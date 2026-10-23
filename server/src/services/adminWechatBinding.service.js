'use strict'

/**
 * 小程序管理员的微信免密绑定。
 *
 * ── 这不是第二套授权体系 ──
 * 它只负责把「当前微信」与一个已存在的 admin_user 绑定起来；真正访问后台时
 * 仍然签发普通的管理员 JWT，走 requireAdmin + requireTenant + dataScope。
 * mini token 只在绑定与换取管理员 token 时证明微信身份，绝不直接访问 /admin/*。
 *
 * ── 绑定是持久凭据 ──
 * 因此任何会削弱管理员账号可信度的事件（改密、重置、禁用、C 端注销）
 * 都必须撤销绑定；admin_token_version 快照是撤销写入失败时的兜底。
 */

const AppError = require('../utils/AppError')
const jwt = require('../utils/jwt')
const db = require('../db/pool')
const datetime = require('../utils/datetime')
const adminUserModel = require('../models/adminUser.model')
const tenantModel = require('../models/tenant.model')
const userModel = require('../models/user.model')
const bindingModel = require('../models/adminWechatBinding.model')
const adminAuthService = require('./adminAuth.service')
const adminLoginLogModel = require('../models/adminLoginLog.model')
const operationLog = require('./operationLog.service')
const logger = require('../utils/logger')

const ROLE_LABELS = {
  owner: '租户管理员',
  admin: '项目管理员',
}

/** 绑定动作要求本次管理员会话是「刚用密码登录」的 */
const BIND_FRESH_SECONDS = 30 * 60

function isLocked(admin) {
  if (!admin || !admin.locked_until) return false
  return new Date(admin.locked_until).getTime() > Date.now()
}

function isTenantUsable(tenant) {
  if (!tenant) return false
  if (tenant.status !== 'active') return false
  if (tenant.expires_at && datetime.parse(tenant.expires_at).valueOf() < Date.now()) return false
  return true
}

function toBindingView(row) {
  return {
    bindingId: row.id,
    adminUserId: row.admin_user_id,
    username: row.username,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantCode: row.tenant_code,
    boundAt: row.bound_at,
    lastUsedAt: row.last_used_at,
  }
}

/**
 * 绑定当前微信。
 *
 * @param {object} adminAuth requireAdmin 注入的 req.auth
 * @param {string} miniToken X-Mini-Token
 */
