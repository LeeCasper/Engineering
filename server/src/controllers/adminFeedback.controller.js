'use strict'

/**
 * B 端反馈处理控制器（C-5.7 的后台侧）。
 *
 * 文档只写了 C 端「意见反馈与在线客服」是 P2，**没有定义后台怎么处理**。
 * 但不做读取侧的话，C 端那句「提交成功」就是把内容丢进了一个没人看的表 ——
 * 用户认真写了问题、界面回报成功，而实际上永远不会有人读到。
 * 这属于 §6.3 的漏项，本文件按最小可用补齐：列表 + 置状态 + 写回执。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const feedbackService = require('../services/feedback.service')

const listQuerySchema = z.object({
  // 不传 status 表示看全部；后台默认视图是「待处理」，由前端决定初始值
  status: z.enum(['new', 'processing', 'resolved']).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
})

const handleSchema = z.object({
  status: z.enum(feedbackService.HANDLE_STATUS, {
    errorMap: () => ({ message: '反馈状态只能置为处理中或已处理' }),
  }),
  // 回执可选：有些反馈口头沟通就解决了，强制填回执会让管理员随手敲几个字交差，
  // 那种回执比没有回执更容易误导下一个人
  reply: z.string().trim().max(1000, '回执不超过 1000 字').optional(),
})

/** GET /admin/feedback —— 反馈列表 */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const paging = parsePaging(req.query)
  const result = await feedbackService.list(req.auth, query, paging)
  res.page(result.list, result.total, paging)
}

/** PUT /admin/feedback/:id —— 处理反馈（置状态、写回执） */
async function handle(req, res) {
  const input = validate(handleSchema, req.body)
  res.ok(await feedbackService.handle(Number(req.params.id), input, req.auth))
}

module.exports = { list, handle }
