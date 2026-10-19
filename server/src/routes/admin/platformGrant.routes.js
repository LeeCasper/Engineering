'use strict'

/**
 * 排障授权路由（挂载于 /api/v1/admin/platform-grants）。
 *
 * 三层鉴权：
 *   requireAdmin        —— 必须登录
 *   requireTenant       —— 必须是租户账号。平台即使持有效授权进来，
 *                          也会因为 requireTenantOwner 被拦下（不能自己续窗）
 *   requireTenantOwner  —— 只有租户管理员能授予/撤销
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant, requireTenantOwner } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/platformGrant.controller')

const router = express.Router()

router.use(requireAdmin, requireTenant, requireTenantOwner)

router.get('/', asyncHandler(controller.list))
router.post('/', asyncHandler(controller.create))
// 撤销用 DELETE：授权不是可编辑对象，只有「生效」与「已撤销」两种状态
router.delete('/:id', asyncHandler(controller.revoke))

module.exports = router
