'use strict'

/**
 * 现场签到照片暂存（迁移 024）。
 *
 * 与 reportMediaStaging.model.js 同构，解决的是同一个问题：
 * 微信小程序一次只能上传一个文件，而签到提交要求 1–3 张照片。
 *
 * 三条不变量：
 *   1. 暂存行只能被**同一个人、同一个项目**消费；
 *   2. 消费必须在事务内 `FOR UPDATE`，否则两个并发提交可能拿到同一批照片；
 *   3. 已 used 的行永远不能再次消费 —— 否则一张照片会出现在两条签到里。
 */

const db = require('../db/pool')

/** 写入一条暂存照片。文件已经由 storage 落盘，这里只存元数据 */
async function create(data, tx = db) {
  const result = await tx.query(
    `INSERT INTO visit_media_staging
       (project_id, user_id, ext, url, size_bytes)
     VALUES (?, ?, ?, ?, ?)`,
    [data.projectId, data.userId, data.ext, data.url, data.sizeBytes ?? null]
  )
  return result.insertId
}

/** 预校验读：不加锁，用于在生成水印前尽早发现无效 ID */
async function findByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(', ')
  return db.query(
    `SELECT id, project_id, user_id, ext, url, size_bytes, status, visit_id, created_at
       FROM visit_media_staging
      WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    ids
  )
}

/**
 * 消费时加锁读取。
 *
 * `ORDER BY id` 固定加锁顺序，降低并发提交时互相等待造成的死锁概率。
 */
async function findByIdsForUpdate(tx, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(', ')
  return tx.query(
    `SELECT id, project_id, user_id, ext, url, size_bytes, status, visit_id, created_at
       FROM visit_media_staging
      WHERE id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY id ASC
      FOR UPDATE`,
    ids
  )
}

/** 标记为已被某条签到消费。返回受影响行数，调用方据此确认全部消费成功 */
async function markUsed(tx, ids, visitId) {
  if (!Array.isArray(ids) || ids.length === 0) return 0

  const placeholders = ids.map(() => '?').join(', ')
  const result = await tx.query(
    `UPDATE visit_media_staging
        SET status = 'used', visit_id = ?
      WHERE id IN (${placeholders}) AND status = 'staged' AND deleted_at IS NULL`,
    [visitId, ...ids]
  )
  return result.affectedRows
}

/** 某人某项目下已暂存但未提交的照片数，用于上传前的上限提示 */
async function countStaged({ userId, projectId }) {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS total
       FROM visit_media_staging
      WHERE user_id = ? AND project_id = ?
        AND status = 'staged' AND deleted_at IS NULL`,
    [userId, projectId]
  )
  return row ? Number(row.total) : 0
}

/**
 * 清理任务第一步：把过期的 staged 行**认领**为 expired。
 *
 * 必须先认领再删文件，不能先扫出来再逐行删 —— 否则存在这个竞态：
 *   清理任务读到一条 staged 行 → 用户正好提交签到把它标成 used →
 *   清理任务继续把文件删掉 → 正式签到里的照片变成 404。
 * UPDATE 带 `status = 'staged'` 条件并持有行锁，提交事务若已消费则不会命中。
 */
async function claimStale(cutoff, limit = 200) {
  const result = await db.query(
    `UPDATE visit_media_staging
        SET status = 'expired'
      WHERE status = 'staged' AND deleted_at IS NULL AND created_at < ?
      ORDER BY id ASC
      LIMIT ?`,
    [cutoff, limit]
  )
  return result.affectedRows
}

/** 已认领、等待删文件的清理行 */
async function listExpired(limit = 200) {
  return db.query(
    `SELECT id, url
       FROM visit_media_staging
      WHERE status = 'expired' AND deleted_at IS NULL
      ORDER BY id ASC
      LIMIT ?`,
    [limit]
  )
}

/** 删掉已清理的记录。只删 expired，不碰 staged / used */
async function removeExpiredByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0

  const placeholders = ids.map(() => '?').join(', ')
  const result = await db.query(
    `DELETE FROM visit_media_staging
      WHERE id IN (${placeholders}) AND status = 'expired'`,
    ids
  )
  return result.affectedRows
}

module.exports = {
  create,
  findByIds,
  findByIdsForUpdate,
  markUsed,
  countStaged,
  claimStale,
  listExpired,
  removeExpiredByIds,
}
