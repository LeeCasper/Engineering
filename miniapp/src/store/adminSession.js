/**
 * 小程序「管理」模式的独立会话。
 *
 * 管理员身份来自后台 admin_user，与 C 端微信身份（gc_token）是两套会话：
 * - 管理端 token 只用于 /api/v1/admin/*；
 * - C 端 token 只用于 /api/v1/*；
 * - 任何一侧 401 都不能清掉另一侧。
 *
 * 这里只保存会话与展示信息，不保存权限判断结果。每次进入管理页仍要
 * 调 /admin/auth/profile 回库确认账号、租户与首登改密状态。
 */

import { clearAdminCache } from './adminCache'

const TOKEN_KEY = 'gc_admin_token'
const USER_KEY = 'gc_admin_user'
const META_KEY = 'gc_admin_meta'
const HINT_KEY = 'gc_admin_binding_hint'
const TENANT_CODE_KEY = 'gc_admin_tenant_code'
const REDIRECT_KEY = 'gc_admin_redirect'

export function getAdminToken() {
  return uni.getStorageSync(TOKEN_KEY) || ''
}

export function getAdminUser() {
  return uni.getStorageSync(USER_KEY) || null
}

export function getAdminMeta() {
  return uni.getStorageSync(META_KEY) || null
}

export function getLastAdminTenantCode() {
  return uni.getStorageSync(TENANT_CODE_KEY) || ''
}

export function setLastAdminTenantCode(code) {
  if (code) uni.setStorageSync(TENANT_CODE_KEY, String(code))
}

export function setAdminSession({ token, admin, meta }) {
  // 换账号必须丢掉上一个会话的页面快照
  clearAdminCache()
  if (token) uni.setStorageSync(TOKEN_KEY, token)
  if (admin) uni.setStorageSync(USER_KEY, admin)
  if (meta) uni.setStorageSync(META_KEY, meta)
}

export function setAdminUser(admin) {
  if (admin) uni.setStorageSync(USER_KEY, admin)
}

export function clearAdminSession() {
  clearAdminCache()
  uni.removeStorageSync(TOKEN_KEY)
  uni.removeStorageSync(USER_KEY)
  uni.removeStorageSync(META_KEY)
}

/**
 * 入口提示：当前微信是否有可免密进入的管理身份。
 *
 * 这是 UI 提示，不是权限。真正的身份仍由 /auth/admin/bindings 与
 * /auth/admin/wechat-login 在服务端判定。
 */
export function getBindingHint() {
  return uni.getStorageSync(HINT_KEY) || null
}

export function setBindingHint(count) {
  uni.setStorageSync(HINT_KEY, {
    count: Number(count) || 0,
    checkedAt: Date.now(),
  })
}

export function clearBindingHint() {
  uni.removeStorageSync(HINT_KEY)
}

/** 会话失效时记住原页面，登录成功后回来；不放在 URL 里，避免二次编码 */
export function setAdminRedirect(path) {
  if (path) uni.setStorageSync(REDIRECT_KEY, path)
}

export function consumeAdminRedirect() {
  const path = uni.getStorageSync(REDIRECT_KEY) || ''
  uni.removeStorageSync(REDIRECT_KEY)
  return path
}
