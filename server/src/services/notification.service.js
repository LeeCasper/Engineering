'use strict'

/**
 * 消息通知（AC-P22 / AC-P23 / AC-L30 / AC-U12）。
 *
 * 写侧（notify / notifyOnce）与读侧（listForUser / markRead / unreadSummary）
 * 放在同一个模块里，共用 TYPES 与过滤条件 —— 分类枚举只有一处定义，
 * 读写两侧就不可能对同一个 type 有不同理解。
 *
 * ── 两条送达通道，站内是兜底 ──
 * 微信订阅消息需要用户**逐次授权**，未授权时发不出去。而业务提醒不能因此丢失：
 * AC-U12 明确要求「用户拒绝授权后该条提醒仍完整记入站内消息中心」。
 * 因此每次通知都先落 `notification` 表（站内），再尝试微信推送。
 * 站内那条永远成功，微信那条尽力而为。
 *
 * ── 微信推送失败不抛错 ──
 * 订阅消息是通知的加速通道，不是业务本身。因为用户没授权 / 微信接口抖动
 * 而让「提交评论」这种主流程失败，是本末倒置。
 */

const config = require('../../config')
const logger = require('../utils/logger')
const notificationModel = require('../models/notification.model')
const sysConfigService = require('./sysConfig.service')
const db = require('../db/pool')

/** 站内消息类型。与 `notification.type` 的枚举一致（AC-U06 的四类 + system 兜底） */
const TYPES = {
  ACCEPTANCE: 'acceptance',
  PROGRESS: 'progress',
  PAYMENT: 'payment',
  COMMENT: 'comment',
  SYSTEM: 'system',
}

/**
 * 提醒类型 → 站内消息类型。
 *
 * ── 这两个枚举不是一回事，别混用 ──
 * `reminder_log.type`（去重用的「提醒种类」）是
 * `stale_report / acceptance_timeout / big_expense / abnormal_checkin`；
 * `notification.type`（消息中心里的分类）是
 * `acceptance / progress / payment / comment / system`。
 *
 * 把前者的值塞进后者，MySQL 会**静默**把 ENUM 截断成空串
 * （只报一个 WARN_DATA_TRUNCATED，不抛错），
 * 于是消息看起来写进去了、实际类型是空的，按分类筛选永远查不到。
 * 这个映射表就是防止两处枚举再次串号的地方。
 */
const REMINDER_TO_NOTIFICATION_TYPE = {
  stale_report: TYPES.PROGRESS,
  acceptance_timeout: TYPES.ACCEPTANCE,
  big_expense: TYPES.PAYMENT,
  // 异常签到是给管理员的告警，消息中心没有对应分类，归入 system
  abnormal_checkin: TYPES.SYSTEM,
  // 门锁密码风险提醒（AC-K15）。消息中心没有「门锁」分类，
  // 归入 system —— 但**它的 type 必须独立**：这个值进的是 reminder_log
  // 的去重键，借用 abnormal_checkin 会让两类提醒互相顶掉
  door_code_risk: TYPES.SYSTEM,
}

/**
 * 发一条通知。
 *
 * @param {object} params
 * @param {number} params.userId 接收人
 * @param {string} params.type TYPES 之一
 * @param {string} params.title
 * @param {string} [params.content]
 * @param {number} [params.projectId]
 * @param {string} [params.refType] 业务对象类型，供点击跳转（AC-U08）
 * @param {number} [params.refId]
 * @returns {Promise<{notificationId: number}>}
 */
async function notify(params) {
  const tenantId = await resolveTenantId(params)

  const notificationId = await notificationModel.create({
    userId: params.userId,
    tenantId,
    projectId: params.projectId,
    type: params.type,
    title: params.title,
    content: params.content,
    refType: params.refType,
    refId: params.refId,
  })

  // 微信订阅消息：尽力而为。
  // **必须带上解析后的 tenantId**：模板 ID 与订阅授权都是按租户存的，
  // 不带的话会去读平台默认配置（sys_config.tenant_id 是 NOT NULL，
  // 那一条永远查不到），表现为「站内消息到了、推送永远不发」
  await tryPushSubscribeMessage({ ...params, tenantId }).catch((err) => {
    logger.warn('微信订阅消息推送失败（站内消息已记录）', { userId: params.userId, message: err.message })
  })

  return { notificationId }
}

