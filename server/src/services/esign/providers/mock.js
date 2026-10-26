'use strict'

/**
 * Mock 电子签服务商。
 *
 * 只用于本地开发与集成测试：不接任何外部网络，但在接口形态上与真实适配器一致。
 * 生产环境启动自检会拒绝 ESIGN_PROVIDER=mock。
 */

const crypto = require('node:crypto')
const { nanoid } = require('nanoid')
const config = require('../../../../config')

const tasks = new Map()
const externalIds = new Map()

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function getOrThrow(providerTaskId) {
  const task = tasks.get(providerTaskId)
  if (!task) throw new Error(`mock 电子签任务不存在：${providerTaskId}`)
  return task
}

async function createTask({ documentBuffer, fileName, signer, idempotencyKey }) {
  const existingId = externalIds.get(idempotencyKey)
  if (existingId) return publicTask(tasks.get(existingId))

  const providerTaskId = `mock_${nanoid(16)}`
  const task = {
    providerTaskId,
    providerFlowId: `mockflow_${nanoid(12)}`,
    externalId: idempotencyKey,
    fileName,
    documentBuffer,
    documentHash: sha256(documentBuffer),
    signerUserId: signer && signer.userId,
    status: 'sent',
    signMode: 'mock',
    signUrl: `mock://esign/${providerTaskId}`,
    createdAt: nowSql(),
    expiresAt: new Date(Date.now() + config.esign.signTtlSeconds * 1000).toISOString(),
    signedPdf: null,
    evidencePdf: null,
    evidenceJson: null,
    certificateSn: null,
    signedAt: null,
    realname: null,
  }
  tasks.set(providerTaskId, task)
  externalIds.set(idempotencyKey, providerTaskId)
  return publicTask(task)
}

function publicTask(task) {
  if (!task) return null
  return {
    providerTaskId: task.providerTaskId,
    providerFlowId: task.providerFlowId,
    signMode: task.signMode,
    signUrl: task.signUrl,
    expiresAt: task.expiresAt,
    status: task.status,
  }
}

async function getSignUrl({ providerTaskId }) {
  const task = getOrThrow(providerTaskId)
  return task.signUrl
}

async function getTask({ providerTaskId }) {  const task = getOrThrow(providerTaskId)
  return {
    providerTaskId: task.providerTaskId,
    status: task.status === 'sent' ? 'pending' : task.status,
    signedAt: task.signedAt,
    certificateSn: task.certificateSn,
    realname: task.realname,
    expiresAt: task.expiresAt,
  }
}

async function findByExternalId({ externalId }) {
  const id = externalIds.get(externalId)
  if (!id) return null
  const task = tasks.get(id)
  return {
    providerTaskId: task.providerTaskId,
    status: task.status === 'sent' ? 'pending' : task.status,
    expiresAt: task.expiresAt,
  }
}

async function downloadArtifacts({ providerTaskId }) {
  const task = getOrThrow(providerTaskId)
  if (task.status !== 'signed') throw new Error('mock 任务尚未签署')
  return {
    signedPdf: task.signedPdf,
    evidencePdf: task.evidencePdf,
    evidenceJson: task.evidenceJson,
  }
}

async function verifySignedDocument({ providerTaskId, signedPdf, expectedOriginalHash }) {
  const task = getOrThrow(providerTaskId)
  const originalHash = task.documentHash
  const valid = Boolean(
    task.status === 'signed' &&
      Buffer.isBuffer(signedPdf) &&
      signedPdf.length > 0 &&
      originalHash === expectedOriginalHash
  )
  return {
    valid,
    originalHash,
    signedHash: Buffer.isBuffer(signedPdf) ? sha256(signedPdf) : null,
    certificateSerial: task.certificateSn,
    certificateIssuer: 'Mock CA',
    certificateNotAfter: null,
    signedAt: task.signedAt,
    signerSubjectMasked: task.realname ? task.realname.nameMasked : null,
    realname: task.realname,
  }
}

async function getRealNameResult({ providerTaskId }) {
  const task = getOrThrow(providerTaskId)
  return task.realname || { status: 'none' }
}

async function cancelTask({ providerTaskId }) {
  const task = getOrThrow(providerTaskId)
  if (['signed', 'cancelled', 'expired', 'failed'].includes(task.status)) return task.status
  task.status = 'cancelled'
  return 'cancelled'
}

function callbackSecret() {
  return config.esign.callbackSecret || 'test-callback-secret'
}

function signRaw(rawBody) {
  return crypto.createHmac('sha256', callbackSecret()).update(rawBody).digest('hex')
}

async function verifyCallback({ headers, rawBody }) {
  const signature = headers['x-esign-signature'] || headers['X-Esign-Signature']
  const expected = signRaw(rawBody)
  const a = Buffer.from(String(signature || ''), 'utf8')
  const b = Buffer.from(expected, 'utf8')
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b)
  if (!valid) return { valid: false }

  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return { valid: false }
  }

  if (payload.eventTime) {
    const ts = Date.parse(payload.eventTime)
    if (Number.isFinite(ts) && Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      return { valid: false }
    }
  }

  return {
    valid: true,
    eventId: payload.eventId || crypto.createHash('sha256').update(rawBody).digest('hex'),
    eventType: payload.eventType,
    providerTaskId: payload.providerTaskId,
    providerBusinessId: payload.providerBusinessId,
    status: payload.status,
    eventTime: payload.eventTime,
    payload,
  }
}

function callbackAck() {
  return { status: 200, body: { code: 0, message: 'success' } }
}

// ── 测试辅助 ────────────────────────────────────────────────

function reset() {
  tasks.clear()
  externalIds.clear()
}

function simulateSign(providerTaskId, { signerSubjectId = 'mock-subject', nameMasked = '张*', method = 'face' } = {}) {
  const task = getOrThrow(providerTaskId)
  task.status = 'signed'
  task.signedAt = nowSql()
  task.certificateSn = `MOCKCERT-${nanoid(10)}`
  task.signedPdf = Buffer.concat([
    task.documentBuffer,
    Buffer.from(`\n%MOCK-ESIGN-SIGNATURE\n${task.certificateSn}\n${task.signedAt}\n`),
  ])
  task.evidencePdf = Buffer.from(
    `MOCK EVIDENCE\noriginalHash=${task.documentHash}\nsignedHash=${sha256(task.signedPdf)}\n`
  )
  task.evidenceJson = { originalHash: task.documentHash, certificateSn: task.certificateSn }
  task.realname = {
    status: 'passed',
    method,
    ref: `mock-realname-${nanoid(10)}`,
    verifiedAt: task.signedAt,
    nameMasked,
    providerSubjectId: signerSubjectId,
  }
  return task
}

function simulateReject(providerTaskId) {
  getOrThrow(providerTaskId).status = 'rejected'
}

function simulateExpire(providerTaskId) {
  getOrThrow(providerTaskId).status = 'expired'
}

function buildCallback({
  providerTaskId,
  providerBusinessId,
  eventType = 'SIGN_COMPLETED',
  status = 'signed',
  eventId = `evt_${nanoid(12)}`,
  eventTime = new Date().toISOString(),
} = {}) {
  const payload = { eventId, eventType, providerTaskId, providerBusinessId, status, eventTime }
  const rawBody = Buffer.from(JSON.stringify(payload))
  return { headers: { 'x-esign-signature': signRaw(rawBody) }, rawBody, payload }
}

function getTaskForTest(providerTaskId) {
  return getOrThrow(providerTaskId)
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
  _mock: {
    reset,
    simulateSign,
    simulateReject,
    simulateExpire,
    buildCallback,
    getTaskForTest,
  },
}
