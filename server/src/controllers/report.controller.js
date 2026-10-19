'use strict'

/**
 * C 端进度汇报控制器（C-2.4 / C-2.6 / C-2.8）。
 *
 * ── multipart 的一处特殊之处 ──
 * 提交汇报走 `multipart/form-data`，因此**请求体里的所有字段都是字符串** ——
 * `progress` 是 "40" 不是 40，`itemId` 是 "12" 不是 12。
 * 这里用 `z.coerce` 显式转换，而不是让它们以字符串身份流进 service：
 * 字符串与数字的比较在 JS 里是不相等的，`item.progress === '40'` 会静默为 false。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const { normalizeFiles } = require('../middlewares/upload')
const reportService = require('../services/report.service')

const submitSchema = z.object({
  // AC-P05：工序必选。这里给必填，前端拦一道、服务端再拦一道
  itemId: z.coerce.number({ invalid_type_error: '请选择要汇报的工序' }).int().positive('请选择要汇报的工序'),
  progress: z.string().min(1, '请填写完成度').max(10),
  content: z.string().max(2000, '说明不超过 2000 字').optional(),
  // 幂等键（AC-P10）。由小程序为每次「提交动作」生成并在重试时复用
  clientRequestId: z.string().min(1, '缺少幂等键').max(64),
  // 客户端上报的视频时长（JSON 数组字符串）。未经服务端校验，
  // 只作为 UX 约束 —— 见 report.service.js 的说明
  videoDurations: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return []
      try {
        const parsed = JSON.parse(value)
        if (!Array.isArray(parsed)) throw new Error('not array')
        return parsed.map(Number).filter(Number.isFinite)
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'videoDurations 必须是数字数组的 JSON' })
        return z.NEVER
      }
    }),
})

const commentSchema = z.object({
  content: z.string().trim().min(1, '评论内容不能为空').max(500, '评论不超过 500 字'),
  replyTo: z.coerce.number().int().positive().optional(),
})

const listQuerySchema = z.object({
  itemId: z.coerce.number().int().positive().optional(),
})

/** POST /projects/:id/reports */
async function submit(req, res) {
  const input = validate(submitSchema, req.body)
  const result = await reportService.submitReport(req.auth.id, Number(req.params.id), {
    ...input,
    files: normalizeFiles(req.files),
  })
  res.ok(result)
}

/** GET /projects/:id/reports */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const result = await reportService.listReports(req.auth.id, Number(req.params.id), {
    paging: parsePaging(req.query),
    itemId: query.itemId,
  })
  res.page(result.list, result.total, { page: result.page, pageSize: result.pageSize })
}

/** POST /reports/:id/comments */
async function addComment(req, res) {
  const input = validate(commentSchema, req.body)
  res.ok(await reportService.addComment(req.auth.id, Number(req.params.id), input))
}

/** GET /reports/:id/comments */
async function listComments(req, res) {
  res.ok(await reportService.listComments(req.auth.id, Number(req.params.id)))
}

module.exports = { submit, list, addComment, listComments }
