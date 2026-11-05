import { request } from './request'

/** 我的项目（C-1.2 ~ C-1.5）。返回 groups / tenants / pendingInvitations */
export function myProjects(tenantId) {
  const query = tenantId ? `?tenantId=${tenantId}` : ''
  return request({ url: `/projects${query}` })
}

/** 项目详情（C-2.1）：概览 + 业主/主工长 + 当前阶段 + 阶段摘要 */
export function projectDetail(projectId) {
  return request({ url: `/projects/${projectId}` })
}

/** 阶段工序树（C-2.2 / C-2.3）：计划日期、门禁、canReport */
export function projectStages(projectId) {
  return request({ url: `/projects/${projectId}/stages` })
}

/** 某个项目的验收单（C-3.1）：业主待办与阶段「待您签字」标记 */
export function projectAcceptances(projectId) {
  return request({ url: `/projects/${projectId}/acceptances` })
}

/** 单工序完成度变更历史（AC-P19），阶段工序行「历史」入口 */
export function projectItemHistory(projectId, itemId) {
  return request({ url: `/projects/${projectId}/items/${itemId}/history` })
}

/** 汇报记录流（C-2.6），首页只取最新一页用于「施工实况」照片 */
export function projectReports(projectId, { page = 1, pageSize = 20, itemId } = {}) {
  const params = [`page=${page}`, `pageSize=${pageSize}`]
  if (itemId) params.push(`itemId=${itemId}`)
  return request({ url: `/projects/${projectId}/reports?${params.join('&')}` })
}

/** 付款节点（C-4.6） */
export function projectPaymentNodes(projectId) {
  return request({ url: `/projects/${projectId}/payment-nodes` })
}

/** 账目总览（C-4.1）。监理无权访问，调用方要自行兜住 403 */
export function projectLedgerSummary(projectId) {
  return request({ url: `/projects/${projectId}/ledger/summary` })
}

/** 项目竣工总报告状态；仅业主 / 工长可读，监理调用会 403 */
export function fetchProjectCompletionReport(projectId) {
  return request({ url: `/projects/${projectId}/completion-report` })
}

/** 生成 / 重试 / 重新生成项目竣工总报告；项目未完工时返回 409 */
export function generateProjectCompletionReport(projectId, { refresh = false } = {}) {
  const query = refresh ? '?refresh=1' : ''
  return request({ url: `/projects/${projectId}/completion-report${query}`, method: 'POST' })
}

/** 业主查看工长/监理联系方式（C-5.6 / AC-U15） */
export function projectContacts(projectId) {
  return request({ url: `/projects/${projectId}/contacts` })
}

/** 工长在单个项目里的汇报统计（C-5.5 / AC-U14） */
export function projectMyStats(projectId) {
  return request({ url: `/projects/${projectId}/my-stats` })
}

/** 工长跨项目汇总统计；「我的」页未选择项目时使用 */
export function projectMyStatsAll() {
  return request({ url: '/projects/my-stats' })
}

/** 业主确认付款（AC-L13：paid → confirmed） */
/** 工长确认已收到付款节点对应的线下工款（会自动生成收入流水） */
export function payPaymentNode(projectId, nodeId) {
  return request({
    url: `/projects/${projectId}/payment-nodes/${nodeId}/pay`,
    method: 'POST',
  })
}

export function confirmPaymentNode(projectId, nodeId) {
  return request({
    url: `/projects/${projectId}/payment-nodes/${nodeId}/confirm`,
    method: 'POST',
  })
}

/** 确认项目邀请（AC-AD18 → AC-AD19） */
export function confirmInvitation(memberId) {
  return request({ url: `/invitations/${memberId}/confirm`, method: 'POST' })
}

/** 拒绝项目邀请 */
export function rejectInvitation(memberId) {
  return request({ url: `/invitations/${memberId}/reject`, method: 'POST' })
}
