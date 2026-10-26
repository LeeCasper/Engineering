'use strict'

/**
 * esign_event 回调收件箱。
 *
 * 回调先落库再处理：服务商回调可能在本地任务还没写完时到达，也可能重复投递。
 * `(provider, event_id)` 唯一键负责幂等；未知任务的事件保留为 received，
 * 由 esignSync 继续解析，不能直接丢弃。
 */

const db = require('../db/pool')

async function insertIfAbsent(data, tx = db) {
  const result = await tx.query(
    `INSERT IGNORE INTO esign_event
       (provider, event_id, task_id, provider_task_id, provider_business_id,
        event_type, event_time, payload, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received')`,
    [
      data.provider,
      data.eventId,
      data.taskId ?? null,
      data.providerTaskId ?? null,
      data.providerBusinessId ?? null,
      data.eventType ?? null,
      data.eventTime ?? null,
      data.payload ? JSON.stringify(data.payload) : null,
    ]
  )
  return result.affectedRows > 0
}

async function findById(id, tx = db) {
  return tx.queryOne('SELECT * FROM esign_event WHERE id = ?', [id])
}

async function findByEventId(provider, eventId, tx = db) {
  return tx.queryOne('SELECT * FROM esign_event WHERE provider = ? AND event_id = ?', [provider, eventId])
}

async function mark(id, { status, taskId, errorMessage, nextRetryAt, processedAt }, tx = db) {
  const sets = []
  const params = []

  if (status !== undefined) {
    sets.push('status = ?')
    params.push(status)
  }
  if (taskId !== undefined) {
    sets.push('task_id = ?')
    params.push(taskId)
  }
  if (errorMessage !== undefined) {
    sets.push('error_message = ?')
    params.push(errorMessage)
  }
  if (nextRetryAt !== undefined) {
    sets.push('next_retry_at = ?')
    params.push(nextRetryAt)
  }
  if (processedAt !== undefined) {
    sets.push('processed_at = ?')
    params.push(processedAt)
  }
  if (status === 'failed') sets.push('attempts = attempts + 1')
  if (sets.length === 0) return

  params.push(id)
  await tx.query(`UPDATE esign_event SET ${sets.join(', ')} WHERE id = ?`, params)
}

async function listUnresolved(limit = 100) {
  return db.query(
    `SELECT * FROM esign_event
      WHERE status = 'received'
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY id ASC LIMIT ?`,
    [limit]
  )
}

module.exports = { insertIfAbsent, findById, findByEventId, mark, listUnresolved }