async function bind(adminAuth, miniToken, context = {}) {
  if (!adminAuth || adminAuth.type !== 'admin') throw AppError.unauthorized()
  if (!miniToken) throw AppError.badRequest('缺少微信身份凭证')

  // 这是「新增一条持久凭据」的动作，不能由免密会话自己发起：
  // 否则一个被盗的免密 token 可以不断给自己续绑新的微信。
  if (adminAuth.authMethod !== 'password') {
    throw AppError.forbidden('请使用账号密码重新登录后再绑定微信')
  }
  const issuedAt = Number(adminAuth.tokenIssuedAt) || 0
  if (!issuedAt || Math.floor(Date.now() / 1000) - issuedAt > BIND_FRESH_SECONDS) {
    throw AppError.forbidden('登录状态已超过 30 分钟，请重新登录后再绑定微信')
  }

  const admin = await adminUserModel.findByIdWithLock(adminAuth.id)
  if (!admin) throw AppError.unauthorized()
  if (admin.status !== 'active') throw AppError.forbidden('账号已被禁用')
  if (admin.tenant_id == null) throw AppError.forbidden('平台账号不能绑定租户微信')
  if (admin.role !== 'owner' && admin.role !== 'admin') {
    throw AppError.forbidden('当前账号不能绑定微信')
  }
  if (admin.must_change_password === 1) {
    throw AppError.forbidden('请先修改初始密码')
  }
  if (isLocked(admin)) throw AppError.unauthorized('账号已锁定，请稍后再试')

  const tenant = await tenantModel.findById(admin.tenant_id)
  if (!isTenantUsable(tenant)) throw AppError.forbidden('租户已停用或已到期')

  // 证明当前微信身份。这里只用 C token 确认 openid，不把它当管理员凭据。
  let payload
  try {
    payload = jwt.verifyMini(miniToken)
  } catch (err) {
    throw AppError.badRequest('微信身份已失效，请重新登录小程序')
  }

  const user = await userModel.findById(payload.sub)
  if (!user || user.status !== 'active' || user.anonymized_at || !user.openid) {
    throw AppError.forbidden('当前微信账号不可用')
  }

  const existingForAdmin = await bindingModel.findActiveByAdmin(admin.id)
  const sameWechat =
    existingForAdmin && existingForAdmin.openid === user.openid &&
    Number(existingForAdmin.admin_token_version) === Number(admin.token_version)
  if (sameWechat) {
    return {
      bound: true,
      binding: {
        id: existingForAdmin.id,
        boundAt: existingForAdmin.bound_at,
        lastUsedAt: existingForAdmin.last_used_at,
      },
    }
  }

  let bindingId
  try {
    bindingId = await db.withTransaction(async (tx) => {
      // 重新绑定到另一个微信：旧绑定先撤销，再插入新的。
      // 唯一索引 `active_admin_key` 不允许两条 active 同时存在。
      if (existingForAdmin) {
        await bindingModel.revoke(existingForAdmin.id, 'rebind', tx)
      }

      return bindingModel.create(
        {
          tenantId: admin.tenant_id,
          adminUserId: admin.id,
          userId: user.id,
          openid: user.openid,
          unionid: user.unionid || null,
          adminTokenVersion: admin.token_version,
        },
        tx
      )
    })
  } catch (err) {
    // 并发绑定：唯一索引兜底后重新读一次，同一 openid 视为幂等成功
    if (err && err.code === 'ER_DUP_ENTRY') {
      const existing = await bindingModel.findActiveByOpenidAndAdmin(user.openid, admin.id)
      if (existing) {
        return {
          bound: true,
          binding: {
            id: existing.id,
            boundAt: existing.bound_at,
            lastUsedAt: existing.last_used_at,
          },
        }
      }
      throw AppError.conflict('该管理员已绑定其他微信，请先解除原绑定')
    }
    throw err
  }

  await operationLog
    .record({
      ...operationLog.fromOperator(adminAuth),
      action: operationLog.ACTIONS.ADMIN_WECHAT_BIND,
      targetType: 'admin_user',
      targetId: admin.id,
      detail: {
        after: {
          bindingId,
          adminUserId: admin.id,
          tenantId: admin.tenant_id,
          cUserId: user.id,
        },
      },
    })
    .catch((err) => logger.warn('写微信绑定日志失败', { bindingId, err }))

  return {
    bound: true,
    binding: {
      id: bindingId,
      boundAt: datetime.format(),
      lastUsedAt: null,
    },
  }
}

/** 小程序登录页的身份列表；只返回当前 openid 的有效绑定 */
async function listForMiniUser(miniAuth) {
  if (!miniAuth || !miniAuth.openid) return { bindings: [] }

  const rows = await bindingModel.listActiveForOpenid(miniAuth.openid)
  return { bindings: rows.map(toBindingView) }
}

/**
 * 用绑定换取管理员 token。
 *
 * 这里的校验比「查一条绑定」多得多：绑定只说明微信身份，
 * 账号/租户状态、锁定、首登改密、token_version 都必须重新回库确认。
 */
