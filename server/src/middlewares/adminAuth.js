'use strict'

/**
 * B 端鉴权中间件。
 *
 * 每个请求都会查一次 admin_user，这是刻意的：
 * AC-AD07 要求「账号被禁用后，其已签发的 token 在下一次请求时即被拒绝，
 * **无需等待过期**」。JWT 是无状态的，光验签名做不到这一点 —— 必须回库比对现状。
 * 想省这次查询就只能上黑名单缓存，而黑名单在缓存重启后会丢失，
 * 恰恰在最需要它的时候失效。一次主键查询换确定性，是划算的。
 */

const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')
const jwt = require('../utils/jwt')
const sessions = require('../services/session.service')
const platformAccessService = require('../services/platformAccess.service')
const adminUserModel = require('../models/adminUser.model')
const tenantModel = require('../models/tenant.model')
const datetime = require('../utils/datetime')

/** 平台持授权进入租户时，这些方法一律拒绝（只读窗口） */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * 平台用哪个租户上下文访问业务接口。
 *
 * 用请求头而不是查询参数：业务接口自己也会用 `?tenantId=` 做筛选
 * （消息、内容页、订阅），两者同名会互相干扰；而且查询串更容易被
 * 日志、分享链接带出去。
 */
const TENANT_CONTEXT_HEADER = 'X-Tenant-Id'

/**
 * 首登强制改密时，只允许访问的接口（AC-AD06）。
 * 只在前端拦不够：拿到 token 的人可以直接调其他接口。
 */
const PASSWORD_CHANGE_ALLOWLIST = ['/admin/auth/change-password', '/admin/auth/profile', '/admin/auth/logout']

/**
 * 要求 B 端登录态。校验顺序：签名 → 账号存在 → token_version → 状态 → 会话 → 首登改密限制。
 */
async function requireAdmin(req, res, next) {
  try {
    const token = jwt.extractToken(req)
    if (!token) throw AppError.unauthorized()

    const payload = jwt.verifyAdmin(token)
    const admin = await adminUserModel.findById(payload.sub)

    // 账号被删除，或 token_version 不一致（改密 / 禁用 / 重置密码后自增，AC-AD07/08）
    if (!admin) throw AppError.unauthorized()
    if (Number(payload.tv) !== Number(admin.token_version)) throw AppError.unauthorized()
    if (admin.status !== 'active') throw AppError.forbidden('账号已被禁用')

    // ── 租户状态检查（M13）──
    // 账号本身正常，但所属租户被停用或已到期时，后台一律拒绝。
    // 顺序刻意放在密码校验与账号状态之后：先确认「你是这个账号」，
    // 再告诉他「你们公司停用了」，避免用响应差异探测租户状态。
    let tenantName = null
    let tenantCode = null
    if (admin.tenant_id != null) {
      const tenant = await tenantModel.findById(admin.tenant_id)
      if (!tenant) throw AppError.forbidden('租户不存在或已退租')
      if (tenant.status !== 'active') throw AppError.forbidden('租户已停用，请联系服务商')
      if (tenant.expires_at && datetime.parse(tenant.expires_at).valueOf() < Date.now()) {
        throw AppError.forbidden('租户服务已到期，请联系服务商续费')
      }
      tenantName = tenant.name
      tenantCode = tenant.code
    }

    const alive = await sessions.touch(admin.id, payload.iat)
    if (!alive) throw AppError.unauthorized('登录已失效，请重新登录')

    if (Number(payload.mcp) === 1) {
      const path = req.originalUrl.split('?')[0]
      if (!PASSWORD_CHANGE_ALLOWLIST.some((suffix) => path.endsWith(suffix))) {
        throw AppError.forbidden('请先修改初始密码')
      }
    }

    req.auth = {
      type: 'admin',
      id: admin.id,
      username: admin.username,
      role: admin.role,
      // 租户归属。平台账号为 null —— dataScope 靠它区分三层身份
      tenantId: admin.tenant_id ?? null,
      // 平台账号持临时授权时的目标租户，由 requireTenant 在授权校验后写入。
      // 登录时恒为 null，即「平台默认看不到任何租户数据」
      grantedTenantId: null,
      platformGrantId: null,
      tokenIssuedAt: payload.iat,
      // 登录方式只用于「是否允许创建新的微信绑定」，不参与授权。
      // 旧 token 没有 amr 时按密码登录处理。
      authMethod: payload.amr === 'wechat' ? 'wechat' : 'password',
      // 已加载的租户展示信息，供 profile 与小程序管理端使用。
      // 平台账号（tenant_id null）保持 null；平台持授权进入时这是目标租户。
      tenantName,
      tenantCode,
      // 审计用。放在这里而不是让每个 service 再接收一个 context 参数：
      // operation_log 要记 IP 与 requestId（AC-AD09），而 service 层拿到的
      // 就是 req.auth —— 参数从 3 个变成 4 个会牵动所有控制器，
      // 漏传一处就是一条没有 IP 的日志，且不会有任何报错。
      // 这两个字段是**请求级**的，与身份同生共死，放一起最不容易丢。
      ip: req.ip || null,
      requestId: req.id || null,
    }

    return next()
  } catch (err) {
    return next(err)
  }
}

