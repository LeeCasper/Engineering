import { PROJECT_STATUS_LABELS } from '../config'
import {
  getAdminToken,
  setAdminUser,
  clearAdminSession,
} from '../store/adminSession'
import { fetchAdminProfile } from '../api/admin/auth'
import { redirectToAdminLogin } from '../api/admin/request'

export const ADMIN_ROLE_LABELS = {
  owner: '租户管理员',
  admin: '项目管理员',
  platform: '平台运营',
}

export const MEMBER_ROLE_LABELS = {
  owner: '业主',
  foreman: '工长',
  supervisor: '监理',
}

export const OWNER_TYPE_LABELS = {
  primary: '主业主',
  temporary: '临时业主',
}

export const MEMBER_STATUS_LABELS = {
  pending: '待确认',
  active: '已加入',
  removed: '已移除',
}

export const NODE_STATUS_LABELS = {
  not_started: '未开始',
  unlocked: '已解锁',
  paid: '已付款',
  confirmed: '已确认',
}

export const TRIGGER_LABELS = {
  manual: '手动解锁',
  stage_acceptance: '阶段验收后解锁',
}

export const BIND_FRESH_MS = 30 * 60 * 1000

/** 管理端默认落地页。管理入口、登录成功、会话失效兜底都回这里 */
export const ADMIN_HOME = '/pages/admin/workbench/index'

export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '0'
  const text = String(value)
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const parts = unsigned.split('.')
  const integer = (parts[0] || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const decimal = (parts[1] || '').padEnd(2, '0').slice(0, 2)
  const fraction = Number(decimal) === 0 ? '' : `.${decimal}`
  return `${negative ? '-' : ''}${integer}${fraction}`
}

