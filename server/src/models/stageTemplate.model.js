'use strict'

/**
 * stage_template / stage_template_stage / stage_template_item 数据访问层。
 */

const db = require('../db/pool')

/** 模板列表，附带阶段数与工序数、引用项目数（B-3.1 / AC-AD28） */
async function list({ tenantId, offset, limit, keyword, onlyDefault }) {
  if (!tenantId) throw new Error('模板查询必须带 tenantId（多租户下模板按租户隔离）')

  const where = ['t.deleted_at IS NULL', 't.tenant_id = ?']
  const params = [tenantId]

  if (keyword) {
    where.push('t.name LIKE ?')
    params.push(`%${keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)
  }
  if (onlyDefault) where.push('t.is_default = 1')

  const clause = `FROM stage_template t WHERE ${where.join(' AND ')}`

  const total = await db.count(clause, params)
  const rows = await db.query(
    `SELECT t.id, t.name, t.is_default, t.created_by, t.created_at, t.updated_at,
            (SELECT COUNT(*) FROM stage_template_stage s
              WHERE s.template_id = t.id AND s.deleted_at IS NULL) AS stage_count,
            (SELECT COUNT(*) FROM stage_template_item i
               JOIN stage_template_stage s2 ON s2.id = i.template_stage_id
              WHERE s2.template_id = t.id AND s2.deleted_at IS NULL AND i.deleted_at IS NULL) AS item_count,
            (SELECT COUNT(*) FROM project p
              WHERE p.template_id = t.id AND p.deleted_at IS NULL) AS project_count
       ${clause}
      ORDER BY t.is_default DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return { total, rows }
}

/**
 * 按 id 取模板，**必须带租户**。
 *
 * 不带租户的话，租户 A 的 owner 可以拿 id 直接读写租户 B 的模板 ——
 * 模板 id 是自增的，扫一遍就知道对方有多少套。调用方一律传 operator.tenantId。
 */
async function findById(id, tenantId) {
  if (!tenantId) throw new Error('模板查询必须带 tenantId')
  return db.queryOne(
    `SELECT id, tenant_id, name, is_default, created_by, created_at
       FROM stage_template WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [id, tenantId]
  )
}

/**
 * 取**本租户**的默认模板（B-2.5：建档未显式选模板时用它）。
 *
 * 必须带租户：不隔离的话建档会拿到全表第一条默认模板，
 * 于是租户 B 的新项目套上了租户 A 的阶段工序 —— 数据看起来完全正常，
 * 只是「按模板生成了」，没人会发现套错了。
 */
async function findDefault(tenantId) {
  if (!tenantId) throw new Error('默认模板查询必须带 tenantId')
  return db.queryOne(
    `SELECT id, name, is_default FROM stage_template
      WHERE is_default = 1 AND tenant_id = ? AND deleted_at IS NULL
      ORDER BY id ASC LIMIT 1`,
    [tenantId]
  )
}

/**
 * 取完整的模板结构（阶段 + 工序），用于生成项目实例。
 * 两次查询后在内存里组装，而不是 JOIN 成一张宽表再拆 ——
 * 后者在「阶段多、工序多」时会产生大量重复列，解析成本反而更高。
 */
async function findStructure(templateId) {
  const stages = await db.query(
    `SELECT id, name, seq, plan_days, weight
       FROM stage_template_stage
      WHERE template_id = ? AND deleted_at IS NULL
      ORDER BY seq`,
    [templateId]
  )

  const stageIds = stages.map((s) => s.id)
  let items = []
  if (stageIds.length > 0) {
    const placeholders = stageIds.map(() => '?').join(', ')
    items = await db.query(
      `SELECT id, template_stage_id, name, seq, weight, default_checklist
         FROM stage_template_item
        WHERE template_stage_id IN (${placeholders}) AND deleted_at IS NULL
        ORDER BY template_stage_id, seq`,
      stageIds
    )
  }

  const itemsByStage = new Map()
  for (const item of items) {
    if (!itemsByStage.has(item.template_stage_id)) itemsByStage.set(item.template_stage_id, [])
    itemsByStage.get(item.template_stage_id).push(item)
  }

  return stages.map((stage) => ({ ...stage, items: itemsByStage.get(stage.id) || [] }))
}

/** 模板被引用的项目数（AC-AD35：被引用的模板不可删除） */
async function countReferencingProjects(templateId) {
  return db.count('FROM project WHERE template_id = ? AND deleted_at IS NULL', [templateId])
}

/** 模板总数，用于「系统始终保留至少一个模板」的判断 */
async function countAll(tenantId) {
  if (!tenantId) throw new Error('模板计数必须带 tenantId')
  return db.count('FROM stage_template WHERE tenant_id = ? AND deleted_at IS NULL', [tenantId])
}

async function create({ tenantId, name, isDefault = false, createdBy }, tx = db) {
  if (!tenantId) throw new Error('创建模板必须带 tenantId')
  const result = await tx.query(
    'INSERT INTO stage_template (tenant_id, name, is_default, created_by) VALUES (?, ?, ?, ?)',
    [tenantId, name, isDefault ? 1 : 0, createdBy ?? null]
  )
  return result.insertId
}

async function updateName(id, name, tx = db) {
  await tx.query('UPDATE stage_template SET name = ? WHERE id = ?', [name, id])
}

/**
 * 清空全部默认标记。
 *
 * **必须在设置新默认之前调用** —— `default_key` 上有唯一索引，
 * 先把新模板置为 1 时旧默认还占着那个键，会直接撞索引。
 * 与主工长改指、占位账号合并是同一类陷阱。
 */
async function clearDefault(tenantId, tx = db) {
  if (!tenantId) throw new Error('清空默认模板必须带 tenantId')
  // **按租户清**：不隔离的话，租户 A 设一次默认会把全平台所有租户的默认模板
  // 一起清掉 —— 其他租户下一次建档会直接报「没有默认模板」，而他们什么都没做
  await tx.query(
    'UPDATE stage_template SET is_default = 0 WHERE is_default = 1 AND tenant_id = ? AND deleted_at IS NULL',
    [tenantId]
  )
}

async function setDefault(id, tenantId, tx = db) {
  if (!tenantId) throw new Error('设置默认模板必须带 tenantId')
  await tx.query('UPDATE stage_template SET is_default = 1 WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [
    id,
    tenantId,
  ])
}

async function softDelete(id, tx = db) {
  await tx.query('UPDATE stage_template SET deleted_at = NOW(), is_default = 0 WHERE id = ?', [id])
}

/**
 * 整体替换模板的阶段与工序结构（B-3.3 / B-3.4 / AC-AD29 / AC-AD31 / AC-AD62）。
 *
 * ── 为什么是整体替换 ──
 * §5.3 明确：「所有排序在保存时整体提交，服务端按最终顺序重写 seq」。
 * 模板编辑器的拖拽交互天然产生一个完整的顺序，逐条 diff 需要前端跟踪每个
 * 节点的 id 与变更类型，代码量与出错面都大得多。
 *
 * ── 为什么可以物理删除旧行 ──
 * 这里用 DELETE 而不是软删除。模板的阶段/工序**没有任何东西引用**：
 * 项目里的 `project_stage` / `project_item` 是建档时拷贝出来的**副本**
 * （§6.2、AC-AD17），不指回模板。因此物理删除不会造成悬空引用，
 * 也避免了「改十次模板留下十份软删数据」这类累积。
 *
 * 顺序上必须先删后插：`uk_sts_template_seq` 对 (template_id, seq) 唯一，
 * 先插新的会与旧的同 seq 行撞键。
 */
async function replaceStructure(templateId, stages, tx) {
  await tx.query(
    'DELETE i FROM stage_template_item i JOIN stage_template_stage s ON s.id = i.template_stage_id WHERE s.template_id = ?',
    [templateId]
  )
  await tx.query('DELETE FROM stage_template_stage WHERE template_id = ?', [templateId])

  for (const [stageIndex, stage] of stages.entries()) {
    const stageResult = await tx.query(
      'INSERT INTO stage_template_stage (template_id, name, seq, plan_days, weight) VALUES (?, ?, ?, ?, ?)',
      [templateId, stage.name, stageIndex + 1, stage.planDays, stage.weight ?? null]
    )

    for (const [itemIndex, item] of stage.items.entries()) {
      await tx.query(
        'INSERT INTO stage_template_item (template_stage_id, name, seq, weight, default_checklist) VALUES (?, ?, ?, ?, ?)',
        [
          stageResult.insertId,
          item.name,
          itemIndex + 1,
          item.weight ?? null,
          item.checklist && item.checklist.length > 0 ? JSON.stringify(item.checklist.map((n) => ({ name: n }))) : null,
        ]
      )
    }
  }
}

module.exports = {
  list,
  findById,
  findDefault,
  findStructure,
  create,
  updateName,
  clearDefault,
  setDefault,
  softDelete,
  replaceStructure,
  countReferencingProjects,
  countAll,
}
