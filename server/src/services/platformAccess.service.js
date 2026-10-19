'use strict'

/**
 * 平台访问租户数据的临时授权（M13 / P4）。
 *
 * ── 三条不可动摇的规则 ──
 * 1. **只有租户管理员能授予**（`requireTenantOwner`）。被看的一方发起，
 *    平台不能给自己开窗。
 * 2. **窗口内只能读**。写入在 `requireTenant` 里按 HTTP 方法统一拦截，
 *    不依赖每个 service 自觉。
 * 3. **每次请求都留痕**。日志写在目标租户名下 —— 租户有权在自己的
 *    操作日志里看到「平台在什么时候访问了什么接口」。
 *
 * ── 门锁密码永久排除 ──
 * 门锁密码只有 C 端成员接口，鉴权走 `requireMini`；平台 token 在那一步
 * 就被拒绝，连「有没有这个资源」都问不到。后台也没有任何门锁密码接口。
 * 这条不是靠本模块的过滤实现的，而是**结构上不存在入口** —— 这也是为什么
 * 它不会因为将来某个查询漏了条件而失效。
 */

const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const tenantModel = require('../models/tenant.model')
const adminUserModel = require('../models/adminUser.model')
const platformAccessGrantModel = require('../models/platformAccessGrant.model')
const operationLog = require('./operationLog.service')

/**
 * 单次授权的最长时限。
 *
 * 排障是小时级的事，7 天已经足够宽松。不设上限的话，一次「临时授权」
 * 可以写成 2099 年到期 —— 那实质上就是永久只读，只是换了个名字。
 */
const MAX_GRANT_HOURS = 24 * 7

const STATUS_LABELS = { active: '生效中', expired: '已过期', revoked: '已撤销' }

function shape(row) {
  let status = 'active'
  if (row.revoked_at) status = 'revoked'
  else if (!row.is_active) status = 'expired'

  return {
    id: row.id,
    tenantId: row.tenant_id,
    adminUserId: row.admin_user_id,
    adminUsername: row.admin_username ?? null,
    grantedBy: row.granted_by,
    reason: row.reason,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    status,
    statusLabel: STATUS_LABELS[status],
    isActive: status === 'active',
    createdAt: row.created_at,
  }
}

// ─────────────────────────────────────────────────────────────
// 租户侧：授予 / 查看 / 撤销
// ─────────────────────────────────────────────────────────────

/**
 * 授予平台账号一个临时窗口。
 *
 * @param {object} operator 租户 owner（req.auth）
 * @param {object} input { adminUserId?, adminUsername?, reason?, expiresAt }
 */
async function grant(operator, input) {
  if (!operator.tenantId) throw AppError.forbidden('只有租户管理员可以授予排障访问权限')

  // ── 目标账号必须是**有效的平台账号** ──
  // 传 id 或 username 都可以：平台客服通常报给客户一个用户名，
  // 而管理界面里更容易拿到 id
  const target = input.adminUserId
    ? await adminUserModel.findById(input.adminUserId)
    : await adminUserModel.findByUsernameInTenant(input.adminUsername, null)

  if (
    !target ||
    target.tenant_id !== null ||
    target.role !== 'platform' ||
    target.status !== 'active'
  ) {
    throw AppError.badRequest('只能授权给有效的平台运营账号')
  }

  // ── 时限：必须是未来，且不超过上限 ──
  const expiresAt = datetime.parse(input.expiresAt)
  if (!expiresAt) throw AppError.badRequest('授权截止时间不合法')
  const deltaMs = expiresAt.valueOf() - Date.now()
  if (deltaMs <= 0) throw AppError.badRequest('授权截止时间必须晚于当前时间')
  if (deltaMs > MAX_GRANT_HOURS * 3600_000) {
    throw AppError.badRequest(`单次授权最长 ${MAX_GRANT_HOURS / 24} 天`)
  }

  // 同一平台账号对同一租户只允许一个有效窗口。多个窗口并存时，
  // 撤销其中一个不会真正断掉访问 —— 客户会以为「已经关掉了」
  const active = await platformAccessGrantModel.findActive(target.id, operator.tenantId)
  if (active) {
    throw AppError.conflict('该平台账号已持有有效授权，请先撤销或等待过期')
  }

  const expiresAtDb = datetime.toDb(expiresAt)
  const id = await platformAccessGrantModel.create({
    tenantId: operator.tenantId,
    adminUserId: target.id,
    grantedBy: operator.id,
    reason: input.reason,
    expiresAt: expiresAtDb,
  })

  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.PLATFORM_GRANT_CREATE,
    targetType: 'platform_access_grant',
    targetId: id,
    detail: {
      after: {
        adminUserId: target.id,
        adminUsername: target.username,
        reason: input.reason ?? null,
        expiresAt: expiresAtDb,
      },
    },
  })

  return getById(operator, id)
}

