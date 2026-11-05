'use strict'

/**
 * 记账（§4.4 / C-4.1 ~ C-4.12 / AC-L01 ~ L31）。
 *
 * ── 本模块不含任何支付功能（§4.4.3）──
 * 所有款项走线下转账，系统只做三件事：记账、付款节点提醒、双方对账确认。
 * 「已付款」仅代表**账目登记状态**，不代表系统内发生过任何资金划转（AC-L17）。
 * 因此这里不存在、也不应该出现任何第三方支付渠道的调用。
 *
 * ── 金额全程走字符串 ──
 * DECIMAL(12,2) 在连接层以字符串进出，运算一律走 `utils/money.js`（内部 decimal.js）。
 * 本模块里不允许出现 `parseFloat` / `Number(amount)` / `+amount`（AC-L11）。
 *
 * ── 权限 ──
 *   查看账目：工长、业主（**监理看不到**，AC-L27）
 *   登记流水：仅工长（AC-L25）
 *   对账确认：仅业主
 *   付款节点登记付款：仅工长；确认：仅业主
 */

const AppError = require('../utils/AppError')
const money = require('../utils/money')
const datetime = require('../utils/datetime')
const db = require('../db/pool')
const logger = require('../utils/logger')
const storage = require('../storage')
const watermark = require('../utils/watermark')
const { assertPrimaryOwner } = require('../utils/ownerType')
const notificationService = require('./notification.service')
const operationLog = require('./operationLog.service')
const sysConfigService = require('./sysConfig.service')
const ledgerModel = require('../models/ledger.model')
const paymentNodeModel = require('../models/paymentNode.model')
const projectMemberModel = require('../models/projectMember.model')
const projectModel = require('../models/project.model')
const projectStageModel = require('../models/projectStage.model')

/** 支出分类的预设枚举（AC-L06）。只有这四种，接口传别的返回 400 */
const EXPENSE_CATEGORIES = {
  material: '材料费',
  labor: '人工费',
  transport: '运输费',
  other: '其他',
}

/** 付款节点状态机（AC-L13：单向流转，跳级返回 409） */
const NODE_STATUS = {
  NOT_STARTED: 'not_started',
  UNLOCKED: 'unlocked',
  PAID: 'paid',
  CONFIRMED: 'confirmed',
}

const NODE_STATUS_LABELS = {
  not_started: '未开始',
  unlocked: '已解锁',
  paid: '已付款',
  confirmed: '已确认',
}

/**
 * 付款节点允许的下一步动作。
 *
 * 与验收状态机同理：逐条列出而不是用序数比较 —— 「跳级」必须被拦住，
 * 而序数比较会让 `not_started → paid` 这种跳过解锁的跃迁蒙混过关。
 */
const NODE_TRANSITIONS = {
  [NODE_STATUS.NOT_STARTED]: ['unlock'],
  [NODE_STATUS.UNLOCKED]: ['pay'],
  [NODE_STATUS.PAID]: ['confirm'],
  [NODE_STATUS.CONFIRMED]: [],
}

/** 票据/凭证照片上限（AC-L02） */
const MAX_RECEIPT_IMAGES = 3

// ─────────────────────────────────────────────────────────────
// 权限
// ─────────────────────────────────────────────────────────────

async function resolveViewer(userId, projectId) {
  const membership = await projectMemberModel.findActiveRole(projectId, userId)
  // AC-L26：非参与项目返回 404，与「项目不存在」同一提示，不泄露存在性
  if (!membership) throw AppError.notFound('项目不存在')
  return membership
}

/** 查看账目：工长与业主。监理不在其中（AC-L27：监理端不展示记账 tab） */
function assertCanViewLedger(viewer, project) {
  if (viewer.role !== 'foreman' && viewer.role !== 'owner') {
    throw AppError.forbidden('监理无权查看项目账目')
  }
  assertNotArchived(project)
}

/** 登记流水：仅工长（AC-L25：业主、监理调记账写接口一律 403） */
function assertCanWriteLedger(viewer, project) {
  if (viewer.role !== 'foreman') throw AppError.forbidden('仅工长可登记账目流水')
  assertNotArchived(project)
}

