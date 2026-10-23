'use strict'

/**
 * B 端项目管理控制器（B-2.x）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const money = require('../utils/money')
const datetime = require('../utils/datetime')
const projectService = require('../services/project.service')
const projectMemberService = require('../services/projectMember.service')
const paymentNodeService = require('../services/paymentNode.service')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * 日期字段。只接受 YYYY-MM-DD（§7.1 的格式约定），
 * 且必须真的是合法日期 —— `2026-02-30` 能过正则但不是日期。
 */
const dateField = (label) =>
  z
    .string()
    .regex(DATE_PATTERN, `${label}格式应为 YYYY-MM-DD`)
    .refine((value) => datetime.parse(value) !== null, `${label}不是合法日期`)

/**
 * 合同金额。AC-AD13 要求 > 0 且最多两位小数。
 * 用 money.validate 而不是 z.number()：金额一旦变成 JS Number 就已经丢精度了，
 * 校验必须发生在字符串阶段。
 */
const amountField = z.string().refine((value) => money.validate(value).ok, '合同金额必须大于 0 且最多两位小数')

const createSchema = z
  .object({
    name: z.string().trim().min(1, '请输入项目名称').max(50, '项目名称不超过 50 字'),
    address: z.string().trim().min(1, '请输入项目地址').max(200, '项目地址不超过 200 字'),
    area: z
      .string()
      .trim()
      .optional()
      .refine((v) => v === undefined || v === '' || money.validate(v).ok, '户型面积必须大于 0 且最多两位小数'),
    contractAmount: amountField,
    startDate: dateField('开工日期'),
    planEndDate: dateField('计划竣工日期'),
    templateId: z.number().int().positive().optional(),
    remark: z.string().trim().max(500, '备注不超过 500 字').optional(),
  })
  // AC-AD14：计划竣工日期早于开工日期时拒绝提交
  .refine((data) => datetime.parse(data.planEndDate).isSameOrAfter(datetime.parse(data.startDate), 'day'), {
    message: '计划竣工日期不得早于开工日期',
    path: ['planEndDate'],
  })

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    address: z.string().trim().min(1).max(200).optional(),
    area: z.string().trim().optional(),
    contractAmount: amountField.optional(),
    startDate: dateField('开工日期').optional(),
    planEndDate: dateField('计划竣工日期').optional(),
    remark: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, '没有需要更新的字段')

/**
 * 坐标字段（GCJ-02，DECIMAL(10,7)）。
 *
 * **不能复用 money.validate**：它对金额限制「最多两位小数」，
 * 而坐标需要到小数点后 7 位。用它会同时犯两个错 ——
 * 拒绝合法的 `121.4737010`，以及把精度截断成 `121.47`（约 1 公里误差）。
 *
 * 校验要求：
 *   - 整数位不超过 3 位（DECIMAL(10,7) 扣掉 7 位小数只剩 3 位）；
 *   - 小数位不超过 7 位；
 *   - 落在合理区间内。范围之外的输入一定是坐标系搞错了（AC-N03）。
 *
 * 返回值保持**字符串**，不转 Number —— 只有字符串才能原样保住 7 位小数。
 */
function coordinateField(label, min, max) {
  return z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^-?\d{1,3}(\.\d{1,7})?$/.test(v), `${label}格式不正确（最多 7 位小数）`)
    .refine((v) => Number(v) >= min && Number(v) <= max, `${label}必须在 ${min} ~ ${max} 之间`)
}

const coordinatesSchema = z.object({
  longitude: coordinateField('经度', -180, 180),
  latitude: coordinateField('纬度', -90, 90),
})

const statusSchema = z.object({
  status: z.enum(['pending', 'building', 'finished', 'archived']),
  confirmReverse: z.boolean().optional().default(false),
})

const archiveSchema = z.object({ confirm: z.boolean().optional().default(false) })

const inviteSchema = z.object({
  phone: z.string().trim().min(1, '请输入手机号').max(20),
  role: z.enum(['foreman', 'supervisor', 'owner']),
  // 角色是账号级固定的（v2.5）。不再接受 confirmReplace 来绕过固定角色；
  // 若客户端仍传该字段，zod 默认 strip 掉，不影响请求
})

const paymentNodesSchema = z.object({
  nodes: z
    .array(
      z.object({
        name: z.string().trim().min(1, '节点名称不能为空').max(50),
        amount: z.string(),
        triggerType: z.enum(['manual', 'stage_acceptance']),
        triggerStageId: z.number().int().positive().optional(),
      })
    )
    .max(50, '付款节点不超过 50 个'),
})

