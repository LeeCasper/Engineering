'use strict'

/**
 * project_item（项目工序实例）数据访问层。
 *
 * ── 本模块最重要的一条纪律 ──
 * 凡是会改变「该阶段下工序集合或其权重」的操作（增、删、改权重、改进度），
 * 调用方都**必须**在同一个事务里重算阶段完成度。漏掉一次，
 * `project_stage.progress` 就与工序实际状态永久脱节 ——
 * 而它正是 C 端进度条、后台看板、阶段门禁判断的共同数据源。
 *
 * 因此本模块的写方法都接收 tx 参数，由 projectStructure / progress 服务
 * 在事务中调用并负责重算。不要把它们直接用在控制器里。
 */

const db = require('../db/pool')

async function findById(id, tx = db) {
  return tx.queryOne(
    `SELECT id, project_stage_id, name, seq, weight, progress, status, plan_start, plan_end, checklist
       FROM project_item WHERE id = ? AND deleted_at IS NULL`,
    [id]
  )
}

/** 加锁读取，供完成度变更使用（§6.2 要求行锁） */
async function lockById(tx, id) {
  const rows = await tx.query(
    `SELECT id, project_stage_id, name, seq, weight, progress, status
       FROM project_item WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
    [id]
  )
  return rows.length > 0 ? rows[0] : null
}

async function listByStage(stageId, tx = db) {
  return tx.query(
    // checklist 必须带上：发起阶段级验收时要由它组装自检清单（AC-AD32）。
    // 漏掉这一列不会报错，只会让清单静默退化成兜底项「XX已完成」——
    // 自检环节表面能走完，实际什么都没检查
    `SELECT id, name, seq, weight, progress, status, plan_start, plan_end, checklist
       FROM project_item
      WHERE project_stage_id = ? AND deleted_at IS NULL
      ORDER BY seq`,
    [stageId]
  )
}

/** 该阶段下的工序数，用于「不能删掉最后一个工序」的判断 */
async function countByStage(stageId, tx = db) {
  return tx.count('FROM project_item WHERE project_stage_id = ? AND deleted_at IS NULL', [stageId])
}

/** 下一个 seq。取 MAX+1 而不是 COUNT+1 —— 删过工序后两者会分叉，导致撞唯一索引 */
async function nextSeq(stageId, tx = db) {
  const row = await tx.queryOne(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM project_item WHERE project_stage_id = ?',
    [stageId]
  )
  return Number(row.next_seq)
}

async function create({ projectStageId, name, weight, planStart, planEnd, checklist }, tx) {
  const seq = await nextSeq(projectStageId, tx)
  const result = await tx.query(
    `INSERT INTO project_item (project_stage_id, name, seq, weight, progress, status, plan_start, plan_end, checklist)
     VALUES (?, ?, ?, ?, 0.00, 'not_started', ?, ?, ?)`,
    [
      projectStageId,
      name,
      seq,
      weight ?? null,
      planStart ?? null,
      planEnd ?? null,
      checklist ? JSON.stringify(checklist) : null,
    ]
  )
  return result.insertId
}

async function update(id, fields, tx) {
  const columns = []
  const params = []
  const mapping = {
    name: 'name',
    weight: 'weight',
    plan_start: 'plan_start',
    plan_end: 'plan_end',
    progress: 'progress',
    status: 'status',
    seq: 'seq',
  }

  for (const [key, column] of Object.entries(mapping)) {
    if (fields[key] !== undefined) {
      columns.push(`${column} = ?`)
      params.push(fields[key])
    }
  }
  if (columns.length === 0) return

  params.push(id)
  await tx.query(`UPDATE project_item SET ${columns.join(', ')} WHERE id = ?`, params)
}

/** 软删除。调用方必须先确认删完之后该阶段至少还剩 1 个工序 */
async function softDelete(id, tx) {
  await tx.query('UPDATE project_item SET deleted_at = NOW() WHERE id = ?', [id])
}

/** 一次性软删除某阶段下的全部工序（删阶段时级联） */
async function softDeleteByStage(stageId, tx) {
  await tx.query('UPDATE project_item SET deleted_at = NOW() WHERE project_stage_id = ? AND deleted_at IS NULL', [
    stageId,
  ])
}

module.exports = {
  findById,
  lockById,
  listByStage,
  countByStage,
  nextSeq,
  create,
  update,
  softDelete,
  softDeleteByStage,
}