/**
 * 发一条**带去重**的提醒（AC-P23 的「同一提醒只发一次」、AC-A22、AC-L30）。
 *
 * 去重键由调用方给出（reminderType + refType + refId + targetUserId）。
 * 抢占失败说明已经发过，直接返回 false —— 定时任务因此可以放心地
 * 每分钟跑一次而不会重复打扰用户。
 *
 * @param {object} params
 * @param {string} params.reminderType 提醒种类，取值见 `reminder_log.type` 枚举
 * @param {string} params.type 站内消息分类，取值见 `notification.type` 枚举。
 *   **与 reminderType 不是一回事**，见 REMINDER_TO_NOTIFICATION_TYPE 的说明
 * @param {number} params.userId
 * @param {string} params.title
 * @param {string} [params.content]
 * @param {number} [params.projectId]
 * @param {string} [params.refType]
 * @param {number} [params.refId]
 * @returns {Promise<{sent: boolean, notificationId?: number}>}
 */
async function notifyOnce(params) {
  const claimed = await notificationModel.claimReminder({
    projectId: params.projectId,
    type: params.reminderType,
    refType: params.refType,
    refId: params.refId,
    targetUserId: params.userId,
    // 未授权订阅时记 inapp，便于运维区分「发了但没推」与「根本没发」
    channel: config.wechat.mock ? 'inapp' : 'subscribe',
  })

  if (!claimed) return { sent: false }

  try {
    const { notificationId } = await notify({
      ...params,
      // 推送用的模板 ID 要按租户取；这里把租户一起传下去
      tenantId: await resolveTenantId(params),
      type: params.type || REMINDER_TO_NOTIFICATION_TYPE[params.reminderType] || TYPES.SYSTEM,
    })
    return { sent: true, notificationId }
  } catch (err) {
    // ── 抢占成功但通知写失败时，必须把去重键释放掉 ──
    // 不释放的话，这条提醒就**永久丢了**：下次运行会因为「已发过」被跳过，
    // 而用户其实一条都没收到。释放之后下一次运行会正常重试。
    //
    // 窗口期内的并发重复（释放前另一个进程刚好跑到）代价是多发一条通知，
    // 比永久漏发一条提醒轻得多 —— 提醒的价值就在于它真的会到。
    //
    // 释放本身失败只记日志：原始异常才是排查依据，不能被清理动作盖掉
    await notificationModel
      .releaseReminderClaim({
        projectId: params.projectId,
        type: params.reminderType,
        refType: params.refType,
        refId: params.refId,
        targetUserId: params.userId,
      })
      .catch((releaseErr) => {
        logger.error('释放提醒去重键失败，该提醒可能被永久跳过', {
          reminderType: params.reminderType,
          refId: params.refId,
          message: releaseErr.message,
        })
      })

    throw err
  }
}

/** 批量通知（如「未汇报提醒」要同时通知管理员与业主）。逐个发，单个失败不影响其他 */
async function notifyMany(userIds, params) {
  const results = []
  for (const userId of [...new Set(userIds)].filter(Boolean)) {
    try {
      results.push(await notifyOnce({ ...params, userId }))
    } catch (err) {
      logger.error('发送通知失败', { userId, type: params.type, err })
      results.push({ sent: false })
    }
  }
  return results
}

/**
 * 批量发**普通**通知（不去重），与 notifyOnce 的区别只在于有没有去重键。
 *
 * ── 为什么必须与 notifyMany 分开 ──
 * `notifyMany` 走的是 `notifyOnce`，而 `notifyOnce` 需要
 * `reminderType + refType + refId` 去拼 `reminder_log` 的去重键。
 * 拿它发一条「不需要去重」的通知（如「业主设置了门锁密码」），
 * 会带着 `undefined` 去写 `reminder_log.type`（NOT NULL 的 ENUM），
 * 结果是**通知一条都发不出去**，而失败还被 notifyOnce 的 try/catch
 * 吞成 `{sent:false}` —— 界面上一切正常，只是没人收到消息。
 *
 * 判断标准很简单：**这件事需要「同一件事只提醒一次」吗？**
 * 需要 → notifyMany；不需要（每发生一次都该说一次）→ notifyEach。
 */
