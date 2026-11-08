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
const cache = require('../cache')
const AppError = require('../utils/AppError')
const logger = require('../utils/logger')

const JSCODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session'
const ACCESS_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token'
const STABLE_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/stable_token'
const PHONE_URL = 'https://api.weixin.qq.com/wxa/business/getuserphonenumber'
const SUBSCRIBE_SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send'

/** 调用微信接口的超时。微信偶发慢响应，不设超时会把我们的接口一起拖死 */
const REQUEST_TIMEOUT_MS = 5000

/**
 * access_token 缓存键与安全余量。
 *
 * 微信的 token 有效期 7200 秒，提前 5 分钟过期，避免「刚好在有效期末尾发出请求」。
 * 缓存必须落 Redis（多实例共享）；缓存不可用时降级为每次回源，不影响功能。
 */
const TOKEN_CACHE_KEY = 'wx:access_token'
const TOKEN_EXPIRES_SAFETY_SECONDS = 300

/** 这些错误码表示 token 失效，刷新后可以重试一次 */
const TOKEN_ERROR_CODES = new Set([40001, 40014, 42001])

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

/** 带超时的请求。Node 22 自带 fetch，不引 axios 之类的依赖 */
async function fetchJson(url, { timeoutMs = REQUEST_TIMEOUT_MS, method = 'GET', body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
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

/**
 * 获取 access_token（发订阅消息用）。
 *
 * ── 为什么用 stable_token 而不是 cgi-bin/token ──
 * cgi-bin/token 每次调用都会签发**新的** token 并让旧的失效。多实例部署时，
 * A、B 两个进程各自刷新会互相把对方刚拿到的 token 顶掉，表现为大量 40001。
 * stable_token 在 `force_refresh=false` 时返回当前有效的那一个，多实例并发回源
 * 是安全的；它只在过期或首次调用时签发。（仍回退到 cgi-bin/token：部分
 * 老环境上 stable_token 不可用。）
 *
 * ── 缓存 ──
 * 优先读 Redis（多实例共享）。缓存不可用时只记日志、继续回源 ——
 * 发不出订阅消息不该变成业务错误。
 *
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh] token 失配时强制换新（只用于错误重试）
 * @returns {Promise<string>}
 */
async function getAccessToken({ forceRefresh = false } = {}) {
  if (config.wechat.mock) return null

  if (!forceRefresh) {
    try {
      const cached = await cache.get(TOKEN_CACHE_KEY)
      if (cached) return cached
    } catch (err) {
      logger.warn('读取微信 access_token 缓存失败，改为直接回源', { message: err.message })
    }
  }

  const data = await fetchAccessToken({ forceRefresh })
  const ttl = Math.max(60, Number(data.expires_in || 7200) - TOKEN_EXPIRES_SAFETY_SECONDS)

  try {
    await cache.set(TOKEN_CACHE_KEY, data.access_token, ttl)
  } catch (err) {
    // 缓存写失败只影响下一次要不要再回源，不影响本次使用
    logger.warn('写入微信 access_token 缓存失败', { message: err.message })
  }

  return data.access_token
}

/** 回源获取 token：stable_token 优先，失败时回退 cgi-bin/token */
async function fetchAccessToken({ forceRefresh = false } = {}) {
  try {
    const data = await fetchJson(STABLE_TOKEN_URL, {
      method: 'POST',
      body: {
        grant_type: 'client_credential',
        appid: config.wechat.appid,
        secret: config.wechat.secret,
        force_refresh: Boolean(forceRefresh),
      },
    })

    if (!data.errcode && data.access_token) return data
    logger.warn('stable_token 返回错误，回退 cgi-bin/token', {
      errcode: data.errcode,
      errmsg: data.errmsg,
    })
  } catch (err) {
    logger.warn('stable_token 请求失败，回退 cgi-bin/token', { message: err.message })
  }

  const url =
    `${ACCESS_TOKEN_URL}?grant_type=client_credential` +
    `&appid=${encodeURIComponent(config.wechat.appid)}` +
    `&secret=${encodeURIComponent(config.wechat.secret)}`

  const data = await fetchJson(url)
  if (data.errcode || !data.access_token) {
    // 不把 secret 写进日志；微信返回的 errmsg 里只有错误原因
    logger.error('获取微信 access_token 返回错误', { errcode: data.errcode, errmsg: data.errmsg })
    throw new Error(`获取微信 access_token 失败（${data.errcode || 'empty'}）`)
  }

  return data
}

/**
 * 发送一次性订阅消息。
 *
 * `data` 必须是 `{ 模板关键词: { value } }`，关键词（thing1 / time2 …）来自
 * 公众平台所选模板的详情，不能自造 —— 少一个或多一个都会得到 47003。
 * 关键词到业务字段的映射在 notification.service 的
 * `subscribe_template_<type>_fields` 配置里维护。
 *
 * 失败不抛给业务：返回 `{ ok: false, errcode, errmsg }`，由调用方决定如何记录。
 * 只有网络异常 / 凭据缺失这类「不知道该返回什么错误码」的情况才抛出。
 *
 * @param {object} params
 * @param {string} params.openid
 * @param {string} params.templateId
 * @param {Record<string, {value: string}>} params.data
 * @param {string} [params.page] 点击卡片后的跳转页；默认到消息中心
 * @returns {Promise<{ok: boolean, mocked?: boolean, errcode?: number, errmsg?: string}>}
 */
async function sendSubscribeMessage({ openid, templateId, data, page = 'pages/message/index' }) {
  if (config.wechat.mock) {
    // 测试与本地开发绝不打真实微信接口（CLAUDE.md 第 16 条）
    return { ok: true, mocked: true }
  }

  if (!openid) throw AppError.badRequest('缺少 openid')
  if (!templateId) throw AppError.badRequest('缺少订阅消息模板 ID')
  if (!data || Object.keys(data).length === 0) throw AppError.badRequest('订阅消息数据为空')

  const payload = {
    touser: openid,
    template_id: templateId,
    page,
    data,
  }

  const post = async (token) =>
    fetchJson(`${SUBSCRIBE_SEND_URL}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: payload,
    })

  let result = await post(await getAccessToken())

  // token 可能在缓存期内被微信提前失效（改密、重置 secret、别的系统占用同一 appid）
  if (TOKEN_ERROR_CODES.has(Number(result.errcode))) {
    logger.warn('微信 access_token 失效，刷新后重试一次', { errcode: result.errcode })
    result = await post(await getAccessToken({ forceRefresh: true }))
  }

  if (Number(result.errcode) !== 0) {
    return { ok: false, errcode: result.errcode, errmsg: result.errmsg }
  }

  return { ok: true }
}

module.exports = {
  assertSafeConfig,
  code2session,
  getPhoneNumber,
  getAccessToken,
  sendSubscribeMessage,
  mockSession,
  REQUEST_TIMEOUT_MS,
}
