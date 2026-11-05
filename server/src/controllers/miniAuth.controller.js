'use strict'

/**
 * C 端认证控制器（C-1.1）。
 */

const { z } = require('zod')
const config = require('../../config')
const { validate } = require('../utils/validate')
const AppError = require('../utils/AppError')
const storage = require('../storage')
const { normalizeFiles } = require('../middlewares/upload')
const miniAuthService = require('../services/miniAuth.service')
const profileService = require('../services/profile.service')
const userModel = require('../models/user.model')

const loginSchema = z.object({
  code: z.string().min(1, '缺少登录凭证 code').max(128),
  nickname: z.string().trim().max(64).optional(),
  avatar: z.string().trim().max(512).optional(),
})

const bindPhoneSchema = z
  .object({
    // 真实环境走微信侧换取；mock 环境允许直接提交手机号（见 miniAuth.service）
    code: z.string().min(1).max(128).optional(),
    phone: z.string().trim().max(20).optional(),
  })
  .refine((data) => Boolean(data.code || data.phone), { message: '缺少手机号凭证' })

const updateProfileSchema = z.object({
  // 显式传入昵称时不允许空串：空昵称会让「我的」页回落到「微信用户」，
  // 看起来像保存失败，也让后台成员列表失去可辨识的名字
  nickname: z
    .string()
    .trim()
    .min(1, '请输入昵称')
    .max(64, '昵称最多 64 个字符')
    .optional(),
  // 真实姓名允许显式清空（null）；空字符串按 null 处理，避免库里出现空串
  realName: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.union([z.string().trim().max(50, '真实姓名最多 50 个字符'), z.null()]).optional()
  ),
  // 头像仍接受外部 URL（登录时微信可能带过来）；小程序端上传走下面的 /avatar
  avatar: z.string().trim().max(512).optional(),
})

/**
 * AC-U01 的「所属角色」是**项目内**的概念，因此 profile 接受一个可选的
 * projectId。用 query 而不是路径参数：同一个 `GET /auth/profile` 在
 * 「刚登录还没选项目」与「已进入某个项目」两种状态下都要能用，
 * 拆成两个路径会让前端每处调用都得判断一次用哪个。
 */
const profileQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
})

/**
 * AC-U19 的二次确认。
 *
 * 用 `z.literal(true)` 而不是 `confirm: z.boolean()` + 服务层判断：
 * 后者要处理三种输入（缺省 / true / false），而这里只接受一种 ——
 * 少写一个分支，就少一种「前端传了 false 却被当成确认」的可能。
 */
const deactivateSchema = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: '注销后个人资料将被匿名化，请二次确认' }),
  }),
})

/** POST /auth/login —— 微信静默登录 */
async function login(req, res) {
  const input = validate(loginSchema, req.body)
  res.ok(await miniAuthService.login(input))
}

/** POST /auth/bind-phone */
async function bindPhone(req, res) {
  const input = validate(bindPhoneSchema, req.body)
  res.ok(await miniAuthService.bindPhone(req.auth.id, input))
}

/**
 * GET /auth/profile —— 当前用户（C-5.1 / AC-U01 / AC-U02）。
 *
 * AC-U01 要求资料里含「所属角色」。v2.5 起角色是账号级固定的：
 * 工长 / 监理不会因切换项目而变化，业主可参与多个项目。传了 projectId
 * 就回该项目里的角色与是否主工长（Q11）；accountRole 始终返回固定角色。
 */
async function profile(req, res) {
  const query = validate(profileQuerySchema, req.query)
  res.ok(await profileService.getProfile(req.auth.id, query))
}

/** PUT /auth/profile */
async function updateProfile(req, res) {
  const input = validate(updateProfileSchema, req.body)

  // 被邀请进入项目后真实姓名是必填项，不能通过接口把它清空。
  if (input.realName === null && (await profileService.requiresRealName(req.auth.id))) {
    throw AppError.badRequest('加入项目后必须填写真实姓名')
  }

  // 改完昵称头像要把带角色的那份资料回给前端，因此这里也走 profileService
  await userModel.updateProfile(req.auth.id, input)
  const query = validate(profileQuerySchema, req.query)
  res.ok(await profileService.getProfile(req.auth.id, query))
}

/**
 * POST /auth/avatar —— 上传头像（微信 chooseAvatar 返回的是临时文件）。
 *
 * 与 `PUT /auth/profile` 分开：
 * - 资料接口只接收 JSON，便于同时改昵称；
 * - 头像是 multipart，必须先落存储再拿到可访问的绝对 URL。
 *
 * 每次只保留一张：写入新头像后删掉上一张由本系统上传的旧文件。
 * 外部 URL（例如登录时微信带过来的头像）不删，避免误删对方域名下的资源。
 */
async function uploadAvatar(req, res) {
  const files = normalizeFiles(req.files)
  const file = files.find((item) => item.field === 'avatar') || files[0]

  if (!file) throw AppError.badRequest('请选择头像图片')
  if (file.type !== 'image') throw AppError.badRequest('头像仅支持图片')
  // 微信 chooseAvatar 返回的是压缩过的头像，5MB 足够且能挡住误传的大图
  if (file.sizeBytes > 5 * 1024 * 1024) throw AppError.badRequest('头像不得超过 5MB')

  const user = await userModel.findById(req.auth.id)
  if (!user) throw AppError.notFound('用户不存在')

  const saved = await storage.save(file.buffer, { category: 'avatars', ext: file.ext })
  await userModel.updateProfile(req.auth.id, { avatar: saved.url })

  // 只清理本系统 uploads 下的旧头像；storage.remove 内部吞掉 ENOENT
  const marker = `${config.upload.publicPath}/`
  if (user.avatar && String(user.avatar).includes(marker)) {
    await storage.remove(storage.extractKey(user.avatar))
  }

  res.ok(await profileService.getProfile(req.auth.id))
}

/**
 * POST /auth/deactivate —— 注销账号（C-5.9 / AC-U19 / AC-U20）。
 *
 * 返回体只有一个标志位：注销成功后这个 token 已经失效（`requireMini` 会拒），
 * 前端拿不到也不需要更多信息。
 */
async function deactivate(req, res) {
  validate(deactivateSchema, req.body)
  res.ok(await miniAuthService.deactivate(req.auth.id, req.auth))
}

module.exports = { login, bindPhone, profile, updateProfile, uploadAvatar, deactivate }
