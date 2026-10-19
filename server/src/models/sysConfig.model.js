'use strict'

/**
 * sys_config 数据访问层（B-5.x / §6.2）。
 *
 * 只处理 `scope = 'global'` 的行。项目级覆盖（B-5.1 的「支持按项目覆盖」）
 * 需要一张配置界面与项目维度，属于那个模块自己的事 —— 混在这里会让
 * 「读配置」这个本该极简的操作多出一个必填的 projectId 参数。
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
 * 唯一索引是 `(config_key, scope, project_id_key)`，而 `project_id_key`
 * 是生成列（`IFNULL(project_id, 0)`）—— 它存在的理由正是 MySQL 的唯一索引
 * 不约束 NULL（CLAUDE.md 第 2 条）。交给数据库做「存在就改、不存在就插」，
 * 既用上了这个索引，也不会有两个管理员同时保存时的竞态。
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

module.exports = { listGlobal, findGlobal, upsertGlobal }
