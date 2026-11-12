'use strict'

/**
 * 后台账号管理路由（挂载于 /api/v1/admin/admin-users）。
 *
 * 全部要求登录态。角色边界（超管 vs 项目管理员）在 service 层判定，
 * 因为判断依据是「目标账号的创建者是不是操作者」，这是数据相关的，
 * 中间件拿不到目标行。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant, requireTenantOwner } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminUser.controller')

const router = express.Router()

// 本文件下所有接口都需要登录态。这里统一挂一次而不是逐条写 ——
// 逐条写就有漏掉的风险，而漏掉的后果是未授权访问
router.use(requireAdmin, requireTenant)

router.get('/', asyncHandler(controller.list))
router.post('/', asyncHandler(controller.create))

// 编辑 / 改角色 / 删除是**租户级**能力（B-1.3 / B-1.10 / AC-AD50）。
// requireTenantOwner 放在路由层是第二道闸：service 里也有一道
// （assertTenantOwner），因为 service 会从别处被调用，路由不是唯一入口
router.put('/:id', requireTenantOwner, asyncHandler(controller.update))
router.put('/:id/role', requireTenantOwner, asyncHandler(controller.updateRole))
router.delete('/:id', requireTenantOwner, asyncHandler(controller.remove))

router.put('/:id/status', asyncHandler(controller.updateStatus))
router.put('/:id/password', asyncHandler(controller.resetPassword))
router.get('/:id/projects', asyncHandler(controller.listGrantedProjects))
// 授予项目数据权限仅租户管理员可操作（AC-AD52）
router.post('/:id/projects', requireTenantOwner, asyncHandler(controller.grantProjects))

module.exports = router
