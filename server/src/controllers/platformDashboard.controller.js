'use strict'

/**
 * 平台运营数据看板控制器。
 *
 * 所有接口挂在 `/admin/platform/dashboard/*`，由 platform.routes 的
 * `requireAdmin + requirePlatform` 统一保护。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const dashboardService = require('../services/platformDashboard.service')
const tenantService = require('../services/tenant.service')

const codeField = z.string().trim().regex(/^\d{6}$/, '行政区划代码应为 6 位数字').optional()
const unassignedField = z
  .enum(['0', '1'])
  .transform((value) => value === '1')
  .optional()

const regionQuerySchema = z
  .object({
    provinceCode: codeField,
    cityCode: codeField,
    unassigned: unassignedField,
  })
  .superRefine((data, ctx) => {
    if (data.unassigned && (data.provinceCode || data.cityCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '未分配地区不能同时指定省份或城市',
        path: ['unassigned'],
      })
    }
    if (data.cityCode && !data.provinceCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '请选择省份',
        path: ['provinceCode'],
      })
    }
    if (!data.unassigned && !data.provinceCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '请选择省份，或查看未分配地区',
        path: ['provinceCode'],
      })
    }
  })

const tenantsQuerySchema = z
  .object({
    provinceCode: codeField,
    cityCode: codeField,
    unassigned: unassignedField,
    status: z.enum(tenantService.STATUSES).optional(),
    keyword: z.string().trim().max(50).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.unassigned && (data.provinceCode || data.cityCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '未分配地区不能同时指定省份或城市',
        path: ['unassigned'],
      })
    }
    if (data.cityCode && !data.provinceCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '请选择省份',
        path: ['provinceCode'],
      })
    }
  })

/** GET /admin/platform/dashboard/overview */
async function overview(req, res) {
  res.ok(await dashboardService.overview())
}

/** GET /admin/platform/dashboard/region */
async function region(req, res) {
  const query = validate(regionQuerySchema, req.query)
  res.ok(await dashboardService.regionDetail(query))
}

/** GET /admin/platform/dashboard/tenants */
async function tenants(req, res) {
  const query = validate(tenantsQuerySchema, req.query)
  const paging = parsePaging(req.query)
  const result = await dashboardService.tenants(req.auth, query, paging)
  res.page(result.list, result.total, paging)
}

module.exports = { overview, region, tenants }
