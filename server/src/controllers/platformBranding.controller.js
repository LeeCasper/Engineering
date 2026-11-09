'use strict'

/**
 * 平台运营 · 小程序品牌素材上传。
 *
 * Logo 不直接塞进 sys_config：配置表只存字符串，二进制必须走存储适配器。
 * 上传成功后返回绝对 URL，前端再把它写进 `miniapp_logo` 配置项。
 */

const AppError = require('../utils/AppError')
const { normalizeFiles } = require('../middlewares/upload')
const storage = require('../storage')

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const MAX_FAVICON_BYTES = 1024 * 1024

/** POST /admin/platform/branding/logo（multipart，字段名 logo） */
async function uploadLogo(req, res) {
  const files = normalizeFiles(req.files || [])
  const logo = files.find((file) => file.field === 'logo')

  if (!logo) throw AppError.badRequest('请选择要上传的 Logo 图片')
  if (logo.type !== 'image') throw AppError.badRequest('Logo 必须是 PNG / JPG / WebP 图片')
  if (logo.sizeBytes > MAX_LOGO_BYTES) throw AppError.badRequest('Logo 不得超过 2MB')

  const saved = await storage.save(logo.buffer, { category: 'branding', ext: logo.ext })
  res.ok({ url: saved.url, key: saved.key, sizeBytes: saved.sizeBytes })
}

/**
 * POST /admin/platform/branding/favicon（multipart，字段名 favicon）
 *
 * 使用专门的 singleUploader，因此文件在 `req.file` 而不是 `req.files`。
 * 只接受 ICO / PNG：SVG favicon 同源提供，存在脚本执行风险，刻意不支持。
 */
async function uploadFavicon(req, res) {
  const files = normalizeFiles(req.file ? [req.file] : [])
  const favicon = files.find((file) => file.field === 'favicon')

  if (!favicon) throw AppError.badRequest('请选择要上传的浏览器图标')
  if (favicon.type !== 'image') throw AppError.badRequest('浏览器图标必须是 ICO / PNG 图片')
  if (favicon.sizeBytes > MAX_FAVICON_BYTES) throw AppError.badRequest('浏览器图标不得超过 1MB')

  const saved = await storage.save(favicon.buffer, { category: 'branding', ext: favicon.ext })
  res.ok({ url: saved.url, key: saved.key, sizeBytes: saved.sizeBytes })
}

module.exports = { uploadLogo, uploadFavicon }
