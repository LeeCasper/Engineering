'use strict'

/**
 * 后台登录日志查询（B-1.8 / AC-AD51）。
 *
 * 与操作日志是两个接口：登录日志回答「谁在什么时候试图进来」，
 * 操作日志回答「谁改了什么」。权限也不同 —— 租户管理员看本租户全部，
 * 项目管理员只看自己的登录记录；`tenant_id IS NULL` 的失败记录
 * （用户名猜错、不知道属于哪个租户）不对任何租户开放。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const loginLogModel = require('../models/adminLoginLog.model')

const listQuerySchema = z.object({
  username: z.string().trim().max(50).optional(),
  result: z.enum(['success', 'failed']).optional(),
  adminUserId: z.coerce.number().int().positive().optional(),
})

function shape(row) {
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    username: row.username,
    loginAt: row.login_at,
    ip: row.ip,
    result: row.result,
    failReason: row.fail_reason,
  }
}

/** GET /admin/login-logs */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const paging = parsePaging(req.query)

  // 项目管理员不能通过 adminUserId 参数看别人 —— 强制改成自己。
  // 这条与操作日志的「仅本人相关」是同一类边界。
  const adminUserId = req.auth.role === 'owner' ? query.adminUserId : req.auth.id

  const { total, rows } = await loginLogModel.list({
    offset: paging.offset,
    limit: paging.limit,
    tenantId: req.auth.tenantId,
    adminUserId,
    username: query.username,
    result: query.result,
  })

  res.page(rows.map(shape), total, paging)
}

module.exports = { list }
