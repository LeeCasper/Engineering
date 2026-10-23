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
const AppError = require('../utils/AppError')
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

const stageMediaSchema = z.object({
  itemId: z.coerce
    .number({ invalid_type_error: '请选择要汇报的工序' })
    .int()
    .positive('请选择要汇报的工序'),
  // 视频时长由客户端上报（服务端没有 ffprobe），暂存时只做单文件上限校验
  duration: z.coerce.number().nonnegative().optional(),
})

const commentSchema = z.object({
  content: z.string().trim().min(1, '评论内容不能为空').max(500, '评论不超过 500 字'),
  replyTo: z.coerce.number().int().positive().optional(),
})

const listQuerySchema = z.object({
  itemId: z.coerce.number().int().positive().optional(),
})

/**
 * 解析暂存附件 ID 列表。
 *
 * `mediaIds` 可能来自三种形态：
 *   - JSON 请求体里的数组：[12, 13]
 *   - multipart 表单里的 JSON 字符串：'[12,13]'
 *   - 兼容旧调试方式的逗号分隔：'12,13'
 *
 * 不把这段放进 zod schema，是因为 zod 的 union 对「字符串里再解析一次 JSON」
 * 表达得很难读，而这里的核心是**归一化**而不是类型校验；类型在归一化后
 * 由下面的整数检查兜住。
 */
function parseMediaIds(value) {
  if (value === undefined || value === null || value === '') return []

  let list
  if (Array.isArray(value)) {
    list = value
  } else if (typeof value === 'string') {
    const text = value.trim()
    if (text.startsWith('[')) {
      try {
        list = JSON.parse(text)
      } catch {
        throw AppError.badRequest('mediaIds 格式不正确')
      }
    } else {
      list = text.split(',')
    }
  } else {
    list = [value]
  }

  if (!Array.isArray(list)) throw AppError.badRequest('mediaIds 格式不正确')

  const ids = list.map((item) => Number(item))
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw AppError.badRequest('mediaIds 必须是正整数数组')
  }
  if (new Set(ids).size !== ids.length) {
    throw AppError.badRequest('附件 ID 不能重复')
  }
  return ids
}

/** POST /projects/:id/reports */
async function submit(req, res) {
  const input = validate(submitSchema, req.body)
  const result = await reportService.submitReport(req.auth.id, Number(req.params.id), {
    ...input,
    // 暂存的附件 ID。与 files 互斥，由 service 再做一次校验。
    mediaIds: parseMediaIds(req.body.mediaIds),
    files: normalizeFiles(req.files),
  })
  res.ok(result)
}

/**
 * POST /projects/:id/reports/media
 *
 * 单文件暂存。小程序一次只能传一个文件，前端逐张上传拿到 mediaId，
 * 最后在提交汇报时一次性带上。这里直接拒绝多文件，避免前端误以为
 * 「一次传多张」也被支持而拿到一堆无法对应到 mediaId 的响应。
 */
async function stageMedia(req, res) {
  const input = validate(stageMediaSchema, req.body)
  const files = normalizeFiles(req.files)

  if (files.length === 0) {
    throw AppError.badRequest('请选择要上传的文件')
  }
  if (files.length > 1) {
    throw AppError.badRequest('一次只能上传一个文件')
  }

  const result = await reportService.stageMedia(req.auth.id, Number(req.params.id), {
    ...input,
    file: files[0],
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

module.exports = { submit, stageMedia, list, addComment, listComments }
