'use strict'

/**
 * 阶段结算（C-7.5 ~ C-7.9 / AC-S02 ~ AC-S08）。
 *
 * ── 为什么它必须存在 ──
 * 验收通过只能把阶段推进到 `accepted`，它解锁的是**本阶段付款节点**；
 * 下一阶段要等这张结算单被主业主确认无异议后才解锁。缺了这一环，
 * 第一个阶段验收通过后，后面所有阶段会永远停在 `locked`。
 *
 * ── 与周期对账共用 reconciliation 表 ──
 * `scope_type='stage'` 的结算单和 `scope_type='period'` 的周期对账单
 * 字段、状态流转、确认动词几乎一致，只有统计范围不同（§6.1 / G-23）。
 * 本模块只负责「阶段」这一种单据的内容快照与提交；
 * 确认动作仍走 `POST /reconciliations/:id/confirm`，并在同一事务里完成
 * AC-S08 要求的两步：当前阶段置 `settled`、下一阶段置 `active`。
 *
 * ── 金额口径 ──
 * 应收 = 关联该阶段的全部付款节点金额之和（AC-S02）；
 * 已收 / 支出 = 归属该阶段且未删除的流水净额（红冲取负，AC-S03）；
 * 结余 = 已收 − 支出。全部用 `utils/money.js`，不经过 JS Number。
 */

const AppError = require('../utils/AppError')
const money = require('../utils/money')
const datetime = require('../utils/datetime')
const db = require('../db/pool')
const logger = require('../utils/logger')
const signedUrl = require('../utils/signedUrl')
const { isPrimaryOwner } = require('../utils/ownerType')
const notificationService = require('./notification.service')
const operationLog = require('./operationLog.service')
const ledgerModel = require('../models/ledger.model')
const reconciliationModel = require('../models/reconciliation.model')
const paymentNodeModel = require('../models/paymentNode.model')
const projectStageModel = require('../models/projectStage.model')
const projectMemberModel = require('../models/projectMember.model')
const projectModel = require('../models/project.model')

const STATUS_LABELS = {
  draft: '待工长提交',
  pending: '待主业主确认',
  confirmed: '已结清',
  disputed: '结算有异议',
}

const PAYMENT_STATUS_LABELS = {
  not_started: '未开始',
  unlocked: '已解锁',
  paid: '已付款',
  confirmed: '已确认',
}

const SETTLEMENT_GATES = new Set(['accepted', 'disputed'])

async function resolveViewer(userId, projectId) {
  const membership = await projectMemberModel.findActiveRole(projectId, userId)
  if (!membership) throw AppError.notFound('项目不存在')
  if (membership.role !== 'foreman' && membership.role !== 'owner') {
    throw AppError.forbidden('监理无权访问项目账目')
  }
  return membership
}

async function loadProject(projectId) {
  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')
  return project
}

function assertWritable(project) {
  if (project.status === 'archived') throw AppError.forbidden('项目已归档，全部数据只读')
}

/** 红冲记录在汇总时取负（金额列不允许负数，AC-L03 / CLAUDE.md 第 48 条） */
function netAmount(row) {
  return row.is_reversal === 1 ? money.multiply(row.amount, '-1') : row.amount
}

/** 结算单的金额快照：应收来自付款节点，已收与支出来自归属本阶段的流水 */
async function buildSnapshot(projectId, stageId, tx = db) {
  const [entries, nodes] = await Promise.all([
    ledgerModel.listByStage(projectId, stageId, tx),
    paymentNodeModel.listByStage(projectId, stageId, tx),
  ])

  const income = money.sum(entries.filter((row) => row.type === 'income').map(netAmount))
  const expense = money.sum(entries.filter((row) => row.type === 'expense').map(netAmount))
  const receivable = money.sum(nodes.map((row) => row.amount))

  return {
    entries,
    nodes,
    receivable,
    income,
    expense,
    balance: money.subtract(income, expense),
  }
}

/**
 * 验收通过后自动生成阶段结算单草稿（C-7.5）。
 *
 * 幂等：同一阶段已经存在结算单时直接返回。数据库的
 * `uk_rec_stage_settlement` 是并发下的最终兜底。
 */
