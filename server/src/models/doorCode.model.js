'use strict'

/**
 * project_door_code 数据访问层（§4.8 / AC-K01 ~ AC-K16）。
 *
 * ── 本模块的模型层多了一条不常见的规矩 ──
 * `code_cipher` 是**密文**，模型层不负责解密也不负责加密 ——
 * 加解密只发生在 service 层，且只在真正要返回给用户的那一刻。
 * 让模型层「顺手解开」看着方便，但那样密文会以明文的形态在层与层之间流动，
 * 任何一次 `logger.debug(row)` 都会把它带出去。
 */

const db = require('../db/pool')

/**
 * 某项目的密码条目。
 *
 * 默认**不含已失效的条目**（AC-K16：失效后立即不可查看）。
 * 业主看历史记录时才需要 includeRevoked —— 而那条路径要单独走
 * 访问记录接口，不是这个列表。
 */
async function listByProject(projectId, { includeRevoked = false } = {}) {
  const where = ['project_id = ?', 'deleted_at IS NULL']
  if (!includeRevoked) where.push("status = 'active'")

  return db.query(
    `SELECT id, project_id, name, code_cipher, remark, status, created_by,
            revoked_at, revoked_by, created_at, updated_at
       FROM project_door_code
      WHERE ${where.join(' AND ')}
      ORDER BY id`,
    [projectId]
  )
}

/** 按 id 取单条。**不施加项目过滤** —— 调用方必须先做成员校验 */
async function findById(id) {
  return db.queryOne(
    `SELECT id, project_id, name, code_cipher, remark, status, created_by, revoked_at, created_by AS owner_id
       FROM project_door_code
      WHERE id = ? AND deleted_at IS NULL`,
    [id]
  )
}

async function create({ projectId, name, codeCipher, remark, createdBy }, tx = db) {
  const result = await tx.query(
    `INSERT INTO project_door_code (project_id, name, code_cipher, remark, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [projectId, name, codeCipher, remark ?? null, createdBy]
  )
  return result.insertId
}

/** 修改名称 / 密码 / 备注。**只允许改 active 的条目** —— 失效是不可逆的 */
async function updateActive(id, { name, codeCipher, remark }, tx = db) {
  return tx.query(
    `UPDATE project_door_code
        SET name        = COALESCE(?, name),
            code_cipher = COALESCE(?, code_cipher),
            remark      = COALESCE(?, remark)
      WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
    [name ?? null, codeCipher ?? null, remark ?? null, id]
  )
}

/**
 * 失效（AC-K02 / AC-K14）。
 *
 * `status = 'active'` 留在 WHERE 里：重复失效不该把 `revoked_at`
 * 刷成新时间。「第一次失效的时刻」是回答「这条密码什么时候停用的」的唯一依据。
 */
async function revoke(id, { revokedBy }, tx = db) {
  return tx.query(
    `UPDATE project_door_code
        SET status = 'revoked', revoked_at = NOW(), revoked_by = ?
      WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
    [revokedBy, id]
  )
}

/** 项目下还有几条生效中的密码。用于「归档 / 移除成员时要不要提醒业主」的判断 */
async function countActive(projectId, tx = db) {
  const row = await tx.queryOne(
    "SELECT COUNT(*) AS total FROM project_door_code WHERE project_id = ? AND status = 'active' AND deleted_at IS NULL",
    [projectId]
  )
  return row ? row.total : 0
}

module.exports = { listByProject, findById, create, updateActive, revoke, countActive }
