'use strict'

/**
 * 周期对账（C-4.7 / AC-L19 ~ L22）。
 *
 * ── 对账要解决的问题 ──
 * 装修过程中工长记一笔、业主记一笔，最后双方对不上账。对账把「工长单方面记账」
 * 变成「双方共同确认过的账」：工长提交某周期的对账单 → 业主逐条核对 →
 * 确认无异议后该周期流水**锁定**，此后不可修改（AC-L20）。
 *
 * ── 锁定是对账的全部意义 ──
 * 若确认之后还能改，对账就只是一次走过场的确认动作，
 * 之后双方仍然会为「你什么时候改的」扯皮。因此锁定的实现必须硬：
 * 服务层的修改/删除入口都要检查 `locked`，而不是只在前端藏按钮。
 *
 * ── 有异议时不锁定（AC-L21）──
 * 有异议说明双方还没谈拢，此时锁定流水等于把争议中的数字固化成事实。
 * 异议退回去让工长处理，重新提交后才可能进入确认。
 */

const AppError = require('../utils/AppError')
const money = require('../utils/money')
const datetime = require('../utils/datetime')
const db = require('../db/pool')
const logger = require('../utils/logger')
const signedUrl = require('../utils/signedUrl')
const { assertPrimaryOwner, isPrimaryOwner } = require('../utils/ownerType')
const notificationService = require('./notification.service')
const operationLog = require('./operationLog.service')
const ledgerModel = require('../models/ledger.model')
const reconciliationModel = require('../models/reconciliation.model')
const projectMemberModel = require('../models/projectMember.model')
const projectModel = require('../models/project.model')
const stageSettlementService = require('./stageSettlement.service')

/**
 * 归档项目全链路只读（AC-AD25 / AC-AD57）。
 *
 * 对账确认会锁流水、结算阶段、激活下一阶段，必须和验收写路径一样
 * 在事务内锁住项目行再判断，不能只依赖 tenantWriteGuard（它只看租户状态）。
 */
async function assertProjectWritable(projectId, tx) {
  const project = tx
    ? await tx.queryOne(
        'SELECT id, status FROM project WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [projectId]
      )
    : await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')
  if (project.status === 'archived') throw AppError.forbidden('项目已归档，全部数据只读')
  return project
}

const STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  DISPUTED: 'disputed',
}

const STATUS_LABELS = {
  draft: '草稿',
  pending: '待确认',
  confirmed: '已确认',
  disputed: '有异议',
}

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

// ─────────────────────────────────────────────────────────────
// 发起对账
// ─────────────────────────────────────────────────────────────

/**
 * 工长发起周期对账（C-4.7 / AC-L19 / AC-L22）。
 *
 * AC-L19：对账周期内无流水时不允许发起。
 * 这条不是形式主义 —— 一张零金额的对账单推给业主，只会让业主觉得系统在乱推送，
 * 进而对所有对账提醒都麻木。
 */
