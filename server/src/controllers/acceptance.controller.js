'use strict'

/**
 * 验收控制器（C-3.x）。
 *
 * 发起、驳回走 multipart（要带现场照片 / 驳回凭证）；通过也走 multipart ——
 * 业主确认时的电子签名是**一次性提交**的：签名与确认必须是一个动作，
 * 分两步会让「签了名但没确认」这种中间态留在库里，而它没有任何业务含义。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { normalizeFiles } = require('../middlewares/upload')
const acceptanceService = require('../services/acceptance.service')
const acceptancePdfService = require('../services/acceptancePdf.service')
const signedUrl = require('../utils/signedUrl')
const storage = require('../storage')
const AppError = require('../utils/AppError')
const acceptanceModel = require('../models/acceptance.model')

const createSchema = z
  .object({
    stageId: z.coerce.number().int().positive().optional(),
    itemId: z.coerce.number().int().positive().optional(),
    description: z.string().trim().max(1000, '验收说明不超过 1000 字').optional(),
  })
  .refine((data) => data.stageId || data.itemId, { message: '请选择要验收的阶段或工序' })

const itemResultSchema = z.object({
  id: z.coerce.number().int().positive(),
  result: z.enum(['pass', 'fail']).nullable().optional(),
  remark: z.string().trim().max(500).optional(),
})

const draftSchema = z.object({
  description: z.string().trim().max(1000).optional(),
  items: z.array(itemResultSchema).max(200).optional(),
})

const selfCheckSchema = draftSchema.refine(
  (data) => data.items !== undefined || data.description !== undefined,
  '没有需要提交的内容'
)

const rejectSchema = z.object({
  reason: z.string().trim().min(1, '驳回原因必填').max(500, '驳回原因不超过 500 字'),
})

const resubmitSchema = z.object({
  description: z.string().trim().max(1000).optional(),
  items: z.array(itemResultSchema).max(200).optional(),
})

/** POST /projects/:id/acceptances —— 发起验收（C-3.2） */
async function create(req, res) {
  const input = validate(createSchema, req.body)
  res.ok(
    await acceptanceService.createAcceptance(req.auth.id, Number(req.params.id), {
      ...input,
      files: normalizeFiles(req.files),
    })
  )
}

/** GET /projects/:id/acceptances —— 某项目的验收列表（C-3.1 / AC-A23） */
async function list(req, res) {
  res.ok(await acceptanceService.listAcceptances(req.auth.id, Number(req.params.id)))
}

/** GET /acceptances —— 跨项目验收收件箱（验收 tab 的默认视图） */
async function inbox(req, res) {
  res.ok(await acceptanceService.inbox(req.auth.id))
}

/** GET /acceptances/:id —— 详情 */
async function detail(req, res) {
  res.ok(await acceptanceService.getDetail(req.auth.id, Number(req.params.id)))
}

/** GET /acceptances/:id/flow —— 流转记录（C-3.9） */
async function flow(req, res) {
  res.ok(await acceptanceService.getFlow(req.auth.id, Number(req.params.id)))
}

/** PUT /acceptances/:id —— 保存草稿（AC-A08） */
async function saveDraft(req, res) {
  const input = validate(draftSchema, req.body)
  res.ok(await acceptanceService.saveDraft(req.auth.id, Number(req.params.id), input))
}

/** POST /acceptances/:id/self-check —— 提交自检（AC-A07/A09） */
async function selfCheck(req, res) {
  const input = validate(selfCheckSchema, req.body)
  res.ok(await acceptanceService.submitSelfCheck(req.auth.id, Number(req.params.id), input))
}

/** POST /acceptances/:id/approve —— 当前环节通过（监理或业主，界面层不区分） */
async function approve(req, res) {
  const files = normalizeFiles(req.files)
  // AC-A16：业主确认时必须带签名图。字段名固定为 signature，
  // 与「现场照片」区分开 —— 不能靠数组顺序猜哪张是签名
  const signature = files.find((f) => f.field === 'signature')
  res.ok(await acceptanceService.approve(req.auth.id, Number(req.params.id), { signatureFile: signature }))
}

/** POST /acceptances/:id/reject —— 驳回（AC-A11/A12） */
async function reject(req, res) {
  const input = validate(rejectSchema, req.body)
  res.ok(
    await acceptanceService.reject(req.auth.id, Number(req.params.id), {
      reason: input.reason,
      files: normalizeFiles(req.files),
    })
  )
}

/** POST /acceptances/:id/resubmit —— 整改后重新提交（AC-A14） */
async function resubmit(req, res) {
  const input = validate(resubmitSchema, req.body)
  res.ok(await acceptanceService.resubmit(req.auth.id, Number(req.params.id), input))
}

/** POST /acceptances/:id/report/retry —— PDF 生成失败后重试（AC-A19） */
async function retryPdf(req, res) {
  const id = Number(req.params.id)
  await acceptanceService.getDetail(req.auth.id, id) // 复用可见性校验
  await acceptancePdfService.retry(id)
  res.ok(await acceptanceService.getDetail(req.auth.id, id))
}

/**
 * GET /acceptances/:id/report.pdf —— 下载验收报告（AC-A20）。
 *
 * **不挂登录鉴权**，改验签名：报告要能转发给不在系统里的人（律师、物业、家人），
 * 走登录鉴权转发出去对方打不开。链接 2 小时有效，过期后重新获取即可。
 */
async function downloadPdf(req, res) {
  const id = Number(req.params.id)

  // 签名校验替代登录校验。放在最前：未通过签名的人不该触发任何查询
  signedUrl.verify({ resource: 'acceptance-report', id, expires: req.query.expires, signature: req.query.sig })

  // 这里直接读库而不用 service.getDetail —— 后者要求访问者身份，
  // 而签名 URL 的设计前提就是「拿到链接的人不在系统里」
  const row = await acceptanceModel.findById(id)
  if (!row || row.report_pdf_status !== 'success' || !row.report_pdf_url) {
    throw AppError.notFound('验收报告尚未生成')
  }

  const buffer = await storage.read(row.report_pdf_url)
  res.setHeader('Content-Type', 'application/pdf')
  // inline 而不是 attachment：多数场景是在手机里直接看，而不是下载到本地
  res.setHeader('Content-Disposition', `inline; filename="acceptance-${id}.pdf"`)
  res.send(buffer)
}

module.exports = {
  create,
  list,
  inbox,
  detail,
  flow,
  saveDraft,
  selfCheck,
  approve,
  reject,
  resubmit,
  retryPdf,
  downloadPdf,
}
