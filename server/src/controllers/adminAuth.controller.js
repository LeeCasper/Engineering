'use strict'

/**
 * B 端认证控制器。
 *
 * 只做三件事：校验入参、调 service、组装响应。任何业务判断都不写在这里 ——
 * 控制器无法被单测直接调用（要构造 req/res），逻辑放进来就等于放弃测试。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const adminAuthService = require('../services/adminAuth.service')
const captchaService = require('../services/captcha.service')
const adminUserModel = require('../models/adminUser.model')

const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名').max(50, '用户名过长'),
  // 密码不设长度下限：登录时的长度由策略决定是「注册时」的事，
  // 在这里拦会让改过策略前的旧密码无法登录
  password: z.string().min(1, '请输入密码').max(72, '密码过长'),
  captchaId: z.string().min(1, '请先获取验证码').max(64),
  captchaAnswer: z.string().min(1, '请输入验证码').max(10),
  // 租户短标识。两家公司都可以有叫 admin 的账号，租户管理员从专属管理地址
  // （/t/<tenantCode>/login）进入时由前端自动带上
  tenantCode: z.string().trim().max(32).optional(),
  // 登录门户。平台运营与租户管理员使用**不同的登录地址**：
  //   platform → 根地址 /login，只接受平台账号
  //   tenant   → /t/<tenantCode>/login，只接受该租户的账号
  // 不传时保留旧行为（按租户标识/用户名定位），供尚未改造的调用方使用
  portal: z.enum(['platform', 'tenant']).optional(),
})

const changePasswordSchema = z.object({
  oldPassword: z.string().max(72).optional(),
  newPassword: z.string().min(1, '请输入新密码').max(72),
})

/** GET /admin/auth/captcha —— 获取图形验证码（登录前调用，无需鉴权） */
async function getCaptcha(req, res) {
  res.ok(await captchaService.generate())
}

/** POST /admin/auth/login */
async function login(req, res) {
  const input = validate(loginSchema, req.body)
  const result = await adminAuthService.login({ ...input, ip: req.ip })

  res.ok({
    token: result.token,
    expiresIn: result.expiresIn,
    mustChangePassword: result.mustChangePassword,
    admin: result.admin,
  })
}

/** POST /admin/auth/logout */
async function logout(req, res) {
  await adminAuthService.logout(req.auth.tokenIssuedAt, req.auth.id)
  res.ok(null)
}

/** GET /admin/auth/profile —— 当前登录账号 */
async function profile(req, res) {
  const admin = await adminUserModel.findById(req.auth.id)
  res.ok({
    id: admin.id,
    username: admin.username,
    role: admin.role,
    status: admin.status,
    // 平台账号为 null。前端据此区分三层身份与「排障访问」的租户上下文
    tenantId: admin.tenant_id ?? null,
    mustChangePassword: admin.must_change_password === 1,
    passwordChangedAt: admin.password_changed_at,
  })
}

/** POST /admin/auth/change-password —— 本人改密，须验旧密码（AC-AD48） */
async function changePassword(req, res) {
  const input = validate(changePasswordSchema, req.body)
  await adminAuthService.changePassword(req.auth.id, {
    oldPassword: input.oldPassword,
    newPassword: input.newPassword,
    requireOldPassword: true,
  })
  // 改密会自增 token_version，当前 token 立即失效（AC-AD08）。
  // 前端收到这个响应后应跳转登录页，因此不返回新 token —— 让用户重新登录一次，
  // 比悄悄换发一个新 token 更符合「密码已变更」的安全语义。
  res.ok({ relogin: true })
}

module.exports = { getCaptcha, login, logout, profile, changePassword }
