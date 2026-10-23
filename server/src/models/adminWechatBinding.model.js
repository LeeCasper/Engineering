'use strict'

/**
 * admin_wechat_binding 数据访问层。
 *
 * 只放 SQL，不放业务判断。绑定是否可用、账号/租户状态、token_version
 * 是否失配等判断都在 adminWechatBinding.service.js。
 *
 * ── openid 是权威键 ──
 * 手机号绑定会合并 C 端占位账号、改变 user.id；openid 不变。
 * 因此所有「这个微信是谁」的查询都按 openid，user_id 只用于审计与注销。
 */

const db = require('../db/pool')

/**
 * 绑定行 + 管理员 + 租户。供免密登录做完整校验。
 *
 * 注意：这里**不**过滤管理员状态/锁定/首登改密/租户状态，
 * 让 service 能区分「绑定不存在」与「账号不可用」，并给出准确提示。
 * 但绑定本身必须 active。
 */
const EXCHANGE_COLUMNS = `
  b.id, b.tenant_id, b.admin_user_id, b.user_id, b.openid, b.unionid,
  b.admin_token_version, b.status, b.bound_at, b.last_used_at,
  a.username, a.role, a.status AS admin_status, a.tenant_id AS admin_tenant_id,
  a.token_version, a.must_change_password, a.locked_until,
  a.deleted_at AS admin_deleted_at,
  t.name AS tenant_name, t.code AS tenant_code,
  t.status AS tenant_status, t.expires_at AS tenant_expires_at
`

async function create(
  { tenantId, adminUserId, userId, openid, unionid = null, adminTokenVersion },
  tx = db
) {
  const result = await tx.query(
    `INSERT INTO admin_wechat_binding
       (tenant_id, admin_user_id, user_id, openid, unionid, admin_token_version)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, adminUserId, userId, openid, unionid, adminTokenVersion]
  )
  return result.insertId
}

/** 当前微信 + 指定绑定 id；绑定必须 active */
async function findActiveByIdForOpenid(id, openid) {
  return db.queryOne(
    `SELECT ${EXCHANGE_COLUMNS}
       FROM admin_wechat_binding b
       JOIN admin_user a ON a.id = b.admin_user_id
       LEFT JOIN tenant t ON t.id = b.tenant_id
      WHERE b.id = ? AND b.openid = ? AND b.status = 'active' AND b.deleted_at IS NULL
      LIMIT 1`,
    [id, openid]
  )
}

/** 当前微信的有效绑定列表，供小程序展示免密身份 */
async function listActiveForOpenid(openid) {
  return db.query(
    `SELECT b.id, b.admin_user_id, b.tenant_id, b.bound_at, b.last_used_at,
            a.username, a.role,
            t.name AS tenant_name, t.code AS tenant_code
       FROM admin_wechat_binding b
       JOIN admin_user a ON a.id = b.admin_user_id
       JOIN tenant t ON t.id = b.tenant_id
      WHERE b.openid = ? AND b.status = 'active' AND b.deleted_at IS NULL
        AND a.deleted_at IS NULL AND a.status = 'active'
        AND a.tenant_id IS NOT NULL AND a.role IN ('owner', 'admin')
        AND a.must_change_password = 0
        AND (a.locked_until IS NULL OR a.locked_until <= NOW())
        AND b.admin_token_version = a.token_version
        AND t.status = 'active'
        AND (t.expires_at IS NULL OR t.expires_at > NOW())
      ORDER BY b.id DESC`,
    [openid]
  )
}

/** 当前管理员的 active 绑定（同一管理员最多一条） */
async function findActiveByAdmin(adminUserId) {
  return db.queryOne(
    `SELECT id, tenant_id, admin_user_id, user_id, openid, admin_token_version,
            status, bound_at, last_used_at, revoked_at, revoked_reason
       FROM admin_wechat_binding
      WHERE admin_user_id = ? AND status = 'active' AND deleted_at IS NULL
      LIMIT 1`,
    [adminUserId]
  )
}

/** 同一微信 + 同一管理员是否已绑定 */
async function findActiveByOpenidAndAdmin(openid, adminUserId) {
  return db.queryOne(
    `SELECT id, tenant_id, admin_user_id, user_id, openid, admin_token_version,
            status, bound_at, last_used_at
       FROM admin_wechat_binding
      WHERE openid = ? AND admin_user_id = ? AND status = 'active' AND deleted_at IS NULL
      LIMIT 1`,
    [openid, adminUserId]
  )
}

async function touchLastUsed(id, tx = db) {
  await tx.query('UPDATE admin_wechat_binding SET last_used_at = NOW() WHERE id = ?', [id])
}

async function revoke(id, reason, tx = db) {
  await tx.query(
    `UPDATE admin_wechat_binding
        SET status = 'revoked', revoked_at = NOW(), revoked_reason = ?
      WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
    [reason || null, id]
  )
}

async function revokeAllForAdmin(adminUserId, reason, tx = db) {
  await tx.query(
    `UPDATE admin_wechat_binding
        SET status = 'revoked', revoked_at = NOW(), revoked_reason = ?
      WHERE admin_user_id = ? AND status = 'active' AND deleted_at IS NULL`,
    [reason || null, adminUserId]
  )
}

async function revokeByOpenid(openid, reason, tx = db) {
  if (!openid) return
  await tx.query(
    `UPDATE admin_wechat_binding
        SET status = 'revoked', revoked_at = NOW(), revoked_reason = ?
      WHERE openid = ? AND status = 'active' AND deleted_at IS NULL`,
    [reason || null, openid]
  )
}

/**
 * C 端手机号合并后修正 user_id。
 * openid 不变，绑定仍然可用；这里只是让审计数据与当前用户行一致。
 */
async function repairUserIdByOpenid(openid, userId, tx = db) {
  if (!openid) return
  await tx.query('UPDATE admin_wechat_binding SET user_id = ? WHERE openid = ? AND user_id <> ?', [
    userId,
    openid,
    userId,
  ])
}

module.exports = {
  create,
  findActiveByIdForOpenid,
  listActiveForOpenid,
  findActiveByAdmin,
  findActiveByOpenidAndAdmin,
  touchLastUsed,
  revoke,
  revokeAllForAdmin,
  revokeByOpenid,
  repairUserIdByOpenid,
}