/**
 * 要求租户账号。必须挂在 requireAdmin 之后。
 *
 * 平台账号（`tenant_id IS NULL`）**不能访问任何租户业务接口** ——
 * 项目、模板、配置、内容页、反馈、操作日志、导出、后台账号，全部在租户内。
 *
 * ── 为什么在路由层拒绝，而不是让它查出一片空 ──
 * 空列表看起来"也没泄露什么"，但有两处隐患：
 *   1. `stage_template` 的查询方法在缺 tenantId 时直接抛错，平台调用会变成 500；
 *   2. 业务接口里大量 `WHERE tenant_id = ?`，传入 NULL 会静默退化成
 *      `tenant_id = NULL`（永远不成立），看起来像"没有数据"，
 *      掩盖了"这个角色本来就不该在这里"。
 * 平台要看租户数据，唯一合法入口是 P4 的 `platform_access_grant` 时间窗，
 * 那条路径有独立的中间件与留痕，不与其他业务接口共用。
 */
const requireTenant = asyncHandler(async (req, res, next) => {
  if (!req.auth || req.auth.type !== 'admin') throw AppError.unauthorized()

  // 租户账号：直接放行
  if (req.auth.tenantId != null) return next()

  // tenant_id 为 NULL 的只可能是平台账号
  if (req.auth.role !== 'platform') throw AppError.forbidden('账号租户信息异常，请联系服务商')

  // ── 平台账号：必须显式指定目标租户 ──
  const raw = req.get(TENANT_CONTEXT_HEADER)
  if (!raw) {
    throw AppError.forbidden(
      '平台账号不能直接访问租户业务接口；如需排障，请使用租户授予的临时访问窗口'
    )
  }

  const tenantId = Number(raw)
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw AppError.badRequest(`${TENANT_CONTEXT_HEADER} 必须是正整数`)
  }

  // 先解析授权并留痕，再判断是不是写操作 ——
  // 顺序反过来的话，「平台持授权尝试修改客户数据」这件事不会留下任何记录，
  // 而那正是最需要被审计的动作。写请求同样写一条 platform.access_tenant，
  // 日志里的 method=POST/PUT/DELETE 就是「他试过改」。
  const { grantId } = await platformAccessService.resolveForRequest(req.auth, tenantId, {
    method: req.method,
    // 去掉查询串（见 platformAccess.service 的说明）
    path: req.originalUrl,
    ip: req.ip || null,
    requestId: req.id || null,
  })

  // ── 只读窗口 ──
  // 统一在这里拦，而不是让每个 service 自己判。业务写接口有几十个，
  // 逐个判断是「记得加就安全」；漏掉的那个不会报错，只会安静地改掉客户数据。
  if (WRITE_METHODS.has(req.method)) {
    throw AppError.forbidden('平台账号对租户数据仅可查看，不能修改')
  }

  // ── 把「正在查看的租户」写进 auth ──
  // 下游服务（模板、配置、内容页、后台账号列表）都按 operator.tenantId 取数。
  // 不写这一行，它们会拿着 null 去查询：模板直接抛错变 500，
  // 配置与内容页会读到平台默认版本。平台身份由 role 保留，
  // 写操作已被上面拦掉，因此这里不会让平台获得写权限。
  req.auth.tenantId = tenantId
  req.auth.grantedTenantId = tenantId
  req.auth.platformGrantId = grantId

  return next()
})

/**
 * 要求平台账号。必须挂在 requireAdmin 之后。
 *
 * 平台账号 = `tenant_id IS NULL` 且 `role='platform'`：
 * 我们自己的运营，负责开通租户、调配额，**不参与任何租户的业务操作**。
 */
function requirePlatform(req, res, next) {
  if (!req.auth || req.auth.type !== 'admin') return next(AppError.unauthorized())
  // 角色与租户归属**一起**判断：平台账号的定义是两个条件同时成立。
  // 只看 role 的话，一行被手工改错的数据（role=platform 但 tenant_id 非空）
  // 就能拿到平台入口 —— 而平台入口包含租户的开通与停用
  if (req.auth.role !== 'platform' || req.auth.tenantId != null) {
    return next(AppError.forbidden('仅平台运营可执行此操作'))
  }
  return next()
}

/**
 * 要求租户管理员（原 requireSuperAdmin）。
 *
 * 语义变了：以前是「超级管理员 = 能看全部项目」，现在是「租户内的最高权限」。
 * 租户之间互不可见，因此它**不是**一个跨租户角色。
 */
function requireTenantOwner(req, res, next) {
  if (!req.auth || req.auth.type !== 'admin') return next(AppError.unauthorized())
  if (req.auth.role !== 'owner') return next(AppError.forbidden('仅租户管理员可执行此操作'))
  return next()
}

// 使已签发 token 失效没有独立接口，也不需要：改密与禁用会自增
// admin_user.token_version（见 adminUser.model.js），下一次请求回库比对时自然被拒。
// 不要新增「批量清理缓存会话」之类的函数 —— 缓存抽象只支持精确键删除，
// 会话键里带 iat 无法枚举，写出来只会是一个看着有效、实际什么都没删的假实现。

module.exports = {
  requireAdmin,
  requireTenant,
  requirePlatform,
  requireTenantOwner,
  sessions,
  PASSWORD_CHANGE_ALLOWLIST,
}
