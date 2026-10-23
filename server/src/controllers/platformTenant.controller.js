'use strict'

/**
 * 平台运营控制器：租户生命周期（M13 / P3）。
 *
 * 挂在 `/api/v1/admin/platform/*`，与租户业务接口共用 `/admin` 前缀但
 * **不挂 `requireTenant`** —— 平台账号正是这里的使用者。
 * 鉴权由 `requireAdmin + requirePlatform` 两层完成。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const datetime = require('../utils/datetime')
const tenantService = require('../services/tenant.service')

const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/

/**
 * 只接受日期或「日期 + 时分秒」，不接受带时区偏移的 ISO 串。
 *
 * 纯日期按**当天结束**理解（`23:59:59`）而不是零点：
 * 运营填「2026-12-31 到期」，客户在当天仍然应该能用；
 * 按零点算的话，那一天 00:00 一过就登不进去了，而合同上写的是「到 12 月 31 日」。
 */
function normalizeExpiresAt(value) {
  const text = value.replace('T', ' ')
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text} 23:59:59` : text
}

const datetimeField = z
  .string()
  .trim()
  .regex(DATETIME_PATTERN, '时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss')
  .refine((value) => datetime.parse(value) !== null, '时间不合法')
  .transform(normalizeExpiresAt)
  .nullable()
  .optional()

const codeField = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,31}$/, '租户标识需为 2-32 位小写字母、数字或 -，且以字母或数字开头')

/**
 * 行政区划代码。名称不接受前端提交 —— 服务端用 regions.json 派生，
 * 避免代码与名称不一致（见 utils/region.js）。
 */
const regionCodeField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, '行政区划代码应为 6 位数字')

const ownerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, '请输入 owner 用户名')
    .max(50, '用户名过长')
    .regex(/^[A-Za-z0-9_.@-]+$/, '用户名只能包含字母、数字与 _ . @ -'),
  // 复杂度策略由 password.validatePolicy 在 service 层校验 ——
  // 那里与「创建后台账号」共用同一条规则，不在这里再写一份
  password: z.string().min(1, '请输入初始密码').max(72),
})

const createSchema = z.object({
  name: z.string().trim().min(1, '请输入公司名称').max(100, '公司名称不超过 100 字'),
  code: codeField,
  plan: z.string().trim().max(32).optional(),
  maxProjects: z.number().int().min(0).max(1_000_000).optional(),
  maxAdminUsers: z.number().int().min(0).max(100_000).optional(),
  trialEndsAt: datetimeField,
  expiresAt: datetimeField,
  contactName: z.string().trim().max(50).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  remark: z.string().trim().max(200).optional(),
  // 新建租户必填地区，用于平台运营的城市统计
  provinceCode: regionCodeField,
  cityCode: regionCodeField,
  owner: ownerSchema,
})

const updateSchema = z
  .object({
    plan: z.string().trim().max(32).optional(),
    maxProjects: z.number().int().min(0).max(1_000_000).optional(),
    maxAdminUsers: z.number().int().min(0).max(100_000).optional(),
    trialEndsAt: datetimeField,
    expiresAt: datetimeField,
    // 允许显式传 null 清空：取消到期时间（改成长期有效）与清空联系人
    // 都是运营会做的动作，只允许「改」不允许「清」会把租户锁在一个
    // 再也改不回去的到期时间上
    contactName: z.string().trim().max(50).nullable().optional(),
    contactPhone: z.string().trim().max(20).nullable().optional(),
    remark: z.string().trim().max(200).nullable().optional(),
    // 老租户可在这里补录；显式传 null 清空，且省、市必须成对出现
    provinceCode: regionCodeField.nullable().optional(),
    cityCode: regionCodeField.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, '没有需要更新的字段')

const statusSchema = z.object({
  status: z.enum(tenantService.STATUSES, {
    errorMap: () => ({ message: '状态只能为 active / suspended / archived' }),
  }),
  reason: z.string().trim().max(200).optional(),
})

const listQuerySchema = z
  .object({
    status: z.enum(tenantService.STATUSES).optional(),
    keyword: z.string().trim().max(50).optional(),
    // 地区筛选与看板共用同一套口径：代码成对出现，未分配与代码互斥
    provinceCode: regionCodeField.optional(),
    cityCode: regionCodeField.optional(),
    unassigned: z
      .enum(['0', '1'])
      .transform((value) => value === '1')
      .optional(),
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

/** GET /admin/platform/tenants —— 租户列表（含用量） */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const paging = parsePaging(req.query)
  const result = await tenantService.list(req.auth, query, paging)
  res.page(result.list, result.total, paging)
}

/** POST /admin/platform/tenants —— 开通租户 */
async function create(req, res) {
  const input = validate(createSchema, req.body)
  res.ok(await tenantService.provision(req.auth, input))
}

/** GET /admin/platform/tenants/:id —— 租户详情 */
async function detail(req, res) {
  res.ok(await tenantService.detail(req.auth, Number(req.params.id)))
}

/** PUT /admin/platform/tenants/:id —— 调整套餐、配额、到期时间与联系人 */
async function update(req, res) {
  const input = validate(updateSchema, req.body)
  res.ok(await tenantService.updateTerms(req.auth, Number(req.params.id), input))
}

/** PUT /admin/platform/tenants/:id/status —— 停用 / 恢复 / 退租 */
async function updateStatus(req, res) {
  const input = validate(statusSchema, req.body)
  res.ok(await tenantService.updateStatus(req.auth, Number(req.params.id), input))
}

module.exports = { list, create, detail, update, updateStatus }
