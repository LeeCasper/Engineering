'use strict'

/**
 * 验收单可靠电子签名领域服务。
 *
 * ── 三条不能破的边界 ──
 *  1. 服务商回调只是**事件提示**，不是签署事实。必须下载已签 PDF、验签、
 *     比对原始文档哈希/实名主体，才能把验收单改成 passed；
 *  2. 回调请求里不做下载/归档等重活，先落 esign_event 并快速 200，
 *     由 processTask/esignSync 异步完成；
 *  3. 所有状态变更都先锁 acceptance、再锁 esign_task，并用条件更新防止
 *     “已驳回的单子被晚到的签名回调改成通过”。
 *
 * 本模块不能 require acceptance.service（会循环）；完成后的联动走
 * acceptancePass.service。
 */

const crypto = require('node:crypto')

const db = require('../db/pool')
const config = require('../../config')
const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const logger = require('../utils/logger')
const signedUrl = require('../utils/signedUrl')
const storage = require('../storage')
const { assertPrimaryOwner, isPrimaryOwner } = require('../utils/ownerType')
const acceptanceModel = require('../models/acceptance.model')
const projectModel = require('../models/project.model')
const projectMemberModel = require('../models/projectMember.model')
const esignTaskModel = require('../models/esignTask.model')
const esignEventModel = require('../models/esignEvent.model')
const esignIdentityModel = require('../models/esignIdentity.model')
const acceptancePdf = require('./acceptancePdf.service')
const acceptancePass = require('./acceptancePass.service')
const contentPageService = require('./contentPage.service')
const operationLog = require('./operationLog.service')
const notificationService = require('./notification.service')
const provider = require('./esign')
const esignConfig = require('./esign/config')

const NOT_FOUND_MESSAGE = '验收单不存在'
const PROCESSING = new Set()