function assertNotArchived(project) {
  if (project.status === 'archived') throw AppError.forbidden('项目已归档，全部数据只读')
}

async function loadProject(projectId) {
  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')
  return project
}

// ─────────────────────────────────────────────────────────────
// 账目总览与列表
// ─────────────────────────────────────────────────────────────

/**
 * 账目总览（C-4.1）。
 *
 * AC-L10 明确：**汇总始终反映全量未删除流水，不随列表筛选条件变化**。
 * 因此本函数只接受 projectId，不接受任何筛选参数 —— 这不是疏漏，
 * 而是把「口径唯一」做进签名里，避免将来有人顺手加个 dateRange 参数。
 * 响应里带回一句说明文案，前端直接展示，避免用户把筛选后的列表
 * 与全量汇总对不上账当成 bug。
 */
async function getSummary(userId, projectId) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanViewLedger(viewer, project)

  const totals = await ledgerModel.sumByType(projectId)

  // 待收金额 = 合同总额 − 已收款，允许为负（AC-L08「已超收」）
  const pending = money.subtract(project.contract_amount, totals.income)
  // 当前余额 = 已收款 − 已支出，允许为负（AC-L09）
  const balance = money.subtract(totals.income, totals.expense)

  return {
    contractAmount: project.contract_amount,
    totalIncome: totals.income,
    totalExpense: totals.expense,
    pendingAmount: pending,
    balance,
    // 由服务端给出标志位，避免各前端各写一遍 `Number(x) < 0`（还会踩到浮点比较）
    isOverReceived: money.isNegative(pending),
    isBalanceNegative: money.isNegative(balance),
    // AC-L10：页面需明确「汇总为全量口径」
    scopeNote: '以上汇总为项目全部未删除流水的合计，不随下方列表的筛选条件变化',
  }
}

/** 流水列表（C-4.2 / AC-L01 / AC-L29） */
async function listLedger(userId, projectId, { filters, paging }) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanViewLedger(viewer, project)

  const { total, rows } = await ledgerModel.list({ projectId, filters, offset: paging.offset, limit: paging.limit })

  return {
    list: rows.map(toLedgerView),
    total,
    page: paging.page,
    pageSize: paging.pageSize,
  }
}

function toLedgerView(row) {
  return {
    id: row.id,
    type: row.type,
    typeLabel: row.type === 'income' ? '收入' : '支出',
    category: row.category,
    categoryLabel: row.category ? EXPENSE_CATEGORIES[row.category] || row.category : null,
    // 金额保持字符串（AC-L11）。前端展示时不要转 Number
    amount: row.amount,
    occurredAt: row.occurred_at,
    remark: row.remark,
    stageId: row.project_stage_id,
    stageName: row.stage_name ?? undefined,
    paymentNodeId: row.payment_node_id,
    paymentNodeName: row.payment_node_name ?? undefined,
    receiptImages: parseImages(row.receipt_images),
    locked: row.locked === 1,
    isReversal: row.is_reversal === 1,
    reversalOfId: row.reversal_of_id,
    reversedById: row.reversed_by_id,
    createdAt: row.created_at,
  }
}

function parseImages(raw) {
  if (!raw) return []
  const list = typeof raw === 'string' ? safeJson(raw) : raw
  if (!Array.isArray(list)) return []
  return list.map((item) => ({
    url: item.watermarkUrl || item.url,
    originalUrl: item.watermarkUrl ? item.url : null,
  }))
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 支出分类汇总 + 按月（C-4.5） */
async function getExpenseBreakdown(userId, projectId, { startDate, endDate } = {}) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanViewLedger(viewer, project)

  const [byCategory, byMonth] = await Promise.all([
    ledgerModel.sumExpenseByCategory({ projectId, startDate, endDate }),
    ledgerModel.sumExpenseByMonth({ projectId }),
  ])

  return {
    byCategory: byCategory.map((row) => ({
      category: row.category,
      categoryLabel: EXPENSE_CATEGORIES[row.category] || row.category,
      total: row.total,
      count: row.count,
    })),
    byMonth: byMonth.map((row) => ({ month: row.month, total: row.total, count: Number(row.count) })),
  }
}

