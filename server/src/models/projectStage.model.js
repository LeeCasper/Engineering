'use strict'

/**
 * project_stage 数据访问层。
 *
 * 门禁状态（gate_status）是「能否汇报、能否发起验收」的**单一事实来源**（§6.2），
 * 因此涉及门禁的读写都要走本模块，不要在别处手写 UPDATE。
 */

const db = require('../db/pool')

/**
 * 按模板结构批量生成项目阶段与工序（B-2.5 / AC-AD15）。
 *
 * ── 为什么是「拷贝」而不是「引用模板」──
 * 生成的阶段与工序是**实例副本**，与源模板之间没有任何外键依赖。
 * 因此编辑模板不会影响已生成的项目（AC-AD17），项目内也能自由增删改而不污染模板
 * （AC-AD16）。这是天然隔离，不需要额外字段或同步逻辑。
 *
 * ── 计划日期怎么算 ──
 * 模板只给了每个阶段的 plan_days，没有工期起点的绝对概念，因此按**串行**排布：
 * 首阶段从项目开工日开始，后续阶段的起点是前一阶段的次日。
 * 真实工程里阶段会有重叠，但模板无法表达重叠，硬编一个假设比串行更容易出错。
 *
 * 工序的 plan_start/plan_end 直接取所属阶段的区间 ——
 * 模板里工序没有独立工期，编一个「平均分配」只会得到看似精确、
 * 实则无依据的日期，反而让 AC-P24 的工序级延期判断失去意义。
 *
 * @param {number} projectId
 * @param {string} startDate 项目开工日期 YYYY-MM-DD
 * @param {Array} stages 模板结构（stageTemplate.findStructure 的返回值）
 * @param {object} tx 事务连接
 */
async function generateFromTemplate(projectId, startDate, stages, tx) {
  const datetime = require('../utils/datetime')
  const created = []

  let cursor = startDate

  for (const [index, stage] of stages.entries()) {
    const planStart = cursor
    // plan_days 是「天数」，因此结束日 = 开始日 + (天数 - 1)
    const planEnd = datetime.addDays(planStart, Math.max(0, Number(stage.plan_days) - 1))
    cursor = datetime.addDays(planEnd, 1)

    // C-7.4：首个阶段默认解锁，其余锁定。
    // 其余阶段要等上一阶段「验收通过 + 结算无异议」才由服务层解锁（§4.7）
    const gateStatus = index === 0 ? 'active' : 'locked'

    const stageResult = await tx.query(
      `INSERT INTO project_stage
         (project_id, name, seq, weight, status, gate_status, plan_start, plan_end, progress, unlocked_at)
       VALUES (?, ?, ?, ?, 'not_started', ?, ?, ?, 0.00, ?)`,
      [
        projectId,
        stage.name,
        stage.seq,
        stage.weight ?? null,
        gateStatus,
        planStart,
        planEnd,
        gateStatus === 'active' ? new Date() : null,
      ]
    )
    const stageId = stageResult.insertId
    created.push({ id: stageId, name: stage.name, seq: stage.seq })

    for (const item of stage.items) {
      await tx.query(
        `INSERT INTO project_item
           (project_stage_id, name, seq, weight, progress, status, plan_start, plan_end, checklist)
         VALUES (?, ?, ?, ?, 0.00, 'not_started', ?, ?, ?)`,
        [
          stageId,
          item.name,
          item.seq,
          item.weight ?? null,
          planStart,
          planEnd,
          item.default_checklist ? JSON.stringify(item.default_checklist) : null,
        ]
      )
    }
  }

  return created
}

