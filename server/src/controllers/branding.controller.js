'use strict'

/**
 * C 端公开品牌信息。
 *
 * 登录前就要展示小程序名称与 Logo，因此**不能要求登录**；只返回平台品牌配置，
 * 不读取任何租户数据。Logo 为空时返回 null，由小程序回落到内置资源。
 */

const config = require('../../config')
const sysConfigService = require('../services/sysConfig.service')

async function detail(req, res) {
  const name = await sysConfigService.getRaw(null, 'miniapp_name')
  const storedLogo = await sysConfigService.getRaw(null, 'miniapp_logo')

  // 允许在通用配置页手工填 `/uploads/...`；对外统一补成绝对地址，
  // 否则小程序的 <image> 会相对小程序包解析，必然 404。
  const logoUrl = storedLogo
    ? storedLogo.startsWith('/')
      ? `${config.upload.publicBaseUrl}${storedLogo}`
      : storedLogo
    : null

  res.set('Cache-Control', 'public, max-age=60')
  res.ok({
    name: name || '柏总管',
    logoUrl,
  })
}

module.exports = { detail }
