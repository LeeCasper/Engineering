'use strict'

/**
 * B 端登录与账号安全（B-1.1 ~ B-1.10）。
 *
 * ── 本文件最核心的设计：校验顺序 ──
 *
 * AC-AD01 要求「密码错误时统一提示『账号或密码错误』，不区分账号是否存在，防止账号枚举」，
 * AC-AD03 要求「连续失败 5 次锁定 15 分钟，锁定期间即使输入正确密码也无法登录」。
 * 两条同时满足的关键在于**先把密码验完，再做其他判断**：
 *
 *   1. 验证码（失败不消耗失败次数，AC-AD02）
 *   2. 查账号
 *   3. 验密码 ← 无论账号是否存在、是否锁定、是否禁用，都走到这一步
 *   4. 密码错误 → 统一 401「账号或密码错误」
 *   5. 密码正确但已锁定 → 401「账号已锁定」
 *   6. 密码正确但已禁用 → 403
 *   7. 通过
 *
 * 若把「锁定 / 禁用」的判断提到第 3 步之前，攻击者不输密码就能通过响应差异
 * 枚举出哪些用户名真实存在 —— 那正是 AC-AD01 要防的。
 *
 * 同理，账号不存在时仍要跑一次 bcrypt.compare（对着一串固定的假哈希），
 * 否则「存在」的响应比「不存在」慢 60ms，时间差同样能枚举账号。
 */

const AppError = require('../utils/AppError')
const password = require('../utils/password')
const jwt = require('../utils/jwt')
const captcha = require('./captcha.service')
const sessions = require('./session.service')
const adminUserModel = require('../models/adminUser.model')
const tenantModel = require('../models/tenant.model')
const loginLogModel = require('../models/adminLoginLog.model')
const adminWechatBindingModel = require('../models/adminWechatBinding.model')

/** AC-AD03 的阈值。写死为常量而非配置项：这是安全策略，不该由后台随手改 */
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

/**
 * 账号不存在时用来消耗时间的假哈希。
 * 值本身无意义，只要是一个合法的 bcrypt 串即可 —— 目的是让 bcrypt.compare
 * 真的跑完一轮，使「账号存在」与「不存在」的耗时一致。
 */
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

/** 统一的密码错误提示（AC-AD01）。这个字符串在代码里只应出现一次 */
const INVALID_CREDENTIALS = '账号或密码错误'

/**
 * 后台登录。
 *
 * @param {object} params
 * @param {string} params.username
 * @param {string} params.password
 * @param {string} params.captchaId
 * @param {string} params.captchaAnswer
 * @param {string} params.ip
 * @returns {Promise<{token: string, expiresIn: string, admin: object, mustChangePassword: boolean}>}
 */
