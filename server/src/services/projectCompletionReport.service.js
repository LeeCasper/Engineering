'use strict'

/**
 * 项目竣工总报告（项目级归档）。
 *
 * ── 与验收报告的区别 ──
 * 验收报告在**每张验收单通过时**生成，证明某个阶段/工序的验收结论；
 * 本模块在项目「已完工 / 已归档」后按需生成一份项目级汇总，用于归档与交付。
 * 它不改变任何业务状态，也不替代验收报告。
 *
 * ── 谁能看 ──
 * C 端只允许业主 / 工长：报告包含账务汇总，而监理在系统里看不到项目账目。
 * 后台管理员按 dataScope 访问；平台账号的只读排障窗口可以下载，但不能触发重新生成。
 */

const crypto = require('node:crypto')

const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const logger = require('../utils/logger')
const money = require('../utils/money')
const progressUtil = require('../utils/progress')
const storage = require('../storage')
const signedUrl = require('../utils/signedUrl')
const projectModel = require('../models/project.model')
const tenantModel = require('../models/tenant.model')
const projectStageModel = require('../models/projectStage.model')
const projectMemberModel = require('../models/projectMember.model')
const acceptanceModel = require('../models/acceptance.model')
const paymentNodeModel = require('../models/paymentNode.model')
const ledgerModel = require('../models/ledger.model')
const reportModel = require('../models/projectCompletionReport.model')
const projectAccess = require('./projectAccess.service')
const pdf = require('./projectCompletionPdf.service')

const STATUS_LABELS = { pending: '待开工', building: '施工中', finished: '已完工', archived: '已归档' }
const GATE_LABELS = {
  active: '进行中',
  locked: '未解锁',
  pending_acceptance: '待验收',
  accepted: '已验收',
  disputed: '有异议',
  settled: '已结清',
}
const PAYMENT_STATUS_LABELS = {
  not_started: '未开始',
  unlocked: '已解锁',
  paid: '已付款',
  confirmed: '已确认',
}
const REPORTABLE = new Set(['finished', 'archived'])
/** 生成中状态超过这个时间视为上次生成异常中断，允许重新触发 */
const PENDING_STALE_MS = 5 * 60 * 1000

function statusLabel(project) {
  return STATUS_LABELS[project.status] || project.status
}

/** C 端：只有项目成员中的业主 / 工长可以看；监理不参与账务，也不看总报告 */
async function loadMiniProject(userId, projectId) {
  const membership = await projectMemberModel.findActiveRole(projectId, userId)
  if (!membership) throw AppError.notFound('项目不存在')
  if (!['owner', 'foreman'].includes(membership.role)) {
    throw AppError.forbidden('监理不参与项目竣工总报告')
  }

  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')
  return project
}

function assertReportable(project) {
  if (!REPORTABLE.has(project.status)) {
    throw AppError.conflict('项目尚未完工，竣工总报告只能在「已完工」或「已归档」后生成')
  }
}

function signedPathFor(projectId) {
  return signedUrl.buildPath({
    resource: 'project-completion-report',
    id: projectId,
    path: `/api/v1/completion-reports/${projectId}/report.pdf`,
  })
}

/**
 * 报告状态。前端据此决定按钮是「生成」「生成中」「下载」还是「重试」。
 * 不返回 file_url —— 只下发带时效的签名路径，避免永久直链被转发。
 */
async function getState(project) {
  const row = await reportModel.findByProject(project.id)

  return {
    available: REPORTABLE.has(project.status),
    status: row ? row.status : 'none',
    generatedAt: row ? row.generated_at : null,
    error: row ? row.error : null,
    signedPath: row && row.status === 'success' ? signedPathFor(project.id) : null,
  }
}

async function getMiniState(userId, projectId) {
  const project = await loadMiniProject(userId, projectId)
  return getState(project)
}

async function generateMini(userId, projectId, { force = false } = {}) {
  const project = await loadMiniProject(userId, projectId)
  return generate(project, { operatorId: userId, operatorType: 'user', force })
}

async function getAdminState(operator, projectId) {
  const project = await projectAccess.load(operator, projectId)
  return getState(project)
}

