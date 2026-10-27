'use strict'

/**
 * 地图预览路由（挂载于 /api/v1/admin/maps）。
 *
 * 与 /projects/:id 分开挂载，避免固定路径被当成项目 id；
 * 所有接口都要求租户管理员身份，平台账号不能借这里消耗租户地图配额。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const controller = require('../../controllers/adminMap.controller')

const router = express.Router()

router.use(requireAdmin, requireTenant)
router.use((req, res, next) => {
  // 地图包含管理员当前选中的位置，不交给浏览器 / 代理缓存
  res.set('Cache-Control', 'no-store')
  next()
})

router.get('/geocode', asyncHandler(controller.geocode))
router.get('/reverse-geocode', asyncHandler(controller.reverseGeocode))
router.get('/static', asyncHandler(controller.staticMap))

module.exports = router