async function login({ username, password: plainPassword, captchaId, captchaAnswer, tenantCode, portal, ip }) {
  // 1. 验证码（AC-AD02）。放在最前面：它挡的是「脚本无脑刷密码」，
  //    因此在任何与账号相关的判断之前就要拦下，且失败不消耗失败次数
  const captchaOk = await captcha.verify(captchaId, captchaAnswer)
  if (!captchaOk) {
    throw AppError.badRequest('验证码错误或已失效')
  }

  // 2. 定位租户（可选）
  //
  // (tenant_key, username) 唯一之后，两家公司都可以有叫 admin 的账号。
  // 登录页从租户二维码/链接里拿到 tenantCode 就传过来；不传时按用户名全局查。
  let tenant = null
  if (tenantCode) {
    tenant = await tenantModel.findByCode(tenantCode)
    // 租户标识写错时不单独报错，按「账号不存在」处理 ——
    // 否则可以拿它枚举「哪些租户存在」
  }

  // 2.5 登录门户约束（M13 后续：平台与租户使用不同地址）
  //
  // 根地址 /login 只服务平台运营；租户管理员必须从 /t/<code>/login 进入。
  // 这里只做「入口是否匹配」的判断，真正的账号归属校验放在密码通过之后 ——
  // 没通过密码的人不该从响应差异里知道某个账号属于租户还是平台。
  if (portal === 'platform' && tenantCode) {
    throw AppError.badRequest('平台登录不需要租户标识')
  }
  if (portal === 'tenant' && !tenantCode) {
    throw AppError.badRequest('请使用租户专属管理地址登录')
  }

  // 3. 查账号。可能命中多条（多个租户各有一个同名账号）
  //
  // 租户门户只在**该租户内**查：这样平台账号、别家租户的同名账号都自然
  // 落进「账号不存在」的通用分支，不会因为响应的提示不同而泄露账号归属。
  const candidates =
    portal === 'tenant'
      ? tenant
        ? await adminUserModel.findForLogin(username, tenant.id)
        : []
      : await adminUserModel.findForLogin(username, tenant ? tenant.id : undefined)
  if (candidates.length > 1) {
    // **不猜。** 取第一条会把人登进别人的公司，而症状是「登录成功但看到的项目全不认识」——
    // 用户只会以为自己进错了系统
    throw AppError.badRequest('该用户名在多个租户下存在，请通过租户专属登录链接进入')
  }

  let admin = candidates[0] || null
  if (admin && tenant && Number(admin.tenant_id) !== Number(tenant.id)) {
    // tenantCode 指向 A，账号却属于 B：退化成「账号不存在」，
    // 让下面的密码校验走 DUMMY_HASH，响应时间与提示都不泄露差异
    admin = null
  }

  // 4. 验密码 —— 账号不存在时也走一遍，抹平响应时间差
  const passwordOk = await password.verify(plainPassword, admin ? admin.password_hash : DUMMY_HASH)

  if (!passwordOk) {
    if (admin) {
      // 已锁定期间不再累加失败次数：否则攻击者可以持续刷新来无限延长锁定，
      // 变成一种「拿别人的账号打我自己的锁定」的骚扰手段
      const locked = isLocked(admin)
      const failedCount = locked ? admin.failed_count : admin.failed_count + 1
      const lockedUntil = locked ? admin.locked_until : computeLockedUntil(admin.failed_count + 1)

      await adminUserModel.updateLoginFailure(admin.id, { failedCount, lockedUntil })
      await loginLogModel.record({
        adminUserId: admin.id,
        tenantId: admin.tenant_id,
        username,
        ip,
        result: 'failed',
        failReason: locked ? '账号锁定期间尝试登录' : `密码错误（第 ${failedCount} 次）`,
      })
    } else {
      await loginLogModel.record({
        adminUserId: null,
        tenantId: tenant ? tenant.id : null,
        username,
        ip,
        result: 'failed',
        failReason: '账号不存在',
      })
    }

    // 对外的提示与外耗时不区分账号是否存在（AC-AD01）
    throw AppError.unauthorized(INVALID_CREDENTIALS)
  }

  // 4. 密码正确之后才暴露账号状态 —— 没通过密码校验的人不该知道这些
  if (isLocked(admin)) {
    await loginLogModel.record({
      adminUserId: admin.id,
      username,
      ip,
      result: 'failed',
      failReason: '账号已锁定',
    })
    const remainMinutes = Math.max(1, Math.ceil((new Date(admin.locked_until) - Date.now()) / 60000))
    throw AppError.unauthorized(`账号已锁定，请在 ${remainMinutes} 分钟后重试`)
  }

  if (admin.status !== 'active') {
    await loginLogModel.record({
      adminUserId: admin.id,
      username,
      ip,
      result: 'failed',
      failReason: '账号已被禁用',
    })
    throw AppError.forbidden('账号已被禁用，请联系超级管理员')
  }

  // 4.2 门户与账号归属（密码已通过，可以给出明确指引）
  if (portal === 'platform' && admin.tenant_id != null) {
    // 不累加 failed_count：密码是对的，这不是一次爆破尝试。
    // 但要留日志 —— 有人在平台入口用租户账号，可能是收藏了旧地址
    await loginLogModel.record({
      adminUserId: admin.id,
      tenantId: admin.tenant_id,
      username,
      ip,
      result: 'failed',
      failReason: '平台入口拒绝了租户账号',
    })
    throw AppError.forbidden('该账号属于租户，请使用所属公司的租户专属管理地址登录')
  }

  if (portal === 'tenant' && (!tenant || Number(admin.tenant_id) !== Number(tenant.id))) {
    // 理论上查账号时已经过滤过；这里再判一次，避免将来有人改查询条件
    // 把租户隔离悄悄拆掉。对外仍是统一的「账号或密码错误」。
    await loginLogModel.record({
      adminUserId: admin.id,
      tenantId: admin.tenant_id,
      username,
      ip,
      result: 'failed',
      failReason: '租户入口与账号归属不一致',
    })
    throw AppError.unauthorized(INVALID_CREDENTIALS)
  }

  // 4.5 租户状态 —— 账号本身正常，但公司停了/到期了也不许进
  if (admin.tenant_id != null) {
    const ownerTenant = tenant && Number(tenant.id) === Number(admin.tenant_id) ? tenant : await tenantModel.findById(admin.tenant_id)
    if (!ownerTenant) throw AppError.forbidden('租户不存在或已退租')
    if (ownerTenant.status !== 'active') throw AppError.forbidden('租户已停用，请联系服务商')
    if (ownerTenant.expires_at && new Date(ownerTenant.expires_at).getTime() < Date.now()) {
      throw AppError.forbidden('租户服务已到期，请联系服务商续费')
    }
  }

  // 5. 通过
  await adminUserModel.resetLoginFailure(admin.id)
  await loginLogModel.record({ adminUserId: admin.id, tenantId: admin.tenant_id, username, ip, result: 'success' })

  return startAdminSession(admin, 'password')
}

