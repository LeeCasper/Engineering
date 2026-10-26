'use strict'

/**
 * esign_task 数据访问层。
 *
 * 这是电子签的持久化事实来源：供应商任务 id、冻结文档、验签结果、证据 key
 * 都在这里。业务层只通过本模块读写，避免 SQL 散落。
 *
 * **不物理删除任务**：失败/过期任务要保留，作为“业主曾经发起过签署”的审计记录。
 */

const db = require('../db/pool')

const ACTIVE_STATUSES = ['creating', 'pending', 'archiving']

const COLUMNS = [
  'acceptance_id',
  'project_id',
  'tenant_id',
  'provider',
  'idempotency_key',
  'provider_task_id',
  'provider_flow_id',
  'status',
  'signer_user_id',
  'signer_identity_id',
  'signer_name',
  'signer_subject_masked',
  'signer_mobile_masked',
  'signer_id_masked',
  'verify_method',
  'realname_status',
  'realname_method',
  'realname_ref',
  'realname_verified_at',
  'consent_at',
  'consent_version',
  'consent_text',
  'consent_text_hash',
  'consent_ip',
  'consent_user_agent',
  'consent_request_id',
  'document_key',
  'document_hash',
  'document_frozen_at',
  'content_snapshot',
  'content_snapshot_hash',
  'signed_document_key',
  'signed_document_hash',
  'evidence_key',
  'certificate_serial',
  'certificate_issuer',
  'certificate_not_after',
  'signed_at',
  'verify_status',
  'verified_at',
  'verify_result',
  'provider_status',
  'sign_mode',
  'sign_url',
  'sign_app_id',
  'sign_path',
  'attempt_no',
  'last_synced_at',
  'last_event_at',
  'error_code',
  'error_message',
  'expires_at',
]

const UPDATABLE = new Set([
  'provider_task_id',
  'provider_flow_id',
  'status',
  'signer_identity_id',
  'signer_name',
  'signer_subject_masked',
  'signer_mobile_masked',
  'signer_id_masked',
  'verify_method',
  'realname_status',
  'realname_method',
  'realname_ref',
  'realname_verified_at',
  'signed_document_key',
  'signed_document_hash',
  'evidence_key',
  'certificate_serial',
  'certificate_issuer',
  'certificate_not_after',
  'signed_at',
  'verify_status',
  'verified_at',
  'verify_result',
  'provider_status',
  'sign_mode',
  'sign_url',
  'sign_app_id',
  'sign_path',
  'last_synced_at',
  'last_event_at',
  'error_code',
  'error_message',
  'expires_at',
  'attempt_no',
])

function normalizeJson(value) {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

async function create(data, tx = db) {
  const values = COLUMNS.map((column) => {
    if (column === 'content_snapshot' || column === 'verify_result') {
      return normalizeJson(data[column])
    }
    if (column === 'status') return data[column] || 'creating'
    if (column === 'verify_status') return data[column] || 'pending'
    if (column === 'realname_status') return data[column] || 'none'
    if (column === 'verify_method') return data[column] || 'none'
    if (column === 'attempt_no') return data[column] || 1
    return data[column] ?? null
  })

  const result = await tx.query(
    `INSERT INTO esign_task (${COLUMNS.map((c) => `\`${c}\``).join(', ')})
     VALUES (${COLUMNS.map(() => '?').join(', ')})`,
    values
  )
  return result.insertId
}

async function findById(id, tx = db) {
  return tx.queryOne('SELECT * FROM esign_task WHERE id = ?', [id])
}

async function lockById(tx, id) {
  const rows = await tx.query('SELECT * FROM esign_task WHERE id = ? FOR UPDATE', [id])
  return rows.length > 0 ? rows[0] : null
}

async function findActiveByAcceptance(acceptanceId, tx = db) {
  return tx.queryOne(
    `SELECT * FROM esign_task
      WHERE acceptance_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})
      ORDER BY id DESC LIMIT 1`,
    [acceptanceId, ...ACTIVE_STATUSES]
  )
}

async function findLatestByAcceptance(acceptanceId, tx = db) {
  return tx.queryOne('SELECT * FROM esign_task WHERE acceptance_id = ? ORDER BY id DESC LIMIT 1', [
    acceptanceId,
  ])
}

async function findByProviderTaskId(provider, providerTaskId, tx = db) {
  if (!providerTaskId) return null
  return tx.queryOne('SELECT * FROM esign_task WHERE provider = ? AND provider_task_id = ?', [
    provider,
    providerTaskId,
  ])
}

async function findByIdempotencyKey(idempotencyKey, tx = db) {
  return tx.queryOne('SELECT * FROM esign_task WHERE idempotency_key = ?', [idempotencyKey])
}

async function update(id, fields, tx = db) {
  const entries = Object.entries(fields).filter(([key, value]) => UPDATABLE.has(key) && value !== undefined)
  if (entries.length === 0) return 0

  const sets = entries.map(([key]) => `\`${key}\` = ?`)
  const params = entries.map(([key, value]) => {
    if (key === 'verify_result') return normalizeJson(value)
    return value
  })
  params.push(id)

  const result = await tx.query(`UPDATE esign_task SET ${sets.join(', ')} WHERE id = ?`, params)
  return result.affectedRows
}

async function listByStatusOlderThan(status, olderThan, limit = 100) {
  return db.query(
    `SELECT * FROM esign_task
      WHERE status = ? AND updated_at < ?
      ORDER BY id ASC LIMIT ?`,
    [status, olderThan, limit]
  )
}

async function listActiveForAcceptance(acceptanceId) {
  return db.query(
    `SELECT * FROM esign_task
      WHERE acceptance_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})
      ORDER BY id DESC`,
    [acceptanceId, ...ACTIVE_STATUSES]
  )
}

module.exports = {
  ACTIVE_STATUSES,
  create,
  findById,
  lockById,
  findActiveByAcceptance,
  findLatestByAcceptance,
  findByProviderTaskId,
  findByIdempotencyKey,
  update,
  listByStatusOlderThan,
  listActiveForAcceptance,
}
