'use strict'

/**
 * C 端意见反馈路由（C-5.7 / AC-U18）。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { uploadAny } = require('../../middlewares/upload')
const controller = require('../../controllers/feedback.controller')

const router = express.Router()

router.use(requireMini)

// 单张图片暂存：微信一次只能传一个文件，逐张拿到 mediaId 后再提交
router.post('/media', uploadAny, asyncHandler(controller.stageMedia))

// multipart：正文与图片同请求提交。图片数上限在 service 层校验
// （3 张），不在这里 —— 中间件只负责把文件收下来并归一化
router.post('/', uploadAny, asyncHandler(controller.submit))

module.exports = router
