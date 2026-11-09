'use strict'

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const controller = require('../../controllers/branding.controller')

const router = express.Router()

// 登录前即可读：小程序名称 / Logo
router.get('/', asyncHandler(controller.detail))
// 登录前即可读：管理后台名称 / Logo / 浏览器图标（B-7.13）
router.get('/admin', asyncHandler(controller.adminDetail))

module.exports = router