async function list(operator, paging) {
  const { total, rows } = await platformAccessGrantModel.listByTenant({
    tenantId: operator.tenantId,
    offset: paging.offset,
    limit: paging.limit,
  })

  return {
    list: rows.map(shape),
    total,
    page: paging.page,
    pageSize: paging.pageSize,
  }
}

async function getById(operator, id) {
  // findById 已 JOIN 出用户名并算好 is_active（与列表同一份口径）
  const row = await platformAccessGrantModel.findById(id, operator.tenantId)
  if (!row) throw AppError.notFound('授权记录不存在')
  return shape(row)
}

async function revoke(operator, id) {
  const row = await platformAccessGrantModel.findById(id, operator.tenantId)
  if (!row) throw AppError.notFound('授权记录不存在')
  if (row.revoked_at) throw AppError.conflict('该授权已经撤销')

  const affected = await platformAccessGrantModel.revoke(id, operator.tenantId)
  if (affected === 0) throw AppError.conflict('该授权已经撤销')

  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.PLATFORM_GRANT_REVOKE,
    targetType: 'platform_access_grant',
    targetId: id,
    detail: {
      before: { adminUserId: row.admin_user_id, expiresAt: row.expires_at },
      after: { revokedAt: datetime.format() },
    },
  })

  return getById(operator, id)
}

// ─────────────────────────────────────────────────────────────
// 平台侧：用授权进入租户
// ─────────────────────────────────────────────────────────────

/**
 * 解析一次平台访问请求，并在目标租户下写审计日志。
 *
 * 由 `middlewares/adminAuth.requireTenant` 在业务路由上调用。
 * 校验顺序：租户存在 → 租户可用 → 有有效授权 → 留痕。
 * 先判租户状态再判授权：租户停用时，平台即使持有窗口也进不去。
 *
 * @returns {Promise<{grantId: number, tenant: object}>}
 */
async function resolveForRequest(operator, tenantId, { method, path, ip, requestId }) {
  const tenant = await tenantModel.findById(tenantId)
  if (!tenant) throw AppError.notFound('租户不存在')
  if (tenant.status !== 'active') throw AppError.forbidden('租户已停用，请联系服务商')
  if (tenant.expires_at && datetime.parse(tenant.expires_at).valueOf() < Date.now()) {
    throw AppError.forbidden('租户服务已到期，请联系服务商续费')
  }

  const grant = await platformAccessGrantModel.findActive(operator.id, tenantId)
  if (!grant) {
    throw AppError.forbidden('未获得该租户的排障授权，请联系租户管理员')
  }

  // ── 每一次请求都留痕 ──
  // tenant_id 写**目标租户**：租户在自己的操作日志里能看到平台来过，
  // 这是「显式授权 + 全程留痕」里「留痕」的实际兑现方式。
  // 只记方法与路径，不记响应体 —— 响应可能有合同金额，审计日志的
  // 可见范围比业务数据还宽，不该成为二次泄露渠道。
  await operationLog.record({
    operatorType: 'admin',
    operatorId: operator.id,
    tenantId,
    action: operationLog.ACTIONS.PLATFORM_ACCESS_TENANT,
    targetType: 'tenant',
    targetId: tenantId,
    ip: ip ?? null,
    requestId: requestId ?? null,
    detail: {
      after: {
        grantId: grant.id,
        method,
        // 去掉查询串：查询串可能含筛选关键字（如业主姓名、手机号），
        // 而访问日志只需要回答「看了哪个接口」
        path: String(path || '').split('?')[0].slice(0, 200),
      },
    },
  })

  return { grantId: grant.id, tenant }
}

module.exports = {
  MAX_GRANT_HOURS,
  STATUS_LABELS,
  grant,
  list,
  getById,
  revoke,
  resolveForRequest,
}
