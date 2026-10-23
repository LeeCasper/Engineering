'use strict'

/**
 * 管理员微信绑定（小程序管理端）。
 *
 * 只做入参整理与响应；所有安全判断在 adminWechatBinding.service.js。
 */

const AppError = require('../utils/AppError')
const adminWechatBindingService = require('../services/adminWechatBinding.service')

function miniToken(req) {
  const token = req.get('x-mini-token')
  if (!token) throw AppError.badRequest('缺少微信身份凭证')
  return token.trim()
}

function context(req) {
  return { ip: req.ip || null, requestId: req.id || null }
}

/** GET /admin/auth/wechat-binding */
async function status(req, res) {
  res.ok(await adminWechatBindingService.statusForAdmin(req.auth))
}

/** POST /admin/auth/wechat-binding */
async function bind(req, res) {
  res.ok(await adminWechatBindingService.bind(req.auth, miniToken(req), context(req)))
}

/** DELETE /admin/auth/wechat-binding */
async function unbind(req, res) {
  res.ok(await adminWechatBindingService.unbind(req.auth, context(req)))
}

module.exports = { status, bind, unbind }
