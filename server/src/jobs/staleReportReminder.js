'use strict'

/**
 * 工长连续未汇报提醒（C-2.11 / AC-P23，B-5.2 可配天数）。
 *
 * AC-P23：工长连续 3 个自然日（Asia/Shanghai）未提交任何汇报，
 * 向管理员与业主**各推送一次**提醒；第 4 天不重复推送。
 *
 * ── 「只发一次」靠什么保证 ──
 * `reminder_log` 对 `(type, ref_type, ref_id, target_user_id)` 有唯一索引。
 * 发送前先抢占式插入，撞键就说明发过了。
 * 用「先查再插」在多实例部署下会双发 —— 两个进程同时查到「没发过」。
 *
 * ── 为什么用「上次汇报时间」而不是「记录已提醒过」 ──
 * 后者需要一张额外的状态表，且工长一旦汇报就要清理状态。
 * 前者的语义更直接：距上次汇报超过 N 天就提醒一次，
 * 提醒记录本身（reminder_log）保证同一段静默期只提醒一次。
 *
 * ── 提醒的 ref_id 用「上次汇报的时间戳」 ──
 * 这是让「第 4 天不重复推送」成立的关键：静默期内 ref_id 不变，唯一索引挡住重复；
 * 工长一旦汇报，上次汇报时间变了，ref_id 随之变化，下一个静默期可以再提醒一次。
 * 若用 project_id 做 ref_id，一个项目一辈子只会提醒一次。
 */

const db = require('../db/pool')
const logger = require('../utils/logger')
const datetime = require('../utils/datetime')
const notificationService = require('../services/notification.service')
const adminNotification = require('../services/adminNotification.service')
const sysConfigService = require('../services/sysConfig.service')

/**
 * 扫描一次并发送提醒。
 *
 * 导出为独立函数而不是藏在定时器里，是为了让测试与运维能按需手动触发一次
 * （冒烟脚本也用它），而不是只能等定时器。
 *
 * @returns {Promise<{scanned: number, reminded: number}>}
 */
async function runOnce({ now = datetime.now() } = {}) {
  // 提醒阈值按租户配置，逐租户取（有进程内缓存）
  const staleDaysByTenant = new Map()

  // 只处理「施工中」的项目：待开工还没开工，已完工/已归档不需要催进度
  const projects = await db.query(
    // 这里**不再**需要 SELECT `created_by`：管理员那一侧的查询已经收进
    // `adminNotification.notifyProjectAdmin`（它自己查 project）。
    // 之前正是漏 SELECT 这一列，让 `notifyProjectAdmin` 里的
    // `if (!project.created_by) return` 静默短路，管理员那条提醒一条都没发出去
    // （CLAUDE.md 第 55 条）。把查询收进被调用方之后，这种漏列就不可能再发生
    `SELECT p.id, p.tenant_id, p.name, p.created_at,
            (SELECT MAX(r.created_at) FROM progress_report r
              WHERE r.project_id = p.id AND r.deleted_at IS NULL) AS last_report_at
       FROM project p
       JOIN tenant t ON t.id = p.tenant_id AND t.deleted_at IS NULL
      WHERE p.status = 'building' AND p.deleted_at IS NULL
        AND t.status = 'active'
        AND (t.expires_at IS NULL OR t.expires_at > NOW())`
  )

  let reminded = 0

  for (const project of projects) {
    if (!staleDaysByTenant.has(project.tenant_id)) {
      staleDaysByTenant.set(project.tenant_id, await sysConfigService.getInt(project.tenant_id, 'stale_report_days'))
    }
    const staleDays = staleDaysByTenant.get(project.tenant_id)

    // 从未汇报过的项目：以建档时间作为静默起点。
    // 若以「永不提醒」处理，一个建档后就没人管的项目会永远不产生提醒 ——
    // 而那恰恰是最需要被发现的
    const anchor = project.last_report_at || project.created_at
    const silentDays = datetime.diffCalendarDays(anchor, now)

    if (!Number.isFinite(silentDays) || silentDays < staleDays) continue

    // 静默期的起点作为 ref_id：同一段静默期内不变（唯一索引挡住重复），
    // 工长汇报后自动变化（下一个静默期可再次提醒）
    const refId = Math.floor(datetime.parse(anchor).valueOf() / 1000)

    // AC-P23 要求「向**管理员**与业主各推送一次」。
    // 管理员在 admin_user 表、业主在 user 表，是两套主体，因此走两条通道 ——
    // 把 admin_user.id 塞进 notification.user_id 会给不相干的 C 端用户发消息
    await adminNotification
      .notifyProjectAdmin({
        projectId: project.id,
        title: '项目已连续多日没有进度汇报',
        content: `「${project.name}」已有 ${silentDays} 天没有收到进度汇报，请关注`,
      })
      .catch((err) => {
        // 管理员侧发失败不影响业主侧：两者是独立的通道
        logger.error('未汇报提醒的管理员侧发送失败', { projectId: project.id, message: err.message })
      })

    const targets = await findReminderTargets(project.id)
    if (targets.length === 0) continue

    const results = await notificationService.notifyMany(targets, {
      projectId: project.id,
      // reminderType 决定去重键（reminder_log.type 的枚举），
      // type 是消息中心里的分类（notification.type 的枚举）——
      // 两者枚举不同，混用会被 MySQL 静默截断成空串
      reminderType: 'stale_report',
      type: notificationService.TYPES.PROGRESS,
      refType: 'project',
      refId,
      title: '项目已连续多日没有进度汇报',
      content: `「${project.name}」已有 ${silentDays} 天没有收到进度汇报，请关注`,
    })

    const sent = results.filter((r) => r.sent).length
    reminded += sent

    if (sent > 0) {
      logger.info('已发送未汇报提醒', { projectId: project.id, silentDays, sent })
    }
  }

  return { scanned: projects.length, reminded }
}

