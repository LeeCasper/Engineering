'use strict'

/**
 * 验收超时提醒（C-3.12 / AC-A22，B-5.3 可配时长）。
 *
 * AC-A22：验收单进入某角色「待我处理」超过 48 小时未处理，向该角色**推送一次**提醒，
 * 不重复推送。
 *
 * ── 计时起点用 `step_entered_at` 而不是 `submitted_at` ──
 * 前者在每次进入新环节时刷新，后者是「首次提交」且永不变更（G-01）。
 * 用 submitted_at 的话，一张被驳回过、刚重新提交的单会立刻被判为「超时 48 小时」——
 * 因为它的首次提交确实是几天前。那会让提醒完全失去意义。
 *
 * ── 「不重复推送」的粒度是「每一轮」而不是「每张单」──
 * 唯一键是 `(type, ref_type, ref_id, target_user_id)`，因此把轮次编进 `ref_type`：
 * 一张单被驳回后重新进入监理审核，监理应当被重新提醒 ——
 * 那是**新的一次等待**，不是同一次超时的重复。
 */

const db = require('../db/pool')
const logger = require('../utils/logger')
const datetime = require('../utils/datetime')
const notificationService = require('../services/notification.service')
const sysConfigService = require('../services/sysConfig.service')
const acceptanceModel = require('../models/acceptance.model')
const projectStageModel = require('../models/projectStage.model')

/** 环节 → 该环节的负责角色 */
const STEP_ROLE = {
  pending_supervisor: 'supervisor',
  pending_owner: 'owner',
}

const STEP_LABELS = { pending_supervisor: '监理审核', pending_owner: '业主确认' }

/**
 * 扫描一次并发送超时提醒。
 *
 * @returns {Promise<{scanned: number, reminded: number}>}
 */
async function runOnce({ now = datetime.now() } = {}) {
  // 超时时长按租户配置：每个候选自带 tenant_id，逐租户取值（配置有进程内缓存，成本很低）
  const timeoutHoursByTenant = new Map()

  const candidates = await acceptanceModel.listTimeoutCandidates()
  let reminded = 0

  for (const acceptance of candidates) {
    // 每个租户可能有不同的超时阈值；按需取一次并缓存
    if (!timeoutHoursByTenant.has(acceptance.tenant_id)) {
      timeoutHoursByTenant.set(
        acceptance.tenant_id,
        await sysConfigService.getInt(acceptance.tenant_id, 'acceptance_timeout_hours')
      )
    }
    const timeoutHours = timeoutHoursByTenant.get(acceptance.tenant_id)

    const waitedHours = datetime.diffHours(acceptance.step_entered_at, now)
    if (!Number.isFinite(waitedHours) || waitedHours < timeoutHours) continue

    const role = STEP_ROLE[acceptance.status]
    if (!role) continue

    const targets = await findStepHandlers(acceptance.project_id, role)
    if (targets.length === 0) continue

    const stage = acceptance.project_stage_id
      ? await projectStageModel.findById(acceptance.project_stage_id)
      : null

    // 轮次编进 ref_type：同一轮内只提醒一次，重新进入该环节后可再提醒
    const round = Number(acceptance.resubmit_count) + 1
    if (!Number.isFinite(round)) {
      // ── 这道防线不是多余的 ──
      // 曾经因为查询漏选 resubmit_count，这里算出 `acceptance_rNaN`。
      // 它**看起来像个正常键**，不会报错，只是恒定不变 ——
      // 于是所有轮次共用同一个去重键，第二轮的提醒被判为「已发过」而静默消失。
      // 宁可漏发一轮并留下日志，也不要出现「键存在但含义已经错了」的静默状态。
      logger.error('验收超时提醒：无法计算轮次，跳过该单', {
        acceptanceId: acceptance.id,
        resubmitCount: acceptance.resubmit_count,
      })
      continue
    }

    const refType = `acceptance_r${round}`

    const results = await notificationService.notifyMany(targets, {
      projectId: acceptance.project_id,
      reminderType: 'acceptance_timeout',
      type: notificationService.TYPES.ACCEPTANCE,
      refType,
      refId: acceptance.id,
      title: `验收单已等待超过 ${timeoutHours} 小时`,
      content: `「${stage ? stage.name : '验收单'}」的${STEP_LABELS[acceptance.status]}已等待 ${Math.floor(waitedHours)} 小时，请尽快处理`,
    })

    const sent = results.filter((r) => r.sent).length
    reminded += sent

    if (sent > 0) {
      logger.info('已发送验收超时提醒', { acceptanceId: acceptance.id, role, waitedHours: Math.floor(waitedHours) })
    }
  }

  return { scanned: candidates.length, reminded }
}

/** 当前环节的处理人。只取 active —— pending 还没确认邀请，催他没意义（AC-AD18） */
async function findStepHandlers(projectId, role) {
  const rows = await db.query(
    `SELECT DISTINCT u.id
       FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pm.project_id = ? AND pm.role = ? AND pm.status = 'active' AND pm.deleted_at IS NULL`,
    [projectId, role]
  )
  return rows.map((r) => r.id)
}

let timer = null
/** 每小时扫一次。AC-A22 的粒度是 48 小时，一小时一次足够且几乎无成本 */
const INTERVAL_MS = 60 * 60 * 1000

function start() {
  if (timer) return timer
  timer = setInterval(() => {
    runOnce().catch((err) => {
      // 定时任务抛错不该让进程退出：下一个小时还会再跑
      logger.error('验收超时提醒任务执行失败', { err })
    })
  }, INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()

  logger.info('验收超时提醒定时任务已启动', { intervalMs: INTERVAL_MS })
  return timer
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { runOnce, findStepHandlers, start, stop, INTERVAL_MS, STEP_ROLE }