async function initiate(userId, projectId, input, context = {}) {
  const viewer = await resolveViewer(userId, projectId)
  const project = await loadProject(projectId)

  if (viewer.role !== 'foreman') throw AppError.forbidden('仅工长可发起对账')
  if (project.status === 'archived') throw AppError.forbidden('项目已归档，全部数据只读')

  const { periodStart, periodEnd } = input
  if (datetime.parse(periodStart).isAfter(datetime.parse(periodEnd), 'day')) {
    throw AppError.badRequest('对账周期的起始日期不得晚于结束日期')
  }

  return db.withTransaction(async (tx) => {
    // 同一周期不允许有两张未终结的对账单（与阶段结算单同一类约束）
    const open = await reconciliationModel.findOpenByPeriod({ projectId, periodStart, periodEnd }, tx)
    if (open) {
      throw AppError.conflict(`该周期已有一张「${STATUS_LABELS[open.status]}」的对账单`, {
        detail: { reconciliationId: open.id, status: open.status },
      })
    }

    const entries = await ledgerModel.listInPeriod({ projectId, startDate: periodStart, endDate: periodEnd }, tx)
    if (entries.length === 0) {
      throw AppError.conflict('该周期暂无流水，无需对账')
    }

    // 金额口径与汇总接口一致：红冲取负计入。用 money.sum 而不是 SQL 的 SUM，
    // 是为了让「对账单总额」与「账目总览」走**同一段计算代码**（AC-S15 的口径一致要求）
    const income = money.sum(entries.map((row) => (row.is_reversal === 1 ? negate(row.amount) : row.amount)))
    const incomeOnly = money.sum(
      entries.filter((r) => r.type === 'income').map((r) => (r.is_reversal === 1 ? negate(r.amount) : r.amount))
    )
    const expenseOnly = money.sum(
      entries.filter((r) => r.type === 'expense').map((r) => (r.is_reversal === 1 ? negate(r.amount) : r.amount))
    )

    const id = await reconciliationModel.create(
      {
        projectId,
        scopeType: 'period',
        periodStart,
        periodEnd,
        status: STATUS.PENDING,
        totalAmount: income,
        incomeAmount: incomeOnly,
        expenseAmount: expenseOnly,
        submittedBy: userId,
        submittedAt: datetime.format(),
        remark: input.remark ?? null,
      },
      tx
    )

    await reconciliationModel.addDetails(
      id,
      entries.map((row) => row.id),
      tx
    )

    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.RECONCILIATION_CREATE,
        targetType: 'reconciliation',
        targetId: id,
        projectId,
        detail: { after: { periodStart, periodEnd, entryCount: entries.length, income: incomeOnly, expense: expenseOnly } },
      },
      tx
    )

    return id
  }).then(async (id) => {
    await notifyOwner(projectId, id, '有一张对账单待确认', `${periodStart} 至 ${periodEnd} 的对账单已提交，请核对`)
    return getDetail(userId, projectId, id)
  })
}

// ─────────────────────────────────────────────────────────────
// 确认与异议
// ─────────────────────────────────────────────────────────────

/**
 * 业主确认对账（AC-L20 / AC-L22）。
 *
 * 确认后该周期内全部流水 `locked = 1`，此后不可修改、不可删除 ——
 * 更正只能走红冲（AC-L23）。锁定与状态流转在**同一事务**内完成：
 * 分开提交会出现「单据已确认但流水没锁」的中间态，
 * 而那正是「确认完还能改」这种扯皮的来源。
 */
