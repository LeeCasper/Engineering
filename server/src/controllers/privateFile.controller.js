'use strict'

/**
 * 私有存储文件的签名下载（手写签名、票据照片等）。
 *
 * ── 为什么不挂登录鉴权 ──
 * 这些地址最终要塞进 `<image src>` 或交给微信 `uni.downloadFile`，两者都无法
 * 附带 Authorization 头。与验收报告 PDF 同口径：用短时 HMAC 代替登录态，
 * 谁拿到链接谁在有效期内能看，过期即失效（AC-A20 / AC-L24 的同一取舍）。
 *
 * ── 为什么要单独一个端点 ──
 * 签名图片与票据照片没有业务上的「主键」可签（一条流水可能有多张图），
 * 因此签名内容直接是 storage key。key 由服务端生成、不含用户输入，
 * 且 readPrivate 仍做目录逃逸检查 —— 签名只证明「这是我们签发的链接」，
 * 不证明「这个 key 一定合理」。
 */

const signedUrl = require('../utils/signedUrl')
const storage = require('../storage')
const AppError = require('../utils/AppError')

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  zip: 'application/zip',
}

/** GET /files?key=...&expires=...&sig=... */
async function download(req, res) {
  const key = String(req.query.key || '')

  // 签名校验放在最前：未通过签名的人不该触发任何磁盘访问
  signedUrl.verify({
    resource: 'private-file',
    id: key,
    expires: req.query.expires,
    signature: req.query.sig,
  })

  let buffer
  try {
    buffer = await storage.readPrivate(key)
  } catch (err) {
    if (err.code === 'ENOENT') throw AppError.notFound('文件不存在')
    throw err
  }

  const ext = key.split('.').pop().toLowerCase()
  res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream')
  // 私有内容不进共享缓存；有效期本身由签名控制
  res.setHeader('Cache-Control', 'private, max-age=300')
  res.setHeader('Content-Disposition', 'inline')
  res.send(buffer)
}

module.exports = { download }