/**
 * 提醒对象：本项目的**业主**（AC-P23 的「向…业主各推送一次提醒」）。
 *
 * 「管理员」那一半由 `adminNotification.notifyProjectAdmin` 走后台通道发送 ——
 * `notification.user_id` 指向 C 端 user 表，而后台管理员在 admin_user 表，
 * 两者是不同的主体集合。把 `project.created_by` 直接塞进 `user_id`，
 * 会给一个**毫不相干的 C 端用户**发消息，是数据串号而非功能缺失。
 *
 * ── 不通知工长本人 ──
 * 静默的正是工长。文档说的是通知「管理员与业主」，
 * 给他自己也发一条「你已经 3 天没汇报了」并不会改变他没汇报的事实。
 *
 * 只取 active 成员：pending 还没确认的人拿到提醒会一头雾水（AC-AD18）。
 * 同样排除已注销账号 —— 他们要么已经退出项目（注销时解除了成员关系），
 * 要么是历史遗留数据，给一个匿名化账号发提醒没有任何意义。
 */
async function findReminderTargets(projectId) {
  const rows = await db.query(
    `SELECT DISTINCT u.id
       FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pm.project_id = ?
        AND pm.role = 'owner'
        AND pm.status = 'active'
        AND pm.deleted_at IS NULL`,
    [projectId]
  )

  return rows.map((r) => r.id)
}

/** 定时器句柄 */
let timer = null

/** 扫描间隔：每小时一次。AC-P23 的粒度是「天」，一小时扫一次足够且几乎无成本 */
const INTERVAL_MS = 60 * 60 * 1000

/** 启动定时任务。由 server.js 调用，测试不启动 */
function start() {
  if (timer) return timer
  timer = setInterval(() => {
    runOnce().catch((err) => {
      // 定时任务抛错不该让进程退出：下一个小时还会再跑
      logger.error('未汇报提醒任务执行失败', { err })
    })
  }, INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()

  logger.info('未汇报提醒定时任务已启动', { intervalMs: INTERVAL_MS })
  return timer
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { runOnce, findReminderTargets, start, stop, INTERVAL_MS }
