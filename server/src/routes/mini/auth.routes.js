'use strict'

/**
 * C 端认证路由。路径**逐字照搬**需求文档 §7.3（/auth/login、/auth/bind-phone）。
 */

const express = require('express')
const config = require('../../../config')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { uploadAny, uploadAvatar } = require('../../middlewares/upload')
const { createRateLimit } = require('../../middlewares/rateLimit')
const controller = require('../../controllers/miniAuth.controller')
const realNameController = require('../../controllers/miniRealName.controller')
const adminController = require('../../controllers/miniAdminAuth.controller')

const router = express.Router()

/**
 * 登录接口限流。
 *
 * 比 B 端宽松（60 次/分钟）：小程序端 `wx.login()` 的 code 是一次性的，
 * 用户重进页面、切前后台都会触发一次静默登录，频率天然高于后台的手工登录。
 * 限得太紧会把正常的自动登录拦掉，而用户体验是「打开小程序一直转圈」。
 */
const loginRateLimit = createRateLimit({
  scope: 'mini-login',
  max: 60,
  identity: (req) => req.ip,
  message: '登录过于频繁，请稍后再试',
})

router.post('/login', loginRateLimit, asyncHandler(controller.login))

router.get('/profile', requireMini, asyncHandler(controller.profile))
router.put('/profile', requireMini, asyncHandler(controller.updateProfile))
// 微信 chooseAvatar 返回临时文件，必须由服务端转存后才能长期展示
router.post('/avatar', requireMini, uploadAvatar, asyncHandler(controller.uploadAvatar))
router.post('/bind-phone', requireMini, asyncHandler(controller.bindPhone))

/**
 * 实名认证（姓名 + 身份证号）。
 *
 * 被邀请后必须完成认证才能确认邀请；未被邀请时也可自愿提交。
 * 单独限流：证件号校验是最容易被脚本反复尝试的入口。
 */
const realNameRateLimit = createRateLimit({
  scope: 'mini-real-name',
  max: config.realName.maxAttemptsPerMinute,
  identity: (req) => (req.auth ? `${req.ip}|${req.auth.id}` : req.ip),
  message: '实名认证提交过于频繁，请稍后再试',
})

router.get('/real-name', requireMini, asyncHandler(realNameController.status))
router.post(
  '/real-name/verify',
  requireMini,
  realNameRateLimit,
  asyncHandler(realNameController.verify)
)

/**
 * 注销账号（C-5.9 / AC-U19）。
 *
 * 挂在 `/auth` 下而不是 `/users/me`：注销是**账号生命周期**的终点，
 * 与登录、绑定手机号同属一组（它们都在回答「这个账号是什么状态」）。
 * 需要登录态 —— 注销的是当前 token 对应的账号，不接受传入 userId。
 */
router.post('/deactivate', requireMini, asyncHandler(controller.deactivate))

/**
 * 小程序管理端的微信免密入口。
 *
 * C token 只证明微信身份；换到的是普通管理员 token，之后仍然走 /admin/*。
 * 免密登录单独限流，避免绑定 id 被反复尝试。
 */
const wechatLoginRateLimit = createRateLimit({
  scope: 'mini-admin-wechat-login',
  max: 20,
  identity: (req) => (req.auth ? `${req.ip}|${req.auth.id}` : req.ip),
  message: '操作过于频繁，请稍后再试',
})

router.get('/admin/bindings', requireMini, asyncHandler(adminController.listBindings))
router.post(
  '/admin/wechat-login',
  requireMini,
  wechatLoginRateLimit,
  asyncHandler(adminController.wechatLogin)
)

module.exports = router
