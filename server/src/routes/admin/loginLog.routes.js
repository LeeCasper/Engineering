'use strict'

/**
 * 登录日志路由（B-1.8 / AC-AD51）。
 *
 * 与 `/admin/operation-logs` 分开：两者的权限口径与用途不同，
 * 合并成一个「日志」接口之后，前端无法在路径上区分该按哪套规则过滤。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminLoginLog.controller')

const router = express.Router()
router.use(requireAdmin, requireTenant)

router.get('/', asyncHandler(controller.list))

module.exports = router