/**
 * 阶段账目视图（C-4.12）。
 *
 * 每个阶段展示：应收（关联该阶段的付款节点金额之和）、已收、支出、结余。
 * 「应收」来自付款节点而非流水 —— 流水记录的是**实际发生**的收付，
 * 应收是**约定**要收的，两者来源不同，不能混在一个 sum 里。
 */
async function getStageLedger(userId, projectId) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanViewLedger(viewer, project)

  const [stages, ledgerSums, nodes] = await Promise.all([
    projectStageModel.findTreeByProject(projectId),
    ledgerModel.sumByProjectGrouped(projectId),
    paymentNodeModel.listByProject(projectId),
  ])

  const sumsByStage = new Map(ledgerSums.map((row) => [Number(row.project_stage_id), row]))
  const dueByStage = new Map()
  for (const node of nodes) {
    if (!node.trigger_stage_id) continue
    const key = Number(node.trigger_stage_id)
    dueByStage.set(key, money.add(dueByStage.get(key) || '0.00', node.amount))
  }

  const rows = stages.map((stage) => {
    const sums = sumsByStage.get(Number(stage.id)) || { income: '0.00', expense: '0.00', entry_count: 0 }
    const due = dueByStage.get(Number(stage.id)) || '0.00'

    return {
      stageId: stage.id,
      stageName: stage.name,
      seq: stage.seq,
      gateStatus: stage.gate_status,
      progress: stage.progress,
      dueAmount: due,
      incomeAmount: sums.income,
      expenseAmount: sums.expense,
      // 结余 = 已收 − 已支出（不是应收 − 支出）：应收只是约定，还没到手
      balance: money.subtract(sums.income, sums.expense),
      entryCount: Number(sums.entry_count),
    }
  })

  const totals = rows.reduce(
    (acc, row) => ({
      dueAmount: money.add(acc.dueAmount, row.dueAmount),
      incomeAmount: money.add(acc.incomeAmount, row.incomeAmount),
      expenseAmount: money.add(acc.expenseAmount, row.expenseAmount),
    }),
    { dueAmount: '0.00', incomeAmount: '0.00', expenseAmount: '0.00' }
  )

  return { stages: rows, totals }
}

// ─────────────────────────────────────────────────────────────
// 流水的写入
// ─────────────────────────────────────────────────────────────

/**
 * 新增支出（C-4.3 / AC-L01 ~ L04 / AC-L06 / AC-L11）。
 *
 * @param {object} params
 * @param {string} params.amount 金额（字符串）
 * @param {string} params.category 分类，必须是四种预设之一
 * @param {string} params.occurredAt 发生日期
 * @param {string} params.stageId 归属阶段（**必填**，C-4.11）
 * @param {string} [params.remark]
 * @param {Array} [params.files] 票据照片，最多 3 张（AC-L02）
 */
async function createExpense(userId, projectId, input, context = {}) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanWriteLedger(viewer, project)

  const amount = validateAmount(input.amount)

  // AC-L06：分类只能是四种预设之一，其他一律 400
  if (!Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORIES, input.category)) {
    throw AppError.badRequest(
      `支出分类只能是：${Object.values(EXPENSE_CATEGORIES).join('、')}`
    )
  }

  const stageId = await resolveStageId(projectId, input.stageId)

  const files = input.files || []
  if (files.length > MAX_RECEIPT_IMAGES) {
    throw AppError.badRequest(`票据照片最多上传 ${MAX_RECEIPT_IMAGES} 张，当前 ${files.length} 张`)
  }

  const receiptImages = await persistReceipts(files, project)

  const ledgerId = await db.withTransaction(async (tx) => {
    const id = await ledgerModel.create(
      {
        projectId,
        projectStageId: stageId,
        type: 'expense',
        category: input.category,
        amount,
        occurredAt: input.occurredAt,
        remark: input.remark ?? null,
        receiptImages,
        createdBy: userId,
      },
      tx
    )

    // AC-L28：金额相关的增删改都要写操作日志，含变更前后值
    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.LEDGER_CREATE,
        targetType: 'ledger',
        targetId: id,
        projectId,
        detail: {
          after: { type: 'expense', category: input.category, amount, occurredAt: input.occurredAt, stageId },
        },
      },
      tx
    )

    return id
  })

  // AC-L30：单笔支出超过合同额一定比例时提醒业主。
  // 放在事务外：提醒失败不该让「这笔支出已经记上了」这个事实回滚
  await notifyLargeExpense(project, { amount, category: input.category, ledgerId }).catch((err) => {
    logger.warn('大额支出提醒发送失败', { projectId, ledgerId, err })
  })

  return getLedgerDetail(userId, projectId, ledgerId)
}

