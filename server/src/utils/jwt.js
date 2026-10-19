'use strict'

/**
 * JWT 签发与校验。
 *
 * 需求文档 §7.1：C 端与 B 端使用**不同的签发策略，互不通用**（AC-AD10）。
 * 这一点靠两件事保证，缺一不可：
 *   1. 两套独立密钥（config.jwt.mini.secret / admin.secret）；
 *   2. 两套独立校验函数 —— 密钥万一被配成同一个值，用同一把钥匙仍能校验通过，
 *      但 payload 里的 `typ` 会拦住跨端复用。
 * 只靠密钥隔离是脆的：环境变量被复制粘贴配错是真实会发生的。
 */

const jwt = require('jsonwebtoken')
const config = require('../../config')
const AppError = require('./AppError')

/** token 来源标识，写进 payload，校验时比对 */
const TYPE_MINI = 'mini'
const TYPE_ADMIN = 'admin'

/**
 * 签发 token。
 *
 * 返回值里带 `issuedAt` 而不是只给字符串：B 端的空闲超时以 iat 作为会话键的一部分
 * （见 session.service.js），重新 decode 一遍去取 iat 是多余的往返。
 *
 * @param {object} payload 业务载荷（如 { sub: 用户 id }）
 * @param {'mini'|'admin'} type
 * @returns {{token: string, issuedAt: number, expiresIn: string}}
 */
function sign(payload, type) {
  const settings = type === TYPE_ADMIN ? config.jwt.admin : config.jwt.mini
  const token = jwt.sign({ ...payload, typ: type }, settings.secret, {
    expiresIn: settings.expiresIn,
    // audience 与 typ 是双重保险：即便将来有人误用同一密钥，audience 也不匹配
    audience: settings.audience,
  })

  return { token, issuedAt: jwt.decode(token).iat, expiresIn: settings.expiresIn }
}

/**
 * 校验 token。
 *
 * @param {string} token
 * @param {'mini'|'admin'} type 期望的端
 * @returns {object} payload
 * @throws {AppError} 401 —— 一律用同一个提示，不区分「过期」「签名错」「端不对」。
 *   区分开等于告诉调用方「这个 token 是真的只是过期了」，对攻击者是无偿的信息。
 */
function verifyRaw(token, type) {
  const settings = type === TYPE_ADMIN ? config.jwt.admin : config.jwt.mini

  let payload
  try {
    payload = jwt.verify(token, settings.secret, { audience: settings.audience })
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      throw AppError.unauthorized('登录已过期，请重新登录')
    }
    throw AppError.unauthorized()
  }

  // 跨端使用：B 端 token 拿去调小程序接口（或反之）一律 401（AC-AD10）
  if (payload.typ !== type) {
    throw AppError.unauthorized()
  }

  return payload
}

/** 签发 C 端（小程序）token，返回 { token, issuedAt, expiresIn } */
function signMini(payload) {
  return sign(payload, TYPE_MINI)
}

/** 校验 C 端 token */
function verifyMini(token) {
  return verifyRaw(token, TYPE_MINI)
}

/** 签发 B 端（后台）token，返回 { token, issuedAt, expiresIn } */
function signAdmin(payload) {
  return sign(payload, TYPE_ADMIN)
}

/** 校验 B 端 token */
function verifyAdmin(token) {
  return verifyRaw(token, TYPE_ADMIN)
}

/**
 * 从 Authorization 头里取出 token。
 * 只接受 `Bearer <token>` 形式，不做「直接放裸 token 也认」的兼容 ——
 * 多一种解析方式就多一处可能与网关/前端约定不一致的地方。
 *
 * @returns {string|null}
 */
function extractToken(req) {
  const header = req.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

module.exports = {
  TYPE_MINI,
  TYPE_ADMIN,
  signMini,
  verifyMini,
  signAdmin,
  verifyAdmin,
  extractToken,
}
