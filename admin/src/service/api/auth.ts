import { request } from '../request';

/** 获取图形验证码（登录前，无需鉴权） */
export function fetchCaptcha() {
  return request<Api.Auth.Captcha>({ url: '/admin/auth/captcha' });
}

/**
 * 账号密码登录。
 *
 * 验证码一次性有效：登录失败后必须重新获取，不能复用同一个 captchaId。
 */
export function fetchLogin(params: Api.Auth.LoginParams) {
  return request<Api.Auth.LoginToken>({
    url: '/admin/auth/login',
    method: 'post',
    data: params
  });
}

/** 当前登录账号 */
export function fetchGetUserInfo() {
  return request<Api.Auth.Profile>({ url: '/admin/auth/profile' });
}

/** 登出（删除服务端会话键，token 立即失效） */
export function fetchLogout() {
  return request<null>({ url: '/admin/auth/logout', method: 'post' });
}

/** 修改本人密码。改密后 token 立即失效，前端需要重新登录 */
export function fetchChangePassword(data: { oldPassword?: string; newPassword: string }) {
  return request<{ relogin: boolean }>({
    url: '/admin/auth/change-password',
    method: 'post',
    data
  });
}