/**
 * 新增收入（C-4.4 / AC-L05）。
 *
 * AC-L05：必须关联付款节点；该节点已有收入流水时提示并阻止重复。
 * 数据库层的条件唯一索引是真正的兜底（并发下查询会穿透），
 * 这里先查一次只是为了给出人能看懂的提示。
 */
async function createIncome(userId, projectId, input, context = {}) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanWriteLedger(viewer, project)

  const amount = validateAmount(input.amount)

  if (!input.paymentNodeId) throw AppError.badRequest('新增收入必须关联付款节点')

  const node = await paymentNodeModel.findById(input.paymentNodeId)
  if (!node || Number(node.project_id) !== Number(projectId)) {
    throw AppError.badRequest('付款节点不属于本项目')
  }

  // AC-L16：未解锁的节点不提供登记入口。服务端同样拦住 ——
  // 前端藏按钮拦不住直接调接口的人
  if (node.status === NODE_STATUS.NOT_STARTED) {
    throw AppError.conflict(`付款节点「${node.name}」尚未解锁，暂不可登记收款`)
  }

  // 阶段型付款节点已经明确了自己的归属阶段，收入流水必须落在同一个阶段。
  // 否则会出现「收入记在水电工程、付款节点却属于拆除改造」的错配：
  // 阶段结算里已收有这笔钱，但应收（付款节点）里没有，两个数字对不上。
  const nodeStageId = node.trigger_stage_id ? Number(node.trigger_stage_id) : null
  if (nodeStageId && input.stageId !== undefined && input.stageId !== null && input.stageId !== '') {
    if (Number(input.stageId) !== nodeStageId) {
      throw AppError.badRequest('收入归属阶段必须与付款节点关联阶段一致')
    }
  }
  const stageId = await resolveStageId(projectId, nodeStageId || input.stageId)

  const existing = await ledgerModel.findIncomeByPaymentNode(input.paymentNodeId)
  if (existing) {
    throw AppError.conflict('该付款节点已登记过付款，如需更正请对原记录发起红冲', {
      detail: { existingLedgerId: existing.id },
    })
  }

  const files = input.files || []
  if (files.length > MAX_RECEIPT_IMAGES) {
    throw AppError.badRequest(`转账凭证最多上传 ${MAX_RECEIPT_IMAGES} 张，当前 ${files.length} 张`)
  }
  const receiptImages = await persistReceipts(files, project)

  const ledgerId = await db.withTransaction(async (tx) => {
    let id
    try {
      id = await ledgerModel.create(
        {
          projectId,
          projectStageId: stageId,
          type: 'income',
          category: null,
          amount,
          occurredAt: input.occurredAt,
          remark: input.remark ?? null,
          paymentNodeId: input.paymentNodeId,
          receiptImages,
          createdBy: userId,
        },
        tx
      )
    } catch (err) {
      // 条件唯一索引 `uk_ledger_payment_node_income` 兜底（AC-L05）。
      // 能走到这里说明并发穿透了上面那次查询 —— 提示与查询路径保持一致，
      // 用户看到的是同一句话，不该因为我们内部走了哪条分支而变化
      if (err && err.code === 'ER_DUP_ENTRY') {
        throw AppError.conflict('该付款节点已登记过付款，如需更正请对原记录发起红冲')
      }
      throw err
    }

    // 登记收入即意味着这笔款已到账 → 节点状态推进到「已付款」（AC-L17）。
    // 节点此时必然是 unlocked（上面校验过），因此这是一次合法的单向流转
    await paymentNodeModel.updateStatus(node.id, NODE_STATUS.PAID, tx)

    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.LEDGER_CREATE,
        targetType: 'ledger',
        targetId: id,
        projectId,
        detail: {
          after: {
            type: 'income',
            amount,
            occurredAt: input.occurredAt,
            paymentNodeId: input.paymentNodeId,
            paymentNodeStatus: `${node.status} → ${NODE_STATUS.PAID}`,
          },
        },
      },
      tx
    )

    return id
  })

  return getLedgerDetail(userId, projectId, ledgerId)
}

