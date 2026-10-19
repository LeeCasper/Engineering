'use strict'

/**
 * progress_report / progress_media / progress_comment 数据访问层。
 */

const db = require('../db/pool')

/**
 * 按幂等键查已存在的汇报（AC-P10）。
 *
 * 断网重试时前端复用同一个 `client_request_id`，服务端据此返回**上一次的结果**，
 * 而不是再插一条。查询放在事务外：它是幂等判定的第一道，命中就直接返回，
 * 不必开事务。
 */
async function findByClientRequestId(projectId, userId, clientRequestId) {
  if (!clientRequestId) return null
  return db.queryOne(
    `SELECT id, project_id, project_item_id, user_id, progress, content, created_at
       FROM progress_report
      WHERE project_id = ? AND user_id = ? AND client_request_id = ? AND deleted_at IS NULL`,
    [projectId, userId, clientRequestId]
  )
}

async function create({ projectId, projectItemId, userId, progress, content, clientRequestId }, tx) {
  const result = await tx.query(
    `INSERT INTO progress_report (project_id, project_item_id, user_id, progress, content, client_request_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectId, projectItemId, userId, progress, content ?? null, clientRequestId]
  )
  return result.insertId
}

async function findById(id, tx = db) {
  return tx.queryOne(
    `SELECT id, project_id, project_item_id, user_id, progress, content, client_request_id, created_at
       FROM progress_report WHERE id = ? AND deleted_at IS NULL`,
    [id]
  )
}

/**
 * 汇报记录流（AC-P20：按时间倒序、每页 20 条、强制分页）。
 *
 * 用 (project_id, created_at) 的复合索引排序 —— 见 003_progress.sql 的 idx_report_project_time。
 */
async function listByProject({ projectId, offset, limit, itemId }) {
  const where = ['r.project_id = ?', 'r.deleted_at IS NULL']
  const params = [projectId]

  if (itemId) {
    where.push('r.project_item_id = ?')
    params.push(itemId)
  }

  // JOIN 必须在 WHERE 之前 —— 拼成 `FROM ... WHERE ... JOIN ...` 是语法错误。
  // 两个片段分开维护，避免以后加条件时又踩到
  const fromClause = `FROM progress_report r
       JOIN project_item i ON i.id = r.project_item_id
       JOIN project_stage s ON s.id = i.project_stage_id
       JOIN user u ON u.id = r.user_id`
  const whereClause = `WHERE ${where.join(' AND ')}`

  const total = await db.count(`${fromClause} ${whereClause}`, params)

  const rows = await db.query(
    `SELECT r.id, r.project_item_id, r.user_id, r.progress, r.content, r.created_at,
            i.name AS item_name, s.id AS stage_id, s.name AS stage_name,
            u.nickname, u.avatar
       ${fromClause}
       ${whereClause}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return { total, rows }
}

/** 批量取多条汇报的附件与评论数，避免逐条查询（N+1） */
async function loadMediaAndComments(reportIds) {
  if (reportIds.length === 0) return { mediaByReport: new Map(), commentCounts: new Map() }

  const placeholders = reportIds.map(() => '?').join(', ')

  const [media, counts] = await Promise.all([
    db.query(
      `SELECT id, report_id, type, url, watermark_url, duration, width, height, sort_order
         FROM progress_media
        WHERE report_id IN (${placeholders}) AND deleted_at IS NULL
        ORDER BY report_id, sort_order, id`,
      reportIds
    ),
    db.query(
      `SELECT report_id, COUNT(*) AS total
         FROM progress_comment
        WHERE report_id IN (${placeholders}) AND deleted_at IS NULL
        GROUP BY report_id`,
      reportIds
    ),
  ])

  const mediaByReport = new Map()
  for (const row of media) {
    if (!mediaByReport.has(row.report_id)) mediaByReport.set(row.report_id, [])
    mediaByReport.get(row.report_id).push(row)
  }

  const commentCounts = new Map(counts.map((row) => [row.report_id, Number(row.total)]))

  return { mediaByReport, commentCounts }
}

// ── 附件 ──

async function addMedia(items, tx) {
  for (const [index, item] of items.entries()) {
    await tx.query(
      `INSERT INTO progress_media (report_id, type, url, watermark_url, duration, width, height, size_bytes, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.reportId,
        item.type,
        item.url,
        item.watermarkUrl ?? null,
        item.duration ?? null,
        item.width ?? null,
        item.height ?? null,
        item.sizeBytes ?? null,
        index,
      ]
    )
  }
}

// ── 评论 ──

async function addComment({ reportId, projectId, userId, content, replyTo }, tx = db) {
  const result = await tx.query(
    'INSERT INTO progress_comment (report_id, project_id, user_id, content, reply_to) VALUES (?, ?, ?, ?, ?)',
    [reportId, projectId, userId, content, replyTo ?? null]
  )
  return result.insertId
}

/** 某条汇报下的评论，按时间正序（评论是对话，倒序读起来别扭） */
async function listComments(reportId) {
  return db.query(
    `SELECT c.id, c.user_id, c.content, c.reply_to, c.created_at, u.nickname, u.avatar
       FROM progress_comment c
       JOIN user u ON u.id = c.user_id
      WHERE c.report_id = ? AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC, c.id ASC`,
    [reportId]
  )
}

async function countComments(reportId) {
  return db.count('FROM progress_comment WHERE report_id = ? AND deleted_at IS NULL', [reportId])
}

/**
 * 某项目里最近一次汇报的时间，用于「连续 N 天未汇报」判定（AC-P23）。
 * 没有汇报时返回 null —— 那时该不该提醒由调用方另外判断（刚建档的项目不该催）。
 */
async function findLastReportAt(projectId) {
  const row = await db.queryOne(
    'SELECT MAX(created_at) AS last_at FROM progress_report WHERE project_id = ? AND deleted_at IS NULL',
    [projectId]
  )
  return row ? row.last_at : null
}

module.exports = {
  findByClientRequestId,
  create,
  findById,
  listByProject,
  loadMediaAndComments,
  addMedia,
  addComment,
  listComments,
  countComments,
  findLastReportAt,
}
