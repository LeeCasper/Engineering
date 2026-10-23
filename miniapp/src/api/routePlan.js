import { request } from './request'

/**
 * 考察计划与路线规划（§4.6）。
 *
 * 地图 Key 只在后端，前端拿到的只有坐标、折线和里程；
 * 任何页面都不要再请求高德 / 腾讯的接口。
 */

export function fetchRoutePlans({ page = 1, pageSize = 20, tenantId } = {}) {
  const params = [`page=${page}`, `pageSize=${pageSize}`]
  if (tenantId) params.push(`tenantId=${tenantId}`)
  return request({ url: `/route-plans?${params.join('&')}` })
}

export function previewRoutePlan({ origin, projectIds, optimize = true }) {
  return request({
    url: '/route-plans/preview',
    method: 'POST',
    data: { origin, projectIds, optimize },
  })
}

export function saveRoutePlan({ name, originType, origin, projectIds }) {
  return request({
    url: '/route-plans',
    method: 'POST',
    data: { name, originType, origin, projectIds },
  })
}

export function fetchRoutePlan(planId) {
  return request({ url: `/route-plans/${planId}` })
}

export function deleteRoutePlan(planId) {
  return request({ url: `/route-plans/${planId}`, method: 'DELETE' })
}
