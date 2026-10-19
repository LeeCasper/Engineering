'use strict'

/**
 * admin_notification / export_task 数据访问层。
 *
 * 接收人指向 `admin_user`，与 C 端的 `notification`（指向 `user`）是两套主体。
 * 详见迁移 012 的说明 —— 混用会让消息发给毫不相干的人。
 */

const db = require('../db/pool')

// ─────────────────────────────────────────────────────────────
// 管理员消息
// ─────────────────────────────────────────────────────────────

async function create({ tenantId, adminUserId, type, title, content, refType, refId }, tx = db) {
  const result = await tx.query(
    `INSERT INTO admin_notification (tenant_id, admin_user_id, type, title, content, ref_type, ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, adminUserId, type, title, content ?? null, refType ?? null, refId ?? null]
  )
  return result.insertId
}

async function list({ adminUserId, tenantId, onlyUnread, offset, limit }) {
  const where = ['admin_user_id = ?', 'deleted_at IS NULL']
  const params = [adminUserId]

  // 平台账号（tenantId 为 null）收到的是平台级消息
  if (tenantId === null) where.push('tenant_id IS NULL')
  else if (tenantId !== undefined) {
    where.push('tenant_id = ?')
    params.push(tenantId)
  }

  if (onlyUnread) where.push('is_read = 0')

  const clause = `FROM admin_notification WHERE ${where.join(' AND ')}`
  const total = await db.count(clause, params)
  const unread = await db.count('FROM admin_notification WHERE admin_user_id = ? AND is_read = 0 AND deleted_at IS NULL', [
    adminUserId,
  ])

  const rows = await db.query(
    `SELECT id, type, title, content, ref_type, ref_id, is_read, read_at, created_at
       ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return { total, unread, rows }
}

/**
 * 标记已读。
 *
 * 条件里带 `admin_user_id` 而不能只按 id —— id 是自增主键、可被枚举，
 * 少了它管理员就能把**别人的**消息标成已读。
 */
async function markRead({ adminUserId, ids = null }) {
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ')
    const result = await db.query(
      `UPDATE admin_notification SET is_read = 1, read_at = NOW()
        WHERE id IN (${placeholders}) AND admin_user_id = ? AND is_read = 0 AND deleted_at IS NULL`,
      [...ids, adminUserId]
    )
    return result.affectedRows
  }

  const result = await db.query(
    'UPDATE admin_notification SET is_read = 1, read_at = NOW() WHERE admin_user_id = ? AND is_read = 0 AND deleted_at IS NULL',
    [adminUserId]
  )
  return result.affectedRows
}

async function countUnread(adminUserId) {
  return db.count('FROM admin_notification WHERE admin_user_id = ? AND is_read = 0 AND deleted_at IS NULL', [
    adminUserId,
  ])
}

// ─────────────────────────────────────────────────────────────
// 异步导出任务
// ─────────────────────────────────────────────────────────────

async function createExportTask({ tenantId, createdBy, filters }, tx = db) {
  const result = await tx.query('INSERT INTO export_task (tenant_id, created_by, filters) VALUES (?, ?, ?)', [
    tenantId,
    createdBy,
    JSON.stringify(filters ?? {}),
  ])
  return result.insertId
}

async function findExportTask(id, tx = db) {
  return tx.queryOne(
    `SELECT id, created_by, status, filters, row_count, file_url, error, started_at, finished_at, created_at
       FROM export_task WHERE id = ? AND deleted_at IS NULL`,
    [id]
  )
}

async function markExportRunning(id) {
  await db.query("UPDATE export_task SET status = 'running', started_at = NOW() WHERE id = ?", [id])
}

async function markExportSuccess(id, { rowCount, fileUrl }) {
  await db.query(
    "UPDATE export_task SET status = 'success', row_count = ?, file_url = ?, error = NULL, finished_at = NOW() WHERE id = ?",
    [rowCount, fileUrl, id]
  )
}

async function markExportFailed(id, { error }) {
  await db.query("UPDATE export_task SET status = 'failed', error = ?, finished_at = NOW() WHERE id = ?", [
    String(error || '未知错误').slice(0, 500),
    id,
  ])
}

/** 某管理员的导出任务列表 */
async function listExportTasks({ adminUserId, offset, limit }) {
  const clause = 'FROM export_task WHERE created_by = ? AND deleted_at IS NULL'
  const total = await db.count(clause, [adminUserId])
  const rows = await db.query(
    `SELECT id, status, row_count, file_url, error, created_at, started_at, finished_at
       ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [adminUserId, limit, offset]
  )
  return { total, rows }
}

module.exports = {
  create,
  list,
  markRead,
  countUnread,
  createExportTask,
  findExportTask,
  markExportRunning,
  markExportSuccess,
  markExportFailed,
  listExportTasks,
}
