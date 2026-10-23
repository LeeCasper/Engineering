import { adminRequest } from './request'

/** 管理员登录图形验证码：PNG data URI，供小程序 <image> 直接渲染 */
export function fetchAdminCaptchaPng() {
  return adminRequest({ url: '/auth/captcha?format=png', auth: false })
}

/**
 * 租户管理员密码登录。
 *
 * 固定 portal=tenant：小程序管理端不接受平台账号。
 * 验证码一次性有效，失败后必须重新获取。
 */
export function loginAdmin({ tenantCode, username, password, captchaId, captchaAnswer }) {
  return adminRequest({
    url: '/auth/login',
    method: 'POST',
    auth: false,
    data: {
      tenantCode,
      username,
      password,
      captchaId,
      captchaAnswer,
      portal: 'tenant',
    },
  })
}

export function fetchAdminProfile() {
  return adminRequest({ url: '/auth/profile' })
}

export function logoutAdmin() {
  return adminRequest({ url: '/auth/logout', method: 'POST' })
}

export function changeAdminPassword({ oldPassword, newPassword }) {
  return adminRequest({
    url: '/auth/change-password',
    method: 'POST',
    data: { oldPassword, newPassword },
  })
}

/** 当前管理员是否已绑定微信 */
export function fetchAdminWechatBinding() {
  return adminRequest({ url: '/auth/wechat-binding' })
}

/** 绑定当前微信；miniToken 由 C 端登录态提供，只用于证明 openid */
export function bindAdminWechat(miniToken) {
  return adminRequest({
    url: '/auth/wechat-binding',
    method: 'POST',
    header: { 'X-Mini-Token': miniToken },
    data: {},
  })
}

export function unbindAdminWechat() {
  return adminRequest({ url: '/auth/wechat-binding', method: 'DELETE' })
}
