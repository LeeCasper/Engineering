const TOKEN_KEY = 'gc_token'
const USER_KEY = 'gc_user'
const ROLE_KEY = 'gc_preferred_role'
const PROJECTS_KEY = 'gc_projects'

export function getToken() {
  return uni.getStorageSync(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (token) uni.setStorageSync(TOKEN_KEY, token)
}

export function getUser() {
  return uni.getStorageSync(USER_KEY) || null
}

export function setUser(user) {
  if (user) uni.setStorageSync(USER_KEY, user)
}

/**
 * 本地「默认视角」，仅用于 UI 排序与文案。
 *
 * 权限永远由后端的 `project_member` 决定 —— 这个值不是身份声明，
 * 用户在 A 项目是工长、B 项目是业主时，服务端各算各的。
 */
export function getPreferredRole() {
  return uni.getStorageSync(ROLE_KEY) || ''
}

export function setPreferredRole(role) {
  uni.setStorageSync(ROLE_KEY, role || '')
}

export function getCachedProjects() {
  return uni.getStorageSync(PROJECTS_KEY) || null
}

export function setCachedProjects(data) {
  uni.setStorageSync(PROJECTS_KEY, data || null)
}

export function clearSession() {
  uni.removeStorageSync(TOKEN_KEY)
  uni.removeStorageSync(USER_KEY)
  // 保留 gc_preferred_role：它是用户的界面偏好，与登录态无关
  uni.removeStorageSync(PROJECTS_KEY)
}
