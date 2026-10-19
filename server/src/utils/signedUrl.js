'use strict'

/**
 * 带签名的临时访问链接（§8.2 / AC-A20）。
 *
 * ── 为什么不用「登录鉴权」而要签名 ──
 * 验收报告 PDF 要能**转发**给不在系统里的人（律师、物业、家人）。
 * 若走登录鉴权，转发出去对方打不开；若完全不设防，链接一旦泄露就是永久泄露。
 * 签名 URL 是这两者之间的取舍：2 小时内谁拿到都能看，过期即失效。
 *
 * ── 签名内容里必须包含「资源」与「过期时间」──
 * 只签 id 的话，同一个签名能拿去访问任何资源；
 * 不签过期时间的话，签一次就永久有效。
 * 两者都签，并用 HMAC 而不是简单哈希 —— 简单哈希（如 md5(id+secret)）
 * 在已知一个合法签名与明文时无法伪造别的，但一旦实现里出现长度扩展或拼接歧义
 * 就会出问题；HMAC 是为此设计的标准构造，没有理由不用它。
 */

const crypto = require('node:crypto')
const config = require('../../config')
const AppError = require('./AppError')

/**
 * 生成签名。
 *
 * @param {object} params
 * @param {string} params.resource 资源类型，如 'acceptance-report'
 * @param {number|string} params.id 资源 id
 * @param {number} [params.ttlSeconds] 有效期，默认取配置（2 小时）
 * @returns {{expires: number, signature: string, expiresInSeconds: number}}
 */
function sign({ resource, id, ttlSeconds }) {
  const ttl = ttlSeconds || config.signedUrl.ttlSeconds
  // 用秒级时间戳而不是毫秒：URL 更短，且 2 小时的有效期不需要毫秒精度
  const expires = Math.floor(Date.now() / 1000) + ttl
  const signature = computeSignature(resource, id, expires)

  return { expires, signature, expiresInSeconds: ttl }
}

/**
 * 校验签名。
 *
 * @throws {AppError} 403 —— 过期与签名错误**用同一个错误码但不同文案**。
 *   过期要告诉用户「链接已失效，请重新获取」，这是可恢复的正常状态；
 *   签名错误则说明链接被篡改，不该给出可利用的细节。
 */
function verify({ resource, id, expires, signature }) {
  const expiry = Number(expires)
  if (!Number.isFinite(expiry)) throw AppError.forbidden('链接无效')

  if (Math.floor(Date.now() / 1000) > expiry) {
    throw AppError.forbidden('链接已过期，请重新获取')
  }

  const expected = computeSignature(resource, id, expiry)

  // 定长比较，避免通过响应时间逐字节猜签名
  const a = Buffer.from(String(signature || ''), 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw AppError.forbidden('链接无效')
  }

  return true
}

function computeSignature(resource, id, expires) {
  return crypto
    .createHmac('sha256', config.signedUrl.secret)
    .update(`${resource}:${id}:${expires}`)
    .digest('hex')
}

/**
 * 拼完整的带签链接。
 * 返回**相对路径**而不是绝对地址 —— 由调用方按自己的对外域名拼接，
 * 服务端配置的 PUBLIC_BASE_URL 在反向代理后面往往不是最终用户看到的域名。
 */
function buildPath({ resource, id, path, ttlSeconds }) {
  const { expires, signature } = sign({ resource, id, ttlSeconds })
  return `${path}?expires=${expires}&sig=${signature}`
}

module.exports = { sign, verify, buildPath, computeSignature }
