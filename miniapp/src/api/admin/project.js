import { adminRequest } from './request'

/**
 * 管理端项目 / 成员 / 付款节点 / 阶段工序接口。
 *
 * 与网页后台共用同一组 /admin/* 接口；这里只做参数与 URL 的整理。
 * 金额、权重保持字符串，前端不把它转成 Number。
 */

function queryString(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')
}

/** 项目列表（分页） */
export function fetchAdminProjects({ page = 1, pageSize = 20, name, status } = {}) {
  const query = queryString({ page, pageSize, name, status })
  return adminRequest({ url: `/projects?${query}` })
}

export function createAdminProject(data) {
  return adminRequest({ url: '/projects', method: 'POST', data })
}

export function fetchAdminProject(id) {
  return adminRequest({ url: `/projects/${id}` })
}

export function updateAdminProject(id, data) {
  return adminRequest({ url: `/projects/${id}`, method: 'PUT', data })
}

export function changeAdminProjectStatus(id, status, confirmReverse = false) {
  return adminRequest({
    url: `/projects/${id}/status`,
    method: 'PUT',
    data: { status, confirmReverse },
  })
}

export function archiveAdminProject(id) {
  return adminRequest({
    url: `/projects/${id}/archive`,
    method: 'POST',
    data: { confirm: true },
  })
}

export function deleteAdminProject(id) {
  return adminRequest({
    url: `/projects/${id}`,
    method: 'DELETE',
    data: { confirm: true },
  })
}

// ── 成员 ─────────────────────────────────────────────────────

export function fetchAdminMembers(projectId) {
  return adminRequest({ url: `/projects/${projectId}/members` })
}

export function inviteAdminMember(projectId, { phone, role }) {
  return adminRequest({
    url: `/projects/${projectId}/members`,
    method: 'POST',
    data: { phone, role },
  })
}

export function setAdminPrimaryForeman(projectId, memberId) {
  return adminRequest({
    url: `/projects/${projectId}/members/${memberId}/primary`,
    method: 'PUT',
    data: {},
  })
}

export function removeAdminMember(projectId, memberId) {
  return adminRequest({
    url: `/projects/${projectId}/members/${memberId}`,
    method: 'DELETE',
  })
}

// ── 付款节点 ─────────────────────────────────────────────────

export function fetchAdminPaymentNodes(projectId) {
  return adminRequest({ url: `/projects/${projectId}/payment-nodes` })
}

export function replaceAdminPaymentNodes(projectId, nodes) {
  return adminRequest({
    url: `/projects/${projectId}/payment-nodes`,
    method: 'PUT',
    data: { nodes },
  })
}

export function unlockAdminPaymentNode(projectId, nodeId) {
  return adminRequest({
    url: `/projects/${projectId}/payment-nodes/${nodeId}/unlock`,
    method: 'POST',
    data: {},
  })
}

// ── 阶段与工序 ───────────────────────────────────────────────

export function addAdminStage(projectId, data) {
  return adminRequest({ url: `/projects/${projectId}/stages`, method: 'POST', data })
}

export function updateAdminStage(projectId, stageId, data) {
  return adminRequest({ url: `/projects/${projectId}/stages/${stageId}`, method: 'PUT', data })
}

export function deleteAdminStage(projectId, stageId) {
  return adminRequest({ url: `/projects/${projectId}/stages/${stageId}`, method: 'DELETE' })
}

export function addAdminItem(projectId, stageId, data) {
  return adminRequest({
    url: `/projects/${projectId}/stages/${stageId}/items`,
    method: 'POST',
    data,
  })
}

export function updateAdminItem(projectId, itemId, data) {
  return adminRequest({ url: `/projects/${projectId}/items/${itemId}`, method: 'PUT', data })
}

export function deleteAdminItem(projectId, itemId) {
  return adminRequest({ url: `/projects/${projectId}/items/${itemId}`, method: 'DELETE' })
}