async function ensureDraftRecord(tx, projectId, stageId) {
  const stage = await projectStageModel.lockById(tx, projectId, stageId)
  if (!stage) throw AppError.notFound('阶段不存在')

  if (stage.gate_status === 'settled') {
    return { reconciliation: await reconciliationModel.findByStage(projectId, stageId, tx), created: false }
  }
  if (!SETTLEMENT_GATES.has(stage.gate_status)) {
    return { reconciliation: null, created: false }
  }

  const existing = await reconciliationModel.findByStage(projectId, stageId, tx, { forUpdate: true })
  if (existing) return { reconciliation: existing, created: false }

  const snapshot = await buildSnapshot(projectId, stageId, tx)

  let id
  try {
    id = await reconciliationModel.create(
      {
        projectId,
        scopeType: 'stage',
        projectStageId: stageId,
        status: 'draft',
        totalAmount: snapshot.receivable,
        incomeAmount: snapshot.income,
        expenseAmount: snapshot.expense,
        submittedBy: null,
        submittedAt: null,
        remark: null,
      },
      tx
    )
  } catch (err) {
    // 并发 GET（验收联动与用户同时打开页面）会撞 uk_rec_stage_settlement。
    // 唯一索引是最终兜底，撞上了就取已经生成的那张，不把 500 抛给用户。
    if (err && err.code === 'ER_DUP_ENTRY') {
      const row = await reconciliationModel.findByStage(projectId, stageId, tx)
      return { reconciliation: row, created: false }
    }
    throw err
  }

  await reconciliationModel.addDetails(
    id,
    snapshot.entries.map((row) => row.id),
    tx
  )

  await operationLog.record(
    {
      operatorType: 'system',
      operatorId: null,
      action: operationLog.ACTIONS.RECONCILIATION_CREATE,
      targetType: 'reconciliation',
      targetId: id,
      projectId,
      detail: {
        after: {
          scopeType: 'stage',
          stageId,
          receivable: snapshot.receivable,
          income: snapshot.income,
          expense: snapshot.expense,
          entryCount: snapshot.entries.length,
        },
      },
    },
    tx
  )

  return { reconciliation: await reconciliationModel.findById(id, tx), created: true }
}

/**
 * 对外的自动生成入口：验收通过后的联动与阶段结算页都会调用它。
 * 返回 reconciliation 行；阶段还不是 `accepted/disputed` 时返回 null。
 */
async function ensureDraftForStage(projectId, stageId) {
  const result = await db.withTransaction((tx) => ensureDraftRecord(tx, projectId, stageId))
  if (result.created) {
    await notifyPrimaryForeman(
      projectId,
      result.reconciliation.id,
      result.reconciliation.project_stage_id,
      '阶段结算单已生成',
      '本阶段已验收通过，请核对结算金额后提交主业主'
    )
  }
  return result.reconciliation
}

/**
 * GET /projects/:id/stages/:stageId/settlement
 * 不存在时自动生成草稿（§7.3 路由表明确要求）。
 */
async function getForStage(userId, projectId, stageId) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)

  const stage = await projectStageModel.findById(stageId)
  if (!stage || Number(stage.project_id) !== Number(projectId)) {
    throw AppError.notFound('阶段不存在')
  }

  if (stage.gate_status === 'settled') {
    const existing = await reconciliationModel.findByStage(projectId, stageId)
    if (existing) return buildDetail(existing, viewer)
    // 历史数据可能只有门禁状态、没有结算单；返回一个只读的已结清视图，
    // 不为了让页面好看而临时生成一张「已确认」的单据。
    const snapshot = await buildSnapshot(projectId, stageId)
    return {
      id: null,
      projectId,
      stageId,
      stageName: stage.name,
      stageSeq: stage.seq,
      scopeType: 'stage',
      status: 'confirmed',
      statusLabel: '已结清',
      receivableAmount: snapshot.receivable,
      incomeAmount: snapshot.income,
      expenseAmount: snapshot.expense,
      balanceAmount: snapshot.balance,
      paymentNodes: mapPaymentNodes(snapshot.nodes),
      details: [],
      disputeCount: 0,
      submittedAt: null,
      confirmedAt: null,
      settlementPdfSignedPath: null,
      myRole: viewer.role,
      ownerType: viewer.owner_type ?? null,
      isPrimaryOwner: isPrimaryOwner(viewer),
      isPrimaryForeman: viewer.role === 'foreman' && Number(viewer.is_primary) === 1,
      myActions: [],
      settledWithoutDocument: true,
    }
  }

  if (!SETTLEMENT_GATES.has(stage.gate_status)) {
    throw AppError.conflict('阶段尚未验收通过，无法进行阶段结算')
  }

  const reconciliation = await ensureDraftForStage(projectId, stageId)
  if (!reconciliation) throw AppError.conflict('阶段尚未验收通过，无法进行阶段结算')
  return buildDetail(reconciliation, viewer, { project })
}