async function notifyEach(userIds, params) {
  const results = []
  for (const userId of [...new Set(userIds)].filter(Boolean)) {
    try {
      results.push({ sent: true, ...(await notify({ ...params, userId })) })
    } catch (err) {
      logger.error('发送通知失败', { userId, type: params.type, err })
      results.push({ sent: false })
    }
  }
  return results
}

/**
 * 尝试推送微信订阅消息。
 *
 * 当前的实现是**占位**：没有模板 ID（B-5.7 需要运营在微信后台申请后配置）时
 * 直接返回，不产生任何外部调用。这样在开发与测试环境下不会因为缺少凭据而报错，
 * 而线上配好模板 ID 之后只需在这里补一个 HTTP 调用即可。
 */
async function tryPushSubscribeMessage({ userId, type, tenantId = null }) {
  const templateId = await resolveTemplateId(tenantId, type)

  if (!templateId) {
    logger.debug('未配置订阅消息模板 ID，仅记录站内消息', { type })
    return { pushed: false, reason: 'no_template' }
  }

  const user = await db.queryOne('SELECT openid FROM user WHERE id = ? AND deleted_at IS NULL', [userId])
  if (!user || !user.openid) return { pushed: false, reason: 'no_openid' }

  // ── 订阅授权必须按**租户**查 ──
  // 唯一键是 (user_id, tenant_id, template_id)：同一个微信模板 ID 会被多个
  // 租户使用（CLAUDE.md 第 72 条）。只按 (user_id, template_id) 查会随机
  // 命中另一个租户的授权记录 —— 在 A 公司同意、在 B 公司拒绝过的用户，
  // 可能因此永远收不到 A 公司的推送，而站内消息一切正常，极难排查。
  // tenantId 为空时（平台级消息）没有模板可用，返回 not_subscribed
  if (!tenantId) return { pushed: false, reason: 'no_tenant' }

  const subscribed = await db.queryOne(
    'SELECT status FROM user_subscription WHERE user_id = ? AND tenant_id = ? AND template_id = ? AND deleted_at IS NULL',
    [userId, tenantId, templateId]
  )
  // AC-U12：用户拒绝过就不再弹窗骚扰，但站内消息照常
  if (!subscribed || subscribed.status !== 'accepted') {
    return { pushed: false, reason: 'not_subscribed' }
  }

  // TODO(M10)：接入 wx.service.sendSubscribeMessage。
  // 这一步需要 AppID/Secret 与已审核的模板 ID，本机环境都没有，
  // 写一个无法被验证的 HTTP 调用不如留一个明确的空位。
  logger.debug('订阅消息待接入', { userId, templateId })
  return { pushed: false, reason: 'not_implemented' }
}

/**
 * 消息的租户归属。
 *
 * 优先用调用方显式给的，否则从项目推。**不接受「推不出就随便挑一个」** ——
 * 消息写错租户的后果是：业主在 A 公司的消息中心里看到 B 公司项目的验收通知。
 * 推不出来时给 null（平台级消息），而不是猜。
 */
async function resolveTenantId({ tenantId, projectId }) {
  if (tenantId) return tenantId
  if (!projectId) return null

  const row = await db.queryOne('SELECT tenant_id FROM project WHERE id = ? AND deleted_at IS NULL', [projectId])
  return row ? row.tenant_id : null
}

/** 业务消息类型 → 模板 ID（B-5.7 逐业务配置，**按租户**） */
async function resolveTemplateId(tenantId, type) {
  // 走 sysConfigService 而不是自己查 sys_config：
  // 那边有默认值回落与 60 秒缓存，也保证「后台能配的键」与「这里读的键」
  // 出自同一个注册表。自己查库则既绕过默认值、也绕过缓存失效，
  // 表现为后台改完模板 ID 要等一分钟才生效，而别处的配置立刻生效
  const value = await sysConfigService.getRaw(tenantId, `subscribe_template_${type}`)
  return value || null
}

