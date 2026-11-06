'use strict'

/**
 * C 端实名认证。
 *
 * ── 两种 provider ──
 *   local  本地校验「姓名格式 + 身份证号校验位 / 出生日期 / 省级行政区」。
 *          它不能证明「姓名与证件号属于同一个人」，接口返回 basic 等级；
 *   aliyun 阿里云实人认证 Id2MetaVerify（姓名 + 身份证号二要素），
 *          返回权威数据源核验结果，接口返回 provider 等级。
 *
 * 本地校验永远先执行：格式/校验位明显错误的输入不必浪费一次付费调用。
 *
 * ── 证件号的生命周期 ──
 * 明文只在 `verify()` 的入参与服务商请求体里存在：校验完立即丢弃，
 * 落库的只有 `id_card_mask`（前 6 后 4）；审计表同样只存脱敏值。
 * 任何日志、错误响应、操作日志都不得出现完整证件号。
 *
 * ── 为什么被邀请后才要求 ──
 * 未被邀请的用户还没有任何协作身份，提前索要身份证号属于超范围收集。
 * `requiresRealNameAuth` 只在存在 pending / active 成员关系时为 true。
 */

const config = require('../../config')
const db = require('../db/pool')
const AppError = require('../utils/AppError')
const idCard = require('../utils/idCard')
const userModel = require('../models/user.model')
const identityVerificationModel = require('../models/identityVerification.model')
const aliyunProvider = require('./realName/aliyun.provider')

const METHOD_LABELS = {
  local: '证件信息校验',
  provider: '服务商核验',
  manual: '人工审核',
}

const LEVEL_LABELS = {
  local: '证件信息校验',
  provider: '服务商二要素核验',
  manual: '人工审核',
}

const PROVIDERS = new Set(['local', 'aliyun'])

/**
 * 启动自检：provider 配置错误时宁可起不来，也不要等到用户提交认证才发现。
 * 由 `server.js` 在 bootstrap 时调用；集成测试直接 require app，不经过这里。
 */
function assertSafeConfig(settings = config.realName) {
  if (!settings.enabled) return

  const provider = settings.provider
  if (!PROVIDERS.has(provider)) {
    throw new Error(
      `REAL_NAME_PROVIDER="${provider}" 不受支持（可选 local / aliyun）`
    )
  }

  if (provider === 'aliyun') {
    const { accessKeyId, accessKeySecret } = settings.aliyun || {}
    if (!accessKeyId || !accessKeySecret) {
      throw new Error(
        'REAL_NAME_PROVIDER=aliyun 时必须配置 ALIYUN_ACCESS_KEY_ID 与 ALIYUN_ACCESS_KEY_SECRET'
      )
    }
  }
}

function ensureAvailable() {
  if (!config.realName.enabled) {
    throw AppError.serviceUnavailable('实名认证暂未开放')
  }

  const provider = config.realName.provider
  if (!PROVIDERS.has(provider)) {
    // 不要静默降级：配置了第三方却仍按本地校验通过，会让用户误以为
    // 已经过服务商核验。宁可报不可用。
    throw AppError.serviceUnavailable('实名认证服务商尚未配置')
  }

  if (provider === 'aliyun') {
    const { accessKeyId, accessKeySecret } = config.realName.aliyun
    if (!accessKeyId || !accessKeySecret) {
      throw AppError.serviceUnavailable('实名认证服务暂不可用，请联系管理员')
    }
  }
}

async function membershipCount(userId) {
  return db.count(
    `FROM project_member
      WHERE user_id = ? AND status IN ('pending', 'active') AND deleted_at IS NULL`,
    [userId]
  )
}

function buildStatus(user, invited) {
  const verified = user.real_name_status === 'verified'
  const method = user.real_name_verify_method
  // 等级必须如实反映实际核验方式：local 不是公安库/服务商核验
  const level = method === 'provider' ? 'provider' : method === 'manual' ? 'manual' : 'local'

  return {
    realName: user.real_name || null,
    realNameStatus: user.real_name_status || 'none',
    verified,
    verifiedAt: user.real_name_verified_at || null,
    verifyMethod: method || null,
    verifyMethodLabel: METHOD_LABELS[method] || null,
    verificationLevel: level === 'local' ? 'basic' : level,
    verificationLevelLabel: LEVEL_LABELS[level],
    // 当前配置的核验通道：前端据此决定「是否会传输给服务商」的提示文案
    provider: config.realName.provider,
    providerLabel: config.realName.provider === 'aliyun' ? '阿里云实人认证' : '本地证件校验',
    idCardMask: user.id_card_mask || null,
    // 被邀请（pending / active）后必须完成认证；未被邀请时仍可自愿认证
    requiresRealNameAuth: invited && !verified,
    consentVersion: config.realName.consentVersion,
    privacyPolicyKey: 'privacy',
  }
}