/** 单条流水的详情（新增后回读，保证返回的就是落库后的真实状态） */
async function getLedgerDetail(userId, projectId, ledgerId) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanViewLedger(viewer, project)

  const row = await ledgerModel.findById(ledgerId)
  if (!row || Number(row.project_id) !== Number(projectId)) throw AppError.notFound('流水不存在')

  const stage = row.project_stage_id ? await projectStageModel.findById(row.project_stage_id) : null
  const node = row.payment_node_id ? await paymentNodeModel.findById(row.payment_node_id) : null

  return toLedgerView({ ...row, stage_name: stage ? stage.name : null, payment_node_name: node ? node.name : null })
}

/**
 * 修改流水（AC-L20）。
 *
 * `locked = 1` 的流水禁止修改 —— 它已经被业主对账确认过，
 * 改动会让「确认时的数字」与「现在的数字」对不上，而那正是对账要消灭的东西。
 * 更正只能走红冲（AC-L23）。
 */
async function updateLedger(userId, projectId, ledgerId, input, context = {}) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanWriteLedger(viewer, project)

  return db.withTransaction(async (tx) => {
    const row = await ledgerModel.lockById(tx, ledgerId)
    if (!row || Number(row.project_id) !== Number(projectId)) throw AppError.notFound('流水不存在')
    if (row.locked === 1) throw AppError.conflict('已对账流水不可修改，如需更正请发起红冲')

    const fields = {}
    if (input.amount !== undefined) fields.amount = validateAmount(input.amount)
    if (input.occurredAt !== undefined) fields.occurred_at = input.occurredAt
    if (input.remark !== undefined) fields.remark = input.remark
    if (input.stageId !== undefined) {
      fields.project_stage_id = await resolveStageId(projectId, input.stageId, tx)
    }
    if (input.category !== undefined) {
      if (row.type !== 'expense') throw AppError.badRequest('收入流水没有分类')
      if (!Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORIES, input.category)) {
        throw AppError.badRequest(`支出分类只能是：${Object.values(EXPENSE_CATEGORIES).join('、')}`)
      }
      fields.category = input.category
    }

    await ledgerModel.updateUnlocked(ledgerId, fields, tx)

    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.LEDGER_UPDATE,
        targetType: 'ledger',
        targetId: ledgerId,
        projectId,
        // §6.2 约定 `{before, after}`，金额变更必须记录变更前后值（AC-L28）
        detail: {
          before: { amount: row.amount, category: row.category, occurredAt: row.occurred_at, remark: row.remark },
          after: fields,
        },
      },
      tx
    )

    return { id: ledgerId }
  })
}

/** 删除流水（软删除，AC-L12）。已锁定的同样拒绝 */
async function deleteLedger(userId, projectId, ledgerId, context = {}) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanWriteLedger(viewer, project)

  await db.withTransaction(async (tx) => {
    const row = await ledgerModel.lockById(tx, ledgerId)
    if (!row || Number(row.project_id) !== Number(projectId)) throw AppError.notFound('流水不存在')
    if (row.locked === 1) throw AppError.conflict('已对账流水不可删除，如需更正请发起红冲')

    await ledgerModel.softDeleteUnlocked(ledgerId, tx)

    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.LEDGER_DELETE,
        targetType: 'ledger',
        targetId: ledgerId,
        projectId,
        detail: { before: { amount: row.amount, type: row.type, occurredAt: row.occurred_at } },
      },
      tx
    )
  })

  return { id: ledgerId, deleted: true }
}

