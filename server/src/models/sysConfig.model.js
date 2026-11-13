'use strict'

/**
 * sys_config 数据访问层（B-5.x / §6.2）。
 *
 * 全局配置与项目级覆盖分两组方法：
 * - `listGlobal` / `findGlobal` / `upsertGlobal` / `softDeleteGlobalOverride`
 *   只看 `scope = 'global'` 的行；
 * - `findProject` / `upsertProject` / `softDeleteProjectOverride`
 *   只看 `scope = 'project'` 的行（B-5.1 的「支持按项目覆盖」）。
 *
 * 两组方法刻意不共用一个带 scope 参数的函数：读取优先级是
 * 「项目覆盖 → 租户覆盖 → 平台基础 → 代码默认值」，每条路径都只有一种语义，
 * 合并之后每个调用方都要自己判断「这次该查哪一种」，漏掉一层就会静默取错值。
 */

const db = require('../db/pool')

/** 全部全局配置行 */
async function listGlobal(tenantId) {
  // tenantId 为 null = 平台级默认值；不为 null = 该租户的配置
  const scope = tenantId == null ? 'tenant_id IS NULL' : 'tenant_id = ?'
  const params = tenantId == null ? [] : [tenantId]

  return db.query(
    `SELECT config_key, config_value, description, updated_by, updated_at
       FROM sys_config
      WHERE scope = 'global' AND ${scope} AND deleted_at IS NULL
      ORDER BY config_key`,
    params
  )
}

async function findGlobal(tenantId, key) {
  const scope = tenantId == null ? 'tenant_id IS NULL' : 'tenant_id = ?'
  const params = tenantId == null ? [key] : [key, tenantId]

  return db.queryOne(
    `SELECT id, config_key, config_value, description, updated_by, updated_at
       FROM sys_config
      WHERE config_key = ? AND scope = 'global' AND ${scope} AND deleted_at IS NULL`,
    params
  )
}

/**
 * 写入或更新一条全局配置。
 *
 * ── 为什么用 ON DUPLICATE KEY UPDATE 而不是「先查再决定插还是改」 ──
 * 唯一索引是 `(tenant_key, config_key, scope, project_id_key)`，其中
 * `tenant_key` 与 `project_id_key` 都是生成列（`IFNULL(..., 0)`）——
 * 它们存在的理由正是 MySQL 的唯一索引不约束 NULL（CLAUDE.md 第 2 条）。
 * 交给数据库做「存在就改、不存在就插」，既用上了这个索引，
 * 也不会有两个管理员同时保存时的竞态。
 *
 * `tenantId = null` 写入的是**平台基础配置**，迁移 022 起 tenant_id 允许 NULL。
 */
async function upsertGlobal({ tenantId, key, value, description, updatedBy }, tx = db) {
  await tx.query(
    `INSERT INTO sys_config (tenant_id, config_key, config_value, scope, project_id, description, updated_by)
     VALUES (?, ?, ?, 'global', NULL, ?, ?)
     ON DUPLICATE KEY UPDATE
       config_value = VALUES(config_value),
       description  = COALESCE(VALUES(description), description),
       updated_by   = VALUES(updated_by),
       deleted_at   = NULL`,
    [tenantId, key, value, description ?? null, updatedBy ?? null]
  )
}

/**
 * 软删除某租户的覆盖值，使配置重新继承平台基础版本。
 *
 * 只允许删 `scope='global' AND project_id IS NULL` 的行：项目级覆盖属于
 * 另一个模块，这个入口不能顺手把它们清掉。
 *
 * 记录 `updated_by` 便于回答「是谁把租户覆盖恢复成平台默认的」。
 */
async function softDeleteGlobalOverride({ tenantId, key, updatedBy }, tx = db) {
  const result = await tx.query(
    `UPDATE sys_config
        SET deleted_at = NOW(), updated_by = ?
      WHERE tenant_id = ? AND config_key = ? AND scope = 'global'
        AND project_id IS NULL AND deleted_at IS NULL`,
    [updatedBy ?? null, tenantId, key]
  )
  return result.affectedRows > 0
}

/**
 * 取某个项目的覆盖值（B-5.1）。
 *
 * 只按 `project_id` 过滤，不带 tenant_id —— 项目 id 全局唯一，
 * 多带一层租户条件只会在两者不一致时制造「该信哪个」的歧义。
 */
async function findProject(projectId, key) {
  return db.queryOne(
    `SELECT id, config_key, config_value, description, updated_by, updated_at
       FROM sys_config
      WHERE config_key = ? AND scope = 'project' AND project_id = ? AND deleted_at IS NULL`,
    [key, projectId]
  )
}

/**
 * 列出某个项目的全部覆盖值（后台阈值配置页回显用）。
 */
async function listProject(projectId) {
  return db.query(
    `SELECT config_key, config_value, description, updated_by, updated_at
       FROM sys_config
      WHERE scope = 'project' AND project_id = ? AND deleted_at IS NULL
      ORDER BY config_key`,
    [projectId]
  )
}

/**
 * 写入 / 更新项目覆盖值。
 *
 * 唯一索引是 `(tenant_key, config_key, scope, project_id_key)`；
 * `tenant_id` 存项目所属租户，让同一租户的审计查询也能顺着租户过滤。
 * 软删除过的行靠 `deleted_at = NULL` 复活 —— 否则「清空覆盖」之后
 * 再设一次会撞上唯一键（CLAUDE.md 第 2 条那套生成列的同一类坑）。
 */
async function upsertProject({ tenantId, projectId, key, value, description, updatedBy }, tx = db) {
  await tx.query(
    `INSERT INTO sys_config (tenant_id, config_key, config_value, scope, project_id, description, updated_by)
     VALUES (?, ?, ?, 'project', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       config_value = VALUES(config_value),
       description  = COALESCE(VALUES(description), description),
       updated_by   = VALUES(updated_by),
       deleted_at   = NULL`,
    [tenantId, key, value, projectId, description ?? null, updatedBy ?? null]
  )
}

/** 软删除项目覆盖值，使配置重新继承租户 / 平台 / 代码默认值（B-5.1） */
async function softDeleteProjectOverride({ projectId, key, updatedBy }, tx = db) {
  const result = await tx.query(
    `UPDATE sys_config
        SET deleted_at = NOW(), updated_by = ?
      WHERE config_key = ? AND scope = 'project' AND project_id = ? AND deleted_at IS NULL`,
    [updatedBy ?? null, key, projectId]
  )
  return result.affectedRows > 0
}

module.exports = {
  listGlobal,
  findGlobal,
  upsertGlobal,
  softDeleteGlobalOverride,
  listProject,
  findProject,
  upsertProject,
  softDeleteProjectOverride,
}
