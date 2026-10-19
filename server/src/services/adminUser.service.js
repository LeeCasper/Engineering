'use strict'

/**
 * 后台账号管理（B-1.3 / B-1.4）。
 *
 * ── 本文件的核心是「项目管理员只能管自己创建的下属」这条边界 ──
 * AC-AD50 要求「项目管理员对超级管理员账号执行禁用、删除或改角色，一律返回 403」；
 * B-1.3 的角色能力表把它放宽为「仅自己创建的下属账号」。
 *
 * 因此每个写操作都走 assertManageable()。把这条判断只写在列表接口里，
 * 是这类系统最常见的越权来源：列表隐藏了入口，但直接调 PUT /admin-users/1/status
 * 仍然能改超管的密码。
 */

const AppError = require('../utils/AppError')
const password = require('../utils/password')
const adminUserModel = require('../models/adminUser.model')
const dataScope = require('./dataScope.service')
const operationLog = require('./operationLog.service')
const tenantService = require('./tenant.service')
const db = require('../db/pool')

/**
 * 断言操作者有权管理目标账号。
 *
 * 规则：
 *   - 超级管理员：可管理任何账号；
 *   - 项目管理员：只能管理「自己创建的」且「不是超级管理员」的账号；
 *   - 任何人（含超管）都不能管理自己 —— 禁用/删除自己会让系统失去操作者，
 *     改自己的角色等于自行提权或降权，两条都该走专门的接口（改密有 change-password）。
 *
 * @param {{id:number, role:string}} operator
 * @param {{id:number, role:string, created_by:number|null}} target
 */
function assertManageable(operator, target) {
  if (!target || target.deleted_at) throw AppError.notFound('账号不存在')

  if (target.id === operator.id) {
    throw AppError.forbidden('不能对当前登录账号执行该操作')
  }

  // 平台账号由平台自己管，租户管理员碰不到
  if (Number(target.tenant_id) !== Number(operator.tenantId) || target.tenant_id == null) {
    throw AppError.forbidden('只能管理本租户的账号')
  }

  // 租户管理员：可以管本租户的任何账号
  if (operator.role === 'owner') return

  // 项目管理员：只能管自己创建的下属
  if (target.role === 'owner') {
    throw AppError.forbidden('无权操作租户管理员账号')
  }
  if (Number(target.created_by) !== Number(operator.id)) {
    // 提示不区分「不存在」与「不属于你」，避免管理员通过报错差异探测账号归属
    throw AppError.forbidden('只能管理自己创建的下属账号')
  }
}

/** 列表。项目管理员只看自己创建的下属（AC-AD47） */
async function list(operator, query) {
  const paging = query.paging
  const params = {
    page: paging.page,
    pageSize: paging.pageSize,
    offset: paging.offset,
    keyword: query.keyword,
    role: query.role,
    status: query.status,
    // owner 与持排障授权的平台账号看全部；项目管理员只看自己创建的下属
    // （undefined 表示不加条件）
    createdBy: operator.role === 'owner' || operator.role === 'platform' ? undefined : operator.id,
    tenantId: operator.tenantId,
  }

  const { total, rows, page, pageSize } = await adminUserModel.list(params)

  return {
    list: rows.map(toPublic),
    total,
    page,
    pageSize,
  }
}

/** 创建下属账号（AC-AD06：首次登录强制改密） */
async function create(operator, { username, password: plainPassword, role }) {
  // 平台账号不经本接口创建 —— 它属于软件方，不属于任何租户
  if (role === 'platform') {
    throw AppError.forbidden('不能通过本接口创建平台账号')
  }
  // 建账号是租户级动作：项目管理员没有账号管理权（§5.1 能力表）
  if (operator.role !== 'owner') {
    throw AppError.forbidden('仅租户管理员可创建账号')
  }

  // 用户名查重按租户：两家公司都可以有叫 admin 的账号
  const existing = await adminUserModel.findByUsernameInTenant(username, operator.tenantId)
  if (existing) throw AppError.conflict('用户名已存在')

  const policy = password.validatePolicy(plainPassword)
  if (!policy.ok) throw AppError.badRequest(policy.reason)

  // 哈希在事务外算：bcrypt 是 CPU 密集的，放进事务会拉长持锁时间
  const passwordHash = await password.hash(plainPassword)

  const id = await db.withTransaction(async (tx) => {
    // 配额在事务内检查并锁住 tenant 行，避免并发建号突破上限
    await tenantService.assertAdminQuota(operator.tenantId, tx)

    return adminUserModel.create(
      {
        tenantId: operator.tenantId,
        username,
        passwordHash,
        role,
        createdBy: operator.id,
        // AC-AD06：新建账号首次登录强制改初始密码
        mustChangePassword: 1,
      },
      tx
    )
  })

  // AC-AD04 要求「代码、日志、接口响应中均无明文密码」——
  // 审计日志同样是「响应之外会被读到的地方」，因此这里只记账号与角色，
  // **绝不记密码**，哪怕是初始密码。判断依据：operation_log 的可见范围
  // 比创建接口宽得多（项目管理员能看到自己项目上的日志）
  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.ADMIN_USER_CREATE,
    targetType: 'admin_user',
    targetId: id,
    detail: { after: { username, role, status: 'active', mustChangePassword: true } },
  })

  const created = await adminUserModel.findById(id)
  return toPublic(created)
}