/**
 * 红冲（C-4.9 / AC-L23）。
 *
 * 账目**只增不减**：红冲不是删掉原记录，而是新增一条反向金额的记录，
 * 并让两条互相指向。因此任何时候回看都能看出「当时记了什么、后来为什么冲掉」——
 * 直接把原记录改掉或删掉，这段历史就永远消失了，而这正是对账制度要防的。
 *
 * 原记录同时被标记为已锁定：它已经被冲销，不应再被单独修改。
 */
async function reverseLedger(userId, projectId, ledgerId, { reason }, context = {}) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanWriteLedger(viewer, project)

  const text = String(reason || '').trim()
  if (!text) throw AppError.badRequest('红冲必须说明原因')

  return db.withTransaction(async (tx) => {
    const row = await ledgerModel.lockById(tx, ledgerId)
    if (!row || Number(row.project_id) !== Number(projectId)) throw AppError.notFound('流水不存在')
    if (row.is_reversal === 1) throw AppError.conflict('红冲记录不可再次红冲')
    if (row.reversed_by_id) throw AppError.conflict('该流水已被红冲，无需重复操作')

    const reversalId = await ledgerModel.createReversal(
      {
        projectId,
        projectStageId: row.project_stage_id,
        type: row.type,
        category: row.category,
        // ── 红冲记录的金额**与原记录同号**，不是负数 ──
        // 金额列是 `DECIMAL(12,2)` 且业务上不允许负数（AC-L03：必须 > 0）。
        // 负号会破坏这条校验，也会让「金额必须为正」成为一句空话。
        // 冲销的语义靠 `is_reversal = 1` 表达：所有汇总查询对它**取负计入**
        // （见 ledger.model 的 SUM(CASE WHEN is_reversal = 1 THEN -amount ...)）。
        // 这样账目只增不减，任何时候回看都能看出「当时记了什么、后来为什么冲掉」。
        amount: row.amount,
        occurredAt: datetime.formatDate(),
        remark: `红冲原记录 #${row.id}：${text}`,
        createdBy: userId,
        reversalOfId: row.id,
      },
      tx
    )

    await ledgerModel.linkReversal(row.id, reversalId, tx)

    // 收入被红冲后，付款节点应退回「已解锁」——那笔款实际上没收到。
    // 若不退，节点会一直显示「已付款」而账上金额是 0，两者对不上
    if (row.type === 'income' && row.payment_node_id) {
      await paymentNodeModel.updateStatus(row.payment_node_id, NODE_STATUS.UNLOCKED, tx)
    }

    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.LEDGER_REVERSE,
        targetType: 'ledger',
        targetId: reversalId,
        projectId,
        detail: {
          before: { originalLedgerId: row.id, amount: row.amount, type: row.type },
          after: { reversalLedgerId: reversalId, reason: text },
        },
      },
      tx
    )

    return { originalId: row.id, reversalId }
  })
}

// ─────────────────────────────────────────────────────────────
// 付款节点
// ─────────────────────────────────────────────────────────────

/** 付款节点列表（C-4.6 / AC-L16） */
async function listPaymentNodes(userId, projectId) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanViewLedger(viewer, project)

  const nodes = await paymentNodeModel.listByProject(projectId)

  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      seq: node.seq,
      name: node.name,
      amount: node.amount,
      triggerType: node.trigger_type,
      triggerStageId: node.trigger_stage_id,
      status: node.status,
      statusLabel: NODE_STATUS_LABELS[node.status],
      unlockedAt: node.unlocked_at,
      // AC-L16：未解锁（not_started）在业主端展示为「未开始」，不提供登记入口。
      // 这个标志由服务端给，避免前端各自判断 `status === 'unlocked'`
      canRegisterPayment: node.status === NODE_STATUS.UNLOCKED,
    })),
  }
}

