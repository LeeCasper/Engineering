'use strict'

/**
 * 腾讯电子签适配器（ess.tencentcloudapi.com / Version 2020-11-11）。
 *
 * ── 重要 ──
 * 这里做的是“按官方文档的字段做映射”，但腾讯云会随版本调整字段与错误码。
 * 上线前必须在服务商沙箱用真实 AppId/Secret、真实 PDF、真实实名账号跑通：
 *   UploadFiles → CreateFlowByFiles → CreateSchemeUrl → 回调 → DescribeFileUrls → VerifyPdf
 * 不能仅凭本文件在本地 mock 通过就认为生产可用。
 *
 * 认证使用腾讯云 TC3-HMAC-SHA256；ESIGN_APP_ID / ESIGN_APP_SECRET 对应 SecretId / SecretKey。
 */

const crypto = require('node:crypto')
const config = require('../../../../config')

const VERSION = '2020-11-11'
const SERVICE = 'ess'
const DEFAULT_HOST = 'ess.tencentcloudapi.com'

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding)
}

function apiEndpoint() {
  const raw = config.esign.apiBase || `https://${DEFAULT_HOST}`
  const url = new URL(raw)
  if (!url.pathname || url.pathname === '/') url.pathname = '/'
  return url
}

function canonicalQuery(url) {
  return [...url.searchParams.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

async function call(action, params = {}) {
  const secretId = config.esign.appId
  const secretKey = config.esign.appSecret
  if (!secretId || !secretKey) throw new Error('腾讯电子签 SecretId/SecretKey 未配置')

  const url = apiEndpoint()
  const host = url.host
  const payload = JSON.stringify(params)
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const contentType = 'application/json; charset=utf-8'

  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-tc-action:${action.toLowerCase()}`,
  ].join('\n')
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = [
    'POST',
    url.pathname || '/',
    canonicalQuery(url),
    canonicalHeaders,
    '',
    signedHeaders,
    sha256Hex(payload),
  ].join('\n')

  const credentialScope = `${date}/${SERVICE}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const secretDate = hmac(`TC3${secretKey}`, date)
  const secretService = hmac(secretDate, SERVICE)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = hmac(secretSigning, stringToSign, 'hex')

  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const headers = {
    Authorization: authorization,
    'Content-Type': contentType,
    Host: host,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': VERSION,
  }
  if (config.esign.region) headers['X-TC-Region'] = config.esign.region

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
      signal: AbortSignal.timeout(config.esign.createTimeoutMs),
    })
  } catch (err) {
    const error = new Error(`腾讯电子签请求失败：${action} ${err.message}`)
    error.code = 'ESIGN_NETWORK'
    error.retryable = true
    throw error
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`腾讯电子签返回非 JSON：${action} HTTP ${response.status}`)
  }

  const result = body && body.Response
  if (!response.ok || !result || result.Error) {
    const code = result && result.Error ? result.Error.Code : `HTTP_${response.status}`
    const message = result && result.Error ? result.Error.Message : '未知错误'
    const error = new Error(`腾讯电子签 ${action} 失败：${code} ${message}`)
    error.code = code
    error.retryable = response.status >= 500 || response.status === 429
    throw error
  }

  return result
}

function operator() {
  const value = { UserId: config.esign.operatorId }
  if (config.esign.organizationId) value.OrganizationId = config.esign.organizationId
  return value
}

function normalizeFlowStatus(status) {
  const value = String(status || '').toUpperCase()
  if (['SIGNED', 'ALL_SIGNED', 'COMPLETED', 'FINISHED'].includes(value)) return 'signed'
  if (['REJECTED', 'REJECT', 'REFUSED'].includes(value)) return 'rejected'
  if (['EXPIRED', 'TIMEOUT'].includes(value)) return 'expired'
  if (['CANCELED', 'CANCELLED', 'REVOKED'].includes(value)) return 'cancelled'
  return 'pending'
}

