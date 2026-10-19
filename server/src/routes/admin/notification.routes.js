'use strict'

/**
 * B 端管理员消息路由。
 *
 * 与 C 端的 `/notifications` 是两套：接收人一个在 `admin_user`、一个在 `user`。
 * 详见迁移 012 的说明。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminOperations.controller')

const router = express.Router()
router.use(requireAdmin, requireTenant)

router.get('/', asyncHandler(controller.listNotifications))
router.post('/read', asyncHandler(controller.markNotificationsRead))

module.exports = router