/**
 * 工长登记线下转账（C-4.4 的前置 / AC-L17）。
 *
 * 「已付款」**仅由工长登记线下转账后置位**。系统内不存在任何资金划转 ——
 * AC-L17 要求「抓包及服务端日志中不存在任何第三方支付渠道的请求」，
 * 因此本函数只改一个状态字段，不触发任何外部调用。
 */
async function payPaymentNode(userId, projectId, nodeId, context = {}) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertCanWriteLedger(viewer, project)

  const node = await paymentNodeModel.findById(nodeId)
  if (!node || Number(node.project_id) !== Number(projectId)) throw AppError.notFound('付款节点不存在')
  if (node.status === NODE_STATUS.NOT_STARTED) {
    throw AppError.conflict(`付款节点「${node.name}」尚未解锁，暂不可登记收款`)
  }
  if (node.status !== NODE_STATUS.UNLOCKED) {
    assertNodeTransition(node.status, 'pay')
  }

  // 一键登记收款 = 自动生成一条收入流水。
  // 不能让节点只改状态而没有账目 —— 阶段结算的「已收」来自流水，
  // 只推进节点会得到「节点已付款、账面已收为 0」的矛盾数据。
  let stageId = node.trigger_stage_id
  if (!stageId) {
    const currentStage = await projectStageModel.findCurrentStage(projectId)
    if (!currentStage) throw AppError.conflict('项目还没有可归属的阶段，无法登记收款')
    stageId = currentStage.id
  }

  const income = await createIncome(
    userId,
    projectId,
    {
      amount: node.amount,
      occurredAt: datetime.formatDate(),
      stageId,
      paymentNodeId: node.id,
      remark: `一键登记收款：${node.name}`,
    },
    context
  )

  return { id: nodeId, status: NODE_STATUS.PAID, ledgerId: income.id }
}

/** 业主确认付款（AC-L13 的最后一步：paid → confirmed） */
async function confirmPaymentNode(userId, projectId, nodeId, context = {}) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)

  assertPrimaryOwner(viewer, '确认付款')
  assertNotArchived(project)

  return db.withTransaction(async (tx) => {
    const node = await paymentNodeModel.lockById(tx, nodeId)
    if (!node || Number(node.project_id) !== Number(projectId)) throw AppError.notFound('付款节点不存在')

    assertNodeTransition(node.status, 'confirm')

    await paymentNodeModel.updateStatus(nodeId, NODE_STATUS.CONFIRMED, tx)

    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.PAYMENT_NODE_CONFIRM,
        targetType: 'payment_node',
        targetId: nodeId,
        projectId,
        detail: { before: { status: node.status }, after: { status: NODE_STATUS.CONFIRMED } },
      },
      tx
    )

    return { id: nodeId, status: NODE_STATUS.CONFIRMED }
  })
}

/**
 * 管理员手工解锁手动触发型节点（AC-L15）。
 *
 * 关联阶段验收的节点由系统在验收通过时自动解锁（AC-L14），
 * **不允许**手工解锁 —— 那会绕过验收这道关，让付款节点失去它的约束意义。
 */
async function unlockPaymentNode(operator, projectId, nodeId, context = {}) {
  const projectAccess = require('./projectAccess.service')
  await projectAccess.load(operator, projectId, { requireWritable: true })

  return db.withTransaction(async (tx) => {
    const node = await paymentNodeModel.lockById(tx, nodeId)
    if (!node || Number(node.project_id) !== Number(projectId)) throw AppError.notFound('付款节点不存在')

    if (node.trigger_type === 'stage_acceptance') {
      throw AppError.conflict('该节点关联阶段验收，须由验收通过后自动解锁，不可手工解锁')
    }

    assertNodeTransition(node.status, 'unlock')

    await paymentNodeModel.updateStatus(nodeId, NODE_STATUS.UNLOCKED, tx)

    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.PAYMENT_NODE_UNLOCK,
        targetType: 'payment_node',
        targetId: nodeId,
        projectId,
        detail: { before: { status: node.status }, after: { status: NODE_STATUS.UNLOCKED } },
      },
      tx
    )

    return { id: nodeId, status: NODE_STATUS.UNLOCKED }
  })
}

