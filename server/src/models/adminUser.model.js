'use strict'

/**
 * admin_user 数据访问层。
 *
 * 只放 SQL，不放业务判断 —— 锁定策略、权限边界那些属于 service 层。
 * 这样 service 的单测可以替换掉本模块，不必起数据库。
 */

const db = require('../db/pool')

/** 对外返回的字段白名单。password_hash 永远不出现在这里（AC-AD04） */
const PUBLIC_COLUMNS = `
  id, tenant_id, username, role, status, must_change_password, token_version,
  password_changed_at, created_by, created_at, updated_at
`

async function findById(id, { withPassword = false } = {}) {
  const columns = withPassword ? `${PUBLIC_COLUMNS}, password_hash, failed_count, locked_until` : PUBLIC_COLUMNS
  return db.queryOne(`SELECT ${columns} FROM admin_user WHERE id = ? AND deleted_at IS NULL`, [id])
}

/**
 * 登录用：需要密码哈希与锁定状态。
 *
 * 传了 tenantId 就限定在该租户（登录页带了 tenantCode）；
 * 不传则**可能返回多条** —— 多个租户各有一个同名账号。
 * 调用方必须显式处理这种情况，不能取第一条：那会把人登进别人的公司。
 */
async function findForLogin(username, tenantId = undefined) {
  const scope = tenantId === undefined ? '' : tenantId === null ? 'AND tenant_id IS NULL' : 'AND tenant_id = ?'
  const params = tenantId === undefined || tenantId === null ? [username] : [username, tenantId]

  return db.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash, failed_count, locked_until
       FROM admin_user
      WHERE username = ? ${scope} AND deleted_at IS NULL
      LIMIT 5`,
    params
  )
}

/**
 * 按租户查用户名。
 *
 * `(tenant_key, username)` 唯一之后，两家公司都可以有叫 admin 的账号，
 * 因此查重**必须带租户** —— 不带的话第二次创建会被一个别的租户的同名账号拦住。
 * tenantId 传 null 表示查平台账号。
 */
async function findByUsernameInTenant(username, tenantId = null) {
  const scope = tenantId === null ? 'tenant_id IS NULL' : 'tenant_id = ?'
  const params = tenantId === null ? [username] : [username, tenantId]
  return db.queryOne(
    `SELECT ${PUBLIC_COLUMNS} FROM admin_user WHERE username = ? AND ${scope} AND deleted_at IS NULL`,
    params
  )
}

/**
 * 按用户名全局查（登录用）。可能命中多条 —— 多个租户各有一个同名账号。
 * 调用方必须处理「命中多条」而不是挑第一条，否则会登进别人的公司。
 */
async function findManyByUsername(username) {
  return db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM admin_user WHERE username = ? AND deleted_at IS NULL LIMIT 5`,
    [username]
  )
}

/**
 * 分页查询（AC-AD47）。
 * 项目管理员只能看自己创建的下属 —— 该过滤由 service 层通过 createdBy 传入，
 * 本函数不做权限判断。
 */
async function list({ tenantId, page, pageSize, offset, keyword, role, status, createdBy }) {
  const where = ['deleted_at IS NULL']
  const params = []

  // tenantId 用 `=== null` 判断而不是 falsy：平台账号的租户就是 null，
  // 那是「查平台账号」的合法条件，不能被 `if (tenantId)` 吞掉
  if (tenantId === null) {
    where.push('tenant_id IS NULL')
  } else if (tenantId !== undefined) {
    where.push('tenant_id = ?')
    params.push(tenantId)
  }

  if (keyword) {
    where.push('username LIKE ?')
    params.push(`%${keyword}%`)
  }
  if (role) {
    where.push('role = ?')
    params.push(role)
  }
  if (status) {
    where.push('status = ?')
    params.push(status)
  }
  if (createdBy !== undefined && createdBy !== null) {
    where.push('created_by = ?')
    params.push(createdBy)
  }

  const clause = `FROM admin_user WHERE ${where.join(' AND ')}`

  const total = await db.count(clause, params)
  const rows = await db.query(
    `SELECT ${PUBLIC_COLUMNS} ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  return { total, rows, page, pageSize }
}

async function create({ tenantId, username, passwordHash, role, createdBy, mustChangePassword = 1 }, tx = db) {
  const result = await tx.query(
    `INSERT INTO admin_user (tenant_id, username, password_hash, role, created_by, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?)`,
    // tenantId 为 null = 平台账号。create() 不校验，由 service 决定能不能建平台号
    [tenantId ?? null, username, passwordHash, role, createdBy ?? null, mustChangePassword ? 1 : 0]
  )
  // INSERT 返回的 insertId 是 number（bigNumberStrings 已关，见 CLAUDE.md）
  return result.insertId
}

/**
 * 更新登录失败状态（AC-AD03）。
 *
 * failedCount 与 lockedUntil 一起传，避免「先加计数再判断是否锁定」这种
 * 两次往返的写法在并发下算错。lockedUntil 传 null 表示不锁定。
 */
async function updateLoginFailure(id, { failedCount, lockedUntil }) {
  await db.query('UPDATE admin_user SET failed_count = ?, locked_until = ? WHERE id = ?', [
    failedCount,
    lockedUntil,
    id,
  ])
}

/** 登录成功：清零失败计数、解除锁定、记录登录时间 */
async function resetLoginFailure(id) {
  await db.query('UPDATE admin_user SET failed_count = 0, locked_until = NULL WHERE id = ?', [id])
}

/**
 * 改密。
 *
 * token_version 自增是关键：所有已签发 token 在下一次请求时立即失效
 * （AC-AD08 重置密码后原 token 全部失效），无需等过期，也无需维护黑名单。
 */
async function updatePassword(id, passwordHash) {
  await db.query(
    `UPDATE admin_user
        SET password_hash = ?, password_changed_at = NOW(),
            must_change_password = 0, token_version = token_version + 1,
            failed_count = 0, locked_until = NULL
      WHERE id = ?`,
    [passwordHash, id]
  )
}

/**
 * 启用 / 禁用（AC-AD07：禁用后已签发 token 下一次请求即被拒绝）。
 * 同样靠 token_version 自增实现，而不是去查数据库里的 status ——
 * 查 status 也能拦住，但每次请求多一次查询，且「禁用又启用」后旧 token 会复活。
 */
async function updateStatus(id, status) {
  await db.query('UPDATE admin_user SET status = ?, token_version = token_version + 1 WHERE id = ?', [status, id])
}

/** 统计某管理员创建的下属数量，用于「仅自建下属」的边界判断 */
async function countCreatedBy(adminUserId) {
  return db.count('FROM admin_user WHERE created_by = ? AND deleted_at IS NULL', [adminUserId])
}

module.exports = {
  PUBLIC_COLUMNS,
  findById,
  findByUsernameInTenant,
  findManyByUsername,
  findForLogin,
  list,
  create,
  updateLoginFailure,
  resetLoginFailure,
  updatePassword,
  updateStatus,
  countCreatedBy,
}
