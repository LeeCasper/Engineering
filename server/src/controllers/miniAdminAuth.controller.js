'use strict'

/**
 * C 端：小程序管理员的微信免密入口。
 *
 * 这两个接口只证明「当前微信是谁」，换到的仍然是普通管理员 JWT；
 * 它们不直接读写任何租户业务数据。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const adminWechatBindingService = require('../services/adminWechatBinding.service')

const loginSchema = z.object({
  bindingId: z.coerce.number().int().positive('请选择要进入的管理身份'),
})

/** GET /auth/admin/bindings */
async function listBindings(req, res) {
  res.ok(await adminWechatBindingService.listForMiniUser(req.auth))
}

/** POST /auth/admin/wechat-login */
async function wechatLogin(req, res) {
  const input = validate(loginSchema, req.body)
  res.ok(
    await adminWechatBindingService.wechatLogin(input.bindingId, req.auth, {
      ip: req.ip || null,
      requestId: req.id || null,
    })
  )
}

module.exports = { listBindings, wechatLogin }
