'use strict'

/**
 * 验收单当前轮次的三方签署摘要（工长 / 监理 / 业主）。
 *
 * ── 为什么单独抽成纯函数 ──
 * 验收详情接口和 PDF 渲染都要回答「这一轮谁签了、谁还没签、谁是未配置监理」。
 * 两处各写一遍，最容易出现的分歧是「详情显示已签、PDF 显示未采集」。
 * 这里只依赖 flow 行与少量上下文，不查库，单测可以直接覆盖。
 *
 * ── 轮次 ──
 * 只取指定 round 的记录。签名跟着流转记录走，重新提交后旧轮次签名保留，
 * 但当前详情 / PDF 只展示最终轮次的签署状态。
 */

const ROLE_LABELS = {
  foreman: '工长',
  supervisor: '监理',
  owner: '业主',
}

const SIGNATURE_STATES = {
  SIGNED: 'signed',
  MISSING: 'missing',
  SKIPPED: 'skipped',
  PROVIDER: 'provider',
}

function operatorOf(row) {
  if (!row) return null
  if (row.operator) return row.operator
  if (row.real_name) return row.real_name
  if (row.nickname) return row.nickname
  return row.operator_id ? `用户${row.operator_id}` : null
}

function signatureUrlOf(row) {
  if (!row) return null
  return row.signature_url || row.signatureUrl || null
}

/** 私有存储 key（新数据）；历史数据没有这一列，返回 null */
function signatureKeyOf(row) {
  if (!row) return null
  return row.signature_key || row.signatureKey || null
}

/** 有 URL 或有私有 key，都算「这张单子上采集过签名」 */
function hasSignatureOf(row) {
  return Boolean(signatureUrlOf(row) || signatureKeyOf(row))
}

function operatedAtOf(row) {
  if (!row) return null
  return row.operated_at || row.operatedAt || null
}

/** 同一 step 可能有多条（例如多次提交），取最后一条非驳回记录 */
function latest(rows, step) {
  const matched = rows.filter((row) => row.step === step && row.action !== 'reject')
  return matched.length ? matched[matched.length - 1] : null
}

function signedState(row) {
  return {
    state: SIGNATURE_STATES.SIGNED,
    stateLabel: '已签署',
    signed: true,
    signatureUrl: signatureUrlOf(row),
    signatureKey: signatureKeyOf(row),
    source: 'flow',
    operator: operatorOf(row),
    signedAt: operatedAtOf(row),
  }
}

function missingState(row, label) {
  return {
    state: SIGNATURE_STATES.MISSING,
    stateLabel: label,
    signed: false,
    signatureUrl: null,
    signatureKey: null,
    source: null,
    operator: operatorOf(row),
    signedAt: null,
  }
}

/**
 * @param {Array<object>} flow `acceptanceModel.listFlow` 或冻结快照里的 flow
 * @param {object} options
 * @param {number} options.round 当前轮次
 * @param {boolean} [options.hasSupervisor] 项目当前是否有 active 监理
 * @param {boolean} [options.providerMode] 业主是否走可靠电子签
 * @param {boolean} [options.providerSigned] 可靠电子签是否已完成
 * @param {{signatureUrl: string, signedAt?: string}|null} [options.ownerFallback]
 *   历史单据的业主签名兼容字段（acceptance.signature_url）
 * @param {string|null} [options.status] 验收单状态；passed 时缺失签名显示「未采集」
 * @returns {{round: number, mode: string, foreman: object, supervisor: object, owner: object}}
 */
function collectRoundSignatures(
  flow,
  {
    round,
    hasSupervisor = false,
    providerMode = false,
    providerSigned = false,
    ownerFallback = null,
    status = null,
  } = {}
) {
  const roundNumber = Number(round) || 1
  const rows = (flow || []).filter((row) => Number(row.round) === roundNumber)
  const missingLabel = status === 'passed' ? '未采集' : '待签署'

  const foremanRow = latest(rows, 'self_check')
  const foreman = {
    role: 'foreman',
    roleLabel: ROLE_LABELS.foreman,
    required: true,
    ...(hasSignatureOf(foremanRow) ? signedState(foremanRow) : missingState(foremanRow, missingLabel)),
  }

  const supervisorRow = latest(rows, 'supervisor')
  // 曾经有监理签过、之后被移除：以 flow 为准，仍然展示「已签署」；
  // 只有既没有 active 监理、也没有监理记录时才是「已跳过」。
  const supervisorConfigured = Boolean(hasSupervisor || supervisorRow)
  const supervisor = supervisorConfigured
    ? {
        role: 'supervisor',
        roleLabel: ROLE_LABELS.supervisor,
        required: true,
        configured: true,
        ...(hasSignatureOf(supervisorRow)
          ? signedState(supervisorRow)
          : missingState(supervisorRow, missingLabel)),
      }
    : {
        role: 'supervisor',
        roleLabel: ROLE_LABELS.supervisor,
        required: false,
        configured: false,
        state: SIGNATURE_STATES.SKIPPED,
        stateLabel: '未配置监理，已跳过',
        signed: false,
        signatureUrl: null,
        signatureKey: null,
        source: null,
        operator: null,
        signedAt: null,
      }

  const ownerRow = latest(rows, 'owner')
  let owner

  if (hasSignatureOf(ownerRow)) {
    owner = { role: 'owner', roleLabel: ROLE_LABELS.owner, required: true, ...signedState(ownerRow) }
  } else if (ownerFallback && (ownerFallback.signatureUrl || ownerFallback.signatureKey)) {
    // 迁移 036 之前的历史单据：业主签名只在 acceptance.signature_url
    owner = {
      role: 'owner',
      roleLabel: ROLE_LABELS.owner,
      required: true,
      state: SIGNATURE_STATES.SIGNED,
      stateLabel: '已签署',
      signed: true,
      signatureUrl: ownerFallback.signatureUrl || null,
      signatureKey: ownerFallback.signatureKey || null,
      source: 'acceptance',
      operator: operatorOf(ownerRow),
      signedAt: ownerFallback.signedAt || operatedAtOf(ownerRow),
    }
  } else if (providerSigned) {
    owner = {
      role: 'owner',
      roleLabel: ROLE_LABELS.owner,
      required: true,
      state: SIGNATURE_STATES.PROVIDER,
      stateLabel: '已可靠电子签',
      signed: true,
      signatureUrl: null,
      signatureKey: null,
      source: 'provider',
      operator: operatorOf(ownerRow),
      signedAt: operatedAtOf(ownerRow),
    }
  } else {
    owner = {
      role: 'owner',
      roleLabel: ROLE_LABELS.owner,
      required: true,
      ...missingState(ownerRow, providerMode ? '待可靠电子签' : missingLabel),
    }
  }

  return {
    round: roundNumber,
    mode: providerMode ? 'provider' : 'legacy',
    foreman,
    supervisor,
    owner,
  }
}

module.exports = {
  ROLE_LABELS,
  SIGNATURE_STATES,
  collectRoundSignatures,
}
