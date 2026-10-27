'use strict'

/**
 * B 端成员目录路由（挂载于 /api/v1/admin/members）。
 *
 * 跨项目只读列表，供管理端「成员」tab 使用。写操作仍在 /projects/:id/members：
 * 邀请与移除都必须绑定具体项目，不能从目录里直接改。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminMember.controller')

const router = express.Router()

router.use(requireAdmin, requireTenant)

router.get('/', asyncHandler(controller.list))

module.exports = router
