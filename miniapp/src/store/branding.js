import { reactive } from 'vue'
import { fetchBranding } from '../api/branding'

/**
 * 小程序品牌信息。
 *
 * 名称与 Logo 由平台运营后台统一配置；接口在登录前即可读。
 * 失败时保留内置默认值，不能因为品牌接口挂了就阻塞登录。
 */
export const branding = reactive({
  name: '柏总管',
  // 空字符串表示回落到各页面自己的内置 Logo（登录页 / 首页的 Logo 不同）
  logoUrl: '',
})

let loaded = false
let pending = null

export function loadBranding() {
  if (loaded) return Promise.resolve(branding)
  if (pending) return pending

  pending = fetchBranding()
    .then((data) => {
      if (data) {
        branding.name = (data.name || '').trim() || '柏总管'
        branding.logoUrl = data.logoUrl || ''
      }
      loaded = true
      return branding
    })
    .catch(() => branding)
    .finally(() => {
      pending = null
    })

  return pending
}