/** GET /reconciliations/:id —— 阶段结算单详情（消息中心按 id 进入时使用） */
async function getByReconciliationId(userId, reconciliationId) {
  const reconciliation = await reconciliationModel.findById(reconciliationId)
  if (!reconciliation || reconciliation.scope_type !== 'stage') {
    throw AppError.notFound('阶段结算单不存在')
  }

  const viewer = await resolveViewer(userId, reconciliation.project_id)
  await loadProject(reconciliation.project_id)
  return buildDetail(reconciliation, viewer)
}

/**
 * 主工长提交阶段结算单（C-7.6）。
 *
 * 提交时重新生成金额快照：草稿生成到提交之间工长可能补录了流水。
 * 提交之后到业主确认之间，流水不应再变化；确认时会再校验一次（verifySnapshot），
 * 变了就退回重提，避免业主确认的是一份已经过时的数字。
 */
async function submit(userId, projectId, stageId, input = {}, context = {}) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)
  assertWritable(project)

  if (viewer.role !== 'foreman' || Number(viewer.is_primary) !== 1) {
    throw AppError.forbidden('仅主工长可提交阶段结算单')
  }

  const result = await db.withTransaction(async (tx) => {
    const stage = await projectStageModel.lockById(tx, projectId, stageId)
    if (!stage) throw AppError.notFound('阶段不存在')
    if (stage.gate_status === 'settled') throw AppError.conflict('本阶段已结清，无需重复提交')
    if (!SETTLEMENT_GATES.has(stage.gate_status)) {
      throw AppError.conflict('阶段尚未验收通过，无法提交阶段结算单')
    }

    let { reconciliation } = await ensureDraftRecord(tx, projectId, stageId)
    if (!reconciliation) throw AppError.conflict('阶段尚未验收通过，无法提交阶段结算单')

    // 加锁再读一次：ensureDraftRecord 刚创建时也走这里，保证状态判断与更新基于同一行
    reconciliation = await reconciliationModel.findByStage(projectId, stageId, tx, { forUpdate: true })
    if (!reconciliation) throw AppError.notFound('阶段结算单不存在')
    if (reconciliation.status === 'pending') {
      throw AppError.conflict('结算单已提交，正在等待主业主确认')
    }
    if (reconciliation.status === 'confirmed') {
      throw AppError.conflict('结算单已确认，不能重复提交')
    }

    const snapshot = await buildSnapshot(projectId, stageId, tx)
    await reconciliationModel.updateAmounts(
      reconciliation.id,
      {
        totalAmount: snapshot.receivable,
        incomeAmount: snapshot.income,
        expenseAmount: snapshot.expense,
      },
      tx
    )
    await reconciliationModel.syncDetails(
      reconciliation.id,
      snapshot.entries.map((row) => row.id),
      tx
    )

    // 上一轮异议在重新提交后进入「已处理」状态，但说明保留（AC-S07）
    const resolvedDisputes = await reconciliationModel.resolveDisputes(reconciliation.id, userId, tx)
    await projectStageModel.markAcceptedPendingSettlement(tx, projectId, stageId)

    await reconciliationModel.updateStatus(
      reconciliation.id,
      {
        status: 'pending',
        submittedBy: userId,
        submittedAt: datetime.format(),
        confirmedBy: null,
        confirmedAt: null,
        remark: input.remark !== undefined ? input.remark : reconciliation.remark,
      },
      tx
    )

    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.RECONCILIATION_SUBMIT,
        targetType: 'reconciliation',
        targetId: reconciliation.id,
        projectId,
        detail: {
          before: { status: reconciliation.status, resolvedDisputes },
          after: {
            status: 'pending',
            stageId,
            receivable: snapshot.receivable,
            income: snapshot.income,
            expense: snapshot.expense,
            entryCount: snapshot.entries.length,
          },
        },
      },
      tx
    )

    return reconciliation.id
  })

  await notifyPrimaryOwner(
    projectId,
    result,
    stageId,
    '阶段结算单待确认',
    '工长已提交阶段结算单，请核对明细并确认无异议'
  )

  const reconciliation = await reconciliationModel.findById(result)
  return buildDetail(reconciliation, viewer)
}

