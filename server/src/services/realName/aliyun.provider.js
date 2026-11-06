'use strict'

/**
 * 阿里云实人认证 · 身份二要素核验（Id2MetaVerify）。
 *
 * ── 为什么手写签名而不装 SDK ──
 * 项目只需要一个接口，引入 `@alicloud/cloudauth20190307` 会带进一长串
 * tea/openapi 依赖；而阿里云 OpenAPI V3 的签名规则足够小，手写可以用
 * 固定向量测试锁住。签名实现见 `signRequest()`。
 *
 * ── 请求形态 ──
 * RPC 风格：POST `/`，`x-acs-action: Id2MetaVerify`、`x-acs-version: 2019-03-07`，
 * 参数放在 `application/x-www-form-urlencoded` body 里。
 *
 * ── 安全边界 ──
 * - AccessKey 只从服务端配置读取，不下发前端、不写日志；
 * - 姓名与证件号只出现在请求体里，错误信息不拼接入参；
 * - 任何网络/鉴权/服务端错误都抛 `AliyunRealNameError`，由调用方转成 503，
 *   不能当成「核验不通过」——那会把服务故障误报成用户身份有问题。
 */

const crypto = require('node:crypto')

const ACTION = 'Id2MetaVerify'
const VERSION = '2019-03-07'
const CONTENT_TYPE = 'application/x-www-form-urlencoded'

class AliyunRealNameError extends Error {
  /**
   * @param {string} message 面向服务端的错误描述，**不得包含姓名/证件号**
   * @param {{code?:string, retryable?:boolean, cause?:Error}} [options]
   */
  constructor(message, { code = 'PROVIDER_ERROR', retryable = true, cause } = {}) {
    super(message)
    this.name = 'AliyunRealNameError'
    this.code = code
    this.retryable = retryable
    this.cause = cause
  }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmacSha256Hex(secret, value) {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('hex')
}

/** RFC 3986 编码：encodeURIComponent 会漏掉 ! ' ( ) *，阿里云要求一并编码 */
function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%7E/g, '~')
}

/** 阿里云要求 UTC、秒级、以 Z 结尾 */
function formatDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || '').trim()
  if (!value) throw new AliyunRealNameError('未配置阿里云实名认证地址', { code: 'CONFIG', retryable: false })
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

/** 查询串按名称、值分别做 RFC 3986 编码后排序 */
function canonicalQueryString(search) {
  const params = new URLSearchParams(search || '')
  return [...params.entries()]
    .map(([name, value]) => [percentEncode(name), percentEncode(value)])
    .sort(([aName, aValue], [bName, bValue]) => {
      if (aName !== bName) return aName < bName ? -1 : 1
      return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
    })
    .map(([name, value]) => `${name}=${value}`)
    .join('&')
}

/**
 * 构造 V3 签名（ACS3-HMAC-SHA256）。
 *
 * 导出是为了单测能直接断言 canonical request / signed headers，
 * 不需要真的发请求。
 *
 * @param {object} params
 * @param {string} params.method
 * @param {string} params.path
 * @param {string} [params.query]
 * @param {Record<string,string>} params.headers 参与签名的请求头（可含 host）
 * @param {string} params.body
 * @param {string} params.accessKeyId
 * @param {string} params.accessKeySecret
 * @returns {{authorization:string, canonicalRequest:string, stringToSign:string,
 *   signature:string, signedHeaders:string, payloadHash:string}}
 */
