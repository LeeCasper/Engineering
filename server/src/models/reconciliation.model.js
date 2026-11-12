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
  r.settlement_pdf_url, r.settlement_pdf_key, r.settlement_pdf_private,
  r.settlement_generated_at, r.created_at
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
 * 某阶段唯一的结算单（scope_type='stage'）。
 *
 * 迁移 030 用生成列 + 唯一索引在数据库层保证「一个阶段最多一张结算单」，
 * 因此这里最多返回一行；加锁版本用于提交与确认。
 */
async function findByStage(projectId, stageId, tx = db, { forUpdate = false } = {}) {
  const rows = await tx.query(
    `SELECT ${COLUMNS} FROM reconciliation r
      WHERE r.project_id = ? AND r.scope_type = 'stage' AND r.project_stage_id = ?
        AND r.deleted_at IS NULL
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [projectId, stageId]
  )
  return rows.length > 0 ? rows[0] : null
}

/** 写入阶段结算单的金额快照（提交时重算，确认前不允许再漂移） */
async function updateAmounts(id, { totalAmount, incomeAmount, expenseAmount }, tx) {
  await tx.query(
    `UPDATE reconciliation
        SET total_amount = ?, income_amount = ?, expense_amount = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [totalAmount, incomeAmount, expenseAmount, id]
  )
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

async function updateStatus(id, { status, submittedBy, submittedAt, confirmedBy, confirmedAt, remark }, tx) {
  const columns = ['status = ?']
  const params = [status]

  if (submittedBy !== undefined) {
    columns.push('submitted_by = ?')
    params.push(submittedBy)
  }
  if (submittedAt !== undefined) {
    columns.push('submitted_at = ?')
    params.push(submittedAt)
  }
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

/**
 * 记录结算单 PDF。
 *
 * `key` / `private` 用于私有存储（新数据）；`url` 只保留给历史公开文件。
 * 两者互斥：写私有存储时必须把 url 清成 NULL，否则旧链接仍可绕过签名访问。
 */
async function updatePdf(id, { url, key, private: isPrivate, generatedAt }) {
  await db.query(
    `UPDATE reconciliation
        SET settlement_pdf_url = ?, settlement_pdf_key = ?,
            settlement_pdf_private = ?, settlement_generated_at = ?
      WHERE id = ?`,
    [url ?? null, key ?? null, isPrivate ? 1 : 0, generatedAt, id]
  )
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
            s.name AS stage_name, s.seq AS stage_seq,
            (SELECT COUNT(*) FROM reconciliation_detail d
              WHERE d.reconciliation_id = r.id AND d.dispute = 1 AND d.deleted_at IS NULL) AS dispute_count
       FROM reconciliation r
       LEFT JOIN project_stage s ON s.id = r.project_stage_id AND s.deleted_at IS NULL
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

/**
 * 把明细同步为「当前归属该阶段的全部流水」。
 *
 * 用于阶段结算单重新提交：工长可能补录了流水、也可能用红冲更正过。
 * 已有的明细行不物理删除 —— 异议说明属于需要保留的历史（AC-S07），
 * 只把不再属于本阶段的明细软删掉。
 */
async function syncDetails(reconciliationId, ledgerIds, tx) {
  const existing = await tx.query(
    `SELECT id, ledger_id FROM reconciliation_detail
      WHERE reconciliation_id = ? AND deleted_at IS NULL`,
    [reconciliationId]
  )
  const wanted = new Set(ledgerIds.map(Number))
  const existingIds = new Set(existing.map((row) => Number(row.ledger_id)))

  const toAdd = ledgerIds.filter((id) => !existingIds.has(Number(id)))
  if (toAdd.length > 0) {
    // 唯一键 (reconciliation_id, ledger_id) 不包含 deleted_at：
    // 之前被软删的行仍然占位，因此用 ON DUPLICATE KEY UPDATE 复活而不是 INSERT
    const values = toAdd.map(() => '(?, ?, 0, NULL, NULL, NULL)').join(', ')
    const params = toAdd.flatMap((ledgerId) => [reconciliationId, ledgerId])
    await tx.query(
      `INSERT INTO reconciliation_detail
         (reconciliation_id, ledger_id, dispute, dispute_remark, dispute_resolved_at, dispute_resolved_by)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE deleted_at = NULL, dispute = 0,
         dispute_remark = NULL, dispute_resolved_at = NULL, dispute_resolved_by = NULL`,
      params
    )
  }

  const toRemove = existing.filter((row) => !wanted.has(Number(row.ledger_id))).map((row) => row.id)
  if (toRemove.length > 0) {
    const placeholders = toRemove.map(() => '?').join(', ')
    await tx.query(
      `UPDATE reconciliation_detail SET deleted_at = NOW() WHERE id IN (${placeholders})`,
      toRemove
    )
  }
}

/**
 * 工长重新提交时把旧异议标记为「已处理」。
 *
 * 不删除 `dispute_remark`：AC-S07 要求此前异议记录完整保留，
 * 前端据此展示「曾有异议 · 说明 · 已处理时间」。
 */
async function resolveDisputes(reconciliationId, userId, tx) {
  const result = await tx.query(
    `UPDATE reconciliation_detail
        SET dispute = 0, dispute_resolved_at = NOW(), dispute_resolved_by = ?
      WHERE reconciliation_id = ? AND dispute = 1 AND deleted_at IS NULL`,
    [userId, reconciliationId]
  )
  return result.affectedRows
}

async function listDetails(reconciliationId, tx = db) {
  return tx.query(
    // is_reversal / reversal_of_id 必须带上：结算单 PDF 要把红冲记录标出来，
    // 否则一条正数金额挂在明细里看不出它是冲销（CLAUDE.md 第 48 条）
    `SELECT d.id, d.ledger_id, d.dispute, d.dispute_remark,
            d.dispute_resolved_at, d.dispute_resolved_by,
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
  findByStage,
  findOpenByPeriod,
  updateStatus,
  updateAmounts,
  updatePdf,
  listByProject,
  addDetails,
  syncDetails,
  resolveDisputes,
  listDetails,
  listLedgerIds,
  setDispute,
  countDisputes,
}