/**
 * 主业主确认前的快照校验。
 *
 * 提交后流水或付款节点被改动，说明业主看到的页面已经不是待确认的那一份。
 * 此时拒绝确认并退回重提，比「先把状态改成已结清、再解释金额为什么变了」安全。
 */
async function verifySnapshot(tx, reconciliation) {
  const stageId = reconciliation.project_stage_id
  const projectId = reconciliation.project_id
  const [entries, nodes, details] = await Promise.all([
    ledgerModel.listByStage(projectId, stageId, tx),
    paymentNodeModel.listByStage(projectId, stageId, tx),
    reconciliationModel.listDetails(reconciliation.id, tx),
  ])

  const currentIds = entries.map((row) => Number(row.id)).sort((a, b) => a - b)
  const detailIds = details.map((row) => Number(row.ledger_id)).sort((a, b) => a - b)
  const sameSet =
    currentIds.length === detailIds.length && currentIds.every((id, index) => id === detailIds[index])

  const income = money.sum(entries.filter((row) => row.type === 'income').map(netAmount))
  const expense = money.sum(entries.filter((row) => row.type === 'expense').map(netAmount))
  const receivable = money.sum(nodes.map((row) => row.amount))

  const unchanged =
    sameSet &&
    money.compare(income, reconciliation.income_amount) === 0 &&
    money.compare(expense, reconciliation.expense_amount) === 0 &&
    money.compare(receivable, reconciliation.total_amount) === 0

  if (!unchanged) {
    throw AppError.conflict('阶段流水或付款节点已变化，请主工长重新提交结算单')
  }

  return { ledgerIds: detailIds }
}

/**
 * AC-S08：在当前阶段置 `settled` 的同时把下一阶段置 `active`。
 * **必须在 reconciliation.confirm 的同一个事务里调用** —— 分开提交会出现
 * 「已结清但下一阶段仍锁死」的中间态，正是本功能要避免的事。
 */
async function settleStageInTransaction(tx, reconciliation) {
  const projectId = reconciliation.project_id
  const stageId = reconciliation.project_stage_id

  const stage = await projectStageModel.lockById(tx, projectId, stageId)
  if (!stage) throw AppError.notFound('阶段不存在')
  if (stage.gate_status === 'settled') throw AppError.conflict('本阶段已结清')
  if (!SETTLEMENT_GATES.has(stage.gate_status)) {
    throw AppError.conflict('阶段尚未验收通过，不能结清')
  }

  const settled = await projectStageModel.markSettled(tx, projectId, stageId)
  if (!settled) throw AppError.conflict('阶段状态已变化，请刷新后重试')

  const next = await projectStageModel.findNextStage(projectId, stage.seq, tx, { forUpdate: true })
  let unlocked = false
  if (next && next.gate_status === 'locked') {
    unlocked = await projectStageModel.unlockStage(tx, projectId, next.id)
  }

  return {
    stageId,
    stageName: stage.name,
    nextStageId: next ? next.id : null,
    nextStageName: next ? next.name : null,
    nextStageUnlocked: unlocked,
  }
}

/** 阶段结算提异议时同步门禁状态（C-7.8 / AC-S06） */
async function markDisputedInTransaction(tx, reconciliation) {
  return projectStageModel.markDisputed(tx, reconciliation.project_id, reconciliation.project_stage_id)
}

