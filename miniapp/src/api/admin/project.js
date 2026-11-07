import { adminRequest, adminUploadFile } from './request'

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

/** 项目列表（分页）。统计计数单独走 fetchAdminProjectStats，不依赖当前筛选 */
export function fetchAdminProjects({
  page = 1,
  pageSize = 20,
  name,
  status,
  sortField,
  sortDirection,
} = {}) {
  const query = queryString({ page, pageSize, name, status, sortField, sortDirection })
  return adminRequest({ url: `/projects?${query}` })
}

/** 工作台 / 状态筛选计数。全局口径，不受列表搜索与状态筛选影响 */
export function fetchAdminProjectStats() {
  return adminRequest({ url: '/projects/stats' })
}

/**
 * 上传项目封面。
 *
 * 微信 `uni.uploadFile` 一次只能带一个文件，所以这里是「先上传拿 url，
 * 再随创建 / 编辑提交 coverUrl」两步；不要试图塞进 JSON 建档请求。
 */
export function uploadAdminProjectCover(filePath) {
  return adminUploadFile({ url: '/projects/cover', filePath, name: 'cover' })
}

// ── 管理员站内消息（工作台待办）────────────────────────────
//
// 放在已有的 admin/project.js 里，而不是再新建一个模块：
// 微信开发者工具对「运行期间新增的 JS 模块」经常不更新模块映射，
// 会报 `module 'api/admin/notification.js' is not defined` 并白屏。
// 复用已存在的模块可以避免这个开发期缓存问题。

export function fetchAdminNotifications({ page = 1, pageSize = 50, onlyUnread = false } = {}) {
  const query = queryString({
    page,
    pageSize,
    onlyUnread: onlyUnread ? 'true' : undefined,
  })
  return adminRequest({ url: `/notifications?${query}` })
}

/** 传 ids 只标记这些；不传表示全部已读 */
export function markAdminNotificationsRead(ids) {
  return adminRequest({
    url: '/notifications/read',
    method: 'POST',
    data: ids && ids.length ? { ids } : {},
  })
}

// ── 跨项目成员目录（管理端「成员」tab）────────────────────
//
// 只读聚合：成员的新增 / 移除仍走具体项目的 /projects/:id/members。
export function fetchAdminMemberDirectory({ page = 1, pageSize = 20, keyword, role, projectId } = {}) {
  const query = queryString({ page, pageSize, keyword, role, projectId })
  return adminRequest({ url: `/members?${query}` })
}

// ── 阶段模板（管理端「我的 → 阶段模板」）──────────────────
//
// 模板是租户级资源，后端已按 operator.tenantId 隔离，不需要项目 id。
// 同样放在已有的 admin/project.js 里，避免新增模块触发微信开发者工具的
// 模块映射缓存问题（见上面管理员消息接口的说明）。
export function fetchAdminTemplates({ page = 1, pageSize = 20, keyword } = {}) {
  const query = queryString({ page, pageSize, keyword })
  return adminRequest({ url: `/stage-templates?${query}` })
}

export function fetchAdminTemplate(id) {
  return adminRequest({ url: `/stage-templates/${id}` })
}

export function createAdminTemplate(data) {
  return adminRequest({ url: '/stage-templates', method: 'POST', data })
}

export function updateAdminTemplate(id, data) {
  return adminRequest({ url: `/stage-templates/${id}`, method: 'PUT', data })
}

export function deleteAdminTemplate(id) {
  return adminRequest({ url: `/stage-templates/${id}`, method: 'DELETE' })
}

// ── 地图定位（服务端代理高德，Key 不下发小程序）──────────────
//
// 与网页后台共用 /admin/maps/*。放在已有模块里，避免微信开发者工具
// 对新增 JS 模块的缓存问题（见上方管理员消息接口说明）。

export function geocodeAdminMap(address) {
  return adminRequest({ url: `/maps/geocode?${queryString({ address })}` })
}

export function reverseGeocodeAdminMap({ longitude, latitude }) {
  return adminRequest({ url: `/maps/reverse-geocode?${queryString({ longitude, latitude })}` })
}

export function fetchAdminMapPreview({
  longitude,
  latitude,
  zoom = 16,
  width = 360,
  height = 200,
  scale = 2,
} = {}) {
  const query = queryString({ longitude, latitude, zoom, width, height, scale })
  return adminRequest({ url: `/maps/static?${query}` })
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

// ── 验收报告（管理端只读）────────────────────────────────────
// 放在已有模块里，避免微信开发者工具对新增 JS 模块的映射缓存问题。
// 返回 { items, summary }，无分页；只有已通过且报告生成的单子带
// reportPdf.signedPath（2 小时签名 URL，下载不需要 Authorization）。
export function fetchAdminProjectAcceptances(projectId) {
  return adminRequest({ url: `/projects/${projectId}/acceptances` })
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