/** AC-L13：节点状态单向流转，跳级返回 409 */
function assertNodeTransition(current, action) {
  const allowed = NODE_TRANSITIONS[current] || []
  if (!allowed.includes(action)) {
    throw AppError.conflict(
      `付款节点当前为「${NODE_STATUS_LABELS[current]}」，不能执行该操作（状态只能单向流转）`
    )
  }
}

// ─────────────────────────────────────────────────────────────
// 辅助
// ─────────────────────────────────────────────────────────────

/** 金额校验（AC-L03）：> 0、最多两位小数。走 money 工具，不在本层做浮点判断 */
function validateAmount(value) {
  const result = money.validate(value)
  if (!result.ok) throw AppError.badRequest(result.reason)
  return result.value
}

/** 归属阶段必填且必须属于本项目（C-4.11） */
async function resolveStageId(projectId, stageId, tx = db) {
  if (stageId === undefined || stageId === null || stageId === '') {
    throw AppError.badRequest('登记流水必须归属到具体阶段')
  }

  const stage = await projectStageModel.findById(stageId, tx)
  if (!stage || Number(stage.project_id) !== Number(projectId)) {
    throw AppError.badRequest('归属阶段不属于本项目')
  }
  return stage.id
}

/** 票据照片落盘 + 服务端水印（与汇报照片同一套理由：AC-P12 的不可绕过） */
async function persistReceipts(files, project) {
  const images = []
  for (const file of files) {
    const original = await storage.save(file.buffer, { category: 'receipts', ext: file.ext })
    let watermarkUrl = null

    if (file.type === 'image') {
      const marked = await watermark.apply(file.buffer, {
        lines: [datetime.format(), project.address, '票据凭证'],
      })
      watermarkUrl = (await storage.save(marked, { category: 'receipts', ext: file.ext })).url
    }

    images.push({ url: original.url, watermarkUrl })
  }
  return images
}

/**
 * 大额支出提醒（C-4.10 / AC-L30 / AC-L31）。
 *
 * 比例取自系统配置（B-5.4），不写死 —— §5.5 的原话是这些阈值「几乎一定会被调整，
 * 写死在代码里意味着每次调整都要发版」。
 *
 * 用 `money.compare` 而不是 `Number(amount) > Number(contract) * ratio`：
 * 后者会把两个 DECIMAL 拉进 JS 浮点，在临界值上出现「刚好 10% 却不提醒」的偏差。
 */
async function notifyLargeExpense(project, { amount, category, ledgerId }) {
  const ratio = await sysConfigService.getFloat(project.tenant_id, 'big_expense_ratio')
  const threshold = money.multiply(project.contract_amount, String(ratio))

  if (money.compare(amount, threshold) <= 0) return { notified: false }

  const owners = await db.query(
    `SELECT DISTINCT u.id FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pm.project_id = ? AND pm.role = 'owner' AND pm.status = 'active' AND pm.deleted_at IS NULL`,
    [project.id]
  )

  for (const owner of owners) {
    await notificationService.notifyOnce({
      userId: owner.id,
      projectId: project.id,
      reminderType: 'big_expense',
      type: notificationService.TYPES.PAYMENT,
      refType: 'ledger',
      refId: ledgerId,
      title: '有一笔较大的支出登记',
      content: `${EXPENSE_CATEGORIES[category] || category}支出 ${amount} 元，超过合同额的 ${Math.round(ratio * 100)}%`,
    })
  }

  return { notified: owners.length > 0, threshold, recipients: owners.length }
}

module.exports = {
  EXPENSE_CATEGORIES,
  NODE_STATUS,
  NODE_STATUS_LABELS,
  NODE_TRANSITIONS,
  MAX_RECEIPT_IMAGES,
  assertNodeTransition,
  getSummary,
  listLedger,
  getLedgerDetail,
  getExpenseBreakdown,
  getStageLedger,
  createExpense,
  createIncome,
  updateLedger,
  deleteLedger,
  reverseLedger,
  listPaymentNodes,
  payPaymentNode,
  confirmPaymentNode,
  unlockPaymentNode,
  resolveViewer,
  assertCanViewLedger,
  assertCanWriteLedger,
}
