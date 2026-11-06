import { request, uploadFile } from './request'

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

/** 更新昵称等文字资料 */
export function updateProfile(data) {
  return request({ url: '/auth/profile', method: 'PUT', data })
}

/** 实名认证状态（被邀请后必须完成） */
export function getRealNameStatus() {
  return request({ url: '/auth/real-name' })
}

/**
 * 提交实名认证：姓名 + 身份证号。
 * 证件号只在本次请求里出现，服务端不落明文；前端也不要写 storage / 日志。
 */
export function verifyRealName(data) {
  return request({ url: '/auth/real-name/verify', method: 'POST', data })
}

/**
 * 上传头像。
 *
 * 微信 `chooseAvatar` 给的是临时文件路径，不能直接存进用户资料——
 * 下次进入小程序就失效了。必须先 multipart 上传，拿服务端返回的绝对 URL。
 */
export function uploadAvatar(filePath) {
  return uploadFile({ url: '/auth/avatar', filePath, name: 'avatar' })
}

/** 注销账号（AC-U19）：必须显式确认，成功后 token 立即失效 */
export function deactivateAccount() {
  return request({ url: '/auth/deactivate', method: 'POST', data: { confirm: true } })
}

/** 静态内容页（用户协议 / 隐私政策）。登录前即可读 */
export function getContent(key, tenantId) {
  const query = tenantId ? `?tenantId=${tenantId}` : ''
  return request({ url: `/contents/${key}${query}`, auth: false })
}

/**
 * 当前微信绑定的管理员身份。
 *
 * 这是入口提示与免密登录页使用的接口；它只证明微信身份，
 * 不会返回管理员 token，也不会暴露 openid。
 */
export function listAdminBindings() {
  return request({ url: '/auth/admin/bindings' })
}

/** 用绑定换取管理员 token（audience=admin），之后走 /admin/* */
export function wechatAdminLogin(bindingId) {
  return request({
    url: '/auth/admin/wechat-login',
    method: 'POST',
    data: { bindingId },
  })
}
