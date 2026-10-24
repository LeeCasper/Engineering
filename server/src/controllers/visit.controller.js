'use strict'

/**
 * 现场签到控制器（C-6.13 ~ C-6.20）。
 *
 * 签到照片走两步：小程序先逐张调 `/visits/media` 暂存，再提交 JSON，
 * 因此提交接口本身不接收 multipart —— 照片的归属与顺序由 mediaIds 表达。
 */

const { z } = require('zod')
const AppError = require('../utils/AppError')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const { normalizeFiles } = require('../middlewares/upload')
const visitService = require('../services/visit.service')

/**
 * 坐标字段。
 *
 * `z.coerce.number()` 会把空串 / null 强转成 0，直接放行就等于接受「0,0」这个
 * 明显不是现场的位置。先 preprocess 成 undefined，让 zod 按缺失值报错。
 */
function coordinate(min, max) {
  return z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce
      .number({ invalid_type_error: '无法获取当前位置' })
      .min(min)
      .max(max)
  )
}

const submitSchema = z
  .object({
    latitude: coordinate(-90, 90),
    longitude: coordinate(-180, 180),
    mediaIds: z
      .array(z.coerce.number().int().positive())
      .min(1, '请至少上传 1 张现场照片')
      .max(3, '现场照片最多 3 张'),
    remark: z.string().trim().max(1000, '备注不超过 1000 字').optional(),
    abnormalReason: z.string().trim().max(500, '异常说明不超过 500 字').optional(),
    routePlanId: z.coerce.number().int().positive().optional(),
    seqInPlan: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (data) =>
      (data.routePlanId === undefined) === (data.seqInPlan === undefined),
    { message: '考察计划与站点序号必须同时提供', path: ['routePlanId'] }
  )

function parseId(value, label = 'ID') {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest(`${label}不合法`)
  return id
}

/** GET /projects/:id/visits/meta */
async function meta(req, res) {
  const projectId = parseId(req.params.id, '项目 ID')
  res.ok(await visitService.getMeta(req.auth.id, projectId))
}

/** POST /projects/:id/visits/media */
async function stageMedia(req, res) {
  const projectId = parseId(req.params.id, '项目 ID')
  const files = normalizeFiles(req.files)

  if (files.length === 0) throw AppError.badRequest('请选择要上传的照片')
  if (files.length > 1) throw AppError.badRequest('一次只能上传一张照片')

  res.ok(
    await visitService.stageMedia(req.auth.id, projectId, { file: files[0] })
  )
}

/** POST /projects/:id/visits */
async function submit(req, res) {
  const projectId = parseId(req.params.id, '项目 ID')
  const input = validate(submitSchema, req.body)
  res.ok(await visitService.submitVisit(req.auth.id, projectId, input))
}

/** GET /projects/:id/visits */
async function list(req, res) {
  const projectId = parseId(req.params.id, '项目 ID')
  const paging = parsePaging(req.query)
  const result = await visitService.listVisits(req.auth.id, projectId, { paging })
  res.page(result.list, result.total, { page: result.page, pageSize: result.pageSize })
}

/** GET /visits/:id */
async function detail(req, res) {
  const visitId = parseId(req.params.id, '签到记录 ID')
  res.ok(await visitService.getVisit(req.auth.id, visitId))
}

module.exports = { meta, stageMedia, submit, list, detail }