async function confirm(userId, reconciliationId, context = {}) {
  const reconciliation = await reconciliationModel.findById(reconciliationId)
  if (!reconciliation) throw AppError.notFound('对账单不存在')

  const viewer = await resolveViewer(userId, reconciliation.project_id)
  assertPrimaryOwner(viewer, '确认对账')
  await assertProjectWritable(reconciliation.project_id)

  if (reconciliation.status !== STATUS.PENDING && reconciliation.status !== STATUS.DISPUTED) {
    throw AppError.conflict(`对账单当前为「${STATUS_LABELS[reconciliation.status]}」，不能确认`)
  }

  return db.withTransaction(async (tx) => {
    await assertProjectWritable(reconciliation.project_id, tx)
    // 加锁读，避免两个确认请求同时通过状态校验
    const locked = await reconciliationModel.lockById(tx, reconciliationId)
    if (!locked) throw AppError.notFound('对账单不存在')
    if (locked.status !== STATUS.PENDING && locked.status !== STATUS.DISPUTED) {
      throw AppError.conflict(`对账单当前为「${STATUS_LABELS[locked.status]}」，不能确认`)
    }

    // AC-L21 的延续：有未处理异议时不允许直接确认。
    // 异议还没谈拢就确认，等于把争议中的数字固化成事实
    const disputes = await reconciliationModel.countDisputes(reconciliationId, tx)
    if (disputes > 0) {
      throw AppError.conflict(`还有 ${disputes} 条明细存在异议，请工长处理后再确认`)
    }

    const isStage = locked.scope_type === 'stage'

    // 阶段结算单确认前必须复核快照：提交之后流水 / 付款节点若被改动，
    // 业主看到的页面已经不是待确认的那一份，应退回重提而不是确认一个过时数字。
    const snapshot = isStage
      ? await stageSettlementService.verifySnapshot(tx, locked)
      : { ledgerIds: await reconciliationModel.listLedgerIds(reconciliationId, tx) }

    const lockedCount = await ledgerModel.lockMany(snapshot.ledgerIds, tx)

    await reconciliationModel.updateStatus(
      reconciliationId,
      { status: STATUS.CONFIRMED, confirmedBy: userId, confirmedAt: datetime.format() },
      tx
    )

    // AC-S08：当前阶段 settled 与下一阶段 active 必须在**同一事务**内完成
    const stageResult = isStage
      ? await stageSettlementService.settleStageInTransaction(tx, locked)
      : null

    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.RECONCILIATION_CONFIRM,
        targetType: 'reconciliation',
        targetId: reconciliationId,
        projectId: reconciliation.project_id,
        detail: {
          before: { status: locked.status },
          after: {
            status: STATUS.CONFIRMED,
            lockedLedgerCount: lockedCount,
            ...(stageResult
              ? {
                  scopeType: 'stage',
                  stageId: stageResult.stageId,
                  nextStageId: stageResult.nextStageId,
                  nextStageUnlocked: stageResult.nextStageUnlocked,
                }
              : {}),
          },
        },
      },
      tx
    )

    return {
      id: reconciliationId,
      status: STATUS.CONFIRMED,
      lockedLedgerCount: lockedCount,
      ...(stageResult ? { stageSettlement: stageResult } : {}),
    }
  }).then(async (result) => {
    if (reconciliation.scope_type === 'stage' && result.stageSettlement) {
      const nextText = result.stageSettlement.nextStageName
        ? `，下一阶段「${result.stageSettlement.nextStageName}」已解锁`
        : ''
      await notifyForeman(
        reconciliation.project_id,
        reconciliationId,
        '阶段已结清',
        `本阶段结算已确认${nextText}`
      )
    } else {
      await notifyForeman(reconciliation.project_id, reconciliationId, '对账已确认', '业主已确认对账，相关流水已锁定')
    }

    // AC-L24：确认后生成结算单 PDF。与验收报告同理（AC-A19），
    // **生成失败不阻断对账确认** —— 对账确认是既成事实，PDF 只是归档产物。
    // 失败只记日志，双方仍可在对账详情页看到全部数据
    await require('./settlementPdf.service')
      .generate(reconciliationId)
      .catch((err) => {
        logger.error('结算单 PDF 生成失败（对账已确认，不阻断）', { reconciliationId, err })
      })

    return result
  })
}

/**
 * 业主对某条明细提异议（AC-L21）。
 *
 * 异议说明**必填** —— 工长需要知道具体哪里不对才能改。
 * 提异议后整张单状态置为「有异议」，且**不锁定**任何流水。
 */