const DEFAULT_CONSENT =
  '本人已阅读并理解本验收确认书的全部内容，确认本次验收项目及现场情况真实、完整。' +
  '本人同意使用电子签名方式签署本验收确认书，并知悉电子签名服务商将采集姓名、' +
  '身份证件信息及人脸信息用于实名核验，相关个人信息处理规则见《隐私政策》。'

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function maskPhone(phone) {
  if (!phone) return null
  const value = String(phone)
  if (value.length === 11) return `${value.slice(0, 3)}****${value.slice(-4)}`
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(1, value.length - 4))}${value.slice(-2)}`
}

async function loadForAction(userId, acceptanceId) {
  const acceptance = await acceptanceModel.findById(acceptanceId)
  if (!acceptance) throw AppError.notFound(NOT_FOUND_MESSAGE)

  const viewer = await projectMemberModel.findActiveRole(acceptance.project_id, userId)
  if (!viewer) throw AppError.notFound(NOT_FOUND_MESSAGE)

  return { acceptance, viewer }
}

async function loadUser(userId) {
  return db.queryOne('SELECT id, nickname, phone FROM user WHERE id = ?', [userId])
}

async function getConsent(tenantId) {
  try {
    const page = await contentPageService.getPublished(tenantId, 'esign_agreement')
    return {
      version: page.version || config.esign.consentVersion,
      text: page.content || DEFAULT_CONSENT,
    }
  } catch {
    return { version: config.esign.consentVersion, text: DEFAULT_CONSENT }
  }
}

function ensureAvailable() {
  if (!config.esign.enabled) {
    throw AppError.serviceUnavailable('电子签名服务未配置')
  }
  if (!config.esign.provider) {
    throw AppError.serviceUnavailable('电子签名服务商未配置')
  }
}

function ensureNotPaused() {
  if (config.esign.signingPaused) {
    throw AppError.serviceUnavailable('电子签名服务维护中，请稍后重试')
  }
}

async function describe(acceptance, viewer) {
  const project = await projectModel.findByIdUnscoped(acceptance.project_id)
  const consent = await getConsent(project ? project.tenant_id : null)
  const user = viewer.user_id ? await loadUser(viewer.user_id) : null
  const task =
    (acceptance.esign_task_id ? await esignTaskModel.findById(acceptance.esign_task_id) : null) ||
    (await esignTaskModel.findLatestByAcceptance(acceptance.id))

  const primary = viewer.role === 'owner' && isPrimaryOwner(viewer)
  const status = task
    ? task.status
    : acceptance.esign_status === 'legacy'
      ? 'legacy'
      : acceptance.esign_status || 'none'

  const active = task && esignTaskModel.ACTIVE_STATUSES.includes(task.status)
  const canSign =
    primary &&
    acceptance.status === 'pending_owner' &&
    !active &&
    ['none', 'failed', 'expired', 'cancelled', 'superseded'].includes(status) &&
    config.esign.enabled &&
    !config.esign.signingPaused &&
    Boolean(user && user.phone)

  let reason = null
  if (primary && !(user && user.phone)) reason = 'phone_required'
  else if (config.esign.enabled && config.esign.signingPaused) reason = 'signing_paused'

  return {
    enabled: config.esign.enabled,
    required: esignConfig.isRequired(),
    status,
    provider: task ? task.provider : config.esign.provider || null,
    taskId: task ? task.id : null,
    signMode: primary && task ? task.sign_mode : null,
    signUrl: primary && task && ['creating', 'pending'].includes(task.status) ? task.sign_url : null,
    appId: primary && task ? task.sign_app_id : null,
    path: primary && task ? task.sign_path : null,
    expiresAt: task ? task.expires_at : null,
    signedAt: task ? task.signed_at : null,
    evidenceAvailable: Boolean(task && task.evidence_key),
    evidencePath:
      primary && task && task.evidence_key
        ? signedUrl.buildPath({
            resource: 'acceptance-esign-evidence',
            id: acceptance.id,
            path: `/api/v1/acceptances/${acceptance.id}/esign/evidence`,
            ttlSeconds: 30 * 60,
          })
        : null,
    consentVersion: consent.version,
    canSign,
    reason,
    error: task ? task.error_message : null,
  }
}

async function getStatus(userId, acceptanceId) {
  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)
  return describe(acceptance, viewer)
}

async function assertNoActiveTask(acceptanceId) {
  const active = await esignTaskModel.findActiveByAcceptance(acceptanceId)
  if (active) throw AppError.conflict('请先取消签署')
}

async function createTask(userId, acceptanceId, { consentVersion, consentAccepted, idempotencyKey, ip, userAgent, requestId }) {
  ensureAvailable()
  ensureNotPaused()

  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)
  assertPrimaryOwner(viewer, '签署验收单')

  if (acceptance.status !== 'pending_owner') {
    throw AppError.conflict('当前验收单不在待业主确认环节')
  }

  const user = await loadUser(userId)
  if (!user || !user.phone) {
    throw AppError.badRequest('请先绑定手机号后再进行电子签名')
  }

  const project = await projectModel.findByIdUnscoped(acceptance.project_id)
  if (!project) throw AppError.notFound('项目不存在')
  if (project.status === 'archived') throw AppError.forbidden('项目已归档，全部数据只读')

  const consent = await getConsent(project.tenant_id)
  if (consentAccepted !== true) throw AppError.badRequest('请先阅读并同意电子签名知情同意书')
  if (consentVersion && consentVersion !== consent.version) {
    throw AppError.conflict('电子签名同意书已更新，请刷新后重新阅读')
  }

  // 已有进行中/归档中任务：直接返回，避免重复创建
  const active = await esignTaskModel.findActiveByAcceptance(acceptanceId)
  if (active) return describe(acceptance, viewer)

  // 最近一次失败/过期但服务商侧可能已经签了：先查单，绝不直接创建第二份
  const latest = await esignTaskModel.findLatestByAcceptance(acceptanceId)
  const currentRound = Number(acceptance.resubmit_count || 0) + 1
  const latestSnapshot = latest ? parseJson(latest.content_snapshot) : null
  const sameRound = Boolean(latestSnapshot && Number(latestSnapshot.round) === currentRound)
  if (
    latest &&
    sameRound &&
    ['failed', 'expired', 'superseded'].includes(latest.status) &&
    latest.provider_task_id
  ) {
    try {
      const remote = await provider.getTask({ providerTaskId: latest.provider_task_id })
      if (remote.status === 'signed') {
        await esignTaskModel.update(latest.id, {
          status: 'archiving',
          provider_status: 'signed',
          last_synced_at: datetime.format(),
        })
        await acceptanceModel.updateEsignState(acceptanceId, { status: 'archiving', taskId: latest.id })
        setImmediate(() => processTask(latest.id).catch((err) => logger.error('电子签归档失败', { err })))
        return describe({ ...acceptance, esign_status: 'archiving' }, viewer)
      }
    } catch (err) {
      logger.warn('电子签重试前查单失败', { acceptanceId, err })
    }
  }

  if (idempotencyKey) {
    const existing = await esignTaskModel.findByIdempotencyKey(idempotencyKey)
    if (existing) {
      if (Number(existing.acceptance_id) !== Number(acceptanceId)) {
        throw AppError.badRequest('幂等键已被其他验收单使用')
      }
      return describe(acceptance, viewer)
    }
  }

  const document = await acceptancePdf.buildForSign(acceptanceId)

  const round = Number(acceptance.resubmit_count || 0) + 1
  const attemptNo = latest ? Number(latest.attempt_no || 0) + 1 : 1
  const finalIdempotencyKey =
    idempotencyKey || `ACC-${acceptanceId}-R${round}-A${attemptNo}`
  const identity = await esignIdentityModel.findByUserAndProvider(userId, config.esign.provider)

  const created = await db.withTransaction(async (tx) => {
    // 先锁 acceptance，再锁任务；顺序不能反
    const locked = await acceptanceModel.lockById(tx, acceptanceId)
    if (!locked || locked.status !== 'pending_owner') {
      throw AppError.conflict('当前验收单不在待业主确认环节')
    }

    const activeInside = await esignTaskModel.findActiveByAcceptance(acceptanceId, tx)
    if (activeInside) return { existing: activeInside }

    const taskId = await esignTaskModel.create(
      {
        acceptance_id: acceptanceId,
        project_id: acceptance.project_id,
        tenant_id: project.tenant_id,
        provider: config.esign.provider,
        idempotency_key: finalIdempotencyKey,
        status: 'creating',
        signer_user_id: userId,
        signer_identity_id: identity ? identity.id : null,
        signer_name: identity ? identity.name_masked : null,
        signer_mobile_masked: maskPhone(user.phone),
        verify_method: identity && identity.realname_status === 'passed' ? 'face' : 'none',
        realname_status: identity ? identity.realname_status : 'pending',
        consent_at: datetime.format(),
        consent_version: consent.version,
        consent_text: consent.text,
        consent_text_hash: sha256(consent.text),
        consent_ip: ip || null,
        consent_user_agent: userAgent || null,
        consent_request_id: requestId || null,
        document_key: document.key,
        document_hash: document.hash,
        document_frozen_at: datetime.format(),
        content_snapshot: document.snapshot,
        content_snapshot_hash: document.snapshotHash,
        attempt_no: attemptNo,
      },
      tx
    )

    await acceptanceModel.updateEsignState(
      acceptanceId,
      { status: 'creating', taskId },
      tx
    )
    await tx.query("UPDATE acceptance SET signature_mode = 'provider' WHERE id = ?", [acceptanceId])
    return { taskId }
  })

  if (created.existing) return describe(acceptance, viewer)

  const taskId = created.taskId
  let providerTask
  try {
    providerTask = await provider.createTask({
      acceptance,
      identity,
      documentBuffer: document.buffer,
      fileName: `验收确认书-AC-${acceptanceId}-R${round}.pdf`,
      signer: { userId, name: user.nickname, mobile: user.phone },
      signaturePage: document.signaturePage,
      callbackUrl: config.esign.callbackUrl,
      idempotencyKey: finalIdempotencyKey,
    })
  } catch (err) {
    const retryable = err.retryable || err.code === 'ESIGN_NETWORK'
    logger.error('创建电子签任务失败', { acceptanceId, taskId, retryable, message: err.message })

    if (retryable) {
      // 服务商可能已经创建：保留 creating，由 esignSync 按 externalId 对账
      await esignTaskModel.update(taskId, {
        error_code: err.code || null,
        error_message: String(err.message || '').slice(0, 500),
      })
      return describe(acceptance, viewer)
    }

    await esignTaskModel.update(taskId, {
      status: 'failed',
      error_code: err.code || null,
      error_message: String(err.message || '').slice(0, 500),
    })
    await acceptanceModel.updateEsignState(acceptanceId, { status: 'failed', taskId })
    throw AppError.serviceUnavailable('电子签名服务暂不可用，请稍后重试')
  }

  if (!providerTask.signUrl && providerTask.providerTaskId && typeof provider.getSignUrl === 'function') {
    try {
      const url = await provider.getSignUrl({
        providerTaskId: providerTask.providerTaskId,
        signer: { userId, name: user.nickname, mobile: user.phone },
      })
      if (url) providerTask.signUrl = url
    } catch (err) {
      logger.warn('获取电子签签署链接失败，等待重试', { taskId, message: err.message })
    }
  }

  const expiresAt = providerTask.expiresAt ? toSqlTime(providerTask.expiresAt) : null
  await esignTaskModel.update(taskId, {
    status: 'pending',
    provider_task_id: providerTask.providerTaskId || null,
    provider_flow_id: providerTask.providerFlowId || null,
    sign_mode: providerTask.signMode || null,
    sign_url: providerTask.signUrl || null,
    sign_app_id: providerTask.appId || null,
    sign_path: providerTask.path || null,
    expires_at: expiresAt,
    last_synced_at: datetime.format(),
    error_code: null,
    error_message: null,
  })
  await acceptanceModel.updateEsignState(acceptanceId, { status: 'pending', taskId })

  await operationLog.record({
    operatorType: 'user',
    operatorId: userId,
    action: operationLog.ACTIONS.ACCEPTANCE_ESIGN_CREATE,
    targetType: 'acceptance',
    targetId: acceptanceId,
    projectId: acceptance.project_id,
    detail: {
      after: { taskId, provider: config.esign.provider, documentHash: document.hash },
    },
  })

  await notifyOwner(acceptance.project_id, userId, '验收单待电子签名', '请完成电子签名以确认本次验收')
  return describe(acceptance, viewer)
}

async function syncTask(task) {
  if (!task || !task.provider_task_id) return task
  try {
    const remote = await provider.getTask({ providerTaskId: task.provider_task_id })
    if (remote.status === 'signed') {
      await esignTaskModel.update(task.id, {
        status: 'archiving',
        provider_status: 'signed',
        signed_at: remote.signedAt ? toSqlTime(remote.signedAt) : task.signed_at,
        certificate_serial: remote.certificateSn || task.certificate_serial,
        last_synced_at: datetime.format(),
      })
      await acceptanceModel.updateEsignState(task.acceptance_id, { status: 'archiving', taskId: task.id })
      setImmediate(() => processTask(task.id).catch((err) => logger.error('电子签归档失败', { err })))
    } else if (remote.status === 'expired') {
      await markRemoteTerminal(task, 'expired')
    } else if (remote.status === 'rejected') {
      await markRemoteTerminal(task, 'failed')
    } else {
      await esignTaskModel.update(task.id, {
        last_synced_at: datetime.format(),
        provider_status: remote.status || task.provider_status,
      })
    }
  } catch (err) {
    logger.warn('电子签查单失败', { taskId: task.id, message: err.message })
  }
  return task
}

async function sync(userId, acceptanceId) {
  ensureAvailable()
  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)
  if (!(viewer.role === 'owner' && isPrimaryOwner(viewer))) {
    throw AppError.forbidden('仅主业主可刷新签署状态')
  }

  const task = await esignTaskModel.findActiveByAcceptance(acceptanceId)
  if (!task) return describe(acceptance, viewer)

  if (task.status === 'archiving') {
    setImmediate(() => processTask(task.id).catch((err) => logger.error('电子签归档失败', { err })))
    return describe(acceptance, viewer)
  }

  const lastSync = task.last_synced_at ? new Date(task.last_synced_at).getTime() : 0
  const minInterval = config.esign.refreshMinIntervalSeconds * 1000
  if (task.status === 'pending' && Date.now() - lastSync < minInterval) {
    return describe(acceptance, viewer)
  }

  await syncTask(task)

  if (!task.sign_url && task.provider_task_id) {
    const user = await loadUser(userId)
    const url = await provider
      .getSignUrl({
        providerTaskId: task.provider_task_id,
        signer: { userId, name: user ? user.nickname : null, mobile: user ? user.phone : null },
      })
      .catch(() => null)
    if (url) {
      task.sign_url = url
      await esignTaskModel.update(task.id, { sign_url: url })
    }
  }

  return describe(acceptance, viewer)
}

async function cancel(userId, acceptanceId) {
  ensureAvailable()
  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)
  assertPrimaryOwner(viewer, '取消电子签名')

  const active = await esignTaskModel.findActiveByAcceptance(acceptanceId)
  if (!active) return describe(acceptance, viewer)
  if (active.status === 'archiving') {
    throw AppError.conflict('服务商已签署，无法取消，请等待归档完成')
  }

  await db.withTransaction(async (tx) => {
    const locked = await acceptanceModel.lockById(tx, acceptanceId)
    if (!locked) throw AppError.notFound(NOT_FOUND_MESSAGE)
    await esignTaskModel.update(active.id, { status: 'cancelled', error_message: '业主取消签署' }, tx)
    await acceptanceModel.updateEsignState(acceptanceId, { status: 'cancelled', taskId: active.id }, tx)
  })

  if (active.provider_task_id) {
    await provider.cancelTask({ providerTaskId: active.provider_task_id }).catch((err) => {
      logger.warn('服务商取消签署失败（本地已取消）', { taskId: active.id, message: err.message })
    })
  }

  return describe({ ...acceptance, esign_status: 'cancelled' }, viewer)
}

async function handleCallback(providerName, headers, rawBody) {
  ensureAvailable()
  if (providerName !== config.esign.provider) {
    throw AppError.notFound('未知的电子签服务商')
  }
  const adapter = provider.adapter()
  const verified = await adapter.verifyCallback({ headers, rawBody })
  if (!verified.valid) {
    await operationLog.record({
      operatorType: 'system',
      operatorId: null,
      action: operationLog.ACTIONS.ACCEPTANCE_ESIGN_CALLBACK_REJECTED,
      targetType: 'esign_callback',
      detail: { after: { provider: providerName, error: verified.error || '验签失败' } },
    })
    throw AppError.unauthorized('电子签回调验签失败')
  }

  const inserted = await esignEventModel.insertIfAbsent({
    provider: providerName,
    eventId: verified.eventId,
    taskId: null,
    providerTaskId: verified.providerTaskId,
    providerBusinessId: verified.providerBusinessId,
    eventType: verified.eventType,
    eventTime: verified.eventTime ? toSqlTime(verified.eventTime) : null,
    payload: verified.payload,
  })
  if (!inserted) return adapter.callbackAck()

  let task = await esignTaskModel.findByProviderTaskId(providerName, verified.providerTaskId)
  if (!task && verified.providerBusinessId) {
    task = await esignTaskModel.findByIdempotencyKey(verified.providerBusinessId)
  }

  const event = await esignEventModel.findByEventId(providerName, verified.eventId)
  if (!task) {
    // 服务商可能比本地写库更快回调；保留事件，由 esignSync 继续解析
    return adapter.callbackAck()
  }

  await esignEventModel.mark(event.id, { taskId: task.id })

  // 服务商比本地更新更快时，task 可能只有 externalId、没有 provider_task_id；
  // 先补上，否则 processTask 无法下载已签文件。
  if (!task.provider_task_id && verified.providerTaskId) {
    task.provider_task_id = verified.providerTaskId
    await esignTaskModel.update(task.id, {
      provider_task_id: verified.providerTaskId,
      provider_flow_id: verified.providerTaskId,
    })
  }

  if (verified.status === 'signed') {
    if (task.status === 'signed') {
      await esignEventModel.mark(event.id, { status: 'processed', processedAt: datetime.format() })
      return adapter.callbackAck()
    }
    await esignTaskModel.update(task.id, {
      status: 'archiving',
      provider_status: 'signed',
      signed_at: verified.eventTime ? toSqlTime(verified.eventTime) : datetime.format(),
      last_event_at: datetime.format(),
    })
    await acceptanceModel.updateEsignState(task.acceptance_id, { status: 'archiving', taskId: task.id })
    setImmediate(() => processEvent(event.id).catch((err) => logger.error('电子签回调处理失败', { err })))
  } else if (['rejected', 'expired', 'cancelled'].includes(verified.status)) {
    await markRemoteTerminal(task, verified.status === 'rejected' ? 'failed' : verified.status, event.id)
  } else {
    await esignTaskModel.update(task.id, {
      provider_status: verified.status || task.provider_status,
      last_event_at: datetime.format(),
    })
    await esignEventModel.mark(event.id, { status: 'processed', processedAt: datetime.format() })
  }

  return adapter.callbackAck()
}

async function processEvent(eventId) {
  const event = await esignEventModel.findById(eventId)
  if (!event || event.status === 'processed') return
  if (!event.task_id) return

  const task = await esignTaskModel.findById(event.task_id)
  if (!task) return
  const result = await processTask(task.id)
  if (result === 'retry' || result === 'skip') {
    await esignEventModel.mark(event.id, {
      status: 'received',
      nextRetryAt: datetime.format(new Date(Date.now() + 5 * 60 * 1000)),
    })
    return
  }
  await esignEventModel.mark(event.id, { status: 'processed', processedAt: datetime.format() })
}

async function processTask(taskId) {
  if (PROCESSING.has(taskId)) return 'retry'
  PROCESSING.add(taskId)

  try {
    const task = await esignTaskModel.findById(taskId)
    if (!task || task.status === 'signed') return 'already'
    if (['failed', 'expired', 'cancelled', 'superseded'].includes(task.status)) return 'done'
    if (task.status !== 'archiving') return 'skip'
    if (!task.provider_task_id) return 'retry'

    let artifacts
    try {
      artifacts = await provider.downloadArtifacts({ providerTaskId: task.provider_task_id })
    } catch (err) {
      logger.warn('下载电子签已签文件失败，等待重试', { taskId, message: err.message })
      return 'retry'
    }

    let verified
    try {
      verified = await provider.verifySignedDocument({
        providerTaskId: task.provider_task_id,
        signedPdf: artifacts.signedPdf,
        expectedOriginalHash: task.document_hash,
      })
    } catch (err) {
      logger.warn('电子签验签失败，等待重试', { taskId, message: err.message })
      return 'retry'
    }

    if (!verified.valid) {
      await failTask(task, 'ESIGN_VERIFY_FAILED', '服务商验签未通过')
      return 'failed'
    }
    if (verified.originalHash && verified.originalHash !== task.document_hash) {
      await failTask(task, 'ESIGN_HASH_MISMATCH', '签署文件原始哈希与冻结文件不一致')
      return 'failed'
    }

    const archived = await acceptancePdf.archiveSigned(task.acceptance_id, task, artifacts)
    const now = datetime.format()

    // 先写实名绑定；完成验收前必须 passed
    const realname = verified.realname || {}
    if (realname.status === 'passed') {
      try {
        await esignIdentityModel.upsertVerified({
          userId: task.signer_user_id,
          provider: task.provider,
          providerSubjectId: realname.providerSubjectId || `${task.provider}:${task.signer_user_id}`,
          realnameStatus: 'passed',
          realnameMethod: realname.method || 'other',
          realnameRef: realname.ref || verified.certificateSerial || null,
          nameMasked: realname.nameMasked || task.signer_name || null,
          verifiedAt: now,
        })
      } catch (err) {
        await failTask(task, 'ESIGN_IDENTITY_CONFLICT', err.message || '实名主体绑定冲突')
        return 'failed'
      }
    }

    const completed = await db.withTransaction(async (tx) => {
      // 锁顺序：acceptance -> task
      const acceptance = await acceptanceModel.lockById(tx, task.acceptance_id)
      const lockedTask = await esignTaskModel.lockById(tx, task.id)
      if (!acceptance || !lockedTask) return { status: 'missing' }
      if (lockedTask.status === 'signed') return { status: 'already' }

      const signer = await projectMemberModel.findActiveRole(acceptance.project_id, task.signer_user_id, tx)
      const signerStillPrimary = signer && signer.role === 'owner' && isPrimaryOwner(signer)
      const snapshot = parseJson(lockedTask.content_snapshot)
      const currentRound = Number(acceptance.resubmit_count || 0) + 1
      // 旧轮次的签名不能用于新轮次：驳回重提后 resubmit_count 增加，
      // 但服务商侧可能已经签了旧文档，这里必须靠快照轮次拦住。
      const roundMatches = !snapshot || Number(snapshot.round) === currentRound

      if (acceptance.status !== 'pending_owner' || !signerStillPrimary || !roundMatches) {
        await esignTaskModel.update(
          lockedTask.id,
          {
            status: 'superseded',
            signer_name: realname.nameMasked || lockedTask.signer_name,
            signer_subject_masked: verified.signerSubjectMasked || lockedTask.signer_subject_masked,
            signed_document_key: archived.signedKey,
            signed_document_hash: archived.signedHash,
            evidence_key: archived.evidenceKey,
            certificate_serial: verified.certificateSerial || null,
            certificate_issuer: verified.certificateIssuer || null,
            certificate_not_after: verified.certificateNotAfter
              ? toSqlTime(verified.certificateNotAfter)
              : null,
            signed_at: verified.signedAt ? toSqlTime(verified.signedAt) : lockedTask.signed_at || now,
            verify_status: 'valid',
            verified_at: now,
            verify_result: sanitizeVerifyResult(verified),
            realname_status: realname.status || 'passed',
            realname_method: realname.method || null,
            realname_ref: realname.ref || null,
            realname_verified_at: now,
          },
          tx
        )
        return { status: 'superseded' }
      }

      const identity = await esignIdentityModel.findByUserAndProvider(task.signer_user_id, task.provider, tx)
      if (!identity || identity.realname_status !== 'passed') {
        return { status: 'realname_missing' }
      }

      await esignTaskModel.update(
        lockedTask.id,
        {
          status: 'signed',
          signer_name: realname.nameMasked || lockedTask.signer_name,
          signer_subject_masked: verified.signerSubjectMasked || lockedTask.signer_subject_masked,
          signed_document_key: archived.signedKey,
          signed_document_hash: archived.signedHash,
          evidence_key: archived.evidenceKey,
          certificate_serial: verified.certificateSerial || null,
          certificate_issuer: verified.certificateIssuer || null,
          certificate_not_after: verified.certificateNotAfter
            ? toSqlTime(verified.certificateNotAfter)
            : null,
          signed_at: verified.signedAt ? toSqlTime(verified.signedAt) : lockedTask.signed_at || now,
          verify_status: 'valid',
          verified_at: now,
          verify_result: sanitizeVerifyResult(verified),
          realname_status: 'passed',
          realname_method: realname.method || null,
          realname_ref: realname.ref || null,
          realname_verified_at: now,
          last_event_at: now,
        },
        tx
      )

      const affected = await acceptanceModel.markPassed(
        acceptance.id,
        {
          signatureUrl: null,
          finishedAt: now,
          esignTaskId: lockedTask.id,
          esignStatus: 'signed',
          esignCompletedAt: now,
        },
        tx
      )
      if (affected === 0) return { status: 'race' }

      await acceptanceModel.appendFlow(
        {
          acceptanceId: acceptance.id,
          round: Number(acceptance.resubmit_count || 0) + 1,
          step: 'owner',
          operatorId: task.signer_user_id,
          action: 'approve',
          reason: '电子签名完成',
          esignTaskId: lockedTask.id,
        },
        tx
      )

      await tx.query("UPDATE project_stage SET gate_status = 'accepted', status = 'accepted' WHERE id = ?", [
        acceptance.project_stage_id,
      ])

      await acceptanceModel.updatePdfState(
        acceptance.id,
        {
          status: 'success',
          key: archived.signedKey,
          private: true,
          sha256: archived.signedHash,
          source: 'signed',
          error: null,
        },
        tx
      )

      return { status: 'passed', acceptance }
    })

    if (completed.status === 'passed') {
      await operationLog.record({
        operatorType: 'user',
        operatorId: task.signer_user_id,
        action: operationLog.ACTIONS.ACCEPTANCE_ESIGN_SIGNED,
        targetType: 'acceptance',
        targetId: task.acceptance_id,
        projectId: task.project_id,
        detail: {
          after: {
            taskId: task.id,
            provider: task.provider,
            documentHash: task.document_hash,
            signedDocumentHash: archived.signedHash,
            certificateSn: verified.certificateSerial || null,
            signedAt: verified.signedAt || now,
          },
        },
      })
      await acceptancePass
        .finalizeAfterPass(completed.acceptance, task.signer_user_id, { generatePdf: false })
        .catch((err) => logger.error('电子签通过后的联动失败，等待补偿', { acceptanceId: task.acceptance_id, err }))
      return 'done'
    }
    if (completed.status === 'realname_missing') {
      await failTask(task, 'ESIGN_REALNAME_MISSING', '电子签名实名核验未通过')
      return 'failed'
    }
    if (completed.status === 'race') {
      await esignTaskModel.update(task.id, { status: 'superseded' })
      logger.warn('电子签归档时验收状态已变化，任务置为 superseded', { taskId: task.id })
      return 'done'
    }
    if (completed.status === 'superseded') {
      logger.warn('电子签完成但验收状态/主业主已变化，任务置为 superseded', { taskId: task.id })
      return 'done'
    }
    return 'skip'
  } finally {
    PROCESSING.delete(taskId)
  }
}

async function markRemoteTerminal(task, status, eventId) {
  const acceptanceStatus = status === 'failed' ? 'failed' : status
  await db.withTransaction(async (tx) => {
    await acceptanceModel.lockById(tx, task.acceptance_id)
    const lockedTask = await esignTaskModel.lockById(tx, task.id)
    if (!lockedTask || ['signed', 'archiving'].includes(lockedTask.status)) return
    await esignTaskModel.update(
      lockedTask.id,
      {
        status,
        error_message: status === 'failed' ? '服务商拒绝签署' : `签署${status}`,
      },
      tx
    )
    await acceptanceModel.updateEsignState(task.acceptance_id, { status: acceptanceStatus, taskId: task.id }, tx)
  })
  if (eventId) await esignEventModel.mark(eventId, { status: 'processed', processedAt: datetime.format() })
  if (status === 'failed') {
    await operationLog.record({
      operatorType: 'system',
      operatorId: null,
      action: operationLog.ACTIONS.ACCEPTANCE_ESIGN_FAILED,
      targetType: 'acceptance',
      targetId: task.acceptance_id,
      projectId: task.project_id,
      detail: { after: { taskId: task.id, provider: task.provider, code: 'ESIGN_PROVIDER_REJECTED' } },
    })
  }
  await notifyOwner(task.project_id, task.signer_user_id, '电子签名未完成', '本次电子签名未完成，可重新发起')
}

async function failTask(task, code, message) {
  await esignTaskModel.update(task.id, {
    status: 'failed',
    error_code: code,
    error_message: message,
    verify_status: code === 'ESIGN_VERIFY_FAILED' || code === 'ESIGN_HASH_MISMATCH' ? 'invalid' : task.verify_status,
  }).catch(() => {})
  await acceptanceModel.updateEsignState(task.acceptance_id, { status: 'failed', taskId: task.id }).catch(() => {})
  await operationLog.record({
    operatorType: 'system',
    operatorId: null,
    action: operationLog.ACTIONS.ACCEPTANCE_ESIGN_FAILED,
    targetType: 'acceptance',
    targetId: task.acceptance_id,
    projectId: task.project_id,
    detail: { after: { taskId: task.id, provider: task.provider, code, message } },
  })
  await notifyOwner(task.project_id, task.signer_user_id, '电子签名失败', message).catch(() => {})
  logger.error('电子签任务失败', { taskId: task.id, code, message })
}

function sanitizeVerifyResult(verified) {
  return {
    valid: Boolean(verified.valid),
    originalHash: verified.originalHash || null,
    signedHash: verified.signedHash || null,
    certificateSerial: verified.certificateSerial || null,
    certificateIssuer: verified.certificateIssuer || null,
    certificateNotAfter: verified.certificateNotAfter || null,
    signedAt: verified.signedAt || null,
    signerSubjectMasked: verified.signerSubjectMasked || null,
  }
}

async function notifyOwner(projectId, userId, title, content) {
  await notificationService
    .notify({
      userId,
      projectId,
      type: notificationService.TYPES.ACCEPTANCE,
      title,
      content,
      refType: 'acceptance',
      refId: null,
    })
    .catch((err) => logger.warn('电子签通知发送失败', { projectId, userId, err }))
}

function toSqlTime(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return datetime.format()
  return datetime.format(date)
}

async function retryArchive(acceptanceId) {
  const task = await esignTaskModel.findLatestByAcceptance(acceptanceId)
  if (!task || task.status !== 'signed' || !task.signed_document_key) {
    throw AppError.conflict('电子签名尚未完成归档')
  }
  await acceptanceModel.updatePdfState(acceptanceId, {
    status: 'success',
    key: task.signed_document_key,
    private: true,
    sha256: task.signed_document_hash,
    source: 'signed',
    error: null,
  })
}

async function getSignedDocument(userId, acceptanceId) {
  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)
  assertPrimaryOwner(viewer, '下载签署文件')
  const task = await esignTaskModel.findLatestByAcceptance(acceptanceId)
  if (!task || !task.signed_document_key) throw AppError.notFound('签署文件尚未生成')

  const buffer = await storage.readPrivate(task.signed_document_key)
  await operationLog.record({
    operatorType: 'user',
    operatorId: userId,
    action: operationLog.ACTIONS.ACCEPTANCE_ESIGN_DOWNLOAD,
    targetType: 'acceptance',
    targetId: acceptance.id,
    projectId: acceptance.project_id,
    detail: { after: { taskId: task.id, kind: 'signed' } },
  })
  return { buffer, filename: `验收确认书-${acceptance.id}.pdf` }
}

async function getEvidence(acceptanceId) {
  const task = await esignTaskModel.findLatestByAcceptance(acceptanceId)
  if (!task || !task.evidence_key) throw AppError.notFound('证据报告尚未生成')

  const buffer = await storage.readPrivate(task.evidence_key)
  const ext = String(task.evidence_key).toLowerCase().endsWith('.json') ? 'json' : 'pdf'
  return { buffer, ext, task }
}

async function recordEvidenceDownload(acceptanceId, userId) {
  const acceptance = await acceptanceModel.findById(acceptanceId)
  if (!acceptance) return
  await operationLog.record({
    operatorType: userId ? 'user' : 'system',
    operatorId: userId || null,
    action: operationLog.ACTIONS.ACCEPTANCE_ESIGN_DOWNLOAD,
    targetType: 'acceptance',
    targetId: acceptanceId,
    projectId: acceptance.project_id,
    detail: { after: { kind: 'evidence' } },
  })
}

module.exports = {
  describe,
  getStatus,
  createTask,
  sync,
  syncTask,
  cancel,
  assertNoActiveTask,
  handleCallback,
  processEvent,
  processTask,
  retryArchive,
  getSignedDocument,
  getEvidence,
  recordEvidenceDownload,
  ensureAvailable,
  DEFAULT_CONSENT,
}
