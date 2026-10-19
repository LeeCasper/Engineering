'use strict'

/**
 * 认证相关的测试辅助。
 *
 * 验证码答案从缓存直接读取，而不是给生产接口加一个「调试用」的回显字段 ——
 * 测试与服务器同进程（supertest 打的是 createApp() 的返回值），
 * 读缓存是这个进程内的正常操作，不需要为此在接口上开口子。
 */

const db = require('../../../src/db/pool')
const cache = require('../../../src/cache')
const password = require('../../../src/utils/password')
const captchaService = require('../../../src/services/captcha.service')
const request = require('./request')

/**
 * 直接建一个后台账号，绕过接口。
 * 用于准备测试前置状态 —— 若用接口创建，测试就依赖了另一条待测链路，
 * 一条链路坏掉会连带另一片用例全红，排查时反而更费劲。
 */
async function createAdmin({
  username,
  plainPassword = 'Test123456',
  role = 'admin',
  status = 'active',
  mustChangePassword = 0,
  createdBy = null,
  passwordHash,
  // 默认落在租户 #1；平台账号显式传 tenantId: null + role: 'platform'
  tenantId = 1,
}) {
  const hash = passwordHash || (await password.hash(plainPassword))
  const result = await db.query(
    `INSERT INTO admin_user (tenant_id, username, password_hash, role, status, must_change_password, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, username, hash, role, status, mustChangePassword ? 1 : 0, createdBy]
  )
  return { id: result.insertId, username, plainPassword, role, status }
}

/** 取一个验证码，返回 { captchaId, answer } */
async function fetchCaptcha() {
  const res = await request.get('/admin/auth/captcha')
  const captchaId = res.body.data.captchaId
  const answer = await cache.get(captchaService._key(captchaId))
  return { captchaId, answer }
}

/**
 * 完整登录，返回 { token, body, status }。
 * 不抛错：很多用例要断言的就是「登录失败」，让调用方自己看 status。
 */
async function login(username, plainPassword, extra = {}) {
  const { captchaId, answer } = await fetchCaptcha()
  const res = await request.post('/admin/auth/login').send({
    username,
    password: plainPassword,
    captchaId,
    captchaAnswer: answer,
    // portal / tenantCode 等门户参数由用例显式传入
    ...extra,
  })
  return { status: res.status, body: res.body, token: res.body.data && res.body.data.token }
}

/** 断言失败用：期望登录失败并返回响应体 */
async function loginExpectFailure(username, plainPassword, extra = {}) {
  const result = await login(username, plainPassword, extra)
  if (result.status === 200) {
    throw new Error(`期望登录失败，但成功了：${username}`)
  }
  return result
}

/** 建号 + 登录，一步拿到可用 token。账号默认不需要改密 */
async function createAndLogin(options = {}) {
  const admin = await createAdmin(options)
  const { token, body } = await login(admin.username, admin.plainPassword)
  return { admin, token, loginBody: body }
}

module.exports = { createAdmin, fetchCaptcha, login, loginExpectFailure, createAndLogin }
