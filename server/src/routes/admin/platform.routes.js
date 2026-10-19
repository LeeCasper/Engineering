'use strict'

/**
 * 平台运营路由（挂载于 /api/v1/admin/platform）。
 *
 * ── 为什么单独一组路径，而不是在业务路由里加角色判断 ──
 * `requiresPlatform` 是一个角色判断，而角色判断放在每个接口上就变成了
 * 「记得加就安全」的约定 —— 漏一个就是平台越权。这里的做法相反：
 * 所有租户业务路由统一挂 `requireTenant`（默认拒绝平台），
 * 只有本文件这组路径显式对平台开放。要新增一个平台能力，
 * 必须来改这个文件，不可能「顺手」把业务接口开放出去。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requirePlatform } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/platformTenant.controller')

const router = express.Router()

router.use(requireAdmin, requirePlatform)

router.get('/tenants', asyncHandler(controller.list))
router.post('/tenants', asyncHandler(controller.create))

router.get('/tenants/:id', asyncHandler(controller.detail))
router.put('/tenants/:id', asyncHandler(controller.update))
router.put('/tenants/:id/status', asyncHandler(controller.updateStatus))

module.exports = router
