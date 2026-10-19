'use strict'

/**
 * C 端订阅消息授权控制器（C-5.4 / AC-U11 ~ AC-U13）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const subscriptionService = require('../services/subscription.service')

/**
 * 记录一次授权结果。
 *
 * `type` 不在这里用 z.enum 写死：模板分类的**唯一来源**是
 * `notificationService.FILTERABLE_TYPES`，写死一份会在枚举变化时悄悄漂移
 * （新增的分类收不到授权、删除的分类还能提交）。由服务层校验。
 */
const recordSchema = z.object({
  type: z.string().trim().min(1, '缺少消息类型').max(32),
  // 跨租户用户必须指定；只属于一个租户时可以省略
  tenantId: z.coerce.number().int().positive().optional(),
  // ban 是微信侧的长期拒绝（用户勾了「不再询问」），要在界面上隐藏申请入口，
  // 因此必须能与一次性拒绝区分（AC-U12）
  status: z.enum(subscriptionService.ALLOWED_STATUS, {
    errorMap: () => ({ message: '授权状态只能为 accepted / rejected / ban' }),
  }),
})

/** GET /notifications/subscriptions —— 订阅状态列表（AC-U13） */
async function list(req, res) {
  res.ok(await subscriptionService.list(req.auth.id, req.query.tenantId ? Number(req.query.tenantId) : undefined))
}

/** POST /notifications/subscriptions —— 回传授权结果（AC-U11 / AC-U12） */
async function record(req, res) {
  const input = validate(recordSchema, req.body)
  res.ok(await subscriptionService.record(req.auth.id, input.tenantId, input.type, input.status, req.auth))
}

module.exports = { list, record }
