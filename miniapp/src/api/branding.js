import { request } from './request'

/** 登录前即可读的小程序品牌：名称与 Logo（平台统一配置） */
export function fetchBranding() {
  return request({ url: '/branding', auth: false })
}
