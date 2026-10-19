'use strict'

/**
 * B 端阶段模板路由（挂载于 /api/v1/admin/stage-templates）。
 *
 * 不施加项目级数据权限：模板是全局资源，超管与项目管理员都可以管理（§5.1）。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminTemplate.controller')

const router = express.Router()

router.use(requireAdmin, requireTenant)

router.get('/', asyncHandler(controller.list))
router.post('/', asyncHandler(controller.create))

router.get('/:id', asyncHandler(controller.detail))
router.put('/:id', asyncHandler(controller.update))
router.delete('/:id', asyncHandler(controller.remove))

// 复制与设为默认都是「对模板的某个动作」，用 POST 而不是 PUT ——
// 它们每次调用都会产生新的结果（一个新的模板 / 一次默认标记的转移），不是幂等的替换
router.post('/:id/duplicate', asyncHandler(controller.duplicate))
router.put('/:id/default', asyncHandler(controller.setDefault))

module.exports = router