/** 阶段 + 工序树（B-2.4 项目详情、C-2.3 阶段详情） */
async function findTreeByProject(projectId) {
  const stages = await db.query(
    `SELECT id, project_id, name, seq, weight, status, gate_status, progress,
            plan_start, plan_end, actual_start, actual_end, unlocked_at, settled_at
       FROM project_stage
      WHERE project_id = ? AND deleted_at IS NULL
      ORDER BY seq`,
    [projectId]
  )

  if (stages.length === 0) return []

  const stageIds = stages.map((s) => s.id)
  const placeholders = stageIds.map(() => '?').join(', ')
  const items = await db.query(
    `SELECT id, project_stage_id, name, seq, weight, progress, status, plan_start, plan_end, checklist
       FROM project_item
      WHERE project_stage_id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY project_stage_id, seq`,
    stageIds
  )

  const itemsByStage = new Map()
  for (const item of items) {
    if (!itemsByStage.has(item.project_stage_id)) itemsByStage.set(item.project_stage_id, [])
    itemsByStage.get(item.project_stage_id).push(item)
  }

  return stages.map((stage) => ({ ...stage, items: itemsByStage.get(stage.id) || [] }))
}

async function findById(id, tx = db) {
  return tx.queryOne(
    `SELECT id, project_id, name, seq, weight, status, gate_status, progress,
            plan_start, plan_end, actual_start, actual_end
       FROM project_stage WHERE id = ? AND deleted_at IS NULL`,
    [id]
  )
}

/**
 * 取门禁状态的**加锁**读。
 *
 * §6.2 明确要求门禁校验使用行锁：两个并发请求（如同时点两次「发起验收」）
 * 若都用普通读取，会双双读到「未锁定」并各自通过校验。
 * 必须走事务连接，否则 FOR UPDATE 锁住的连接与后续 UPDATE 的不是同一条。
 */
async function lockGate(tx, stageId) {
  const rows = await tx.query(
    `SELECT id, project_id, name, seq, gate_status, progress, status
       FROM project_stage
      WHERE id = ? AND deleted_at IS NULL
      FOR UPDATE`,
    [stageId]
  )
  return rows.length > 0 ? rows[0] : null
}

/** 加锁读取阶段（阶段结算确认时要用它同时改当前阶段与下一阶段） */
async function lockById(tx, projectId, stageId) {
  const rows = await tx.query(
    `SELECT id, project_id, name, seq, gate_status, progress, status
       FROM project_stage
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL
      FOR UPDATE`,
    [stageId, projectId]
  )
  return rows.length > 0 ? rows[0] : null
}

