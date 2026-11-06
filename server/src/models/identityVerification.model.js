'use strict'

/**
 * identity_verification：实名认证尝试流水。
 *
 * 只追加，不更新、不删除（CLAUDE.md 第 10 条）。成功与失败都写一行，
 * 方便排查「用户说提交了但没通过」以及观察失败率。
 *
 * 表中只有脱敏姓名与脱敏证件号 —— 完整证件号只在 service 的入参里存在，
 * 绝不进入 SQL 参数。
 */

const db = require('../db/pool')

async function create(data, tx = db) {
  const result = await tx.query(
    `INSERT INTO identity_verification
       (user_id, name_masked, id_card_mask, method, provider, status,
        failure_code, failure_reason, ip, user_agent, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.userId,
      data.nameMasked ?? null,
      data.idCardMask ?? null,
      data.method || 'local',
      data.provider ?? null,
      data.status,
      data.failureCode ?? null,
      data.failureReason ?? null,
      data.ip ?? null,
      data.userAgent ?? null,
      data.requestId ?? null,
    ]
  )
  return result.insertId
}

async function listByUser(userId, limit = 20) {
  return db.query(
    `SELECT id, name_masked, id_card_mask, method, provider, status,
            failure_code, failure_reason, created_at
       FROM identity_verification
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [userId, limit]
  )
}

module.exports = { create, listByUser }