async function getStatus(userId) {
  const user = await userModel.findById(userId)
  if (!user) throw AppError.notFound('用户不存在')
  const count = await membershipCount(userId)
  return buildStatus(user, count > 0)
}

/**
 * 提交实名认证。
 *
 * 已认证用户重复调用直接返回当前状态（幂等）：网络超时后前端重试不应该
 * 报「不能重复认证」。若姓名与已认证的不一致，返回 409 —— 姓名是验收、
 * 结算单据上的署名，认证后不允许通过这个接口更换。
 */
async function verify(userId, input, context = {}) {
  ensureAvailable()

  const user = await userModel.findById(userId)
  if (!user) throw AppError.notFound('用户不存在')

  const name = idCard.validateRealName(input.realName)
  const document = idCard.validateIdCard(input.idCardNo)
  const nameMasked = idCard.maskRealName(name.normalized || input.realName)
  const idCardMask = idCard.maskIdCard(document.normalized || input.idCardNo)

  if (user.real_name_status === 'verified') {
    if (name.valid && name.normalized !== idCard.normalizeRealName(user.real_name)) {
      throw AppError.conflict('已完成实名认证，姓名不可修改')
    }
    return { ...(await getStatus(userId)), alreadyVerified: true }
  }

  if (!name.valid) {
    await writeAttempt({
      userId,
      nameMasked,
      idCardMask,
      status: 'failed',
      failureCode: name.code,
      failureReason: name.message,
      context,
    })
    throw AppError.badRequest(name.message, { detail: { code: name.code } })
  }

  if (!document.valid) {
    await writeAttempt({
      userId,
      nameMasked,
      idCardMask,
      status: 'failed',
      failureCode: document.code,
      failureReason: document.message,
      context,
    })
    throw AppError.badRequest(document.message, { detail: { code: document.code } })
  }

  const provider = config.realName.provider
  let method = 'local'
  let providerName = 'local'

  if (provider === 'aliyun') {
    method = 'provider'
    providerName = 'aliyun'

    // 成本护栏：阿里云按次计费，通用限流（10 次/分钟）挡不住
    // 用随机证件号持续刷调用。只统计真正发往服务商的尝试。
    const recentCalls = await db.count(
      `FROM identity_verification
        WHERE user_id = ? AND provider = 'aliyun'
          AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [userId]
    )
    if (recentCalls >= config.realName.aliyun.maxAttemptsPerHour) {
      throw AppError.tooManyRequests('实名认证尝试次数过多，请 1 小时后再试')
    }

    let result
    try {
      result = await aliyunProvider.verify({
        realName: name.normalized,
        idCardNo: document.normalized,
      })
    } catch (err) {
      // 网络 / 鉴权 / 欠费 / 限流都不能当成「身份不通过」：
      // 那会把服务故障错误地归因到用户身上。
      await writeAttempt({
        userId,
        nameMasked,
        idCardMask,
        method,
        provider: providerName,
        status: 'failed',
        failureCode: err.code || 'PROVIDER_ERROR',
        failureReason: '服务商调用失败',
        context,
      })
      throw AppError.serviceUnavailable('实名认证服务暂不可用，请稍后重试', {
        cause: err,
      })
    }

    if (!result.passed) {
      await writeAttempt({
        userId,
        nameMasked,
        idCardMask,
        method,
        provider: providerName,
        status: 'failed',
        failureCode: result.code,
        failureReason: result.message,
        context,
      })
      throw AppError.badRequest(result.message, { detail: { code: result.code } })
    }
  }

  await userModel.markRealNameVerified(userId, {
    realName: name.normalized,
    idCardMask,
    method,
  })

  await writeAttempt({
    userId,
    nameMasked,
    idCardMask,
    method,
    provider: providerName,
    status: 'passed',
    context,
  })

  return { ...(await getStatus(userId)), alreadyVerified: false }
}

async function writeAttempt({
  userId,
  nameMasked,
  idCardMask,
  method = 'local',
  provider = 'local',
  status,
  failureCode,
  failureReason,
  context,
}) {
  await identityVerificationModel.create({
    userId,
    nameMasked,
    idCardMask,
    method,
    provider,
    status,
    failureCode: failureCode ? String(failureCode).slice(0, 64) : null,
    failureReason: failureReason ? String(failureReason).slice(0, 100) : null,
    ip: context.ip || null,
    userAgent: context.userAgent ? String(context.userAgent).slice(0, 512) : null,
    requestId: context.requestId || null,
  })
}

module.exports = {
  getStatus,
  verify,
  assertSafeConfig,
  METHOD_LABELS,
}
