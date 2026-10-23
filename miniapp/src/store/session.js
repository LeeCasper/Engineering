import { clearCurrentProject } from './projectContext'

const TOKEN_KEY = 'gc_token'
const USER_KEY = 'gc_user'
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

export function getCachedProjects() {
  return uni.getStorageSync(PROJECTS_KEY) || null
}

export function setCachedProjects(data) {
  uni.setStorageSync(PROJECTS_KEY, data || null)
}

export function clearSession() {
  uni.removeStorageSync(TOKEN_KEY)
  uni.removeStorageSync(USER_KEY)
  uni.removeStorageSync(PROJECTS_KEY)
  // 项目上下文属于登录态，必须一起清掉；否则下一个账号可能继承上一个账号的项目
  clearCurrentProject()
}
