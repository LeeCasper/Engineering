'use strict'

/**
 * 对账控制器（C-4.7 / C-4.8）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const AppError = require('../utils/AppError')
const signedUrl = require('../utils/signedUrl')
const storage = require('../storage')
const reconciliationService = require('../services/reconciliation.service')
const reconciliationModel = require('../models/reconciliation.model')
const operationLog = require('../services/operationLog.service')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const initiateSchema = z
  .object({
    periodStart: z.string().regex(DATE_PATTERN, '起始日期格式应为 YYYY-MM-DD'),
    periodEnd: z.string().regex(DATE_PATTERN, '结束日期格式应为 YYYY-MM-DD'),
    remark: z.string().trim().max(500, '备注不超过 500 字').optional(),
  })
  .refine(
    (data) => {
      // 只做「非空且格式正确」的粗校验，先后顺序由 service 用 datetime 判定 ——
      // 那里能正确处理时区与非法日期（如 2026-02-30）
      return data.periodStart <= data.periodEnd
    },
    { message: '起始日期不得晚于结束日期', path: ['periodEnd'] }
  )

const disputeSchema = z.object({
  detailId: z.coerce.number().int().positive('请指定有异议的明细'),
  remark: z.string().trim().min(1, '异议说明必填').max(500, '异议说明不超过 500 字'),
})

/** POST /projects/:id/reconciliations —— 发起对账（AC-L19） */
async function initiate(req, res) {
  const input = validate(initiateSchema, req.body)
  res.ok(
    await reconciliationService.initiate(req.auth.id, Number(req.params.id), input, operationLog.contextFrom(req))
  )
}

/** GET /projects/:id/reconciliations —— 对账单列表（AC-L22） */
async function list(req, res) {
  res.ok(await reconciliationService.list(req.auth.id, Number(req.params.id)))
}

/**
 * GET /reconciliations/:id —— 对账单详情。
 *
 * 详情路由在顶层（`/reconciliations/:id`）而不是挂在项目下，因此这里先按 id
 * 查出它属于哪个项目，再交给服务层做可见性校验。
 * 不存在时返回与服务层**同一句**提示，避免「不存在」与「无权访问」被对比出差异。
 */
async function detail(req, res) {
  const reconciliation = await reconciliationModel.findById(Number(req.params.id))
  if (!reconciliation) throw AppError.notFound('对账单不存在')

  res.ok(await reconciliationService.getDetail(req.auth.id, reconciliation.project_id, Number(req.params.id)))
}

/** POST /reconciliations/:id/confirm —— 确认对账（AC-L20） */
async function confirm(req, res) {
  res.ok(
    await reconciliationService.confirm(req.auth.id, Number(req.params.id), operationLog.contextFrom(req))
  )
}

/** POST /reconciliations/:id/dispute —— 对某条明细提异议（AC-L21） */
async function dispute(req, res) {
  const input = validate(disputeSchema, req.body)
  res.ok(
    await reconciliationService.dispute(
      req.auth.id,
      Number(req.params.id),
      input,
      operationLog.contextFrom(req)
    )
  )
}

/**
 * GET /reconciliations/:id/settlement.pdf —— 下载结算单（AC-L24）。
 *
 * **不挂登录鉴权**，改验签名：与验收报告同口径（AC-A20），
 * 结算单要能转发给不在系统里的人。因此这里直接读库而不用 service.getDetail ——
 * 后者要求访问者身份，而签名 URL 的设计前提就是「拿到链接的人不在系统里」。
 */
async function downloadSettlement(req, res) {
  const id = Number(req.params.id)

  // 签名校验放在最前：未通过签名的人不该触发任何查询
  signedUrl.verify({
    resource: 'reconciliation-settlement',
    id,
    expires: req.query.expires,
    signature: req.query.sig,
  })

  const row = await reconciliationModel.findById(id)
  if (!row || !row.settlement_pdf_url) throw AppError.notFound('结算单尚未生成')

  const buffer = await storage.read(row.settlement_pdf_url)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="settlement-${id}.pdf"`)
  res.send(buffer)
}

module.exports = { initiate, list, detail, confirm, dispute, downloadSettlement }
