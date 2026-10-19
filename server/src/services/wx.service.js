'use strict'

/**
 * 微信小程序服务端接口封装。
 *
 * ── 关于 mock 模式 ──
 * 本机开发没有 AppID / AppSecret，若不做处理，`/auth/login` 永远返回失败，
 * 整个 C 端链路（含集成测试、冒烟脚本）都跑不起来。因此 `WX_MOCK=true` 时
 * 跳过 code2session，改为由 code 派生一个稳定的 openid。
 *
 * **这个开关在生产环境等于不设防** —— 任何人都能伪造任意 openid 登录成别人。
 * 因此除了这里的分支判断，`server.js` 启动时会做一次硬校验：
 * `NODE_ENV=production` 且 `WX_MOCK=true` 直接拒绝启动（见 assertSafeConfig）。
 * 把「危险配置」变成「起不来」，比写在文档里靠人记得要可靠。
 */

const crypto = require('node:crypto')
const config = require('../../config')
const AppError = require('../utils/AppError')
const logger = require('../utils/logger')

const JSCODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session'
const ACCESS_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token'
const PHONE_URL = 'https://api.weixin.qq.com/wxa/business/getuserphonenumber'

/** 调用微信接口的超时。微信偶发慢响应，不设超时会把我们的接口一起拖死 */
const REQUEST_TIMEOUT_MS = 5000

/**
 * 启动期安全自检。由 server.js 调用，失败则拒绝启动。
 *
 * @throws {Error}
 */
function assertSafeConfig() {
  if (config.isProd && config.wechat.mock) {
    throw new Error(
      '生产环境禁止开启 WX_MOCK：任何人都能伪造 openid 登录成他人。' +
        '请配置真实的 WX_APPID / WX_SECRET 并设置 WX_MOCK=false'
    )
  }
  if (!config.wechat.mock && (!config.wechat.appid || !config.wechat.secret)) {
    throw new Error('WX_MOCK=false 时必须配置 WX_APPID 与 WX_SECRET')
  }
}

/** 带超时的 GET。Node 22 自带 fetch，不引 axios 之类的依赖 */
async function fetchJson(url, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 用 code 换 openid / session_key。
 *
 * @param {string} code 小程序端 wx.login() 拿到的 code
 * @returns {Promise<{openid: string, unionid: string|null, sessionKey: string|null}>}
 */
async function code2session(code) {
  if (!code) throw AppError.badRequest('缺少登录凭证 code')

  if (config.wechat.mock) {
    return mockSession(code)
  }

  const url =
    `${JSCODE2SESSION_URL}?appid=${encodeURIComponent(config.wechat.appid)}` +
    `&secret=${encodeURIComponent(config.wechat.secret)}` +
    `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`

  let data
  try {
    data = await fetchJson(url)
  } catch (err) {
    // 不把微信的原始错误抛给客户端：既看不懂，也可能带上我们的 appid
    logger.error('调用 jscode2session 失败', { code: err.code, message: err.message })
    throw AppError.internal('微信登录服务暂时不可用，请稍后重试', { cause: err })
  }

  if (data.errcode) {
    // 40029 = code 无效（多为重复使用同一个 code），属于用户侧可解释的错误
    if (data.errcode === 40029) throw AppError.badRequest('登录凭证已失效，请重新登录')
    logger.error('jscode2session 返回错误', { errcode: data.errcode, errmsg: data.errmsg })
    throw AppError.unauthorized('微信登录失败')
  }

  return {
    openid: data.openid,
    unionid: data.unionid || null,
    sessionKey: data.session_key || null,
  }
}

/**
 * mock 会话：由 code 派生一个稳定的 openid。
 *
 * 「稳定」很关键：同一个 code 永远得到同一个 openid，
 * 这样集成测试与冒烟脚本可以重复执行且状态可预期。
 * 若每次随机生成，重跑测试就会不断创建新用户，所有断言都变得不可复现。
 */
function mockSession(code) {
  const digest = crypto.createHash('sha256').update(`renovation-mock:${code}`).digest('hex')
  return {
    openid: `mock_${digest.slice(0, 28)}`,
    unionid: null,
    sessionKey: null,
  }
}

/**
 * 用 getPhoneNumber 返回的 code 换取手机号。
 *
 * 微信侧是两步：先用 appid/secret 换 access_token，再用 code 换手机号。
 * access_token 有 2 小时有效期且**全局唯一**，多实例同时刷新会让先拿到的那份失效，
 * 因此这里每次调用都重新取。这是用配额换正确性的取舍 ——
 * 登录绑定手机号是低频操作，多几次 cgi-bin/token 调用不构成问题；
 * 而缓存 access_token 若不落 Redis，多实例下必然互相顶掉。
 */
async function getPhoneNumber(code) {
  if (!code) throw AppError.badRequest('缺少手机号凭证 code')

  const tokenUrl =
    `${ACCESS_TOKEN_URL}?grant_type=client_credential` +
    `&appid=${encodeURIComponent(config.wechat.appid)}` +
    `&secret=${encodeURIComponent(config.wechat.secret)}`

  const tokenData = await fetchJson(tokenUrl).catch((err) => {
    logger.error('获取微信 access_token 失败', { message: err.message })
    throw AppError.internal('微信服务暂时不可用，请稍后重试', { cause: err })
  })
  if (tokenData.errcode || !tokenData.access_token) {
    logger.error('获取微信 access_token 返回错误', { errcode: tokenData.errcode, errmsg: tokenData.errmsg })
    throw AppError.internal('微信服务暂时不可用，请稍后重试')
  }

  const res = await fetch(`${PHONE_URL}?access_token=${encodeURIComponent(tokenData.access_token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }).catch((err) => {
    logger.error('获取手机号请求失败', { message: err.message })
    throw AppError.internal('微信服务暂时不可用，请稍后重试', { cause: err })
  })

  const data = await res.json()
  if (data.errcode !== 0 || !data.phone_info) {
    logger.error('获取手机号返回错误', { errcode: data.errcode, errmsg: data.errmsg })
    throw AppError.badRequest('手机号获取失败，请重试')
  }

  return data.phone_info.purePhoneNumber || data.phone_info.phoneNumber
}

module.exports = { assertSafeConfig, code2session, getPhoneNumber, mockSession, REQUEST_TIMEOUT_MS }
