'use strict'

/**
 * C 端认证路由。路径**逐字照搬**需求文档 §7.3（/auth/login、/auth/bind-phone）。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { createRateLimit } = require('../../middlewares/rateLimit')
const controller = require('../../controllers/miniAuth.controller')

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
router.post('/bind-phone', requireMini, asyncHandler(controller.bindPhone))

/**
 * 注销账号（C-5.9 / AC-U19）。
 *
 * 挂在 `/auth` 下而不是 `/users/me`：注销是**账号生命周期**的终点，
 * 与登录、绑定手机号同属一组（它们都在回答「这个账号是什么状态」）。
 * 需要登录态 —— 注销的是当前 token 对应的账号，不接受传入 userId。
 */
router.post('/deactivate', requireMini, asyncHandler(controller.deactivate))

module.exports = router
