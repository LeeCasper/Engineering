'use strict'

/**
 * 私有文件签名下载。
 *
 * 与验收报告 / 结算单 PDF 一样，这个路由**不能**挂 requireMini：
 * 链接要能直接放进 `<image src>`，而微信的图片请求不带 Authorization。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const controller = require('../../controllers/privateFile.controller')

const router = express.Router()

router.get('/', asyncHandler(controller.download))

module.exports = router