async function dispute(userId, reconciliationId, { detailId, remark }, context = {}) {
  const reconciliation = await reconciliationModel.findById(reconciliationId)
  if (!reconciliation) throw AppError.notFound('对账单不存在')

  const viewer = await resolveViewer(userId, reconciliation.project_id)
  assertPrimaryOwner(viewer, '提出异议')
  await assertProjectWritable(reconciliation.project_id)

  if (reconciliation.status !== STATUS.PENDING && reconciliation.status !== STATUS.DISPUTED) {
    throw AppError.conflict(`对账单当前为「${STATUS_LABELS[reconciliation.status]}」，不能提出异议`)
  }

  const text = String(remark || '').trim()
  if (!text) throw AppError.badRequest('异议说明必填')

  return db.withTransaction(async (tx) => {
    await assertProjectWritable(reconciliation.project_id, tx)
    const ok = await reconciliationModel.setDispute({ reconciliationId, detailId, remark: text }, tx)
    if (!ok) throw AppError.notFound('对账明细不存在')

    // 已经有异议了就不必重复写状态 —— 反复触发会让 operation_log 被同类记录刷满
    if (reconciliation.status !== STATUS.DISPUTED) {
      await reconciliationModel.updateStatus(reconciliationId, { status: STATUS.DISPUTED }, tx)
    }

    // C-7.8 / AC-S06：阶段结算有异议时，阶段门禁同步进入 disputed，
    // 页面与阶段列表才能显示「结算有异议」，且下一阶段继续锁定。
    if (reconciliation.scope_type === 'stage') {
      await stageSettlementService.markDisputedInTransaction(tx, reconciliation)
    }

    await operationLog.record(
      {
        ...context,
        action: operationLog.ACTIONS.RECONCILIATION_DISPUTE,
        targetType: 'reconciliation',
        targetId: reconciliationId,
        projectId: reconciliation.project_id,
        detail: { after: { detailId, remark: text } },
      },
      tx
    )

    const disputeCount = await reconciliationModel.countDisputes(reconciliationId, tx)
    return { id: reconciliationId, status: STATUS.DISPUTED, disputeCount }
  }).then(async (result) => {
    await notifyForeman(
      reconciliation.project_id,
      reconciliationId,
      reconciliation.scope_type === 'stage' ? '阶段结算有异议' : '对账有异议',
      text.slice(0, 100)
    )
    return result
  })
}

// ─────────────────────────────────────────────────────────────
// 读取
// ─────────────────────────────────────────────────────────────

async function getDetail(userId, projectId, reconciliationId) {
  const viewer = await resolveViewer(userId, projectId)

  const reconciliation = await reconciliationModel.findById(reconciliationId)
  if (!reconciliation || Number(reconciliation.project_id) !== Number(projectId)) {
    throw AppError.notFound('对账单不存在')
  }

  const details = await reconciliationModel.listDetails(reconciliationId)

  return {
    id: reconciliation.id,
    scopeType: reconciliation.scope_type,
    periodStart: reconciliation.period_start,
    periodEnd: reconciliation.period_end,
    status: reconciliation.status,
    statusLabel: STATUS_LABELS[reconciliation.status],
    totalAmount: reconciliation.total_amount,
    incomeAmount: reconciliation.income_amount,
    expenseAmount: reconciliation.expense_amount,
    submittedBy: reconciliation.submitted_by,
    submittedAt: reconciliation.submitted_at,
    confirmedBy: reconciliation.confirmed_by,
    confirmedAt: reconciliation.confirmed_at,
    remark: reconciliation.remark,
    settlementPdfUrl: reconciliation.settlement_pdf_url,
    // AC-L24：双方均可下载。与 AC-A20 同口径 —— 带签名的临时链接，
    // 不要求登录态（结算单同样要能转发给不在系统里的人），2 小时有效
    settlementPdfSignedPath: reconciliation.settlement_pdf_url
      ? signedUrl.buildPath({
          resource: 'reconciliation-settlement',
          id: reconciliation.id,
          path: `/api/v1/reconciliations/${reconciliation.id}/settlement.pdf`,
        })
      : null,
    details: details.map((row) => ({
      id: row.id,
      ledgerId: row.ledger_id,
      type: row.type,
      typeLabel: row.type === 'income' ? '收入' : '支出',
      category: row.category,
      amount: row.amount,
      occurredAt: row.occurred_at,
      remark: row.ledger_remark,
      dispute: row.dispute === 1,
      disputeRemark: row.dispute_remark,
    })),
    disputeCount: details.filter((row) => row.dispute === 1).length,
    myRole: viewer.role,
    ownerType: viewer.owner_type ?? null,
    isPrimaryOwner: isPrimaryOwner(viewer),
  }
}

