'use strict'

/**
 * C 端认证控制器（C-1.1）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
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
  nickname: z.string().trim().max(64).optional(),
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
 * AC-U01 要求资料里含「所属角色」，而本系统的角色**按项目判定**
 * （同一个人可以在 A 项目当业主、在 B 项目当工长），因此传了 projectId
 * 就回该项目里的角色与是否主工长（Q11）。不传则为 null。
 */
async function profile(req, res) {
  const query = validate(profileQuerySchema, req.query)
  res.ok(await profileService.getProfile(req.auth.id, query))
}

/** PUT /auth/profile */
async function updateProfile(req, res) {
  const input = validate(updateProfileSchema, req.body)

  // 改完昵称头像要把带角色的那份资料回给前端，因此这里也走 profileService
  await userModel.updateProfile(req.auth.id, input)
  const query = validate(profileQuerySchema, req.query)
  res.ok(await profileService.getProfile(req.auth.id, query))
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

module.exports = { login, bindPhone, profile, updateProfile, deactivate }
