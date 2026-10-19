'use strict'

/**
 * B 端反馈处理路由（挂载于 /api/v1/admin/feedback）。
 *
 * 文档没有定义后台侧（C-5.7 只写了 C 端提交），但不做读取侧的话，
 * C 端那句「提交成功」就是把内容丢进一个没人看的表。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminFeedback.controller')

const router = express.Router()

router.use(requireAdmin, requireTenant)

router.get('/', asyncHandler(controller.list))
router.put('/:id', asyncHandler(controller.handle))

module.exports = router
