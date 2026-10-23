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
const configController = require('../../controllers/adminConfig.controller')
const contentController = require('../../controllers/adminContent.controller')
const operationLogController = require('../../controllers/adminLog.controller')
const loginLogController = require('../../controllers/adminLoginLog.controller')
const dashboardController = require('../../controllers/platformDashboard.controller')

const router = express.Router()

router.use(requireAdmin, requirePlatform)

// 平台数据看板：全国 → 省 → 市；只读租户运营信息，不进入租户业务数据
router.get('/dashboard/overview', asyncHandler(dashboardController.overview))
router.get('/dashboard/region', asyncHandler(dashboardController.region))
router.get('/dashboard/tenants', asyncHandler(dashboardController.tenants))

router.get('/tenants', asyncHandler(controller.list))
router.post('/tenants', asyncHandler(controller.create))

router.get('/tenants/:id', asyncHandler(controller.detail))
router.put('/tenants/:id', asyncHandler(controller.update))
router.put('/tenants/:id/status', asyncHandler(controller.updateStatus))

// ── 平台基础配置（tenant_id IS NULL） ──
// 这不是「平台替租户改配置」：改的是所有租户未覆盖时继承的基线。
// 租户的覆盖值仍在 `/admin/sys-configs`，两者共用同一套校验与缓存。
router.get('/sys-configs', asyncHandler(configController.list))
router.put('/sys-configs/:key', asyncHandler(configController.update))

// ── 平台基础内容页 ──
// 用户协议/隐私政策在登录前就要能读；登录时还不知道用户属于哪个租户，
// 因此必须有一份平台版本。租户发布自己的版本后覆盖它。
router.get('/contents', asyncHandler(contentController.list))
router.get('/contents/:key', asyncHandler(contentController.detail))
router.put('/contents/:key', asyncHandler(contentController.save))

// ── 平台日志中心 ──
// 只查 tenant_id IS NULL 的平台级事件；租户业务日志不在默认视野内。
router.get('/logs/operation/filters', asyncHandler(operationLogController.platformFilters))
router.get('/logs/operation', asyncHandler(operationLogController.platformList))
router.get('/logs/login', asyncHandler(loginLogController.platformList))

module.exports = router
