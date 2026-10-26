'use strict'

/**
 * 验收通过后的联动：解锁付款节点 + 通知 + 报告归档。
 *
 * 从 acceptance.service 抽出来，是为了让电子签回调处理也能调用，
 * 同时避免 acceptance.service ↔ esign.service 的循环 require（CLAUDE.md 第 63 条）。
 *
 * `post_pass_status` 记录联动结果：已签/已通过是事实，不因付款节点解锁失败而回滚；
 * 失败由 acceptancePostPassRetry 定时补。
 */

const db = require('../db/pool')
const datetime = require('../utils/datetime')
const logger = require('../utils/logger')
const notificationService = require('./notification.service')
const acceptancePdfService = require('./acceptancePdf.service')
const acceptanceModel = require('../models/acceptance.model')
const paymentNodeModel = require('../models/paymentNode.model')
const projectStageModel = require('../models/projectStage.model')

async function finalizeAfterPass(acceptance, operatorId, { generatePdf = true } = {}) {
  try {
    await unlockPaymentNodes(acceptance)
    await notifyPassed(acceptance)

    if (generatePdf) {
      await acceptancePdfService.generate(acceptance.id).catch((err) => {
        logger.error('验收报告 PDF 生成失败，已标记为可重试', { acceptanceId: acceptance.id, err })
      })
    }

    await acceptanceModel.updatePostPassState(acceptance.id, {
      status: 'done',
      error: null,
      doneAt: datetime.format(),
    })

    logger.info('验收通过后的联动处理完成', { acceptanceId: acceptance.id, operatorId })
  } catch (err) {
    await acceptanceModel.updatePostPassState(acceptance.id, {
      status: 'failed',
      error: String(err.message || '未知错误').slice(0, 500),
    })
    throw err
  }
}

/** AC-A21 / C-3.11 / AC-L14：解锁关联该阶段的付款节点 */
async function unlockPaymentNodes(acceptance) {
  if (!acceptance.project_stage_id) return []

  const unlocked = await db.withTransaction((tx) =>
    paymentNodeModel.unlockByStage(acceptance.project_id, acceptance.project_stage_id, tx)
  )

  if (unlocked.length === 0) return []

  const targets = await db.query(
    `SELECT DISTINCT user_id FROM project_member
      WHERE project_id = ? AND role IN ('foreman', 'owner') AND status = 'active' AND deleted_at IS NULL`,
    [acceptance.project_id]
  )

  for (const { user_id: userId } of targets) {
    await notificationService
      .notify({
        userId,
        projectId: acceptance.project_id,
        type: notificationService.TYPES.PAYMENT,
        title: '付款节点已解锁',
        content: `验收通过，已解锁 ${unlocked.length} 个付款节点：${unlocked.map((n) => n.name).join('、')}`,
        refType: 'acceptance',
        refId: acceptance.id,
      })
      .catch((err) => logger.warn('付款节点解锁通知发送失败', { acceptanceId: acceptance.id, err }))
  }

  return unlocked
}

/** 验收通过后通知工长与业主 */
async function notifyPassed(acceptance) {
  const targets = await db.query(
    `SELECT DISTINCT user_id FROM project_member
      WHERE project_id = ? AND role IN ('foreman', 'owner') AND status = 'active' AND deleted_at IS NULL`,
    [acceptance.project_id]
  )

  const stage = acceptance.project_stage_id
    ? await projectStageModel.findById(acceptance.project_stage_id)
    : null

  for (const { user_id: userId } of targets) {
    await notificationService
      .notify({
        userId,
        projectId: acceptance.project_id,
        type: notificationService.TYPES.ACCEPTANCE,
        title: '验收已通过',
        content: stage ? `「${stage.name}」验收通过，已归档` : '验收通过，已归档',
        refType: 'acceptance',
        refId: acceptance.id,
      })
      .catch((err) => logger.warn('验收通过通知发送失败', { acceptanceId: acceptance.id, err }))
  }
}

module.exports = { finalizeAfterPass, unlockPaymentNodes, notifyPassed }
