'use strict'

/**
 * esign_identity：用户 ↔ 服务商实名主体绑定。
 *
 * 微信账号不等于业主本人；这张表是“登录账号”和“服务商核身主体”之间的桥。
 * 只存服务商 subject id、核身流水号、脱敏姓名，不存身份证号/人脸图。
 */

const db = require('../db/pool')

async function findByUserAndProvider(userId, provider, tx = db) {
  return tx.queryOne('SELECT * FROM esign_identity WHERE user_id = ? AND provider = ?', [userId, provider])
}

async function findBySubject(provider, providerSubjectId, tx = db) {
  if (!providerSubjectId) return null
  return tx.queryOne('SELECT * FROM esign_identity WHERE provider = ? AND provider_subject_id = ?', [
    provider,
    providerSubjectId,
  ])
}

/**
 * 写入/更新实名结果。
 *
 * 唯一键是 (user_id, provider)；同一用户重复实名时覆盖为最新结果。
 * `provider_subject_id` 若与另一个用户冲突，MySQL 会抛 ER_DUP_ENTRY，
 * 调用方应视为“该实名主体已绑定其他账号”，不能静默改绑。
 */
async function upsertVerified(data, tx = db) {
  // 先查 subject 是否已绑定给另一个账号：ON DUPLICATE KEY UPDATE 在这种情况下
  // 会静默更新别人的行（因为不更新 user_id），必须提前拦住。
  const existing = await findBySubject(data.provider, data.providerSubjectId, tx)
  if (existing && Number(existing.user_id) !== Number(data.userId)) {
    const err = new Error('该实名主体已绑定其他账号')
    err.code = 'ESIGN_SUBJECT_CONFLICT'
    throw err
  }

  await tx.query(
    `INSERT INTO esign_identity
       (user_id, provider, provider_subject_id, realname_status, realname_method,
        realname_ref, name_masked, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       provider_subject_id = VALUES(provider_subject_id),
       realname_status = VALUES(realname_status),
       realname_method = VALUES(realname_method),
       realname_ref = VALUES(realname_ref),
       name_masked = VALUES(name_masked),
       verified_at = VALUES(verified_at)`,
    [
      data.userId,
      data.provider,
      data.providerSubjectId ?? null,
      data.realnameStatus || 'passed',
      data.realnameMethod ?? null,
      data.realnameRef ?? null,
      data.nameMasked ?? null,
      data.verifiedAt ?? null,
    ]
  )
}

async function markFailed(userId, provider, ref, tx = db) {
  await tx.query(
    `INSERT INTO esign_identity (user_id, provider, realname_status, realname_ref)
     VALUES (?, ?, 'failed', ?)
     ON DUPLICATE KEY UPDATE
       realname_status = 'failed',
       realname_ref = VALUES(realname_ref)`,
    [userId, provider, ref ?? null]
  )
}

module.exports = { findByUserAndProvider, findBySubject, upsertVerified, markFailed }
