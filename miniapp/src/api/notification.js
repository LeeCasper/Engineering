import { request } from './request'

/**
 * C 端消息中心（AC-U06 ~ AC-U10）。
 *
 * 未读数只有一个口径：全局未读。列表返回的 `unread` 与筛选条件无关，
 * 不要拿当前分类的条数去刷“我的”tab 红点。
 */

function toQuery(params) {
  const list = []
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue
    list.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }
  return list.length ? `?${list.join('&')}` : ''
}

export function fetchNotifications({ page = 1, pageSize = 20, type, projectId, unreadOnly } = {}) {
  return request({
    url: `/notifications${toQuery({ page, pageSize, type, projectId, unreadOnly })}`,
  })
}

/** 轻量未读汇总，供“我的”tab 红点与下拉刷新 */
export function fetchUnreadSummary() {
  return request({ url: '/notifications/unread-count' })
}

/** 不传 ids 表示全部已读；返回最新全局未读数 */
export function markNotificationsRead(ids) {
  return request({
    url: '/notifications/read',
    method: 'POST',
    data: ids && ids.length ? { ids } : {},
  })
}

/** 订阅消息状态（AC-U13）。未配置模板的分类也会返回 available=false */
export function fetchSubscriptions(tenantId) {
  return request({ url: `/notifications/subscriptions${toQuery({ tenantId })}` })
}

/** 回传一次微信订阅授权结果 */
export function recordSubscription({ type, status, tenantId }) {
  return request({
    url: '/notifications/subscriptions',
    method: 'POST',
    data: { type, status, tenantId },
  })
}