/** 下一阶段（按 seq 递增）。只有它还是 locked 时才会被解锁。 */
async function findNextStage(projectId, seq, tx = db, { forUpdate = false } = {}) {
  const rows = await tx.query(
    `SELECT id, name, seq, gate_status
       FROM project_stage
      WHERE project_id = ? AND seq > ? AND deleted_at IS NULL
      ORDER BY seq ASC LIMIT 1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [projectId, seq]
  )
  return rows.length > 0 ? rows[0] : null
}

/**
 * 工长重新提交阶段结算后，阶段从「有异议」回到「已验收待结算」。
 * 此时下一阶段仍然锁定，必须等主业主确认后才解锁。
 */
async function markAcceptedPendingSettlement(tx, projectId, stageId) {
  const result = await tx.query(
    `UPDATE project_stage
        SET gate_status = 'accepted'
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL
        AND gate_status = 'disputed'`,
    [stageId, projectId]
  )
  return result.affectedRows > 0
}

async function markDisputed(tx, projectId, stageId) {
  const result = await tx.query(
    `UPDATE project_stage
        SET gate_status = 'disputed'
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL
        AND gate_status IN ('accepted', 'disputed')`,
    [stageId, projectId]
  )
  return result.affectedRows > 0
}

/**
 * 阶段结清（AC-S08）。
 *
 * `status` 列没有 settled 枚举值：它是展示状态，由 progress.service 按
 * gate_status 派生；这里只把门禁的单一事实来源推进到终态，并记录时间。
 */
async function markSettled(tx, projectId, stageId) {
  const result = await tx.query(
    `UPDATE project_stage
        SET gate_status = 'settled', settled_at = COALESCE(settled_at, NOW())
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL
        AND gate_status IN ('accepted', 'disputed')`,
    [stageId, projectId]
  )
  return result.affectedRows > 0
}

/**
 * 解锁下一阶段（C-7.1）。
 *
 * 只在 gate_status='locked' 时生效：若下一阶段已经因为别的原因激活
 * （例如历史数据或管理员调整），不能把它降级或重复写 unlocked_at。
 */
async function unlockStage(tx, projectId, stageId) {
  const result = await tx.query(
    `UPDATE project_stage
        SET gate_status = 'active', unlocked_at = COALESCE(unlocked_at, NOW())
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND gate_status = 'locked'`,
    [stageId, projectId]
  )
  return result.affectedRows > 0
}

/** 取某项目当前未结清的首个阶段（阶段推进的「当前阶段」） */
async function findCurrentStage(projectId) {
  return db.queryOne(
    `SELECT id, name, seq, gate_status, progress
       FROM project_stage
      WHERE project_id = ? AND deleted_at IS NULL AND gate_status <> 'settled'
      ORDER BY seq ASC LIMIT 1`,
    [projectId]
  )
}

/** 更新展示状态（由进度与验收结论派生，非手工设置） */
async function updateStatus(projectId, stageId, status, tx = db) {
  await tx.query('UPDATE project_stage SET status = ? WHERE id = ? AND project_id = ?', [status, stageId, projectId])
}

/** 下一个 seq。取 MAX+1 而不是 COUNT+1 —— 删过阶段后两者会分叉，导致撞唯一索引 */
async function nextSeq(projectId, tx = db) {
  const row = await tx.queryOne(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM project_stage WHERE project_id = ?',
    [projectId]
  )
  return Number(row.next_seq)
}

/**
 * 新增阶段（B-2.5：生成后可手工增删改）。
 *
 * 新阶段一律 `gate_status = 'locked'`，即使它是当前最后一个阶段 ——
 * 门禁的解锁是「上一阶段结清」触发的（C-7.1），不由「新增一个阶段」顺带完成。
 * 唯一例外是项目本来没有任何阶段时，它成为首阶段，按 C-7.4 默认解锁。
 */
async function create({ projectId, name, planStart, planEnd, weight }, tx) {
  const seq = await nextSeq(projectId, tx)
  const existing = await countByProject(projectId)

  // C-7.4：首个阶段默认解锁
  const gateStatus = existing === 0 ? 'active' : 'locked'

  const result = await tx.query(
    `INSERT INTO project_stage
       (project_id, name, seq, weight, status, gate_status, plan_start, plan_end, progress, unlocked_at)
     VALUES (?, ?, ?, ?, 'not_started', ?, ?, ?, 0.00, ?)`,
    [projectId, name, seq, weight ?? null, gateStatus, planStart ?? null, planEnd ?? null, gateStatus === 'active' ? new Date() : null]
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
    actual_start: 'actual_start',
    actual_end: 'actual_end',
  }

  for (const [key, column] of Object.entries(mapping)) {
    if (fields[key] !== undefined) {
      columns.push(`${column} = ?`)
      params.push(fields[key])
    }
  }
  if (columns.length === 0) return

  params.push(id)
  await tx.query(`UPDATE project_stage SET ${columns.join(', ')} WHERE id = ?`, params)
}

/**
 * 写入阶段完成度与派生的展示状态。
 *
 * 只由 progress.service 在重算后调用，**不接受**手工设置 ——
 * AC-P02 明确「状态由系统自动判定，无手工设置入口」。
 */
async function updateProgress(id, { progress, status }, tx) {
  await tx.query('UPDATE project_stage SET progress = ?, status = ? WHERE id = ?', [progress, status, id])
}

async function softDelete(id, tx) {
  await tx.query('UPDATE project_stage SET deleted_at = NOW() WHERE id = ?', [id])
}

async function countByProject(projectId, tx = db) {
  return tx.count('FROM project_stage WHERE project_id = ? AND deleted_at IS NULL', [projectId])
}

async function countByStatus(projectId, status) {
  return db.count('FROM project_stage WHERE project_id = ? AND status = ? AND deleted_at IS NULL', [projectId, status])
}

module.exports = {
  generateFromTemplate,
  findTreeByProject,
  findById,
  lockGate,
  lockById,
  findNextStage,
  markAcceptedPendingSettlement,
  markDisputed,
  markSettled,
  unlockStage,
  findCurrentStage,
  create,
  update,
  updateProgress,
  updateStatus,
  softDelete,
  nextSeq,
  countByProject,
  countByStatus,
}
