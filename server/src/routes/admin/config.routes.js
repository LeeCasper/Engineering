'use strict'

/**
 * B 端系统配置路由（挂载于 /api/v1/admin/sys-configs）。
 *
 * §7.3 只说「PUT /sys-configs/:key 仅超级管理员」，没区分读。这里的取舍是：
 * **读对项目管理员开放、写只给超管**。
 *
 * 理由是两者面对的问题不同：项目管理员看不到配置值时，遇到「为什么超过 9 张照片
 * 就传不上去了」只能去问超管；而配置值本身不含任何商业敏感信息 ——
 * 真正的机密是合同金额与业主手机号，那些走的是项目数据权限。
 * 写操作则相反：改一个阈值会立刻影响全公司所有项目的判定，必须收敛到一个人。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant, requireTenantOwner } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminConfig.controller')

const router = express.Router()

router.use(requireAdmin, requireTenant)

router.get('/', asyncHandler(controller.list))
// AC-AD67：项目管理员修改系统配置返回 403
router.put('/:key', requireTenantOwner, asyncHandler(controller.update))

module.exports = router
