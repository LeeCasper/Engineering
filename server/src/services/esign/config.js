'use strict'

/**
 * 电子签配置自检。
 *
 * 这不是普通的“功能开关”：生产环境如果没有可靠电子签名配置，业主验收
 * 不应该继续可用旧的签名图片。因此生产环境缺配置时**拒绝启动**，
 * 而不是降级成 legacy。开发/测试保留 legacy，保证既有测试可跑。
 */

const path = require('node:path')
const config = require('../../../config')

function isInside(child, parent) {
  const c = path.resolve(child)
  const p = path.resolve(parent)
  return c === p || c.startsWith(`${p}${path.sep}`)
}

function providerName() {
  return String(config.esign.provider || '').trim().toLowerCase()
}

/** 当前环境是否要求业主必须使用可靠电子签名 */
function isRequired() {
  return config.isProd || config.esign.enabled
}

/** 是否允许旧的手写签名图片（仅非生产） */
function legacyAllowed() {
  return !config.isProd && config.esign.legacySigning
}

function assertSafeConfig() {
  const provider = providerName()

  if (isInside(config.esign.privateDir, config.upload.dir)) {
    throw new Error('ESIGN_PRIVATE_DIR 不能位于 UPLOAD_DIR 内，否则私有证据会被静态服务暴露')
  }

  if (!config.esign.enabled) {
    if (config.isProd) {
      throw new Error('生产环境必须启用 ESIGN_ENABLED；禁止回退到手写签名图片')
    }
    return true
  }

  if (config.isProd && config.esign.legacySigning) {
    throw new Error('生产环境禁止 ESIGN_LEGACY_SIGNING=true')
  }

  if (!provider) {
    throw new Error('ESIGN_ENABLED=true 时必须配置 ESIGN_PROVIDER')
  }

  if (provider === 'mock') {
    if (config.isProd) throw new Error('生产环境禁止 ESIGN_PROVIDER=mock')
    return true
  }

  if (!['tencent'].includes(provider)) {
    throw new Error(`电子签服务商 ${provider} 的适配器尚未实现；当前可用：tencent / mock`)
  }

  if (!config.esign.appId || !config.esign.appSecret) {
    throw new Error('ESIGN_APP_ID / ESIGN_APP_SECRET 未配置')
  }
  if (!config.esign.callbackSecret) {
    throw new Error('ESIGN_CALLBACK_SECRET 未配置')
  }
  if (!config.esign.callbackUrl) {
    throw new Error('ESIGN_CALLBACK_URL 未配置')
  }
  if (config.isProd && !config.esign.callbackUrl.startsWith('https://')) {
    throw new Error('生产环境 ESIGN_CALLBACK_URL 必须是 https')
  }
  if (!config.esign.apiBase) {
    throw new Error('ESIGN_API_BASE 未配置')
  }
  if (provider === 'tencent' && !config.esign.operatorId) {
    throw new Error('腾讯电子签必须配置 ESIGN_OPERATOR_ID（发起人 UserId）')
  }

  return true
}

module.exports = {
  assertSafeConfig,
  isRequired,
  legacyAllowed,
  providerName,
}
