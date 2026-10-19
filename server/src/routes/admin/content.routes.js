'use strict'

/**
 * B 端内容页路由（挂载于 /api/v1/admin/contents）。
 *
 * AC-U17 明确「内容由后台可维护」，因此写侧必须在后台。
 *
 * 只挂 `requireAdmin`，不收敛到超管：内容维护是运营动作，
 * 项目管理员改一段隐私政策措辞没有越权问题 —— 真正需要收敛的是
 * 能影响业务判定的系统配置（AC-AD67），两者的性质不同。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminContent.controller')

const router = express.Router()

router.use(requireAdmin, requireTenant)

router.get('/', asyncHandler(controller.list))
router.get('/:key', asyncHandler(controller.detail))
router.put('/:key', asyncHandler(controller.save))

module.exports = router