function signRequest({ method, path, query = '', headers, body, accessKeyId, accessKeySecret }) {
  const payloadHash = sha256Hex(body)

  // 所有参与签名的头：小写、去首尾空格、按名称升序
  const normalized = Object.entries(headers)
    .map(([name, value]) => [String(name).toLowerCase(), String(value).trim()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const canonicalHeaders = normalized.map(([name, value]) => `${name}:${value}\n`).join('')
  const signedHeaders = normalized.map(([name]) => name).join(';')

  // CanonicalHeaders 末尾已经有换行，这里再补一个，形成官方示例里的空行
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = `ACS3-HMAC-SHA256\n${sha256Hex(canonicalRequest)}`
  const signature = hmacSha256Hex(accessKeySecret, stringToSign)

  return {
    authorization: `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`,
    canonicalRequest,
    stringToSign,
    signature,
    signedHeaders,
    payloadHash,
  }
}

function parseResponseBody(text) {
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new AliyunRealNameError('实名认证服务返回了无法解析的数据', {
      code: 'INVALID_RESPONSE',
      cause: err,
    })
  }
}

function mapBizCode(bizCode) {
  switch (String(bizCode)) {
    case '1':
      return { passed: true, code: 'MATCHED', message: '实名认证通过' }
    case '2':
      return { passed: false, code: 'MISMATCH', message: '姓名与身份证号不一致，请核对后重试' }
    case '3':
      return { passed: false, code: 'NOT_FOUND', message: '未查到该身份信息，请核对姓名与身份证号' }
    default:
      return { passed: false, code: 'UNKNOWN', message: '实名认证未通过，请稍后重试' }
  }
}

/**
 * 调用阿里云二要素核验。
 *
 * @param {{realName:string, idCardNo:string}} input
 * @param {object} [options]
 * @param {object} [options.settings] 覆盖配置（测试用）
 * @param {Function} [options.fetchImpl] 覆盖 fetch（测试用）
 * @returns {Promise<{passed:boolean, code:string, message:string,
 *   bizCode:string|null, requestId:string|null, provider:'aliyun'}>}
 */
async function verify(input, options = {}) {
  const settings = { ...require('../../../config').realName.aliyun, ...(options.settings || {}) }
  const fetchImpl = options.fetchImpl || globalThis.fetch

  if (!settings.accessKeyId || !settings.accessKeySecret) {
    throw new AliyunRealNameError('阿里云实名认证 AccessKey 未配置', {
      code: 'CONFIG',
      retryable: false,
    })
  }
  if (typeof fetchImpl !== 'function') {
    throw new AliyunRealNameError('当前运行环境不支持 fetch', {
      code: 'CONFIG',
      retryable: false,
    })
  }

  let url
  try {
    url = new URL(normalizeEndpoint(settings.endpoint))
  } catch (err) {
    throw new AliyunRealNameError('阿里云实名认证地址配置不正确', {
      code: 'CONFIG',
      retryable: false,
      cause: err,
    })
  }

  const body = new URLSearchParams({
    ParamType: 'normal',
    IdentifyNum: String(input.idCardNo || ''),
    UserName: String(input.realName || ''),
  }).toString()

  const headers = {
    host: url.host,
    'content-type': CONTENT_TYPE,
    'x-acs-action': ACTION,
    'x-acs-version': VERSION,
    'x-acs-date': formatDate(options.now || new Date()),
    // 阿里云示例使用 32 位十六进制；UUID 带连字符不一定被所有网关接受
    'x-acs-signature-nonce': options.nonce || crypto.randomBytes(16).toString('hex'),
    'x-acs-content-sha256': sha256Hex(body),
  }

  const signed = signRequest({
    method: 'POST',
    path: url.pathname || '/',
    query: canonicalQueryString(url.search),
    headers,
    body,
    accessKeyId: settings.accessKeyId,
    accessKeySecret: settings.accessKeySecret,
  })

  // host 由 fetch 自动设置；其余签名头显式发送
  const requestHeaders = {
    'content-type': CONTENT_TYPE,
    'x-acs-action': ACTION,
    'x-acs-version': VERSION,
    'x-acs-date': headers['x-acs-date'],
    'x-acs-signature-nonce': headers['x-acs-signature-nonce'],
    'x-acs-content-sha256': headers['x-acs-content-sha256'],
    authorization: signed.authorization,
  }

  const controller = new AbortController()
  const timeoutMs = Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : 8000
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response
  let text
  try {
    response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: requestHeaders,
      body,
      signal: controller.signal,
      // 不跟随重定向：签名只对当前 host 有效，跟到别的域名等于把 AK 签名带过去
      redirect: 'error',
    })
    text = await response.text()
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new AliyunRealNameError('实名认证服务响应超时', { code: 'TIMEOUT', cause: err })
    }
    throw new AliyunRealNameError('实名认证服务网络异常', { code: 'NETWORK', cause: err })
  } finally {
    clearTimeout(timer)
  }

  const payload = parseResponseBody(text)
  const code = String(payload.Code ?? payload.code ?? '')
  const message = String(payload.Message ?? payload.message ?? '')

  if (!response.ok || code !== '200') {
    // 鉴权失败、欠费、限流等都属于「服务不可用」，不是身份核验不通过
    throw new AliyunRealNameError(
      `阿里云实名认证调用失败（${code || response.status}${message ? `: ${message}` : ''}）`,
      {
        code: code || `HTTP_${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
      }
    )
  }

  let resultObject = payload.ResultObject || payload.resultObject || {}
  // 部分网关会把嵌套对象序列化成字符串，兼容一下
  if (typeof resultObject === 'string') {
    try {
      resultObject = JSON.parse(resultObject)
    } catch {
      resultObject = {}
    }
  }
  const bizCode = resultObject.BizCode ?? resultObject.bizCode ?? null

  return {
    ...mapBizCode(bizCode),
    bizCode: bizCode === null ? null : String(bizCode),
    requestId: payload.RequestId || payload.requestId || null,
    provider: 'aliyun',
  }
}

module.exports = {
  verify,
  signRequest,
  AliyunRealNameError,
  ACTION,
  VERSION,
  _internal: { sha256Hex, percentEncode, formatDate, canonicalQueryString },
}
