import { request } from './request'

/** 微信静默登录（C-1.1） */
export function login(data) {
  return request({ url: '/auth/login', method: 'POST', data, auth: false })
}

/** 绑定手机号。真实环境传微信 getPhoneNumber 的 code；mock 环境可传 phone */
export function bindPhone(data) {
  return request({ url: '/auth/bind-phone', method: 'POST', data })
}

/** 当前用户资料；传 projectId 时返回该项目内的角色（AC-U01） */
export function getProfile(projectId) {
  const query = projectId ? `?projectId=${projectId}` : ''
  return request({ url: `/auth/profile${query}` })
}

/** 静态内容页（用户协议 / 隐私政策）。登录前即可读 */
export function getContent(key, tenantId) {
  const query = tenantId ? `?tenantId=${tenantId}` : ''
  return request({ url: `/contents/${key}${query}`, auth: false })
}
