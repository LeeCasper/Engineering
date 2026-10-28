'use strict'

/**
 * B 端项目管理控制器（B-2.x）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const { coordinateField, refineCoordinatePair } = require('../utils/coordinate')
const AppError = require('../utils/AppError')
const { normalizeFiles } = require('../middlewares/upload')
const storage = require('../storage')
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

/**
 * 项目封面地址。
 *
 * 只接受上传接口返回的 http(s) 绝对地址；空字符串表示清除封面（落库为 NULL）。
 * 与汇报照片一致，存的是绝对 URL —— 小程序 `<image src>` 必须能直接访问。
 */
const coverUrlField = z
  .string()
  .trim()
  .max(512, '封面地址过长')
  .refine((value) => value === '' || /^https?:\/\//i.test(value), '封面地址不合法')
  .transform((value) => (value === '' ? null : value))

const createSchema = refineCoordinatePair(
  z
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
      coverUrl: coverUrlField.optional(),
      // 地图选点结果。与 address 同时存在时，服务层直接用坐标，不再地理编码。
      longitude: coordinateField('经度', -180, 180).optional(),
      latitude: coordinateField('纬度', -90, 90).optional(),
    })
    // AC-AD14：计划竣工日期早于开工日期时拒绝提交
    .refine((data) => datetime.parse(data.planEndDate).isSameOrAfter(datetime.parse(data.startDate), 'day'), {
      message: '计划竣工日期不得早于开工日期',
      path: ['planEndDate'],
    })
)

const updateSchema = refineCoordinatePair(
  z
    .object({
      name: z.string().trim().min(1).max(50).optional(),
      address: z.string().trim().min(1).max(200).optional(),
      area: z.string().trim().optional(),
      contractAmount: amountField.optional(),
      startDate: dateField('开工日期').optional(),
      planEndDate: dateField('计划竣工日期').optional(),
      remark: z.string().trim().max(500).optional(),
      // 传空字符串表示清除封面；不传表示本次不改
      coverUrl: coverUrlField.optional(),
      // 允许只改坐标（不传 address）；两者必须同时出现或同时省略
      longitude: coordinateField('经度', -180, 180).optional(),
      latitude: coordinateField('纬度', -90, 90).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, '没有需要更新的字段')
)

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

/** GET /admin/projects/stats —— 工作台与状态筛选计数的统一口径 */
async function stats(req, res) {
  res.ok(await projectService.getProjectStats(req.auth))
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

const MAX_COVER_BYTES = 5 * 1024 * 1024

/**
 * POST /admin/projects/cover —— 上传项目封面 / 缩略图。
 *
 * 与建档解耦：先上传拿到绝对 URL，再随创建 / 编辑请求提交 `coverUrl`。
 * Key 不返回给前端使用，前端只保存 url；换图后旧文件由运维任务清理。
 */
async function uploadCover(req, res) {
  const files = normalizeFiles(req.files || [])
  const cover = files.find((file) => file.field === 'cover')

  if (!cover) throw AppError.badRequest('请选择要上传的项目封面')
  if (cover.type !== 'image') throw AppError.badRequest('项目封面必须是 PNG / JPG / WebP 图片')
  if (cover.sizeBytes > MAX_COVER_BYTES) throw AppError.badRequest('项目封面不得超过 5MB')

  const saved = await storage.save(cover.buffer, { category: 'project-covers', ext: cover.ext })
  res.ok({ url: saved.url, key: saved.key, sizeBytes: saved.sizeBytes })
}

module.exports = {
  uploadCover,
  list,
  stats,
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
