'use strict'

/**
 * reconciliation / reconciliation_detail 数据访问层。
 *
 * 一张表承载两种单据，由 `scope_type` 区分（§6.1 / G-23）：
 *   `stage`  阶段结算单：`project_stage_id` 必填、`period_*` 为空 —— V1.1，属 §4.7
 *   `period` 周期对账单：`period_*` 必填、`project_stage_id` 为空 —— 记账模块，本次实现
 *
 * 合并的理由：两者的字段、状态流转、确认动作完全一致，仅「统计范围」的定义不同。
 * 拆两张表意味着确认逻辑、锁定逻辑、PDF 生成逻辑都要写两遍。
 */

const db = require('../db/pool')

const COLUMNS = `
  r.id, r.project_id, r.scope_type, r.project_stage_id, r.period_start, r.period_end,
  r.status, r.total_amount, r.income_amount, r.expense_amount,
  r.submitted_by, r.submitted_at, r.confirmed_by, r.confirmed_at, r.remark,
  r.settlement_pdf_url, r.settlement_generated_at, r.created_at
`

async function create(data, tx) {
  const result = await tx.query(
    `INSERT INTO reconciliation
       (project_id, scope_type, project_stage_id, period_start, period_end, status,
        total_amount, income_amount, expense_amount, submitted_by, submitted_at, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.projectId,
      data.scopeType,
      data.projectStageId ?? null,
      data.periodStart ?? null,
      data.periodEnd ?? null,
      data.status,
      data.totalAmount,
      data.incomeAmount,
      data.expenseAmount,
      data.submittedBy ?? null,
      data.submittedAt ?? null,
      data.remark ?? null,
    ]
  )
  return result.insertId
}

async function findById(id, tx = db) {
  return tx.queryOne(`SELECT ${COLUMNS} FROM reconciliation r WHERE r.id = ? AND r.deleted_at IS NULL`, [id])
}

/** 加锁读取，供确认/提异议使用（§6.2 要求行锁） */
async function lockById(tx, id) {
  const rows = await tx.query(
    `SELECT ${COLUMNS} FROM reconciliation r WHERE r.id = ? AND r.deleted_at IS NULL FOR UPDATE`,
    [id]
  )
  return rows.length > 0 ? rows[0] : null
}

/**
 * 某项目在给定周期内是否存在**未终结**的对账单。
 *
 * 「未终结」= 状态不是 `confirmed`。重复发起返回 409，
 * 与阶段结算单「一个阶段只能有一张未终结结算单」是同一类约束。
 */
async function findOpenByPeriod({ projectId, periodStart, periodEnd }, tx = db) {
  return tx.queryOne(
    `SELECT id, status FROM reconciliation
      WHERE project_id = ? AND scope_type = 'period'
        AND period_start = ? AND period_end = ?
        AND status <> 'confirmed' AND deleted_at IS NULL`,
    [projectId, periodStart, periodEnd]
  )
}

async function updateStatus(id, { status, confirmedBy, confirmedAt, remark }, tx) {
  const columns = ['status = ?']
  const params = [status]

  if (confirmedBy !== undefined) {
    columns.push('confirmed_by = ?')
    params.push(confirmedBy)
  }
  if (confirmedAt !== undefined) {
    columns.push('confirmed_at = ?')
    params.push(confirmedAt)
  }
  if (remark !== undefined) {
    columns.push('remark = ?')
    params.push(remark)
  }

  params.push(id)
  await tx.query(`UPDATE reconciliation SET ${columns.join(', ')} WHERE id = ?`, params)
}

async function updatePdf(id, { url, generatedAt }) {
  await db.query('UPDATE reconciliation SET settlement_pdf_url = ?, settlement_generated_at = ? WHERE id = ?', [
    url,
    generatedAt,
    id,
  ])
}

async function listByProject(projectId, { scopeType } = {}) {
  const where = ['r.project_id = ?', 'r.deleted_at IS NULL']
  const params = [projectId]

  if (scopeType) {
    where.push('r.scope_type = ?')
    params.push(scopeType)
  }

  return db.query(
    `SELECT ${COLUMNS},
            (SELECT COUNT(*) FROM reconciliation_detail d
              WHERE d.reconciliation_id = r.id AND d.dispute = 1) AS dispute_count
       FROM reconciliation r
      WHERE ${where.join(' AND ')}
      ORDER BY r.id DESC`,
    params
  )
}

// ── 明细 ──

/** 一次性写入对账明细。用批量 INSERT 而不是循环 —— 一个周期的流水可能上百条 */
async function addDetails(reconciliationId, ledgerIds, tx) {
  if (ledgerIds.length === 0) return

  const values = ledgerIds.map(() => '(?, ?, 0)').join(', ')
  const params = ledgerIds.flatMap((ledgerId) => [reconciliationId, ledgerId])

  await tx.query(
    `INSERT INTO reconciliation_detail (reconciliation_id, ledger_id, dispute) VALUES ${values}`,
    params
  )
}

async function listDetails(reconciliationId, tx = db) {
  return tx.query(
    // is_reversal / reversal_of_id 必须带上：结算单 PDF 要把红冲记录标出来，
    // 否则一条正数金额挂在明细里看不出它是冲销（CLAUDE.md 第 48 条）
    `SELECT d.id, d.ledger_id, d.dispute, d.dispute_remark,
            l.type, l.category, l.amount, l.occurred_at, l.remark AS ledger_remark,
            l.is_reversal, l.reversal_of_id
       FROM reconciliation_detail d
       JOIN ledger l ON l.id = d.ledger_id
      WHERE d.reconciliation_id = ? AND d.deleted_at IS NULL
      ORDER BY l.occurred_at, l.id`,
    [reconciliationId]
  )
}

/** 明细对应的流水 id（确认后要批量锁定它们，AC-L20） */
async function listLedgerIds(reconciliationId, tx = db) {
  const rows = await tx.query(
    'SELECT ledger_id FROM reconciliation_detail WHERE reconciliation_id = ? AND deleted_at IS NULL',
    [reconciliationId]
  )
  return rows.map((row) => row.ledger_id)
}

/**
 * 给某条明细打异议（AC-L21）。
 *
 * 允许追加异议：业主可能先提了几条、想了想又补一条。
 * 用 UPDATE 而不是 DELETE + INSERT —— 异议记录本身也是要留痕的。
 */
async function setDispute({ reconciliationId, detailId, remark }, tx) {
  const result = await tx.query(
    `UPDATE reconciliation_detail SET dispute = 1, dispute_remark = ?
      WHERE id = ? AND reconciliation_id = ? AND deleted_at IS NULL`,
    [remark, detailId, reconciliationId]
  )
  return result.affectedRows > 0
}

async function countDisputes(reconciliationId, tx = db) {
  return tx.count('FROM reconciliation_detail WHERE reconciliation_id = ? AND dispute = 1 AND deleted_at IS NULL', [
    reconciliationId,
  ])
}

module.exports = {
  COLUMNS,
  create,
  findById,
  lockById,
  findOpenByPeriod,
  updateStatus,
  updatePdf,
  listByProject,
  addDetails,
  listDetails,
  listLedgerIds,
  setDispute,
  countDisputes,
}