/** 对账单列表（AC-L22：完整展示周期、金额合计、状态、提交人、确认人及各自时间） */
async function list(userId, projectId) {
  const viewer = await resolveViewer(userId, projectId)
  await loadProject(projectId)

  // 阶段结算单与周期对账单并存（AC-S15）。列表把两种单据一起返回，
  // 前端按 scopeType 分别展示：阶段单显示阶段名，周期单显示对账周期。
  const rows = await reconciliationModel.listByProject(projectId)

  const submitters = await loadUserNames(rows.map((r) => r.submitted_by))
  const confirmers = await loadUserNames(rows.map((r) => r.confirmed_by))

  return {
    list: rows.map((row) => ({
      id: row.id,
      scopeType: row.scope_type,
      stageId: row.project_stage_id,
      stageName: row.stage_name || null,
      stageSeq: row.stage_seq || null,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      status: row.status,
      statusLabel:
        row.scope_type === 'stage'
          ? stageSettlementService.STATUS_LABELS[row.status] || row.status
          : STATUS_LABELS[row.status],
      totalAmount: row.total_amount,
      incomeAmount: row.income_amount,
      expenseAmount: row.expense_amount,
      disputeCount: Number(row.dispute_count),
      submittedBy: row.submitted_by,
      submittedByName: submitters.get(row.submitted_by) || null,
      submittedAt: row.submitted_at,
      confirmedBy: row.confirmed_by,
      confirmedByName: confirmers.get(row.confirmed_by) || null,
      confirmedAt: row.confirmed_at,
      settlementPdfUrl: row.settlement_pdf_url,
    })),
    total: rows.length,
    myRole: viewer.role,
    ownerType: viewer.owner_type ?? null,
    isPrimaryOwner: isPrimaryOwner(viewer),
  }
}

/** 批量取用户名，避免逐行查询。null / undefined 直接跳过 */
async function loadUserNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()

  const placeholders = unique.map(() => '?').join(', ')
  const rows = await db.query(`SELECT id, nickname FROM user WHERE id IN (${placeholders})`, unique)
  return new Map(rows.map((row) => [row.id, row.nickname]))
}

// ─────────────────────────────────────────────────────────────
// 通知
// ─────────────────────────────────────────────────────────────

async function notifyOwner(projectId, reconciliationId, title, content) {
  const owners = await db.query(
    `SELECT DISTINCT u.id FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pm.project_id = ? AND pm.role = 'owner' AND pm.owner_type = 'primary'
        AND pm.status = 'active' AND pm.deleted_at IS NULL`,
    [projectId]
  )

  for (const owner of owners) {
    await notificationService
      .notify({
        userId: owner.id,
        projectId,
        type: notificationService.TYPES.PAYMENT,
        title,
        content,
        refType: 'reconciliation',
        refId: reconciliationId,
      })
      .catch((err) => logger.warn('对账通知发送失败', { reconciliationId, err }))
  }
}

async function notifyForeman(projectId, reconciliationId, title, content) {
  const foremen = await db.query(
    `SELECT DISTINCT u.id FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pm.project_id = ? AND pm.role = 'foreman' AND pm.status = 'active' AND pm.deleted_at IS NULL`,
    [projectId]
  )

  for (const foreman of foremen) {
    await notificationService
      .notify({
        userId: foreman.id,
        projectId,
        type: notificationService.TYPES.PAYMENT,
        title,
        content,
        refType: 'reconciliation',
        refId: reconciliationId,
      })
      .catch((err) => logger.warn('对账通知发送失败', { reconciliationId, err }))
  }
}

/**
 * 取相反数。
 *
 * 金额列不允许负数（AC-L03），红冲靠 `is_reversal` 标记。
 * 在内存里做汇总时要把这个标记翻译成负号 —— 用 decimal.js 而不是 `-Number(x)`，
 * 否则「0.1 + 0.2」那类精度问题会从这里溜回来。
 */
function negate(amount) {
  return money.multiply(amount, '-1')
}

module.exports = {
  STATUS,
  STATUS_LABELS,
  initiate,
  confirm,
  dispute,
  getDetail,
  list,
  resolveViewer,
}