async function generateAdmin(operator, projectId, { force = false } = {}) {
  const project = await projectAccess.load(operator, projectId)
  // 平台持授权进入是只读排障窗口；生成会写文件与报告状态，不属于只读
  if (operator.role === 'platform') {
    throw AppError.forbidden('平台账号仅可查看竣工总报告，不能生成')
  }
  return generate(project, { operatorId: operator.id, operatorType: 'admin', force })
}

async function generate(project, { operatorId, operatorType, force = false }) {
  assertReportable(project)

  const existing = await reportModel.findByProject(project.id)
  if (!force && existing && existing.status === 'success') return getState(project)
  if (existing && existing.status === 'pending' && isFreshPending(existing)) return getState(project)

  await reportModel.markPending(project.id, { operatorId, operatorType })

  try {
    const snapshot = await buildSnapshot(project)
    const buffer = await pdf.render(snapshot)
    const saved = await storage.saveGenerated(buffer, {
      category: 'project-completion-reports',
      ext: 'pdf',
    })
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

    await reportModel.markSuccess(project.id, { url: saved.url, key: saved.key, sha256 })
    // 重新生成时清理上一份归档文件；失败只记 warn，不影响新报告
    if (existing && existing.file_url && existing.file_url !== saved.url) {
      await storage.remove(storage.extractKey(existing.file_url))
    }
    logger.info('项目竣工总报告已生成', { projectId: project.id, sizeBytes: saved.sizeBytes })
  } catch (err) {
    // 重新生成失败时保留上一版成功报告：归档材料不应因一次刷新失败而不可下载
    if (existing && existing.status === 'success' && existing.file_url) {
      await reportModel.restoreSuccess(
        project.id,
        existing,
        `本次重新生成失败，已保留上一版报告：${err.message}`
      )
      logger.warn('项目竣工总报告重新生成失败，已保留上一版', { projectId: project.id, err })
    } else {
      // 首次生成失败不改变项目状态；前端展示失败原因并允许重试
      await reportModel.markFailed(project.id, err.message)
      logger.error('项目竣工总报告生成失败', { projectId: project.id, err })
    }
  }

  return getState(project)
}

function isFreshPending(row) {
  const updatedAt = datetime.parse(row.updated_at)
  return Boolean(updatedAt && Date.now() - updatedAt.valueOf() < PENDING_STALE_MS)
}

