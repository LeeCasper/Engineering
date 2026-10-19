'use strict'

/**
 * B 端认证路由（挂载于 /api/v1/admin/auth）。
 *
 * 公开接口只有「取验证码」与「登录」，其余全部要求登录态。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin } = require('../../middlewares/adminAuth')
const { createRateLimit } = require('../../middlewares/rateLimit')
const controller = require('../../controllers/adminAuth.controller')

const router = express.Router()

/**
 * 登录接口的专用限流，比全局的 60 次/分钟严格得多。
 *
 * 按「IP + 用户名」计数而不是只按 IP：只按 IP 时，一个公司出口 IP 后面的
 * 所有人共享配额，同事输错几次会把别人一起锁在门外；带上用户名则
 * 针对某个账号的爆破被单独限流，跨账号的撞库仍受 IP 维度约束。
 *
 * 上限 10 次/分钟是给人类留的余量（换验证码、手滑打错），
 * 对脚本来说远低于有效爆破速率，且 AC-AD03 的 5 次锁定会更早生效。
 */
const loginRateLimit = createRateLimit({
  scope: 'admin-login',
  max: 10,
  identity: (req) => {
    const username = req.body && req.body.username ? String(req.body.username).slice(0, 50) : 'anonymous'
    return `${req.ip}|${username}`
  },
  message: '登录尝试过于频繁，请稍后再试',
})

router.get('/captcha', asyncHandler(controller.getCaptcha))
router.post('/login', loginRateLimit, asyncHandler(controller.login))

router.post('/logout', requireAdmin, asyncHandler(controller.logout))
router.get('/profile', requireAdmin, asyncHandler(controller.profile))
router.post('/change-password', requireAdmin, asyncHandler(controller.changePassword))

module.exports = router
