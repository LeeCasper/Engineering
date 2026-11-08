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
const datetime = require('../utils/datetime')
const notificationModel = require('../models/notification.model')
const sysConfigService = require('./sysConfig.service')
const wx = require('./wx.service')
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

  // 微信订阅消息：尽力而为，**不阻塞主流程**。
  // 微信接口偶发慢响应（超时 5s），若在业务请求里串行 await，
  // 一次「通知 20 个成员」就可能把接口拖到几十秒；而站内消息已经落库，
  // 推送晚一两秒到达没有任何业务影响。
  //
  // **必须带上解析后的 tenantId**：订阅授权是按租户存的，
  // 不带的话会读错租户的授权记录，表现为「站内消息到了、推送不发」
  tryPushSubscribeMessage({ ...params, tenantId }).catch((err) => {
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

/** 微信订阅消息模板关键词 → 业务字段。新增来源时同步 sysConfig 的提示文案 */
const SUBSCRIBE_DATA_SOURCES = new Set([
  'projectName',
  'title',
  'content',
  'typeLabel',
  'time',
  'date',
  'refId',
])

/** 消息分类的展示名。订阅消息的数据映射可用 typeLabel 引用它 */
const TYPE_LABELS = {
  acceptance: '验收通知',
  progress: '进度提醒',
  payment: '付款提醒',
  comment: '评论回复',
  system: '系统通知',
}

/**
 * 微信对各类关键词的字符上限（thing 20、phrase 5 …）。
 * 超限会得到 47003（数据格式错误），因此按关键词**前缀**截断而不是整串硬裁。
 */
const WX_VALUE_MAX_LENGTH = {
  thing: 20,
  phrase: 5,
  character_string: 32,
  number: 20,
  amount: 20,
  time: 20,
  date: 20,
}

function truncateChars(value, max) {
  return Array.from(String(value)).slice(0, max).join('')
}

/** 按模板关键词的类型截断；未识别的前缀按 thing 的 20 字处理 */
function formatTemplateValue(keyword, value) {
  const keywordType = String(keyword).replace(/\d+$/, '')
  return truncateChars(value, WX_VALUE_MAX_LENGTH[keywordType] || 20)
}

/**
 * 解析 `subscribe_template_<type>_fields`。
 *
 * 容错策略：任何不合法（JSON 语法、非对象、未知来源、非法关键词）都回落到
 * 内置映射。原因是这条配置只影响「消息能不能发出去」，不该让推送整体停摆；
 * 同时每一项被丢弃的配置都会留痕，避免「配了但没生效」无声无息。
 *
 * @param {string} type
 * @param {string|null} raw
 * @returns {Record<string, string>}
 */
function parseFieldMap(type, raw) {
  const fallback = { ...(sysConfigService.SUBSCRIBE_FIELD_DEFAULTS[type] || {}) }
  if (raw === null || raw === undefined || String(raw).trim() === '') return fallback

  let parsed
  try {
    parsed = JSON.parse(String(raw))
  } catch (err) {
    logger.warn('订阅消息数据映射不是合法 JSON，已回落到内置映射', { type, message: err.message })
    return fallback
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn('订阅消息数据映射必须是 JSON 对象，已回落到内置映射', { type })
    return fallback
  }

  const map = {}
  for (const [keyword, source] of Object.entries(parsed)) {
    // 微信关键词形如 thing1 / character_string2；自造的键会在发送时得到 47003
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(keyword)) {
      logger.warn('订阅消息模板关键词不合法，已忽略', { type, keyword })
      continue
    }
    if (!SUBSCRIBE_DATA_SOURCES.has(source)) {
      logger.warn('订阅消息数据来源未知，已忽略', { type, keyword, source })
      continue
    }
    map[keyword] = source
  }

  return Object.keys(map).length > 0 ? map : fallback
}

/**
 * 构造模板数据来源。时间统一按上海时区格式化 ——
 * 微信的 time / date 关键词只接受固定格式，传 `2026-11-08 10:00:00` 也能识别，
 * 但这类模板通常按「2026年11月8日 10:00」展示，直接给最终文案更稳。
 */
function buildTemplateValues({ projectName = '', title = '', content = '', type = '', refId = null }) {
  const now = datetime.now()
  return {
    projectName,
    title,
    content,
    typeLabel: TYPE_LABELS[type] || type,
    // 与微信文档示例一致（2020年01月01日 12:00），补零以避免不同模板的格式校验差异
    time: now.format('YYYY年MM月DD日 HH:mm'),
    date: now.format('YYYY年MM月DD日'),
    refId: refId === null || refId === undefined ? '' : String(refId),
  }
}

/** 读取并解析某类消息的数据映射 */
async function resolveTemplateFields(type) {
  const raw = await sysConfigService.getRaw(null, `subscribe_template_${type}_fields`)
  return parseFieldMap(type, raw)
}

/**
 * 把一条站内消息组装成微信订阅消息的 `data`。
 *
 * 没有映射到任何非空字段时返回 `{}`，调用方据此跳过推送 ——
 * 微信不接受空 data，发出去也只会得到错误码。
 */
async function buildTemplateData(type, { projectId = null, title, content, refId }) {
  const fields = await resolveTemplateFields(type)

  let projectName = ''
  if (projectId && Object.values(fields).includes('projectName')) {
    const project = await db.queryOne('SELECT name FROM project WHERE id = ? AND deleted_at IS NULL', [projectId])
    projectName = project ? project.name : ''
  }

  const values = buildTemplateValues({ projectName, title, content, type, refId })

  const data = {}
  for (const [keyword, source] of Object.entries(fields)) {
    const value = values[source]
    // 空值不塞给微信：thing 的空字符串会被判定为 47003，而少一个关键词
    // 同样是模板不匹配 —— 两种都是「这条消息发不出去」，但留空至少能看出原因
    if (!value) continue
    data[keyword] = { value: formatTemplateValue(keyword, value) }
  }
  return data
}

/**
 * 尝试推送微信订阅消息。
 *
 * 只有「模板 ID 已配置 + 用户已授权 + 数据可组装」三个条件同时满足才真正调用微信；
 * 其余情况返回带 `reason` 的结果，由调用方决定怎么记录。
 *
 * 失败一律不抛：站内消息已经落库，推送只是加速通道（AC-U12 / AC-L31）。
 */
async function tryPushSubscribeMessage({
  userId,
  type,
  tenantId = null,
  projectId = null,
  title,
  content,
  refId,
}) {
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

  const data = await buildTemplateData(type, { projectId, title, content, refId })
  if (Object.keys(data).length === 0) {
    logger.warn('订阅消息模板数据为空，跳过推送', { userId, type, templateId })
    return { pushed: false, reason: 'no_data' }
  }

  try {
    const result = await wx.sendSubscribeMessage({ openid: user.openid, templateId, data })

    // WX_MOCK=true 时 wx.service 不产生外部调用；本地开发与测试据此区分
    if (result.mocked) return { pushed: false, reason: 'mock' }

    if (!result.ok) {
      logger.warn('微信订阅消息发送失败', {
        userId,
        type,
        errcode: result.errcode,
        errmsg: result.errmsg,
      })
      return { pushed: false, reason: 'wx_error', errcode: result.errcode }
    }

    logger.info('微信订阅消息已发送', { userId, type })
    return { pushed: true }
  } catch (err) {
    logger.warn('微信订阅消息发送异常', { userId, type, message: err.message })
    return { pushed: false, reason: 'wx_error' }
  }
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

/**
 * 业务消息类型 → 模板 ID（B-5.7）。
 *
 * ── 模板 ID 是平台级的，不是租户级 ──
 * 模板 ID 来自微信公众平台的小程序后台。本项目一个小程序服务多个租户，
 * 小程序主体是平台，租户没有该小程序的登录权限，申请不到模板 ID。
 * 因此这里**固定读平台基础配置**（tenantId = null），不使用调用方传入的租户。
 * `tenantId` 参数仍然保留：它在这一层没有用，但调用方（订阅授权、推送）
 * 需要它来定位 `user_subscription` 的租户维度 —— 同一个模板 ID 下，
 * 不同租户的授权状态必须分开。
 */
async function resolveTemplateId(_tenantId, type) {
  // 走 sysConfigService 而不是自己查 sys_config：
  // 那边有默认值回落与 60 秒缓存，也保证「后台能配的键」与「这里读的键」
  // 出自同一个注册表。自己查库则既绕过默认值、也绕过缓存失效，
  // 表现为后台改完模板 ID 要等一分钟才生效，而别处的配置立刻生效
  const value = await sysConfigService.getRaw(null, `subscribe_template_${type}`)
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
  TYPE_LABELS,
  SUBSCRIBE_DATA_SOURCES,
  REMINDER_TO_NOTIFICATION_TYPE,
  notify,
  notifyOnce,
  notifyMany,
  notifyEach,
  tryPushSubscribeMessage,
  resolveTemplateId,
  // 供单测直接验证映射解析与截断规则（不经过数据库）
  parseFieldMap,
  buildTemplateValues,
  formatTemplateValue,
  listForUser,
  unreadSummary,
  markRead,
}