async function buildSnapshot(project) {
  const [tenant, stages, members, acceptances, paymentNodes, totals] = await Promise.all([
    project.tenant_id ? tenantModel.findById(project.tenant_id) : null,
    projectStageModel.findTreeByProject(project.id),
    projectMemberModel.listByProject(project.id),
    acceptanceModel.listPassedByProject(project.id),
    paymentNodeModel.listByProject(project.id),
    ledgerModel.sumByType(project.id),
  ])

  const stageAcceptance = new Map()
  for (const acceptance of acceptances) {
    if (acceptance.type === 'stage' && acceptance.project_stage_id) {
      stageAcceptance.set(Number(acceptance.project_stage_id), acceptance)
    }
  }

  const stageViews = stages.map((stage) => {
    const acceptance = stageAcceptance.get(Number(stage.id))
    const accepted = Boolean(acceptance) || ['accepted', 'settled'].includes(stage.gate_status)
    return {
      seq: stage.seq,
      name: stage.name,
      progress: formatPercent(stage.progress),
      gateLabel: GATE_LABELS[stage.gate_status] || stage.gate_status,
      acceptanceLabel: accepted ? '已通过' : '未验收',
      acceptedAt: acceptance && acceptance.finished_at ? datetime.format(acceptance.finished_at) : null,
    }
  })

  const acceptedStages = stageViews.filter((stage) => stage.acceptanceLabel === '已通过')
  const pendingStageNames = stageViews
    .filter((stage) => stage.acceptanceLabel !== '已通过')
    .map((stage) => stage.name)

  const activeMembers = members.filter((member) => member.status === 'active')
  const memberViews = activeMembers.map((member) => ({
    roleLabel: memberRoleLabel(member),
    name: member.nickname || maskPhone(member.phone) || `用户 #${member.user_id}`,
    identityLabel:
      member.role === 'owner'
        ? member.owner_type === 'primary'
          ? '主要负责人'
          : '项目成员'
        : member.is_primary === 1
          ? '主要负责人'
          : '项目成员',
    joinedAt: formatDate(member.confirmed_at || member.created_at),
  }))

  const acceptanceViews = acceptances.map((acceptance) => ({
    no: `AC-${acceptance.id}`,
    typeLabel: acceptance.type === 'item' ? '工序验收' : '阶段验收',
    targetLabel: acceptance.type === 'item'
      ? `${acceptance.stage_name || '—'} · ${acceptance.item_name || '—'}`
      : acceptance.stage_name || '—',
    round: Number(acceptance.resubmit_count || 0) + 1,
    finishedAt: acceptance.finished_at ? datetime.format(acceptance.finished_at) : null,
    signatureLabel: signatureLabel(acceptance),
  }))

  const paymentViews = paymentNodes.map((node) => ({
    seq: node.seq,
    name: node.name,
    amount: node.amount,
    statusLabel: PAYMENT_STATUS_LABELS[node.status] || node.status,
    unlockedAt: node.unlocked_at ? datetime.format(node.unlocked_at) : null,
  }))

  const income = totals.income
  const expense = totals.expense
  const finance = {
    contractAmount: project.contract_amount,
    income,
    expense,
    pending: money.subtract(project.contract_amount, income),
    balance: money.subtract(income, expense),
  }

  const itemCount = stages.reduce((sum, stage) => sum + (stage.items ? stage.items.length : 0), 0)
  const legacySignatureCount = acceptances.filter(
    (acceptance) => acceptance.signature_mode !== 'provider' && Boolean(acceptance.signature_url)
  ).length
  const esignCount = acceptances.filter(
    (acceptance) => acceptance.signature_mode === 'provider' || acceptance.esign_status === 'signed'
  ).length

  return {
    reportNo: `PCR-${project.id}-${datetime.now().format('YYYYMMDDHHmmss')}`,
    generatedAt: datetime.format(),
    project: {
      id: project.id,
      name: project.name,
      address: project.address,
      tenantName: tenant ? tenant.name : null,
      statusLabel: statusLabel(project),
      startDate: formatDate(project.start_date),
      planEndDate: formatDate(project.plan_end_date),
      actualEndDate: formatDate(project.actual_end_date),
      progress: formatPercent(
        progressUtil.projectProgress(stages.map((stage) => ({ progress: stage.progress, weight: stage.weight })))
      ),
    },
    summary: {
      stageCount: stages.length,
      itemCount,
      acceptedStageCount: acceptedStages.length,
      pendingStageNames,
      passedAcceptanceCount: acceptances.length,
      legacySignatureCount,
      esignCount,
    },
    members: memberViews,
    stages: stageViews,
    acceptances: acceptanceViews,
    paymentNodes: paymentViews,
    finance,
  }
}

function memberRoleLabel(member) {
  if (member.role === 'owner') {
    return member.owner_type === 'primary' ? '主业主' : '临时业主'
  }
  if (member.role === 'foreman') {
    return member.is_primary === 1 ? '主工长' : '工长'
  }
  return '监理'
}

function signatureLabel(acceptance) {
  if (acceptance.signature_mode === 'provider' || acceptance.esign_status === 'signed') {
    return '可靠电子签'
  }
  if (acceptance.signature_url) return '手写签名'
  return '—'
}

function formatDate(value) {
  return value ? datetime.formatDate(value) : null
}

/** 进度是百分比，不是金额；去掉 DECIMAL 带出来的多余小数位 */
function formatPercent(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : '0'
}

function maskPhone(phone) {
  if (!phone) return null
  const value = String(phone)
  if (value.length === 11) return `${value.slice(0, 3)}****${value.slice(-4)}`
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(1, value.length - 4))}${value.slice(-2)}`
}

module.exports = {
  getMiniState,
  generateMini,
  getAdminState,
  generateAdmin,
  getState,
  signedPathFor,
}
