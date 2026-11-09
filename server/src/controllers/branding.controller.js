'use strict'

/**
 * C 端公开品牌信息。
 *
 * 登录前就要展示小程序名称与 Logo，因此**不能要求登录**；只返回平台品牌配置，
 * 不读取任何租户数据。Logo 为空时返回 null，由小程序回落到内置资源。
 */

const config = require('../../config')
const sysConfigService = require('../services/sysConfig.service')

/**
 * 允许在通用配置页手工填 `/uploads/...`；对外统一补成绝对地址，
 * 否则小程序的 <image> 会相对小程序包解析，必然 404。
 */
function absoluteUrl(value) {
  if (!value) return null
  return value.startsWith('/') ? `${config.upload.publicBaseUrl}${value}` : value
}

/**
 * 管理后台的 URL 只补 `/uploads/...`。
 *
 * 与小程序不同：后台默认 favicon 是 SPA 自己的 `/favicon.svg`，
 * 如果也按「任意 `/` 开头」补成 API 域名，会变成 API 服务器上的
 * `/favicon.svg`（不存在）。因此只处理本系统上传目录。
 */
function adminAssetUrl(value) {
  const text = String(value || '').trim()
  if (!text) return null
  return text.startsWith(`${config.upload.publicPath}/`)
    ? `${config.upload.publicBaseUrl}${text}`
    : text
}

async function detail(req, res) {
  const name = await sysConfigService.getRaw(null, 'miniapp_name')
  const storedLogo = await sysConfigService.getRaw(null, 'miniapp_logo')

  res.set('Cache-Control', 'public, max-age=60')
  res.ok({
    name: name || '柏总管',
    logoUrl: absoluteUrl(storedLogo),
  })
}

/**
 * 管理后台品牌（B-7.13）。
 *
 * 必须公开：登录页在拿到 token 之前就要显示名称 / Logo / 浏览器图标。
 * 与小程序 `/branding` 分开，避免改变小程序既有响应结构；
 * 后台配置随时可能被运营修改，因此不使用浏览器缓存。
 */
async function adminDetail(req, res) {
  const [name, storedLogo, storedFavicon] = await Promise.all([
    sysConfigService.getRaw(null, 'admin_name'),
    sysConfigService.getRaw(null, 'admin_logo'),
    sysConfigService.getRaw(null, 'admin_favicon'),
  ])

  res.set('Cache-Control', 'no-store')
  res.ok({
    name: name || '工程宝管理后台',
    logoUrl: adminAssetUrl(storedLogo),
    faviconUrl: adminAssetUrl(storedFavicon),
  })
}

module.exports = { detail, adminDetail }
