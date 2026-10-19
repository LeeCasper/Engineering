'use strict'

/**
 * C 端消息中心控制器（C-5.3 / AC-U06 ~ AC-U10）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const notificationService = require('../services/notification.service')

/**
 * 一批次最多标记多少条。
 *
 * 前端「全部已读」不该走这里 —— 不传 ids 就是全部，没有条数上限，
 * 也不会有「第 501 条没标上」这种事。这个上限只约束显式列举 id 的场景。
 */
const MAX_READ_IDS = 500

const listQuerySchema = z.object({
  // 白名单而不是自由字符串：类型是 ENUM 列，传一个不存在的值 MySQL 不报错、
  // 只是查不到东西，用户会以为「这一类消息没有」而不是「分类名写错了」
  type: z.enum(notificationService.FILTERABLE_TYPES).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  // 用 enum 而不是 z.coerce.boolean()：Boolean('false') === true，
  // 前端传 unreadOnly=false 会被静默当成「只看未读」
  unreadOnly: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
})

const markReadSchema = z.object({
  // 不传（或空数组）表示全部已读
  ids: z.array(z.number().int().positive()).max(MAX_READ_IDS, `单次最多标记 ${MAX_READ_IDS} 条`).optional(),
})

/** GET /notifications —— 消息列表（AC-U06 / AC-U08） */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const paging = parsePaging(req.query)
  const result = await notificationService.listForUser(req.auth.id, query, paging)
  // unread 是**全局**未读数（红点口径），与本次筛选无关，见 notification.service 的说明
  res.page(result.list, result.total, paging, { unread: result.unread })
}

/** GET /notifications/unread-count —— 未读汇总，供红点与下拉刷新（AC-U07 / AC-U10） */
async function unreadCount(req, res) {
  res.ok(await notificationService.unreadSummary(req.auth.id))
}

/** POST /notifications/read —— 标记已读（AC-U09） */
async function markRead(req, res) {
  const input = validate(markReadSchema, req.body)
  res.ok(await notificationService.markRead(req.auth.id, input.ids))
}

module.exports = { list, unreadCount, markRead }
