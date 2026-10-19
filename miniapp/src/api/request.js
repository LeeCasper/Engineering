import { API_BASE } from '../config'
import { getToken, clearSession } from '../store/session'

/**
 * 统一请求封装。
 *
 * 后端响应恒为 `{ code, message, data }`（需求文档 §7.2）：
 * HTTP 2xx + `code === 0` 才算成功，其余一律 reject —— 调用方只需要
 * 处理一种失败形态，不必在每个页面里判断 `res.data.code`。
 */
export function request({ url, method = 'GET', data, auth = true, header = {} }) {
  return new Promise((resolve, reject) => {
    const token = getToken()
    const headers = {
      'Content-Type': 'application/json',
      ...header,
    }
    if (auth && token) headers.Authorization = `Bearer ${token}`

    uni.request({
      url: `${API_BASE}${url}`,
      method,
      data,
      header: headers,
      success(res) {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
          resolve(body.data)
          return
        }

        // 401：token 失效（注销、改密、会话过期）。清掉本地登录态，
        // 下一次进入由登录页重新发起微信登录。
        if (res.statusCode === 401) clearSession()

        const error = new Error(body.message || `请求失败（${res.statusCode}）`)
        error.statusCode = res.statusCode
        error.code = body.code
        error.data = body.data
        reject(error)
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络异常，请稍后重试'))
      },
    })
  })
}