async function createTask({ acceptance, documentBuffer, fileName, signer, signaturePage = 1, idempotencyKey }) {
  const upload = await call('UploadFiles', {
    BusinessType: 'DOCUMENT',
    FileInfos: [
      {
        FileType: 'pdf',
        FileName: fileName,
        FileBody: documentBuffer.toString('base64'),
      },
    ],
  })
  const fileId = upload.FileIds && upload.FileIds[0]
  if (!fileId) throw new Error('腾讯电子签 UploadFiles 未返回 FileId')

  const flowName = `验收确认书-AC-${acceptance.id}-R${acceptance.resubmit_count || 0}`
  const flow = await call('CreateFlowByFiles', {
    Operator: operator(),
    FlowName: flowName,
    FileIds: [fileId],
    FlowType: '验收确认书',
    Deadline: Math.floor(Date.now() / 1000) + config.esign.signTtlSeconds,
    ClientToken: idempotencyKey,
    UserData: Buffer.from(JSON.stringify({ acceptanceId: acceptance.id, idempotencyKey })).toString('base64'),
    Approvers: [
      {
        ApproverType: 1,
        ApproverName: signer.name || '业主',
        ApproverMobile: signer.mobile,
        ApproverVerifyType: 'VerifyCheck',
        SignComponents: [
          {
            ComponentType: 'SIGN_SIGNATURE',
            ComponentPage: signaturePage,
            ComponentPosX: 400,
            ComponentPosY: 700,
            ComponentWidth: 110,
            ComponentHeight: 55,
            FileIndex: 0,
          },
        ],
      },
    ],
  })

  const flowId = flow.FlowId
  if (!flowId) throw new Error('腾讯电子签 CreateFlowByFiles 未返回 FlowId')

  let signUrl = null
  try {
    signUrl = await getSignUrl({ providerTaskId: flowId, signer })
  } catch (err) {
    // 签署链接获取失败不丢 FlowId：任务已创建，后续可重试取链接
    if (err.code === 'ESIGN_NETWORK') throw err
  }

  return {
    providerTaskId: flowId,
    providerFlowId: flowId,
    signMode: 'webview',
    signUrl,
    expiresAt: new Date(Date.now() + config.esign.signTtlSeconds * 1000).toISOString(),
  }
}

async function getSignUrl({ providerTaskId, signer = {} }) {
  const scheme = await call('CreateSchemeUrl', {
    Operator: operator(),
    FlowId: providerTaskId,
    PathType: 0,
    EndPoint: 'APP',
    Name: signer.name || undefined,
    Mobile: signer.mobile,
  })
  return scheme.SchemeUrl || null
}

async function getTask({ providerTaskId }) {
  const res = await call('DescribeFlowBriefs', { FlowIds: [providerTaskId] })
  const brief = (res.FlowBriefs || [])[0] || {}
  return {
    providerTaskId,
    status: normalizeFlowStatus(brief.FlowStatus),
    signedAt: brief.SignTime || null,
    certificateSn: null,
    realname: null,
    expiresAt: brief.Deadline || null,
  }
}

async function findByExternalId() {
  // 腾讯电子签没有按外部 id 查询流程的公开接口；本地必须存住 FlowId。
  // 创建超时时服务只能把任务留在 creating，由人工/补偿处理，不能凭空再造一份。
  return null
}

async function describeFileUrl(flowId) {
  const res = await call('DescribeFileUrls', {
    BusinessIds: [flowId],
    BusinessType: 'FLOW',
  })
  const urls = res.FileUrls || res.FileUrl || []
  const list = Array.isArray(urls) ? urls : [urls]
  for (const item of list) {
    const url = typeof item === 'string' ? item : item && (item.Url || item.FileUrl)
    if (url) return url
  }
  return null
}

async function verifyPdf(flowId) {
  const res = await call('VerifyPdf', { FlowId: flowId, Operator: operator() })
  const code = Number(res.VerifyResult)
  return {
    raw: res,
    valid: code === 1 || code === 2,
    verifySerialNo: res.VerifySerialNo || null,
    pdfResourceMd5: res.PdfResourceMd5 || null,
  }
}

async function downloadArtifacts({ providerTaskId }) {
  const url = await describeFileUrl(providerTaskId)
  if (!url) throw new Error('腾讯电子签未返回已签文件下载地址')
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`下载腾讯电子签已签文件失败：HTTP ${response.status}`)
  const signedPdf = Buffer.from(await response.arrayBuffer())
  const verification = await verifyPdf(providerTaskId)
  return {
    signedPdf,
    evidencePdf: null,
    evidenceJson: {
      provider: 'tencent',
      flowId: providerTaskId,
      verification,
      downloadedAt: new Date().toISOString(),
    },
  }
}