export function formatDate(value) {
  if (!value) return ''
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return text
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function formatDateTime(value) {
  if (!value) return ''
  const text = String(value).replace('T', ' ')
  return text.length >= 16 ? text.slice(0, 16) : text
}

export function percent(value) {
  const number = Number(value) || 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

export function statusLabel(status) {
  return PROJECT_STATUS_LABELS[status] || status || '未知'
}

export function memberRoleLabel(role) {
  return MEMBER_ROLE_LABELS[role] || role || '成员'
}

/**
 * 成员的角色展示文案取「最具体」的那一层：
 * 主工长 > 主业主 > 临时业主 > 基础角色。
 * 管理端不能只显示 roleLabel —— 工长与主工长的权限完全不同。
 */
export function memberRoleText(member) {
  if (!member) return '成员'
  if (member.isPrimaryForeman) return '主工长'
  if (member.isPrimaryOwner) return '主业主'
  if (member.ownerType === 'temporary') return '临时业主'
  return member.roleLabel || memberRoleLabel(member.role)
}

export function memberStatusText(member) {
  if (!member) return ''
  return MEMBER_STATUS_LABELS[member.status] || member.statusLabel || member.status || ''
}

export function nodeStatusLabel(status) {
  return NODE_STATUS_LABELS[status] || status || '未知'
}

export function triggerLabel(triggerType) {
  return TRIGGER_LABELS[triggerType] || triggerType || '未知'
}

export function isAdminFresh(profile) {
  if (!profile || profile.authMethod !== 'password' || !profile.tokenIssuedAt) return false
  return Date.now() - Number(profile.tokenIssuedAt) * 1000 <= BIND_FRESH_MS
}

export function sanitizeAdminRedirect(path) {
  if (typeof path !== 'string' || !path.startsWith('/pages/admin/')) {
    return ADMIN_HOME
  }
  // 登录页与改密页不能作为登录后的目标，否则会绕回自己
  if (path.startsWith('/pages/admin/login') || path.startsWith('/pages/admin/change-password')) {
    return ADMIN_HOME
  }
  return path
}

export function goCProjects() {
  uni.switchTab({ url: '/pages/projects/index' })
}

export function goAdminHome() {
  uni.redirectTo({ url: ADMIN_HOME })
}

export function goAdminProjects() {
  uni.redirectTo({ url: '/pages/admin/projects/index' })
}

export function adminBack(fallback = ADMIN_HOME) {
  const pages = getCurrentPages()
  if (pages && pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.redirectTo({ url: fallback })
}

export function redirectToAdminChangePassword(first = false) {
  uni.redirectTo({ url: `/pages/admin/change-password/index${first ? '?first=1' : ''}` })
}

/**
 * 管理页统一守卫。
 *
 * 每次进入管理页都回库确认账号状态、租户与首登改密标记；
 * 不依赖本地缓存的 role/tenantId 做权限判断。
 *
 * @returns {Promise<object|null>} profile；返回 null 表示已经跳转，调用方停止加载
 */
export async function requireAdminSession() {
  if (!getAdminToken()) {
    redirectToAdminLogin('login_required')
    return null
  }

  let profile
  try {
    profile = await fetchAdminProfile()
  } catch (err) {
    // adminRequest 对 401 已清会话并跳登录；这里不再重复跳
    if (err && err.statusCode === 401) return null
    throw err
  }

  if (!profile || profile.tenantId == null || profile.role === 'platform') {
    clearAdminSession()
    uni.showToast({ title: '该账号不能进入租户管理端', icon: 'none' })
    redirectToAdminLogin('invalid_tenant')
    return null
  }

  setAdminUser(profile)

  if (profile.mustChangePassword) {
    redirectToAdminChangePassword(true)
    return null
  }

  return profile
}

export function showAdminError(err, fallback = '操作失败') {
  if (!err) return
  if (err.statusCode === 401) return
  uni.showToast({ title: err.message || fallback, icon: 'none', duration: 2600 })
}

// ── 管理端静态地图换算 ─────────────────────────────────────
//
// 刻意放在已有的 utils/admin 模块里，而不是新建 mapProjection.js：
// 微信开发者工具对运行期间新增的 JS 模块经常不更新模块映射，会报
// `module '...' is not defined`（见 miniapp/README 的说明）。
// 这些函数与网页后台 / 服务端使用同一套 Web Mercator 公式。

const MAP_WORLD_AT_ZOOM1 = 256
// 高德静态图 zoom 比标准 Web Mercator 大 1
const MAP_STATIC_ZOOM_OFFSET = 1
const MAP_COORDINATE_PATTERN = /^-?\d{1,3}(\.\d{1,7})?$/

export const MAX_MERCATOR_LAT = 85.0511287798066

function clampMapValue(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function lngLatToMercator(longitude, latitude, zoom) {
  const worldSize = MAP_WORLD_AT_ZOOM1 * 2 ** (zoom + MAP_STATIC_ZOOM_OFFSET)
  const x = ((longitude + 180) / 360) * worldSize
  const rad = (clampMapValue(latitude, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) * Math.PI) / 180
  const y =
    (0.5 - Math.log((1 + Math.sin(rad)) / (1 - Math.sin(rad))) / (4 * Math.PI)) * worldSize
  return { x, y, worldSize }
}

function mercatorToLngLat(x, y, zoom) {
  const worldSize = MAP_WORLD_AT_ZOOM1 * 2 ** (zoom + MAP_STATIC_ZOOM_OFFSET)
  const longitude = (x / worldSize) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / worldSize
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return {
    longitude: clampMapValue(longitude, -180, 180),
    latitude: clampMapValue(latitude, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT),
  }
}

export function moveCenterByPixels(center, dx, dy, zoom) {
  const { x, y } = lngLatToMercator(center.longitude, center.latitude, zoom)
  // 向右拖 → 中心往西；向下拖 → 中心往北
  return mercatorToLngLat(x - dx, y - dy, zoom)
}

export function toCoordinateString(value) {
  return Number(value).toFixed(7)
}

export function isValidCoordinate(value, min, max) {
  const text = value === null || value === undefined ? '' : String(value).trim()
  if (!MAP_COORDINATE_PATTERN.test(text)) return false
  const number = Number(text)
  return Number.isFinite(number) && number >= min && number <= max
}