async function buildDetail(reconciliation, viewer, { project } = {}) {
  const stage = reconciliation.project_stage_id
    ? await projectStageModel.findById(reconciliation.project_stage_id)
    : null

  const [details, snapshot] = await Promise.all([
    reconciliationModel.listDetails(reconciliation.id),
    buildSnapshot(reconciliation.project_id, reconciliation.project_stage_id),
  ])

  const income = reconciliation.income_amount
  const expense = reconciliation.expense_amount
  const isPrimaryForeman = viewer.role === 'foreman' && Number(viewer.is_primary) === 1
  const primaryOwner = isPrimaryOwner(viewer)

  const myActions = []
  if (reconciliation.status === 'draft' && isPrimaryForeman) myActions.push('submit')
  if (reconciliation.status === 'disputed' && isPrimaryForeman) myActions.push('submit')
  if (reconciliation.status === 'pending' && primaryOwner) myActions.push('confirm', 'dispute')
  if (reconciliation.settlement_pdf_url) myActions.push('download')

  return {
    id: reconciliation.id,
    projectId: reconciliation.project_id,
    stageId: reconciliation.project_stage_id,
    stageName: stage ? stage.name : null,
    stageSeq: stage ? stage.seq : null,
    scopeType: reconciliation.scope_type,
    status: reconciliation.status,
    statusLabel: STATUS_LABELS[reconciliation.status] || reconciliation.status,
    // 应收是付款节点金额之和（AC-S02），不是本阶段流水收入
    receivableAmount: reconciliation.total_amount,
    incomeAmount: income,
    expenseAmount: expense,
    balanceAmount: money.subtract(income, expense),
    paymentNodes: mapPaymentNodes(snapshot.nodes),
    details: details.map(mapDetail),
    disputeCount: details.filter((row) => row.dispute === 1).length,
    resolvedDisputeCount: details.filter(
      (row) => row.dispute === 0 && row.dispute_remark && row.dispute_resolved_at
    ).length,
    submittedBy: reconciliation.submitted_by,
    submittedAt: reconciliation.submitted_at,
    confirmedBy: reconciliation.confirmed_by,
    confirmedAt: reconciliation.confirmed_at,
    remark: reconciliation.remark,
    settlementPdfUrl: reconciliation.settlement_pdf_url,
    settlementPdfSignedPath: reconciliation.settlement_pdf_url
      ? signedUrl.buildPath({
          resource: 'reconciliation-settlement',
          id: reconciliation.id,
          path: `/api/v1/reconciliations/${reconciliation.id}/settlement.pdf`,
        })
      : null,
    myRole: viewer.role,
    ownerType: viewer.owner_type ?? null,
    isPrimaryOwner: primaryOwner,
    isPrimaryForeman,
    myActions,
    project: project ? { id: project.id, name: project.name, status: project.status } : undefined,
  }
}

function mapPaymentNodes(nodes) {
  return nodes.map((node) => ({
    id: node.id,
    seq: node.seq,
    name: node.name,
    amount: node.amount,
    triggerType: node.trigger_type,
    status: node.status,
    statusLabel: PAYMENT_STATUS_LABELS[node.status] || node.status,
    unlockedAt: node.unlocked_at,
  }))
}

function mapDetail(row) {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    type: row.type,
    typeLabel: row.type === 'income' ? '收入' : '支出',
    category: row.category,
    amount: row.amount,
    occurredAt: row.occurred_at,
    remark: row.ledger_remark,
    isReversal: row.is_reversal === 1,
    dispute: row.dispute === 1,
    disputeRemark: row.dispute_remark,
    disputeResolvedAt: row.dispute_resolved_at,
  }
}

// ─────────────────────────────────────────────────────────────
// 通知
// ─────────────────────────────────────────────────────────────

async function notifyPrimaryOwner(projectId, reconciliationId, stageId, title, content) {
  const rows = await db.query(
    `SELECT DISTINCT u.id
       FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pm.project_id = ? AND pm.role = 'owner' AND pm.owner_type = 'primary'
        AND pm.status = 'active' AND pm.deleted_at IS NULL`,
    [projectId]
  )

  for (const row of rows) {
    await notificationService
      .notify({
        userId: row.id,
        projectId,
        type: notificationService.TYPES.PAYMENT,
        title,
        content,
        refType: 'stage_settlement',
        refId: reconciliationId,
      })
      .catch((err) => logger.warn('阶段结算通知发送失败', { reconciliationId, stageId, err }))
  }
}

async function notifyPrimaryForeman(projectId, reconciliationId, stageId, title, content) {
  const rows = await db.query(
    `SELECT DISTINCT u.id
       FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pm.project_id = ? AND pm.role = 'foreman' AND pm.is_primary = 1
        AND pm.status = 'active' AND pm.deleted_at IS NULL`,
    [projectId]
  )

  for (const row of rows) {
    await notificationService
      .notify({
        userId: row.id,
        projectId,
        type: notificationService.TYPES.PAYMENT,
        title,
        content,
        refType: 'stage_settlement',
        refId: reconciliationId,
      })
      .catch((err) => logger.warn('阶段结算通知发送失败', { reconciliationId, stageId, err }))
  }
}

module.exports = {
  STATUS_LABELS,
  ensureDraftForStage,
  getForStage,
  getByReconciliationId,
  submit,
  verifySnapshot,
  settleStageInTransaction,
  markDisputedInTransaction,
  buildSnapshot,
}
