'use strict'

/**
 * 订阅消息授权管理（C-5.4 / AC-U11 ~ AC-U13）。
 *
 * ── 服务端在这件事上的职责边界 ──
 * 「在恰当时机引导授权」（AC-U11）是**客户端的交互决策** ——
 * 小程序调 `wx.requestSubscribeMessage` 的时机由页面决定，服务端插不上手。
 * 服务端负责的是另外两件必须集中的事：
 *   1. 告诉客户端「有哪些模板可以申请授权」（模板 ID 来自后台配置，客户端不该硬编码）；
 *   2. 记下授权结果 —— AC-U12「拒绝后不再重复弹窗骚扰」需要记住谁拒绝过。
 *
 * ── 为什么授权结果必须回传服务端，而不能只存在小程序本地 ──
 * 本地存储会随「删除小程序」「换手机」丢失，用户会被反复弹窗；
 * 而「拒绝过」这件事只对服务端有意义（决定后续还给不给他发订阅消息）。
 */

const AppError = require('../utils/AppError')
const notificationModel = require('../models/notification.model')
const notificationService = require('../services/notification.service')
const projectMemberModel = require('../models/projectMember.model')
const operationLog = require('./operationLog.service')

/** 微信侧返回的授权状态 → 本系统的枚举。取值见迁移 006 的 user_subscription.status */
const ALLOWED_STATUS = ['accepted', 'rejected', 'ban']

/**
 * 订阅模板清单（AC-U13 的「订阅消息管理」页面）。
 *
 * ── 未配置模板 ID 的分类也要返回，但标记为不可申请 ──
 * 直接过滤掉「没配模板 ID 的分类」会让运营困惑：管理页里只有三类，
 * 而消息中心明明有五类消息。返回全量 + `available: false`，
 * 界面就能显示「该类消息尚未开通订阅推送，仅站内信」——
 * 这也是本系统当前的真实状态（缺微信凭据）。
 *
 * @param {number} userId
 */
async function list(userId, tenantId) {
  const resolved = await resolveTenant(userId, tenantId)
  const rows = await notificationModel.listSubscriptions(userId, resolved)
  const stored = new Map(rows.map((r) => [r.template_key || r.template_id, r]))

  const list = await Promise.all(
    notificationService.FILTERABLE_TYPES.map(async (type) => {
      const templateId = await notificationService.resolveTemplateId(resolved, type)
      const row = stored.get(type)

      return {
        type,
        typeLabel: TYPE_LABELS[type] || type,
        // 客户端要用这个 ID 调 wx.requestSubscribeMessage；模板 ID 不是密钥，
        // 它随小程序前端下发是微信订阅消息的正常用法。
        templateId: templateId || null,
        available: Boolean(templateId),
        // 未配置模板时状态恒为 null —— 报 'rejected' 会让用户以为
        // 「我拒绝过这一类」，而他根本没有被问过
        status: templateId && row ? row.status : null,
        // AC-U12：ban 表示用户勾了「不再询问」，界面应当隐藏申请入口
        canRequest: Boolean(templateId) && row?.status !== 'ban',
        updatedAt: row ? row.updated_at : null,
      }
    })
  )

  return {
    list,
    // 汇总一个「已授权几项」供界面展示进度，省得前端各写一遍过滤
    acceptedCount: list.filter((i) => i.status === 'accepted').length,
    availableCount: list.filter((i) => i.available).length,
  }
}

// 展示名集中在 notification.service（推送的 typeLabel 也用它），这里只做别名，
// 避免两处中文标签各写一份后漂移
const TYPE_LABELS = notificationService.TYPE_LABELS

/**
 * 记录一次授权结果（AC-U11 的回传端点）。
 *
 * @param {number} userId
 * @param {string} type 消息分类
 * @param {string} status accepted / rejected / ban
 * @param {object} operator 用于审计留痕
 */
async function record(userId, tenantId, type, status, operator) {
  const resolved = await resolveTenant(userId, tenantId)
  if (!notificationService.FILTERABLE_TYPES.includes(type)) {
    throw AppError.badRequest('未知的消息类型')
  }
  if (!ALLOWED_STATUS.includes(status)) {
    throw AppError.badRequest('未知的授权状态')
  }

  const templateId = await notificationService.resolveTemplateId(resolved, type)
  if (!templateId) {
    // 未配置模板 ID 时**拒绝记录**而不是静默忽略：
    // `user_subscription` 的唯一键是 (user_id, template_id)，空串是一个确定的值，
    // 五个分类会全部折到同一行上互相覆盖。客户端据此知道「这一类还没开通」
    throw AppError.badRequest('该类型的订阅消息尚未配置模板，暂不支持授权')
  }

  await notificationModel.upsertSubscription({ userId, tenantId: resolved, templateId, templateKey: type, status })

  // 授权动作留痕：它是「用户明确同意接收」的凭据，之后若因推送产生投诉，
  // 这条日志是唯一能证明「他当时点了同意」的东西
  await operationLog.record({
    ...operationLog.fromOperator(operator),
    // C 端用户没有单一租户（可跨租户），但这次授权明确属于 `resolved`。
    // 不写的话这条日志的 tenant_id 为 NULL：租户在自己的操作日志里
    // 看不到「用户同意接收我这条推送」，而它正是推送投诉时唯一的凭据
    tenantId: resolved,
    action: operationLog.ACTIONS.SUBSCRIPTION_RECORD,
    targetType: 'user_subscription',
    targetId: null,
    detail: { before: null, after: { type, status } },
  })

  return { type, status }
}

/**
 * 确定这次请求的租户。
 *
 * ── 为什么必须显式 ──
 * 模板 ID 是各租户自己配的，同一个人可能同时在两家公司干活。
 * 「猜一个租户」会让他在 A 公司的授权写到 B 公司名下 ——
 * 而界面看起来完全正常，只是推送永远不来。
 *
 * 规则：请求带了就用（并校验他确实属于该租户）；没带则要求他**只属于一个租户**，
 * 多租户时返回 400 让他明确指定。
 */
async function resolveTenant(userId, tenantId) {
  const tenants = await projectMemberModel.listUserTenants(userId)

  if (tenantId) {
    const ok = tenants.some((t) => Number(t.tenant_id) === Number(tenantId))
    if (!ok) throw AppError.notFound('项目不存在')
    return Number(tenantId)
  }

  if (tenants.length === 1) return Number(tenants[0].tenant_id)
  if (tenants.length === 0) throw AppError.badRequest('你还不属于任何租户')
  throw AppError.badRequest('你属于多个租户，请指定 tenantId')
}

module.exports = { TYPE_LABELS, list, record, ALLOWED_STATUS, resolveTenant }
