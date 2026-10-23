'use strict'

/**
 * 进度汇报附件暂存（迁移 017）。
 *
 * 这张表只解决一个问题：微信小程序一次只能上传一个文件，而汇报提交必须
 * 把「多个附件 + 进度变更 + 汇报记录」放在同一个事务里。暂存行让文件先落盘、
 * 元数据先入库，最后提交时只消费 ID，不再依赖一次 multipart 带齐所有文件。
 *
 * 三条不变量：
 *   1. 暂存行只能被**同一个人、同一个项目、同一个工序**消费；
 *   2. 消费必须在事务内 `FOR UPDATE`，否则两个并发提交可能拿到同一批附件；
 *   3. 已 used 的行永远不能再次消费 —— 否则一条汇报的图片会出现在另一条里。
 */

const db = require('../db/pool')

/** 写入一条暂存附件。文件已经在 storage 落盘，这里只存元数据 */
async function create(data, tx = db) {
  const result = await tx.query(
    `INSERT INTO report_media_staging
       (project_id, project_item_id, user_id, type, url, watermark_url,
        duration, size_bytes, width, height)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.projectId,
      data.projectItemId,
      data.userId,
      data.type,
      data.url,
      data.watermarkUrl ?? null,
      data.duration ?? null,
      data.sizeBytes ?? null,
      data.width ?? null,
      data.height ?? null,
    ]
  )
  return result.insertId
}

/**
 * 按 ID 加锁读取暂存行。`FOR UPDATE` 是消费时的关键：
 * 同一批 mediaIds 若被两个提交请求同时读到，就会各自插入一份 progress_media。
 */
async function findByIdsForUpdate(tx, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(', ')
  return tx.query(
    `SELECT id, project_id, project_item_id, user_id, type, url, watermark_url,
            duration, size_bytes, width, height, status, report_id, created_at
       FROM report_media_staging
      WHERE id IN (${placeholders}) AND deleted_at IS NULL
      FOR UPDATE`,
    ids
  )
}

/** 标记为已被某条汇报消费。返回受影响行数，调用方据此确认全部消费成功 */
async function markUsed(tx, ids, reportId) {
  if (!Array.isArray(ids) || ids.length === 0) return 0

  const placeholders = ids.map(() => '?').join(', ')
  const result = await tx.query(
    `UPDATE report_media_staging
        SET status = 'used', report_id = ?
      WHERE id IN (${placeholders}) AND status = 'staged' AND deleted_at IS NULL`,
    [reportId, ...ids]
  )
  return result.affectedRows
}

/** 某工序下已暂存但未提交的附件数量，用于上传前的上限提示 */
async function countStaged({ userId, projectId, projectItemId }) {
  const rows = await db.query(
    `SELECT type, COUNT(*) AS total
       FROM report_media_staging
      WHERE user_id = ? AND project_id = ? AND project_item_id = ?
        AND status = 'staged' AND deleted_at IS NULL
      GROUP BY type`,
    [userId, projectId, projectItemId]
  )

  const counts = { image: 0, video: 0 }
  for (const row of rows) counts[row.type] = Number(row.total)
  return counts
}

/**
 * 清理任务的第一步：把过期的 staged 行**认领**为 expired。
 *
 * 必须先认领再删文件，不能先扫出来再逐行删 —— 否则存在这个竞态：
 *   清理任务读到一条 staged 行 → 用户正好提交汇报把它标成 used →
 *   清理任务继续把文件删掉 → 正式汇报里的图片变成 404。
 * UPDATE 带 `status = 'staged'` 条件并持有行锁，提交事务若已消费则不会命中；
 * 若清理先认领，提交那边的 `FOR UPDATE` 会读到 expired 并拒绝。
 *
 * 不碰 used 行：它们已经属于一条正式汇报，删除会丢审计线索。
 */
async function claimStale(cutoff, limit = 200) {
  const result = await db.query(
    `UPDATE report_media_staging
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
    `SELECT id, url, watermark_url
       FROM report_media_staging
      WHERE status = 'expired' AND deleted_at IS NULL
      ORDER BY id ASC
      LIMIT ?`,
    [limit]
  )
}

/** 物理删除一批已认领的暂存行。文件删完后调用 */
async function removeExpiredByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0

  const placeholders = ids.map(() => '?').join(', ')
  const result = await db.query(
    `DELETE FROM report_media_staging
      WHERE id IN (${placeholders}) AND status = 'expired'`,
    ids
  )
  return result.affectedRows
}

module.exports = {
  create,
  findByIdsForUpdate,
  markUsed,
  countStaged,
  claimStale,
  listExpired,
  removeExpiredByIds,
}
