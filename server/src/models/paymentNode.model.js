'use strict'

/**
 * payment_node 数据访问层（B-2.8 付款节点配置）。
 *
 * 状态流转「未开始 → 已解锁 → 已付款 → 已确认」是单向的（AC-L13），
 * 但状态变更发生在记账模块（验收通过自动解锁、工长登记付款），
 * 本模块只负责配置侧的增删改查。
 */

const db = require('../db/pool')

async function listByProject(projectId) {
  return db.query(
    `SELECT id, project_id, seq, name, amount, trigger_type, trigger_stage_id, status, unlocked_at, created_at
       FROM payment_node
      WHERE project_id = ? AND deleted_at IS NULL
      ORDER BY seq`,
    [projectId]
  )
}

/**
 * 某阶段的付款节点（阶段结算单的「应收」来源，AC-S02）。
 *
 * 不限定 trigger_type：只要节点明确关联了这个阶段，就属于本阶段应收。
 * 手工触发的节点在创建时也被禁止填 trigger_stage_id（管理端校验），
 * 因此这里按阶段过滤不会把无关节点算进来。
 */
async function listByStage(projectId, stageId, tx = db) {
  return tx.query(
    `SELECT id, project_id, seq, name, amount, trigger_type, trigger_stage_id, status, unlocked_at
       FROM payment_node
      WHERE project_id = ? AND trigger_stage_id = ? AND deleted_at IS NULL
      ORDER BY seq`,
    [projectId, stageId]
  )
}

async function findById(id) {
  return db.queryOne(
    `SELECT id, project_id, seq, name, amount, trigger_type, trigger_stage_id, status
       FROM payment_node WHERE id = ? AND deleted_at IS NULL`,
    [id]
  )
}

/**
 * 批量替换某个项目的付款节点配置。
 *
 * 用「整表替换」而不是逐条 diff：付款节点是一个**有序的整体**
 * （定金 → 开工款 → … → 尾款），顺序与金额之和共同构成配置。
 * 逐条增删改需要前端跟踪每个节点的 id 与变更类型，而实际使用中
 * 管理员几乎总是整体重排一次；整表替换的代码量和出错面都小得多。
 *
 * 代价是 id 会变。因此只允许在项目尚未产生关联流水时替换 ——
 * `ledger.payment_node_id` 指向节点，替换会切断已登记收入与节点的关联。
 * 该前置条件由 service 层判断。
 */
async function replaceAll(projectId, nodes, tx) {
  // 先软删旧的，再插入新的。用软删而不是物理删：
  // 万一有流水还挂着（理论上 service 层已拦），软删能保住那段关联不至于悬空
  await tx.query('UPDATE payment_node SET deleted_at = NOW() WHERE project_id = ? AND deleted_at IS NULL', [projectId])

  for (const [index, node] of nodes.entries()) {
    await tx.query(
      `INSERT INTO payment_node (project_id, seq, name, amount, trigger_type, trigger_stage_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, index + 1, node.name, node.amount, node.triggerType, node.triggerStageId ?? null]
    )
  }
}

/**
 * 加锁读取，供解锁 / 登记付款 / 确认使用（§6.2 要求行锁）。
 *
 * 状态流转必须走这里：两个并发请求（如连点两次「登记付款」）
 * 若都用普通读取，会双双读到同一个旧状态并各自通过校验。
 */
async function lockById(tx, id) {
  const rows = await tx.query(
    `SELECT id, project_id, seq, name, amount, trigger_type, trigger_stage_id, status
       FROM payment_node WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
    [id]
  )
  return rows.length > 0 ? rows[0] : null
}

/**
 * 写入节点状态。
 *
 * `unlocked_at` 只在进入 unlocked 时记录，之后的流转**不清空** ——
 * 它是「这个节点什么时候被解锁的」这一历史事实，与当前状态无关。
 */
async function updateStatus(id, status, tx = db) {
  if (status === 'unlocked') {
    await tx.query(
      'UPDATE payment_node SET status = ?, unlocked_at = COALESCE(unlocked_at, NOW()) WHERE id = ?',
      [status, id]
    )
    return
  }
  await tx.query('UPDATE payment_node SET status = ? WHERE id = ?', [status, id])
}

/**
 * 解锁「关联该阶段验收通过」的付款节点（AC-A21 / C-3.11 / AC-L14）。
 *
 * 条件里带 `status = 'not_started'` 是幂等保护：
 * 同一阶段若因故重复触发解锁，已解锁/已付款的节点不会被**退回**到 unlocked ——
 * AC-L13 明确节点状态只能单向流转，降级会把已登记的收款状态抹掉。
 *
 * @returns {Promise<Array>} 本次真正解锁的节点
 */
async function unlockByStage(projectId, stageId, tx) {
  const nodes = await tx.query(
    `SELECT id, name, amount FROM payment_node
      WHERE project_id = ? AND trigger_stage_id = ? AND trigger_type = 'stage_acceptance'
        AND status = 'not_started' AND deleted_at IS NULL`,
    [projectId, stageId]
  )

  if (nodes.length === 0) return []

  const placeholders = nodes.map(() => '?').join(', ')
  await tx.query(
    `UPDATE payment_node SET status = 'unlocked', unlocked_at = NOW()
      WHERE id IN (${placeholders}) AND status = 'not_started'`,
    nodes.map((n) => n.id)
  )

  return nodes
}

/** 某项目已登记的付款节点数量，用于判断能否整体替换 */
async function countByProject(projectId) {
  return db.count('FROM payment_node WHERE project_id = ? AND deleted_at IS NULL', [projectId])
}

/**
 * 已被流水引用的节点数。
 * 大于 0 时不允许重排节点 —— 否则收入流水会指向一个被软删的节点。
 */
async function countReferencedByLedger(projectId) {
  return db.count(
    `FROM ledger l
      JOIN payment_node pn ON pn.id = l.payment_node_id
     WHERE pn.project_id = ? AND l.deleted_at IS NULL`,
    [projectId]
  )
}

/** 各节点金额之和，用于与合同额比对（AC-L18：不一致时告警但允许保存） */
async function sumAmounts(projectId) {
  const row = await db.queryOne(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM payment_node WHERE project_id = ? AND deleted_at IS NULL',
    [projectId]
  )
  return row.total
}

module.exports = {
  listByProject,
  listByStage,
  findById,
  lockById,
  updateStatus,
  unlockByStage,
  replaceAll,
  countByProject,
  countReferencedByLedger,
  sumAmounts,
}
