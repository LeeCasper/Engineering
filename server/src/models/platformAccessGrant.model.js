'use strict'

/**
 * platform_access_grant 数据访问层（M13 / P4）。
 *
 * ── 这张表为什么必须存在 ──
 * 平台运营默认看不到任何租户业务数据。需要排障时，由租户管理员显式开一个
 * 时间窗；窗口内平台只能**读**，且每一次请求都写审计日志。
 * 不给平台一个「永久只读」角色 —— 那等于把「随时可以看客户合同金额和
 * 业主手机号」写进系统设计里，而 SaaS 客户签约时一定会问这一条。
 *
 * ── 为什么查询形状是 (admin_user_id, tenant_id, revoked_at, expires_at) ──
 * 每次平台请求都要判一次「这个账号对这个租户当前有没有有效授权」，
 * 是这条链路上最热的查询。迁移 015 的 `idx_grant_lookup` 就是按这个顺序建的。
 */

const db = require('../db/pool')

const COLUMNS = `
  id, tenant_id, admin_user_id, granted_by, reason,
  expires_at, revoked_at, created_at, updated_at
`

/** 建授权。调用方负责校验时限与目标账号 */
async function create({ tenantId, adminUserId, grantedBy, reason, expiresAt }, tx = db) {
  const result = await tx.query(
    `INSERT INTO platform_access_grant (tenant_id, admin_user_id, granted_by, reason, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, adminUserId, grantedBy, reason ?? null, expiresAt]
  )
  return result.insertId
}

/**
 * 查当前有效授权。
 *
 * `expires_at > NOW()` 而不是在应用层比较：数据库时钟是唯一权威 ——
 * 多实例部署时各台机器的时钟可能有偏差，用应用层时间会让「同一时刻
 * 有的实例放行、有的拒绝」。
 */
async function findActive(adminUserId, tenantId, tx = db) {
  return tx.queryOne(
    `SELECT ${COLUMNS}
       FROM platform_access_grant
      WHERE admin_user_id = ? AND tenant_id = ?
        AND revoked_at IS NULL AND deleted_at IS NULL
        AND expires_at > NOW()
      ORDER BY expires_at DESC
      LIMIT 1`,
    [adminUserId, tenantId]
  )
}

/** 按 id 取，**必须带租户** —— 授权 id 自增可枚举，不带租户就能撤销别家的授权 */
async function findById(id, tenantId, tx = db) {
  // JOIN 出用户名并算好是否生效：接口返回的形状必须与列表一致，
  // 否则「刚授予的那条」会缺 adminUsername，前端只能再猜一次
  return tx.queryOne(
    `SELECT g.id, g.tenant_id, g.admin_user_id, g.granted_by, g.reason,
            g.expires_at, g.revoked_at, g.created_at, g.updated_at,
            au.username AS admin_username,
            (g.revoked_at IS NULL AND g.expires_at > NOW()) AS is_active
       FROM platform_access_grant g
       LEFT JOIN admin_user au ON au.id = g.admin_user_id
      WHERE g.id = ? AND g.tenant_id = ? AND g.deleted_at IS NULL`,
    [id, tenantId]
  )
}

/** 某租户的授权记录（含已撤销与已过期，审计需要看到完整历史） */
async function listByTenant({ tenantId, offset, limit }) {
  const clause = `FROM platform_access_grant g
                   LEFT JOIN admin_user au ON au.id = g.admin_user_id
                  WHERE g.tenant_id = ? AND g.deleted_at IS NULL`
  const params = [tenantId]

  const total = await db.count(clause, params)
  const rows = await db.query(
    `SELECT g.id, g.tenant_id, g.admin_user_id, g.granted_by, g.reason,
            g.expires_at, g.revoked_at, g.created_at,
            au.username AS admin_username,
            (g.revoked_at IS NULL AND g.expires_at > NOW()) AS is_active
       ${clause}
      ORDER BY g.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return { total, rows }
}

/**
 * 撤销（软撤销：只置 revoked_at，不删行）。
 *
 * 条件里带 `tenant_id` 与 `revoked_at IS NULL`：返回 0 表示「不存在、
 * 不属于本租户，或已经撤销过」，由服务层区分提示。
 */
async function revoke(id, tenantId, tx = db) {
  const result = await tx.query(
    `UPDATE platform_access_grant
        SET revoked_at = NOW()
      WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL AND deleted_at IS NULL`,
    [id, tenantId]
  )
  return result.affectedRows
}

module.exports = { COLUMNS, create, findActive, findById, listByTenant, revoke }
