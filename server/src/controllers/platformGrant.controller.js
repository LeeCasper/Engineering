'use strict'

/**
 * 排障授权控制器（M13 / P4）。
 *
 * 由**租户管理员**操作，不是平台。平台不能给自己开窗 ——
 * 这是「默认不可见」能在合同里写清楚的前提。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const datetime = require('../utils/datetime')
const service = require('../services/platformAccess.service')

const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/

/**
 * 授权截止时间必须**显式给出**（表结构也是 NOT NULL）。
 * 纯日期按当天结束理解，与平台调整到期时间的口径一致。
 */
const expiresAtField = z
  .string()
  .trim()
  .regex(DATETIME_PATTERN, '时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss')
  .refine((value) => datetime.parse(value) !== null, '时间不合法')
  .transform((value) => {
    const text = value.replace('T', ' ')
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text} 23:59:59` : text
  })

const grantSchema = z
  .object({
    // id 与用户名二选一：平台客服通常报用户名，后台界面里更容易拿到 id
    adminUserId: z.number().int().positive().optional(),
    adminUsername: z.string().trim().min(1).max(50).optional(),
    reason: z.string().trim().max(200, '事由不超过 200 字').optional(),
    expiresAt: expiresAtField,
  })
  .refine((value) => (value.adminUserId != null) !== (value.adminUsername != null), {
    message: '请提供 adminUserId 或 adminUsername（二选一）',
    path: ['adminUserId'],
  })

/** GET /admin/platform-grants —— 本租户的授权记录（含历史） */
async function list(req, res) {
  const paging = parsePaging(req.query)
  const result = await service.list(req.auth, paging)
  res.page(result.list, result.total, paging)
}

/** POST /admin/platform-grants —— 授予一个临时窗口 */
async function create(req, res) {
  const input = validate(grantSchema, req.body)
  res.ok(await service.grant(req.auth, input))
}

/** DELETE /admin/platform-grants/:id —— 立即撤销 */
async function revoke(req, res) {
  res.ok(await service.revoke(req.auth, Number(req.params.id)))
}

module.exports = { list, create, revoke }
