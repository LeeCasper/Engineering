'use strict'

/**
 * 付款节点配置（B-2.8 / AC-AD22 / AC-L18）。
 *
 * **本模块不涉及任何支付功能**（§4.4.3）：节点只是「什么时候该收多少钱」的
 * 记账锚点，实际收款走线下转账，由工长在记账模块手工登记。
 */

const AppError = require('../utils/AppError')
const money = require('../utils/money')
const projectAccess = require('./projectAccess.service')
const db = require('../db/pool')
const projectStageModel = require('../models/projectStage.model')
const paymentNodeModel = require('../models/paymentNode.model')

const TRIGGER_TYPES = ['manual', 'stage_acceptance']

async function loadProject(operator, projectId) {
  // 付款节点配置是写操作，归档项目一律拒绝（AC-AD25）
  return projectAccess.load(operator, projectId, { requireWritable: true })
}

async function list(operator, projectId) {
  const project = await loadProject(operator, projectId)
  const nodes = await paymentNodeModel.listByProject(projectId)

  const total = money.sum(nodes.map((n) => n.amount))
  const diff = money.subtract(project.contract_amount, total)

  return {
    nodes: nodes.map(toView),
    // AC-L18：各节点金额之和与合同总额不一致时给出提示，**允许保存**
    contractAmount: project.contract_amount,
    nodesTotal: total,
    difference: diff,
    mismatched: !money.isZero(diff),
  }
}

function toView(node) {
  return {
    id: node.id,
    seq: node.seq,
    name: node.name,
    amount: node.amount,
    triggerType: node.trigger_type,
    triggerStageId: node.trigger_stage_id,
    status: node.status,
    statusLabel: { not_started: '未开始', unlocked: '已解锁', paid: '已付款', confirmed: '已确认' }[node.status] || node.status,
    unlockedAt: node.unlocked_at,
  }
}

/**
 * 整体替换付款节点配置（B-2.8）。
 *
 * ── 为什么是整体替换而不是逐条增删改 ──
 * 节点是一个**有序整体**（定金 → 开工款 → … → 尾款），顺序与金额之和共同构成配置。
 * 逐条 diff 需要前端跟踪每个节点的 id 与变更类型，而管理员实际使用时
 * 几乎总是整体重排一次。整表替换的代码量与出错面都小得多。
 *
 * 代价是节点 id 会变，因此已产生收入流水的项目**不允许**替换 ——
 * `ledger.payment_node_id` 指向节点，替换会让已登记的收入指到一个被软删的节点上，
 * 破坏 AC-L05「一个付款节点只有一条收入流水」的可追溯性。
 */
async function replaceAll(operator, projectId, nodes) {
  const project = await loadProject(operator, projectId)

  const referenced = await paymentNodeModel.countReferencedByLedger(projectId)
  if (referenced > 0) {
    throw AppError.conflict(
      `该项目已有 ${referenced} 条流水关联付款节点，无法整体重排。如需调整请仅在记账模块内处理`
    )
  }

  // 校验阶段归属：AC-AD22 要求「关联阶段时只能选择本项目已有阶段」
  const stages = await projectStageModel.findTreeByProject(projectId)
  const stageIds = new Set(stages.map((s) => s.id))

  const normalized = nodes.map((node, index) => {
    const amountCheck = money.validate(node.amount)
    if (!amountCheck.ok) {
      throw AppError.badRequest(`第 ${index + 1} 个节点「${node.name}」的金额不合法：${amountCheck.reason}`)
    }

    if (!TRIGGER_TYPES.includes(node.triggerType)) {
      throw AppError.badRequest(`第 ${index + 1} 个节点的触发方式不合法`)
    }

    if (node.triggerType === 'stage_acceptance') {
      if (!node.triggerStageId) {
        throw AppError.badRequest(`第 ${index + 1} 个节点选择「阶段验收后解锁」时必须指定阶段`)
      }
      if (!stageIds.has(Number(node.triggerStageId))) {
        throw AppError.badRequest(`第 ${index + 1} 个节点关联的阶段不属于本项目`)
      }
    }

    return {
      name: node.name,
      amount: amountCheck.value,
      triggerType: node.triggerType,
      triggerStageId: node.triggerType === 'stage_acceptance' ? Number(node.triggerStageId) : null,
    }
  })

  await db.withTransaction(async (tx) => {
    await paymentNodeModel.replaceAll(projectId, normalized, tx)
  })

  const total = money.sum(normalized.map((n) => n.amount))
  const diff = money.subtract(project.contract_amount, total)

  return {
    count: normalized.length,
    nodesTotal: total,
    contractAmount: project.contract_amount,
    difference: diff,
    // AC-L18：只在响应里告警，不阻断保存
    mismatched: !money.isZero(diff),
    warning: money.isZero(diff) ? null : `各节点金额之和与合同额相差 ${diff}，请确认是否遗漏节点`,
  }
}

module.exports = { TRIGGER_TYPES, list, replaceAll, toView }
