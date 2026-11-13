'use strict'

/**
 * 意见反馈图片暂存（迁移 037）。
 *
 * 与 visitMediaStaging.model.js / reportMediaStaging.model.js 同构：
 * 微信小程序一次只能上传一个文件，而一条反馈最多带 3 张图。
 *
 * 三条不变量：
 *   1. 暂存行只能被**同一个人**消费；
 *   2. 消费必须在事务内 `FOR UPDATE`，否则两个并发提交可能拿到同一批图片；
 *   3. 已 used 的行永远不能再次消费。
 */

const db = require('../db/pool')

/** 写入一条暂存图片。文件已经由 storage 落盘，这里只存元数据 */
async function create(data, tx = db) {
  const result = await tx.query(
    `INSERT INTO feedback_media_staging
       (user_id, ext, url, size_bytes)
     VALUES (?, ?, ?, ?)`,
    [data.userId, data.ext, data.url, data.sizeBytes ?? null]
  )
  return result.insertId
}

/** 预校验读：不加锁，用于在提交前尽早发现无效 ID */
async function findByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(', ')
  return db.query(
    `SELECT id, user_id, ext, url, size_bytes, status, feedback_id, created_at
       FROM feedback_media_staging
      WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    ids
  )
}

/** 消费时加锁读取。`ORDER BY id` 固定加锁顺序，降低死锁概率 */
async function findByIdsForUpdate(tx, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(', ')
  return tx.query(
    `SELECT id, user_id, ext, url, size_bytes, status, feedback_id, created_at
       FROM feedback_media_staging
      WHERE id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY id ASC
      FOR UPDATE`,
    ids
  )
}

/** 标记为已被某条反馈消费。返回受影响行数，调用方据此确认全部消费成功 */
async function markUsed(tx, ids, feedbackId) {
  if (!Array.isArray(ids) || ids.length === 0) return 0

  const placeholders = ids.map(() => '?').join(', ')
  const result = await tx.query(
    `UPDATE feedback_media_staging
        SET status = 'used', feedback_id = ?
      WHERE id IN (${placeholders}) AND status = 'staged' AND deleted_at IS NULL`,
    [feedbackId, ...ids]
  )
  return result.affectedRows
}

/** 某人已暂存但未提交的图片数，用于上传前的上限提示 */
async function countStaged(userId) {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS total
       FROM feedback_media_staging
      WHERE user_id = ? AND status = 'staged' AND deleted_at IS NULL`,
    [userId]
  )
  return row ? Number(row.total) : 0
}

/**
 * 清理任务第一步：把过期的 staged 行**认领**为 expired。
 *
 * 必须先认领再删文件，不能先扫出来再逐行删 —— 否则存在这个竞态：
 *   清理任务读到一条 staged 行 → 用户正好提交反馈把它标成 used →
 *   清理任务继续把文件删掉 → 反馈里的图片变成 404。
 */
async function claimStale(cutoff, limit = 200) {
  const result = await db.query(
    `UPDATE feedback_media_staging
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
       FROM feedback_media_staging
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
    `DELETE FROM feedback_media_staging
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
