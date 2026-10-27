'use strict'

/**
 * 电子签配置自检。
 *
 * 可靠电子签名是**可选能力**，默认关闭；关闭时走手写签名（仅项目内部确认，
 * 不具备法律效力）。开启后必须配置服务商，生产禁止 mock，且不再接受手写兜底。
 * 三种环境都必须保留至少一种签名方式，否则业主无法完成验收。
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
  return Boolean(config.esign.enabled)
}

/** 是否允许手写签名（仅在可靠电子签关闭时；不具备法律效力） */
function legacyAllowed() {
  return !isRequired() && Boolean(config.esign.legacySigning)
}

function assertSafeConfig() {
  const provider = providerName()

  if (isInside(config.esign.privateDir, config.upload.dir)) {
    throw new Error('ESIGN_PRIVATE_DIR 不能位于 UPLOAD_DIR 内，否则私有证据会被静态服务暴露')
  }

  if (!config.esign.enabled) {
    if (!config.esign.legacySigning) {
      throw new Error('未启用可靠电子签时必须允许手写签名（ESIGN_LEGACY_SIGNING=true），否则验收无法完成')
    }
    return true
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
