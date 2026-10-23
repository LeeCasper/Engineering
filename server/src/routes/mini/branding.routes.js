'use strict'

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const controller = require('../../controllers/branding.controller')

const router = express.Router()

// 登录前即可读：小程序名称 / Logo
router.get('/', asyncHandler(controller.detail))

module.exports = router
