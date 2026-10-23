'use strict'

/**
 * C 端考察计划控制器（§4.6 / §7.3）。
 *
 * 坐标为 GCJ-02。这里只做范围合法性校验，无法判断坐标是否真的落在地球上的
 * 某个工地上 —— 有意的位置模拟不在本模块的防御范围内。
 */

const { z } = require('zod')
const AppError = require('../utils/AppError')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const routePlanService = require('../services/routePlan.service')

const originSchema = z.object({
  latitude: z.coerce.number().finite().min(-90, '起点纬度不合法').max(90, '起点纬度不合法'),
  longitude: z.coerce.number().finite().min(-180, '起点经度不合法').max(180, '起点经度不合法'),
  name: z.string().trim().max(100, '起点名称不超过 100 字').optional(),
})

const projectIdsSchema = z
  .array(z.coerce.number().int('项目 ID 不合法').positive('项目 ID 不合法'))
  .min(1, '请至少选择一个工地')
  .max(50, '一次选择的项目过多')

const previewSchema = z.object({
  origin: originSchema,
  projectIds: projectIdsSchema,
  // false = 用户已经手动调整过顺序，服务端不再跑最近邻 / 2-opt
  optimize: z.boolean().optional().default(true),
})

const saveSchema = z.object({
  name: z.string().trim().min(1, '请填写考察计划名称').max(50, '计划名称不超过 50 字'),
  originType: z.enum(['current', 'custom'], { invalid_type_error: '起点类型不合法' }),
  origin: originSchema,
  projectIds: projectIdsSchema,
})

const listQuerySchema = z.object({
  tenantId: z.coerce.number().int().positive().optional(),
})

function parseId(value) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw AppError.badRequest('考察计划 ID 不合法')
  }
  return id
}

/** POST /route-plans/preview */
async function preview(req, res) {
  const input = validate(previewSchema, req.body)
  res.ok(await routePlanService.preview(req.auth.id, input))
}

/** POST /route-plans */
async function save(req, res) {
  const input = validate(saveSchema, req.body)
  res.ok(await routePlanService.save(req.auth.id, input))
}

/** GET /route-plans */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const result = await routePlanService.list(req.auth.id, {
    paging: parsePaging(req.query),
    tenantId: query.tenantId,
  })
  res.page(result.list, result.total, { page: result.page, pageSize: result.pageSize }, {
    maxPoints: result.maxPoints,
  })
}

/** GET /route-plans/:id */
async function detail(req, res) {
  res.ok(await routePlanService.detail(req.auth.id, parseId(req.params.id)))
}

/** DELETE /route-plans/:id */
async function remove(req, res) {
  res.ok(await routePlanService.remove(req.auth.id, parseId(req.params.id)))
}

module.exports = { preview, save, list, detail, remove }