async function wechatLogin(bindingId, miniAuth, context = {}) {
  if (!miniAuth || !miniAuth.openid) throw AppError.forbidden('当前微信身份不可用')

  const binding = await bindingModel.findActiveByIdForOpenid(bindingId, miniAuth.openid)
  if (!binding) throw AppError.notFound('管理身份不存在或已失效')

  // 数据完整性：绑定的租户必须与管理员当前租户一致
  if (Number(binding.tenant_id) !== Number(binding.admin_tenant_id)) {
    await bindingModel.revoke(binding.id, 'tenant_mismatch')
    throw AppError.forbidden('微信绑定已失效，请重新登录')
  }

  if (binding.admin_deleted_at || binding.admin_status !== 'active') {
    await bindingModel.revoke(binding.id, 'admin_disabled')
    throw AppError.forbidden('管理员账号已被禁用')
  }
  if (binding.role !== 'owner' && binding.role !== 'admin') {
    throw AppError.forbidden('当前账号不能进入管理端')
  }
  if (binding.must_change_password === 1) {
    throw AppError.forbidden('请先修改初始密码')
  }
  if (isLocked({ locked_until: binding.locked_until })) {
    throw AppError.unauthorized('账号已锁定，请稍后再试')
  }

  if (Number(binding.admin_token_version) !== Number(binding.token_version)) {
    // 改密后 token_version 已变；即使撤销写入漏了，这里也必须失败
    await bindingModel.revoke(binding.id, 'token_version_mismatch')
    throw AppError.forbidden('微信绑定已失效，请重新登录')
  }

  const tenant = {
    status: binding.tenant_status,
    expires_at: binding.tenant_expires_at,
  }
  if (!isTenantUsable(tenant)) throw AppError.forbidden('租户已停用或已到期')

  // 手机号合并会改变 C 用户 id；openid 不变，绑定仍有效。修正审计字段。
  if (Number(binding.user_id) !== Number(miniAuth.id)) {
    await bindingModel.repairUserIdByOpenid(miniAuth.openid, miniAuth.id)
  }

  const admin = {
    id: binding.admin_user_id,
    username: binding.username,
    role: binding.role,
    tenant_id: binding.admin_tenant_id,
    token_version: binding.token_version,
    must_change_password: binding.must_change_password,
  }

  const session = await adminAuthService.startAdminSession(admin, 'wechat')

  await bindingModel.touchLastUsed(binding.id)
  await adminLoginLogModel.record({
    adminUserId: admin.id,
    tenantId: binding.tenant_id,
    username: admin.username,
    ip: context.ip || miniAuth.ip || '',
    result: 'success',
    authMethod: 'wechat',
  })

  await operationLog
    .record({
      operatorType: 'admin',
      operatorId: admin.id,
      tenantId: binding.tenant_id,
      ip: context.ip || miniAuth.ip || null,
      requestId: context.requestId || miniAuth.requestId || null,
      action: operationLog.ACTIONS.ADMIN_WECHAT_LOGIN,
      targetType: 'admin_user',
      targetId: admin.id,
      detail: { after: { bindingId: binding.id, authMethod: 'wechat' } },
    })
    .catch((err) => logger.warn('写微信免密登录日志失败', { bindingId: binding.id, err }))

  return {
    ...session,
    bindingId: binding.id,
    admin: {
      ...session.admin,
      tenantName: binding.tenant_name,
      tenantCode: binding.tenant_code,
      mustChangePassword: binding.must_change_password === 1,
    },
  }
}

/** 当前管理员是否已绑定微信 */
async function statusForAdmin(adminAuth) {
  const binding = await bindingModel.findActiveByAdmin(adminAuth.id)
  if (!binding) return { bound: false, binding: null }

  const admin = await adminUserModel.findByIdWithLock(adminAuth.id)
  if (!admin || Number(binding.admin_token_version) !== Number(admin.token_version)) {
    await bindingModel.revoke(binding.id, 'token_version_mismatch')
    return { bound: false, binding: null }
  }

  return {
    bound: true,
    binding: {
      id: binding.id,
      boundAt: binding.bound_at,
      lastUsedAt: binding.last_used_at,
    },
  }
}

/** 解除当前管理员的微信绑定；幂等 */
async function unbind(adminAuth, context = {}) {
  const binding = await bindingModel.findActiveByAdmin(adminAuth.id)
  if (!binding) return { unbound: true }

  await bindingModel.revoke(binding.id, 'manual')

  await operationLog
    .record({
      ...operationLog.fromOperator(adminAuth),
      action: operationLog.ACTIONS.ADMIN_WECHAT_UNBIND,
      targetType: 'admin_user',
      targetId: adminAuth.id,
      detail: { after: { bindingId: binding.id, reason: 'manual' } },
    })
    .catch((err) => logger.warn('写微信解绑日志失败', { bindingId: binding.id, err }))

  return { unbound: true }
}

module.exports = {
  BIND_FRESH_SECONDS,
  ROLE_LABELS,
  bind,
  listForMiniUser,
  wechatLogin,
  statusForAdmin,
  unbind,
}
