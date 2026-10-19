'use strict'

/**
 * C 端记账控制器（C-4.1 ~ C-4.12）。
 *
 * 新增流水走 multipart（要带票据照片），因此请求体里的字段都是字符串 ——
 * `stageId` / `paymentNodeId` 用 `z.coerce` 显式转成数字，
 * 不让字符串流进 service（`item.progress === '40'` 这类静默 false 是最难查的 bug）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const { normalizeFiles } = require('../middlewares/upload')
const ledgerService = require('../services/ledger.service')
const operationLog = require('../services/operationLog.service')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 金额以字符串提交，合法性由 service 的 money.validate 统一判定（AC-L03） */
const amountField = z.string().min(1, '请输入金额').max(20)

const dateField = z
  .string()
  .regex(DATE_PATTERN, '日期格式应为 YYYY-MM-DD')

const createSchema = z
  .object({
    type: z.enum(['income', 'expense'], { errorMap: () => ({ message: '流水类型只能是收入或支出' }) }),
    amount: amountField,
    occurredAt: dateField,
    // C-4.11：归属阶段为**必选项**，缺失时直接拒绝而不是落到某个默认阶段。
    // `required_error` / `invalid_type_error` 都要写：字段缺失时 zod 走的是
    // required_error 分支，而 `z.coerce.number()` 对空字符串会先转成 NaN
    // 再落到 invalid_type_error —— 只写 .positive() 的 message 两条都覆盖不到
    stageId: z.coerce
      .number({
        required_error: '登记流水必须归属到具体阶段',
        invalid_type_error: '登记流水必须归属到具体阶段',
      })
      .int('登记流水必须归属到具体阶段')
      .positive('登记流水必须归属到具体阶段'),
    category: z.string().trim().max(20).optional(),
    paymentNodeId: z.coerce.number().int().positive().optional(),
    remark: z.string().trim().max(500, '备注不超过 500 字').optional(),
  })
  .refine((data) => data.type !== 'expense' || Boolean(data.category), {
    message: '请选择支出分类',
    path: ['category'],
  })
  .refine((data) => data.type !== 'income' || Boolean(data.paymentNodeId), {
    message: '新增收入必须关联付款节点',
    path: ['paymentNodeId'],
  })

const updateSchema = z
  .object({
    amount: amountField.optional(),
    occurredAt: dateField.optional(),
    stageId: z.coerce.number().int().positive().optional(),
    category: z.string().trim().max(20).optional(),
    remark: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, '没有需要更新的字段')

const reverseSchema = z.object({
  reason: z.string().trim().min(1, '红冲必须说明原因').max(500, '原因不超过 500 字'),
})

const listQuerySchema = z.object({
  type: z.enum(['income', 'expense']).optional(),
  category: z.string().trim().max(20).optional(),
  stageId: z.coerce.number().int().positive().optional(),
  startDate: z.string().regex(DATE_PATTERN).optional(),
  endDate: z.string().regex(DATE_PATTERN).optional(),
})

const breakdownQuerySchema = z.object({
  startDate: z.string().regex(DATE_PATTERN).optional(),
  endDate: z.string().regex(DATE_PATTERN).optional(),
})

/** 请求上下文（操作日志用）：谁、从哪个 IP、哪个 requestId */
function logContext(req) {
  return operationLog.contextFrom(req)
}

/** GET /projects/:id/ledger/summary —— 账目总览（C-4.1） */
async function summary(req, res) {
  res.ok(await ledgerService.getSummary(req.auth.id, Number(req.params.id)))
}

/** GET /projects/:id/ledger —— 流水列表（C-4.2） */
async function list(req, res) {
  const filters = validate(listQuerySchema, req.query)
  const result = await ledgerService.listLedger(req.auth.id, Number(req.params.id), {
    filters,
    paging: parsePaging(req.query),
  })
  res.page(result.list, result.total, { page: result.page, pageSize: result.pageSize })
}

/** GET /projects/:id/ledger/expense-breakdown —— 支出分类与按月汇总（C-4.5） */
async function breakdown(req, res) {
  const query = validate(breakdownQuerySchema, req.query)
  res.ok(await ledgerService.getExpenseBreakdown(req.auth.id, Number(req.params.id), query))
}

/** GET /projects/:id/ledger/:ledgerId */
async function detail(req, res) {
  res.ok(await ledgerService.getLedgerDetail(req.auth.id, Number(req.params.id), Number(req.params.ledgerId)))
}

/** POST /projects/:id/ledger —— 新增流水（C-4.3 / C-4.4） */
async function create(req, res) {
  const input = validate(createSchema, req.body)
  const payload = { ...input, files: normalizeFiles(req.files) }
  const context = logContext(req)

  const result =
    input.type === 'income'
      ? await ledgerService.createIncome(req.auth.id, Number(req.params.id), payload, context)
      : await ledgerService.createExpense(req.auth.id, Number(req.params.id), payload, context)

  res.ok(result)
}

/** PUT /projects/:id/ledger/:ledgerId */
async function update(req, res) {
  const input = validate(updateSchema, req.body)
  res.ok(
    await ledgerService.updateLedger(
      req.auth.id,
      Number(req.params.id),
      Number(req.params.ledgerId),
      input,
      logContext(req)
    )
  )
}

/** DELETE /projects/:id/ledger/:ledgerId */
async function remove(req, res) {
  res.ok(
    await ledgerService.deleteLedger(
      req.auth.id,
      Number(req.params.id),
      Number(req.params.ledgerId),
      logContext(req)
    )
  )
}

/** POST /projects/:id/ledger/:ledgerId/reverse —— 红冲（AC-L23） */
async function reverse(req, res) {
  const input = validate(reverseSchema, req.body)
  res.ok(
    await ledgerService.reverseLedger(
      req.auth.id,
      Number(req.params.id),
      Number(req.params.ledgerId),
      input,
      logContext(req)
    )
  )
}

/** GET /projects/:id/stages/ledger —— 阶段账目视图（C-4.12） */
async function stageLedger(req, res) {
  res.ok(await ledgerService.getStageLedger(req.auth.id, Number(req.params.id)))
}

/** GET /projects/:id/payment-nodes —— 付款节点列表（C-4.6） */
async function paymentNodes(req, res) {
  res.ok(await ledgerService.listPaymentNodes(req.auth.id, Number(req.params.id)))
}

/** POST /projects/:id/payment-nodes/:nodeId/pay —— 工长登记线下转账（AC-L17） */
async function payNode(req, res) {
  res.ok(
    await ledgerService.payPaymentNode(
      req.auth.id,
      Number(req.params.id),
      Number(req.params.nodeId),
      logContext(req)
    )
  )
}

/** POST /projects/:id/payment-nodes/:nodeId/confirm —— 业主确认付款 */
async function confirmNode(req, res) {
  res.ok(
    await ledgerService.confirmPaymentNode(
      req.auth.id,
      Number(req.params.id),
      Number(req.params.nodeId),
      logContext(req)
    )
  )
}

module.exports = {
  summary,
  list,
  breakdown,
  detail,
  create,
  update,
  remove,
  reverse,
  stageLedger,
  paymentNodes,
  payNode,
  confirmNode,
}
