'use strict'

/**
 * 电子签服务商回调。
 *
 * 这个路由必须在 `express.json()` 之前挂载，并用 express.raw 保留原始 body；
 * 验签依赖原始字节，JSON 重新序列化后签名一定对不上。
 */

const express = require('express')
const asyncHandler = require('../utils/asyncHandler')
const controller = require('../controllers/esign.controller')

const router = express.Router()

router.post('/:provider', asyncHandler(controller.callback))

module.exports = router
