'use strict'

/**
 * C 端静态内容页路由（C-5.8 / AC-U17）。
 *
 * 挂 `/contents/:key` 而不是 `/about`、`/agreement`、`/privacy` 三个路径：
 * 三者是同一件事（读一段由后台维护的文本），差异只在 key 上。
 * 拆成三个路径意味着将来加一个「帮助中心」要动路由表和前端两处。
 *
 * **不需要登录态**：用户协议与隐私政策必须在**注册/登录之前**就能读到，
 * 否则「用户如何得知自己的信息会被怎么用」在流程上就不成立。
 * 内容本身是面向公众的文本，没有敏感信息。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const controller = require('../../controllers/content.controller')

const router = express.Router()

router.get('/:key', asyncHandler(controller.detail))

module.exports = router
