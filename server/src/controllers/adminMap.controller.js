'use strict'

/**
 * B 端地图预览控制器。
 *
 * 只做入参校验与响应组装；地图服务商的空值 / 异常由 mapAdmin.service
 * 收敛成 found / available = false，控制器不把第三方错误打成 500。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { coordinateField } = require('../utils/coordinate')
const mapAdminService = require('../services/mapAdmin.service')

const geocodeQuerySchema = z.object({
  address: z.string().trim().min(1, '请输入地址').max(200, '地址不超过 200 字'),
})

const reverseQuerySchema = z.object({
  longitude: coordinateField('经度', -180, 180),
  latitude: coordinateField('纬度', -90, 90),
})

const staticQuerySchema = z
  .object({
    longitude: coordinateField('经度', -180, 180),
    // 静态地图使用 Web Mercator，越过该纬度无法稳定出图
    latitude: coordinateField('纬度', -85.0511288, 85.0511288),
    zoom: z.coerce.number().int().min(1).max(17).default(16),
    width: z.coerce.number().int().min(120).max(1024).default(640),
    height: z.coerce.number().int().min(80).max(1024).default(360),
    scale: z.coerce.number().int().min(1).max(2).default(2),
  })
  .refine((data) => data.width * data.height <= 640 * 480, {
    message: '地图预览尺寸过大',
    path: ['width'],
  })

/** GET /admin/maps/geocode */
async function geocode(req, res) {
  const query = validate(geocodeQuerySchema, req.query)
  res.ok(await mapAdminService.geocodeAddress(query.address))
}

/** GET /admin/maps/reverse-geocode */
async function reverseGeocode(req, res) {
  const query = validate(reverseQuerySchema, req.query)
  res.ok(await mapAdminService.reverseGeocode(query))
}

/** GET /admin/maps/static */
async function staticMap(req, res) {
  const query = validate(staticQuerySchema, req.query)
  res.ok(await mapAdminService.staticMapPreview(query))
}

module.exports = { geocode, reverseGeocode, staticMap }
