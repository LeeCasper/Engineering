'use strict'

/**
 * 密码哈希与策略。
 *
 * AC-AD04 要求「bcrypt 加盐哈希存储；代码、日志、接口响应中均无明文密码」，
 * AC-AD49 要求策略生效：少于 8 位或纯字母 / 纯数字的密码被拒绝。
 *
 * 用 bcryptjs 而非原生 bcrypt：前者是纯 JS 实现，不需要 node-gyp 编译，
 * 部署时少一类「换台机器就装不上」的故障。代价是慢一些，但登录频率下无感。
 */

const bcrypt = require('bcryptjs')
const config = require('../../config')

/**
 * cost 默认 10：约 45ms/次。调到 12 会让登录接口 P95（§8.1 要求 ≤500ms）变得紧张。
 * 测试环境配置为低值以缩短用例耗时 —— 见 config.security.bcryptRounds 的说明。
 */
const SALT_ROUNDS = config.security.bcryptRounds

const MIN_LENGTH = 8

/**
 * 判断 bcrypt cost 配置是否安全。
 *
 * 抽成接收参数的纯函数（而不是直接读 config）是为了可测：
 * `config` 是深冻结的，测试无法临时改 `bcryptRounds` 来验证这条守卫，
 * 而「生产环境把 cost 调低」恰恰是最需要被测试盯住的一处 ——
 * 它在开发期看着完全无害（测试确实更快了）。
 *
 * @param {object} params
 * @param {boolean} params.isProd
 * @param {number} params.rounds
 * @param {number} params.minimum
 * @throws {Error} 生产环境 cost 低于下限
 */
function checkBcryptRounds({ isProd, rounds, minimum }) {
  if (!isProd) return true

  if (!Number.isInteger(rounds) || rounds < minimum) {
    throw new Error(
      `生产环境的 BCRYPT_ROUNDS=${rounds} 低于安全下限 ${minimum}。` +
        '过低的 cost 会显著降低离线爆破成本，请改回 10 或更高'
    )
  }
  return true
}

/**
 * 生产环境的安全自检。
 *
 * 由 server.js 在启动时调用。**把危险配置变成「起不来」，比写在文档里靠人记得可靠**。
 */
function assertSecureConfig() {
  return checkBcryptRounds({
    isProd: config.isProd,
    rounds: config.security.bcryptRounds,
    minimum: config.security.bcryptRoundsMin,
  })
}

/**
 * 校验密码是否满足策略（B-1.6 / AC-AD49）。
 *
 * 注意这里**只校验强度，不校验是否与用户名相同** —— 后者需要用户名，
 * 而本函数被注册、重置、改密三处复用，签名保持单一职责更省事。
 *
 * @param {string} plain 明文密码
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function validatePolicy(plain) {
  if (plain === null || plain === undefined || plain === '') {
    return { ok: false, reason: '密码不能为空' }
  }

  const value = String(plain)

  if (value.length < MIN_LENGTH) {
    return { ok: false, reason: `密码长度不得少于 ${MIN_LENGTH} 位` }
  }

  // 上限不是安全考虑，是防御：bcrypt 只取前 72 字节，
  // 超长密码会被静默截断，不如直接拒绝
  if (Buffer.byteLength(value, 'utf8') > 72) {
    return { ok: false, reason: '密码过长（不超过 72 字节）' }
  }

  if (!/[A-Za-z]/.test(value)) {
    return { ok: false, reason: '密码必须同时包含字母与数字' }
  }
  if (!/\d/.test(value)) {
    return { ok: false, reason: '密码必须同时包含字母与数字' }
  }

  return { ok: true }
}

/** 生成哈希。返回的字符串含算法、cost 与盐，可直接入库 */
async function hash(plain) {
  return bcrypt.hash(String(plain), SALT_ROUNDS)
}

/**
 * 校验密码。
 *
 * 始终走 bcrypt.compare，不做「长度不等就直接返回 false」之类的短路 ——
 * 那会让「密码错误」的响应时间随密码长度变化，从而泄漏信息。
 * compare 本身就是在恒定时间内比较的。
 */
async function verify(plain, hashValue) {
  if (!plain || !hashValue) return false
  try {
    return await bcrypt.compare(String(plain), String(hashValue))
  } catch {
    // 库里存了非法哈希串（历史脏数据）时不该让登录接口 500
    return false
  }
}

module.exports = {
  SALT_ROUNDS,
  MIN_LENGTH,
  validatePolicy,
  hash,
  verify,
  checkBcryptRounds,
  assertSecureConfig,
}
