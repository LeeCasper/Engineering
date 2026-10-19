'use strict'

/**
 * B 端操作日志路由（B-1.9 / AC-AD09）。
 *
 * 路径用 `/admin/operation-logs` 而不是 `/admin/logs`：后台还有登录日志
 * （`admin_login_log`，B-1.8），两者是不同的东西 ——
 * 登录日志记的是「谁在什么时候试图进来」，操作日志记的是「谁改了什么」。
 * 合并成一个「日志」接口之后，权限（登录日志看全部、操作日志项目管理员
 * 只看本人相关）就没法在路径上区分开了。
 *
 * 只挂 requireAdmin，**不挂 requireSuperAdmin**：§5.1 的能力表里
 * 项目管理员也有「操作日志查看」的能力，只是范围被限制在本人相关 ——
 * 那个限制在服务层由 dataScope.buildOperationLogFilter 施加，
 * 而不是靠「不给入口」。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminLog.controller')

const router = express.Router()
router.use(requireAdmin, requireTenant)

// 静态段写在前面，避免将来新增 `/:id` 时把 filters 当成一个 id
router.get('/filters', asyncHandler(controller.filters))
router.get('/', asyncHandler(controller.list))

module.exports = router
