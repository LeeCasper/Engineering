'use strict'

/**
 * B 端导出与管理员消息路由（AC-AD61）。
 *
 * 导出任务挂在 `/admin/exports` 而不是 `/admin/projects/exports`：
 * 任务的视角是「我发起的一次导出」，与具体项目无关；
 * 而且 `/admin/projects/export` 那个路径已经用于「发起导出」。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminOperations.controller')

const router = express.Router()
router.use(requireAdmin, requireTenant)

router.get('/', asyncHandler(controller.listExports))
router.get('/:id/download', asyncHandler(controller.downloadExport))

module.exports = router
