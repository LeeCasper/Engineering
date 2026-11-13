'use strict'

/**
 * B 端考察统计路由（挂载于 /api/v1/admin/visit-stats，B-4.6）。
 *
 * 只读：签到记录是只追加表（AC-N26），后台没有编辑 / 删除入口。
 * 数据权限在 service 层通过 dataScope 施加，与项目列表同源。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminVisit.controller')

const router = express.Router()
router.use(requireAdmin, requireTenant)

// 固定路径段放在根路径之前。虽然这里的根是 `/`（精确匹配），
// 但保持「固定段优先」的写法与项目路由一致，避免以后新增 `/:id` 时踩顺序坑
router.get('/export', asyncHandler(controller.exportStats))
router.get('/', asyncHandler(controller.stats))

module.exports = router
