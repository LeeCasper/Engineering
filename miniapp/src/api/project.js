import { request } from './request'

/** 我的项目（C-1.2 ~ C-1.5）。返回 groups / tenants / pendingInvitations */
export function myProjects(tenantId) {
  const query = tenantId ? `?tenantId=${tenantId}` : ''
  return request({ url: `/projects${query}` })
}

/** 确认项目邀请（AC-AD18 → AC-AD19） */
export function confirmInvitation(memberId) {
  return request({ url: `/invitations/${memberId}/confirm`, method: 'POST' })
}

/** 拒绝项目邀请 */
export function rejectInvitation(memberId) {
  return request({ url: `/invitations/${memberId}/reject`, method: 'POST' })
}