const listQuerySchema = z.object({
  name: z.string().trim().max(50).optional(),
  address: z.string().trim().max(200).optional(),
  status: z.enum(['pending', 'building', 'finished', 'archived']).optional(),
  foremanId: z.coerce.number().int().positive().optional(),
  templateId: z.coerce.number().int().positive().optional(),
  sortField: z.enum(['created_at', 'start_date', 'plan_end_date', 'contract_amount', 'name']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
})

/** GET /admin/projects */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const paging = parsePaging(req.query)

  const result = await projectService.listProjects(req.auth, {
    ...query,
    paging,
    sort: query.sortField ? { field: query.sortField, direction: query.sortDirection } : undefined,
  })

  res.page(result.list, result.total, { page: result.page, pageSize: result.pageSize })
}

/** POST /admin/projects */
async function create(req, res) {
  const input = validate(createSchema, req.body)
  res.ok(await projectService.createProject(req.auth, input))
}

/** GET /admin/projects/:id */
async function detail(req, res) {
  res.ok(await projectService.getProjectDetail(req.auth, Number(req.params.id)))
}

/** PUT /admin/projects/:id */
async function update(req, res) {
  const input = validate(updateSchema, req.body)
  res.ok(await projectService.updateProject(req.auth, Number(req.params.id), input))
}

/** PUT /admin/projects/:id/coordinates —— 地图手工拾取（AC-AD54） */
async function setCoordinates(req, res) {
  const input = validate(coordinatesSchema, req.body)
  res.ok(await projectService.setCoordinates(req.auth, Number(req.params.id), input))
}

/** PUT /admin/projects/:id/status */
async function changeStatus(req, res) {
  const input = validate(statusSchema, req.body)
  res.ok(await projectService.changeStatus(req.auth, Number(req.params.id), input.status, input))
}

/** POST /admin/projects/:id/archive */
async function archive(req, res) {
  const input = validate(archiveSchema, req.body)
  res.ok(await projectService.archiveProject(req.auth, Number(req.params.id), input))
}

/** DELETE /admin/projects/:id */
async function remove(req, res) {
  const input = validate(archiveSchema, req.body)
  res.ok(await projectService.deleteProject(req.auth, Number(req.params.id), input))
}

/** POST /admin/projects/:id/restore */
async function restore(req, res) {
  res.ok(await projectService.restoreProject(req.auth, Number(req.params.id)))
}

/** GET /admin/projects/:id/members */
async function listMembers(req, res) {
  const result = await projectMemberService.listMembers(req.auth, Number(req.params.id))
  res.ok(result)
}

/** POST /admin/projects/:id/members —— 邀请成员（B-2.6） */
async function inviteMember(req, res) {
  const input = validate(inviteSchema, req.body)
  res.ok(await projectMemberService.invite(req.auth, Number(req.params.id), input))
}

/**
 * PUT /admin/projects/:id/members/:memberId/primary —— 指定主工长（Q11）。
 * 无请求体：目标人选由路径参数唯一确定，再要求一个 body 只是多余的形式。
 */
async function setPrimaryForeman(req, res) {
  res.ok(
    await projectMemberService.setPrimaryForeman(req.auth, Number(req.params.id), Number(req.params.memberId))
  )
}

/** DELETE /admin/projects/:id/members/:memberId */
async function removeMember(req, res) {
  res.ok(
    await projectMemberService.removeMember(req.auth, Number(req.params.id), Number(req.params.memberId))
  )
}

/** GET /admin/projects/:id/payment-nodes */
async function listPaymentNodes(req, res) {
  res.ok(await paymentNodeService.list(req.auth, Number(req.params.id)))
}

/** PUT /admin/projects/:id/payment-nodes */
async function replacePaymentNodes(req, res) {
  const input = validate(paymentNodesSchema, req.body)
  res.ok(await paymentNodeService.replaceAll(req.auth, Number(req.params.id), input.nodes))
}

/**
 * POST /admin/projects/:id/payment-nodes/:nodeId/unlock —— 手工解锁（AC-L15）。
 *
 * 操作写入 `operation_log`（AC-L15 明确要求）。这是管理员影响业主付款义务的动作，
 * 必须留痕 —— 否则「这个节点为什么解锁了」将无从追溯。
 */
async function unlockPaymentNode(req, res) {
  const ledgerService = require('../services/ledger.service')
  const operationLog = require('../services/operationLog.service')

  res.ok(
    await ledgerService.unlockPaymentNode(
      req.auth,
      Number(req.params.id),
      Number(req.params.nodeId),
      operationLog.contextFrom(req)
    )
  )
}

module.exports = {
  list,
  create,
  detail,
  update,
  setCoordinates,
  changeStatus,
  archive,
  remove,
  restore,
  listMembers,
  inviteMember,
  setPrimaryForeman,
  removeMember,
  listPaymentNodes,
  replacePaymentNodes,
  unlockPaymentNode,
}