/** 启用 / 禁用（AC-AD07：禁用后已签发 token 下一次请求即被拒） */
async function updateStatus(operator, targetId, status) {
  const target = await adminUserModel.findById(targetId)
  assertManageable(operator, target)

  if (target.status === status) {
    throw AppError.conflict(status === 'active' ? '账号已是启用状态' : '账号已是禁用状态')
  }

  await adminUserModel.updateStatus(targetId, status)

  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.ADMIN_USER_STATUS,
    targetType: 'admin_user',
    targetId,
    detail: {
      before: { username: target.username, status: target.status },
      after: { username: target.username, status },
    },
  })

  return { id: targetId, status }
}

/**
 * 重置密码（AC-AD08：重置后原 token 全部失效、旧密码无法登录）。
 * 重置为指定密码并强制对方下次登录时修改。
 */
async function resetPassword(operator, targetId, newPassword) {
  const target = await adminUserModel.findById(targetId)
  assertManageable(operator, target)

  const policy = password.validatePolicy(newPassword)
  if (!policy.ok) throw AppError.badRequest(policy.reason)

  const passwordHash = await password.hash(newPassword)
  await db.withTransaction(async (tx) => {
    await tx.query(
      `UPDATE admin_user
          SET password_hash = ?, must_change_password = 1, password_changed_at = NOW(),
              token_version = token_version + 1, failed_count = 0, locked_until = NULL
        WHERE id = ?`,
      [passwordHash, targetId]
    )

    // 这条日志本身就是安全事件记录：谁重置了谁的密码。因此**只记事实、不记密码**。
    // tokenVersionBumped 写进去是为了将来能回答「我的登录怎么突然失效了」——
    // 那是本次操作最容易被误解的副作用（AC-AD08）
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.ADMIN_USER_PASSWORD,
        targetType: 'admin_user',
        targetId,
        detail: {
          before: { username: target.username, mustChangePassword: target.must_change_password === 1 },
          after: { username: target.username, mustChangePassword: true, tokenVersionBumped: true },
        },
      },
      tx
    )
  })

  return { id: targetId }
}

/**
 * 授予项目数据权限范围（B-5.4 / G-19）。
 * 仅租户管理员可操作（AC-AD52 的数据权限模型）。
 */
async function grantProjects(operator, targetId, projectIds) {
  if (operator.role !== 'owner') throw AppError.forbidden('仅租户管理员可授予项目数据权限')

  const target = await adminUserModel.findById(targetId)
  if (!target) throw AppError.notFound('账号不存在')
  if (target.role === 'owner') throw AppError.badRequest('租户管理员无需授予项目范围')
  // 目标必须属于同一租户 —— 否则可以把本租户的项目授权给别家公司的人
  if (Number(target.tenant_id) !== Number(operator.tenantId)) throw AppError.notFound('账号不存在')

  // 被授权的项目也必须属于本租户：id 是自增的，扫一遍就能猜到别人的项目
  if (projectIds.length > 0) {
    const placeholders = projectIds.map(() => '?').join(', ')
    const owned = await db.query(
      `SELECT id FROM project WHERE id IN (${placeholders}) AND tenant_id = ? AND deleted_at IS NULL`,
      [...projectIds, operator.tenantId]
    )
    if (owned.length !== new Set(projectIds).size) {
      throw AppError.badRequest('存在不属于本租户的项目')
    }
  }

  const previous = await dataScope.listGrantedProjectIds(targetId)

  await db.withTransaction(async (tx) => {
    // 全量替换语义：先软删再插入，避免「取消授权」没有对应接口
    await tx.query(
      'UPDATE project_admin_scope SET deleted_at = NOW() WHERE admin_user_id = ? AND deleted_at IS NULL',
      [targetId]
    )

    for (const projectId of projectIds) {
      await tx.query(
        `INSERT INTO project_admin_scope (admin_user_id, project_id, granted_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE deleted_at = NULL, granted_by = VALUES(granted_by), granted_at = NOW()`,
        [targetId, projectId, operator.id]
      )
    }

    // AC-AD09：数据权限的授予与撤销是最该留痕的一类操作 ——
    // 「他为什么能看到这个项目」的答案就在这条日志里
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.ADMIN_USER_GRANT,
        targetType: 'admin_user',
        targetId,
        detail: { before: { grantedProjectIds: previous.sort() }, after: { grantedProjectIds: [...projectIds].sort() } },
      },
      tx
    )
  })

  return { id: targetId, projectIds }
}

/** 被授权的项目 ID 列表（按租户校验目标账号归属） */
async function listGrantedProjects(operator, adminUserId) {
  const target = await adminUserModel.findById(adminUserId)
  if (!target || Number(target.tenant_id) !== Number(operator.tenantId)) throw AppError.notFound('账号不存在')

  const rows = await db.query(
    'SELECT project_id FROM project_admin_scope WHERE admin_user_id = ? AND deleted_at IS NULL',
    [adminUserId]
  )
  return rows.map((r) => r.project_id)
}

/** 去掉 password_hash 等敏感字段。model 层的 PUBLIC_COLUMNS 已经过滤，这里只做驼峰转换 */
function toPublic(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

module.exports = { assertManageable, list, create, updateStatus, resetPassword, grantProjects, listGrantedProjects }