async function verifySignedDocument({ providerTaskId, signedPdf, expectedOriginalHash }) {
  const verification = await verifyPdf(providerTaskId)
  return {
    valid: verification.valid,
    // 腾讯 VerifyPdf 不直接返回“原始文档哈希”；这里返回 null，
    // 由 service 用 FlowId 绑定 + 本地冻结哈希 + 验签结果判断。
    originalHash: null,
    signedHash: signedPdf ? sha256Hex(signedPdf) : null,
    certificateSerial: verification.verifySerialNo,
    certificateIssuer: 'Tencent E-Sign',
    certificateNotAfter: null,
    signedAt: null,
    signerSubjectMasked: null,
    // 腾讯的个人签署流程在签署时已完成实名/意愿核验；这里只记录“服务商确认通过”，
    // 不伪造姓名或身份证号。真实证据报告以服务商输出为准。
    realname: verification.valid
      ? { status: 'passed', method: 'other', ref: verification.verifySerialNo, nameMasked: null }
      : { status: 'failed' },
    expectedOriginalHash,
  }
}

async function getRealNameResult({ providerTaskId }) {
  const verification = await verifyPdf(providerTaskId)
  return verification.valid
    ? { status: 'passed', method: 'other', ref: verification.verifySerialNo, nameMasked: null }
    : { status: 'unknown' }
}

async function cancelTask({ providerTaskId }) {
  await call('CancelFlow', {
    Operator: operator(),
    FlowId: providerTaskId,
    CancelMessage: '业主取消签署',
  })
}

/**
 * 腾讯电子签 v2 回调：{"encrypt":"base64"}，AES-256-CBC，
 * key = CallbackUrlKey，IV = key 前 16 字节，PKCS#7。
 * 也兼容未加密的明文 JSON（控制台未配置 CallbackKey 时）。
 */
function decryptCallback(rawBody) {
  const text = rawBody.toString('utf8').trim()
  let cipherText = null

  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed.encrypt === 'string') cipherText = parsed.encrypt
    else return parsed
  } catch {
    // 旧版回调直接是 base64 字符串
    cipherText = text
  }

  if (!cipherText) throw new Error('腾讯电子签回调缺少 encrypt')

  let key = Buffer.from(config.esign.callbackSecret || '', 'utf8')
  if (key.length !== 32) key = crypto.createHash('sha256').update(key).digest()
  const iv = key.subarray(0, 16)
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  const plain = Buffer.concat([decipher.update(Buffer.from(cipherText, 'base64')), decipher.final()])
  return JSON.parse(plain.toString('utf8'))
}

function callbackStatus(payload) {
  const data = typeof payload.MsgData === 'string' ? safeJson(payload.MsgData) : payload.MsgData || {}
  const status = data.FlowStatus || data.Status || payload.FlowStatus || payload.Status
  return { data, status }
}

function safeJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

async function verifyCallback({ headers, rawBody }) {
  try {
    const payload = decryptCallback(rawBody)
    const { data, status } = callbackStatus(payload)
    const msgId =
      payload.MsgId ||
      payload.MsgID ||
      payload.MsgIdString ||
      crypto.createHash('sha256').update(rawBody).digest('hex')
    return {
      valid: true,
      eventId: msgId,
      eventType: payload.MsgType || 'FLOW_STATUS_CHANGE',
      providerTaskId: data.FlowId || payload.FlowId || null,
      providerBusinessId: data.FlowName || payload.FlowName || null,
      status: normalizeFlowStatus(status),
      eventTime: data.SignTime || payload.SignTime || new Date().toISOString(),
      payload: {
        msgId,
        msgType: payload.MsgType || null,
        flowId: data.FlowId || payload.FlowId || null,
        flowStatus: status || null,
        signTime: data.SignTime || null,
      },
    }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}

function callbackAck() {
  return { status: 200, body: { code: 0, message: 'success' } }
}

module.exports = {
  createTask,
  getTask,
  getSignUrl,
  findByExternalId,
  downloadArtifacts,
  verifySignedDocument,
  getRealNameResult,
  cancelTask,
  verifyCallback,
  callbackAck,
}