// ─────────────────────────────────────────────────────────────
// 消息中心（AC-U06 ~ AC-U10）
// ─────────────────────────────────────────────────────────────

/** 消息中心支持筛选的分类。AC-U06 的四类 + system 兜底 */
const FILTERABLE_TYPES = [TYPES.ACCEPTANCE, TYPES.PROGRESS, TYPES.PAYMENT, TYPES.COMMENT, TYPES.SYSTEM]

/**
 * 「未读数」在本模块只有**一个口径：全局未读**，不随列表的筛选条件变化。
 *
 * ── 这条约定是刻意的 ──
 * AC-U07 要求「tab 红点数量等于未读消息数」。若列表接口顺手返回一个
 * 「当前筛选下的未读数」，前端很容易拿它去刷红点 —— 于是用户切到「评论」
 * 分类，红点就从 5 变成 1，看起来像消息被吞了。
 * 红点回答的是「我有多少条没看」，与「我正在看哪一类」无关。
 *
 * 因此：列表接口返回的 `unread` 恒为全局值，与 `type` / `projectId` /
 * `unreadOnly` 一概无关。需要分类角标时用 unreadSummary 的 byType。
 */
function shapeMessage(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    projectId: row.project_id,
    // AC-U08 的跳转依据。**服务端只给「跳到哪个业务对象」，不给具体页面路径** ——
    // 路由表是小程序自己的东西，写进响应体意味着后端发版才能改前端路由。
    //
    // 注意 refType/refId 只是跳转提示：目标对象可能已被软删除（汇报撤回、验收单作废），
    // 前端点击后若拿到 404，应优雅退回消息列表而不是弹一个报错框。
    refType: row.ref_type,
    refId: row.ref_id,
    isRead: row.is_read === 1,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

/**
 * 消息列表（AC-U06 / AC-U08 / AC-U09 的读取侧）。
 *
 * @param {number} userId
 * @param {{type?: string, projectId?: number, unreadOnly?: boolean}} filters
 * @param {{offset: number, limit: number, page: number, pageSize: number}} paging
 */
async function listForUser(userId, filters, paging) {
  const { total, rows } = await notificationModel.list({
    userId,
    tenantId: filters.tenantId,
    type: filters.type,
    projectId: filters.projectId,
    unreadOnly: filters.unreadOnly,
    offset: paging.offset,
    limit: paging.limit,
  })

  return {
    list: rows.map(shapeMessage),
    total,
    // 全局未读数，见上文说明 —— 前端拿它刷红点
    unread: await notificationModel.countUnread(userId),
  }
}

/**
 * 未读汇总（AC-U07 红点 / AC-U10 下拉刷新）。
 *
 * 单独开一个轻量接口而不是复用列表：下拉刷新时前端只想知道数字变了没有，
 * 拉一整页消息既浪费流量，也会在刷新瞬间把正在看的那一屏内容抽掉。
 *
 * @returns {Promise<{total: number, byType: Record<string, number>}>}
 */
async function unreadSummary(userId) {
  const byType = Object.fromEntries(FILTERABLE_TYPES.map((t) => [t, 0]))

  const counts = await notificationModel.countUnreadByType(userId)
  let total = 0
  for (const [type, count] of Object.entries(counts)) {
    byType[type] = count
    total += count
  }

  return { total, byType }
}

/**
 * 标记已读（AC-U09）。
 *
 * 同时返回最新的未读数，让前端一次往返就能更新红点 ——
 * AC-U09 要求「操作后红点同步更新」，若还要前端自己再查一次未读数，
 * 中间那一小段窗口里红点会显示旧值。
 *
 * @param {number} userId
 * @param {number[]|undefined} ids 传 ids 则只标这些，不传则全部已读
 */
async function markRead(userId, ids) {
  const affected = await notificationModel.markRead({ userId, ids })
  return { affected, unread: await notificationModel.countUnread(userId) }
}

module.exports = {
  TYPES,
  FILTERABLE_TYPES,
  REMINDER_TO_NOTIFICATION_TYPE,
  notify,
  notifyOnce,
  notifyMany,
  notifyEach,
  tryPushSubscribeMessage,
  resolveTemplateId,
  listForUser,
  unreadSummary,
  markRead,
}
