'use strict'

/**
 * tenant 数据访问层（M13）。
 *
 * 只放 SQL。配额、启停、到期这些判断都在 service 层 ——
 * 放在这里的话，单测就得连数据库。
 */

const db = require('../db/pool')

const COLUMNS = `
  id, name, code, status, plan, max_projects, max_admin_users,
  trial_ends_at, expires_at, contact_name, contact_phone, remark,
  created_at, updated_at
`

async function findById(id, tx = db) {
  return tx.queryOne(`SELECT ${COLUMNS} FROM tenant WHERE id = ? AND deleted_at IS NULL`, [id])
}

/** 登录时用租户短标识定位。code 全局唯一且不可变 */
async function findByCode(code) {
  if (!code) return null
  return db.queryOne(`SELECT ${COLUMNS} FROM tenant WHERE code = ? AND deleted_at IS NULL`, [code])
}

/**
 * 租户列表。顺带带出用量，避免平台列表页 N+1 查询。
 *
 * `project_count` / `admin_count` 用相关子查询而不是 LEFT JOIN + GROUP BY：
 * 两个统计维度会让行数相乘（笛卡尔积），除非每个都写 COUNT(DISTINCT)，
 * 而那个写法的成本并不比两个子查询低。
 */
async function list({ status, keyword, offset, limit }) {
  const where = ['t.deleted_at IS NULL']
  const params = []

  if (status) {
    where.push('t.status = ?')
    params.push(status)
  }
  if (keyword) {
    where.push('(t.name LIKE ? OR t.code LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }

  const clause = `FROM tenant t WHERE ${where.join(' AND ')}`
  const total = await db.count(clause, params)
  const rows = await db.query(
    `SELECT ${COLUMNS},
            (SELECT COUNT(*) FROM project p
              WHERE p.tenant_id = t.id AND p.deleted_at IS NULL) AS project_count,
            (SELECT COUNT(*) FROM admin_user au
              WHERE au.tenant_id = t.id AND au.deleted_at IS NULL) AS admin_count
       ${clause}
      ORDER BY t.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return { total, rows }
}

/**
 * 取租户并加行锁。用于配额检查 —— 两个并发建档请求若都先 COUNT 再 INSERT，
 * 会双双看到「还剩 1 个名额」然后各插一条，配额被突破。
 * 锁住租户行之后，第二个请求会等第一个提交，再看到新的计数。
 */
async function lockById(id, tx = db) {
  return tx.queryOne(
    `SELECT id, name, code, status, max_projects, max_admin_users, expires_at
       FROM tenant WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
    [id]
  )
}

async function countProjects(tenantId, tx = db) {
  return tx.count('FROM project WHERE tenant_id = ? AND deleted_at IS NULL', [tenantId])
}

async function countAdminUsers(tenantId, tx = db) {
  return tx.count('FROM admin_user WHERE tenant_id = ? AND deleted_at IS NULL', [tenantId])
}

async function create({ name, code, plan, maxProjects, maxAdminUsers, trialEndsAt, expiresAt, contactName, contactPhone, remark }, tx = db) {
  const result = await tx.query(
    `INSERT INTO tenant
       (name, code, plan, max_projects, max_admin_users, trial_ends_at, expires_at, contact_name, contact_phone, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      code,
      plan ?? 'basic',
      maxProjects ?? 20,
      maxAdminUsers ?? 5,
      trialEndsAt ?? null,
      expiresAt ?? null,
      contactName ?? null,
      contactPhone ?? null,
      remark ?? null,
    ]
  )
  return result.insertId
}

/** 状态流转（active / suspended / archived）。租户不做软删 —— 退租用 archived */
async function updateStatus(id, status, tx = db) {
  await tx.query('UPDATE tenant SET status = ? WHERE id = ? AND deleted_at IS NULL', [status, id])
}

/** 可调整的租户条款字段。列名来自固定映射，不接受外部输入 */
const TERM_COLUMNS = {
  plan: 'plan',
  maxProjects: 'max_projects',
  maxAdminUsers: 'max_admin_users',
  trialEndsAt: 'trial_ends_at',
  expiresAt: 'expires_at',
  contactName: 'contact_name',
  contactPhone: 'contact_phone',
  remark: 'remark',
}

/**
 * 续期与配额调整。
 *
 * ── 为什么不能写成 `SET x = COALESCE(?, x)` ──
 * 那个写法无法把字段**清空**：运营取消到期时间（改成永久）时传 `null`，
 * COALESCE 会保留旧值，接口返回成功但租户仍然会到期 —— 这类「看起来改了、
 * 实际没改」的问题比报错难查得多。
 *
 * 因此按「传了才改」处理：`undefined` = 不动，`null` = 清空。
 * 与 PATCH 语义一致，也让审计日志只记录真正变化的字段。
 */
async function updateTerms(id, changes, tx = db) {
  const sets = []
  const params = []

  for (const [key, column] of Object.entries(TERM_COLUMNS)) {
    if (changes[key] === undefined) continue
    sets.push(`${column} = ?`)
    params.push(changes[key])
  }

  if (sets.length === 0) return

  params.push(id)
  await tx.query(`UPDATE tenant SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params)
}

/** 用量：项目数与后台账号数（配额判断与平台列表都用它） */
async function usage(id, tx = db) {
  const row = await tx.queryOne(
    `SELECT (SELECT COUNT(*) FROM project WHERE tenant_id = ? AND deleted_at IS NULL) AS project_count,
            (SELECT COUNT(*) FROM admin_user WHERE tenant_id = ? AND deleted_at IS NULL) AS admin_count`,
    [id, id]
  )
  return { projectCount: row.project_count, adminCount: row.admin_count }
}

async function countByStatus(status, tx = db) {
  const where = status ? 'status = ? AND deleted_at IS NULL' : 'deleted_at IS NULL'
  return tx.count(`FROM tenant WHERE ${where}`, status ? [status] : [])
}

module.exports = {
  COLUMNS,
  findById,
  findByCode,
  list,
  create,
  updateStatus,
  updateTerms,
  usage,
  countByStatus,
  lockById,
  countProjects,
  countAdminUsers,
}