/**
 * 签发管理员 token 并建立会话。
 *
 * 密码登录与微信免密登录共用这一段 —— token 载荷、会话键、首登改密标记
 * 任何一处抄错都会造成「某一种登录方式绕过安全限制」。
 *
 * @param {object} admin admin_user 行
 * @param {'password'|'wechat'} authMethod
 */
async function startAdminSession(admin, authMethod = 'password') {
  const mustChangePassword = admin.must_change_password === 1
  const { token, issuedAt, expiresIn } = jwt.signAdmin({
    sub: admin.id,
    username: admin.username,
    role: admin.role,
    // 租户写进 token 便于前端展示；**权限判定仍以回库结果为准**
    // （adminAuth 中间件每次都用库里的 tenant_id，不信 token）
    tid: admin.tenant_id,
    // tv 与库里的 token_version 比对，实现改密/禁用后旧 token 立即失效（AC-AD07/08）
    tv: admin.token_version,
    // 首登强制改密标记，由 adminAuth 中间件限制可访问的接口（AC-AD06）
    mcp: mustChangePassword ? 1 : 0,
    // 登录方式只用于「是否允许绑定新的微信」，不参与授权
    amr: authMethod,
  })

  // 建立会话，支撑 B-1.7 的空闲超时
  await sessions.start(admin.id, issuedAt)

  return {
    token,
    issuedAt,
    expiresIn,
    authMethod,
    mustChangePassword,
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      tenantId: admin.tenant_id,
      mustChangePassword,
    },
  }
}

/** 登出：删掉本 token 的会话键。JWT 本身无法作废，作废的是它的会话 */
async function logout(issuedAt, adminId) {
  await sessions.end(adminId, issuedAt)
}

/**
 * 修改密码。
 *
 * 三个调用场景共用：首登强制改密（AC-AD06，无旧密码）、本人改密（AC-AD48，须验旧密码）、
 * 超管重置下属密码（AC-AD08，无旧密码）。用 requireOldPassword 区分。
 *
 * @param {number} adminId
 * @param {object} params
 * @param {string} [params.oldPassword] requireOldPassword 为 true 时必填
 * @param {string} params.newPassword
 * @param {boolean} [params.requireOldPassword=true]
 */
async function changePassword(adminId, { oldPassword, newPassword, requireOldPassword = true }) {
  const admin = await adminUserModel.findById(adminId, { withPassword: true })
  if (!admin) throw AppError.notFound('账号不存在')

  if (requireOldPassword) {
    if (!oldPassword) throw AppError.badRequest('请输入原密码')
    const ok = await password.verify(oldPassword, admin.password_hash)
    // AC-AD48：旧密码错误时拒绝修改
    if (!ok) throw AppError.badRequest('原密码错误')
  }

  const policy = password.validatePolicy(newPassword)
  if (!policy.ok) throw AppError.badRequest(policy.reason)

  // 新密码不能与原密码相同：否则「强制改密」形同虚设 ——
  // 用户直接再填一遍初始密码就绕过去了
  const sameAsOld = await password.verify(newPassword, admin.password_hash)
  if (sameAsOld) throw AppError.badRequest('新密码不能与原密码相同')

  const passwordHash = await password.hash(newPassword)
  await adminUserModel.updatePassword(adminId, passwordHash)

  // 改密后所有微信免密绑定立即失效。token_version 失配是兜底，
  // 这里主动撤销是为了让「小程序管理入口」立刻消失，而不是等用户点进去才发现失败。
  await adminWechatBindingModel.revokeAllForAdmin(adminId, 'password_changed')

  return { id: adminId }
}

/**
 * 判断账号当前是否处于锁定期。
 *
 * 读的是 admin_user.locked_until 而**不是** Redis：锁定状态必须与账号同生共死，
 * 放缓存里一旦 Redis 重启或被清空，锁定就消失了，攻击者可借此重置计数。
 * 缓存的定位是「可丢失的加速层」，安全状态不属于这一层。
 */
function isLocked(admin) {
  if (!admin || !admin.locked_until) return false
  return new Date(admin.locked_until).getTime() > Date.now()
}

/** 达到阈值才给锁定时间，未达阈值返回 null（表示「只记数，不锁」） */
function computeLockedUntil(nextFailedCount) {
  if (nextFailedCount < MAX_FAILED_ATTEMPTS) return null
  return new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  LOCK_MINUTES,
  INVALID_CREDENTIALS,
  login,
  startAdminSession,
  logout,
  changePassword,
  isLocked,
}
