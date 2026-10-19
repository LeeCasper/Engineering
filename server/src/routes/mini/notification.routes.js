'use strict'

/**
 * C 端消息中心路由（§7.3 的 `/notifications`）。
 *
 * `/notifications/unread-count` 是文档没列、但 AC-U07 的红点与 AC-U10 的
 * 下拉刷新都需要的：红点要在**不拉列表**的前提下刷新，否则每次轮询都要
 * 传一整页消息，且刷新瞬间会把用户正在看的列表抽掉。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const controller = require('../../controllers/notification.controller')
const subscription = require('../../controllers/subscription.controller')

const router = express.Router()

router.use(requireMini)

// 静态段写在前面：目前没有 `/:id`，但保持这个顺序可以避免将来新增
// `/:id` 时把 unread-count 当成一个 id（那是典型的「路由顺序」事故）
router.get('/unread-count', asyncHandler(controller.unreadCount))
router.get('/', asyncHandler(controller.list))
router.post('/read', asyncHandler(controller.markRead))

// 订阅消息授权（C-5.4 / AC-U11~U13）。挂在消息域下而不是 /auth：
// 它是「消息能不能推到微信」的开关，与消息中心是同一件事的两面
router.get('/subscriptions', asyncHandler(subscription.list))
router.post('/subscriptions', asyncHandler(subscription.record))

module.exports = router
