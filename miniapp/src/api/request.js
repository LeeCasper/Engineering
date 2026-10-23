import { API_BASE } from '../config'
import { getToken, clearSession } from '../store/session'

/**
 * 统一请求封装。
 *
 * 后端响应恒为 `{ code, message, data }`（需求文档 §7.2）：
 * HTTP 2xx + `code === 0` 才算成功，其余一律 reject —— 调用方只需要
 * 处理一种失败形态，不必在每个页面里判断 `res.data.code`。
 */
/**
 * 把后端返回的相对媒体路径补成可访问地址。
 *
 * 上传后的照片 / PDF 存的是 `/uploads/...`；小程序不能直接加载相对路径。
 * 生产环境 API_BASE 是 `/api/v1`（同源），去掉它之后仍是同源路径。
 */
export function resolveMediaUrl(url) {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  // /static 是小程序自己的本地资源，不能拼到后端 origin 上
  if (url.startsWith('/static/')) return url
  if (url.startsWith('/')) return API_BASE.replace(/\/api\/v1\/?$/, '') + url
  return url
}

/**
 * multipart 上传（验收现场照片 / 业主签名）。
 *
 * 后端成功响应仍是 `{ code, message, data }`，但 `uni.uploadFile` 的 `res.data`
 * 是字符串，必须先 JSON.parse —— 直接当对象用会得到 undefined 并静默失败。
 */
export function uploadFile({ url, filePath, name, formData = {}, auth = true, header = {} }) {
  return new Promise((resolve, reject) => {
    const token = getToken()
    const headers = { ...header }
    if (auth && token) headers.Authorization = `Bearer ${token}`

    uni.uploadFile({
      url: `${API_BASE}${url}`,
      filePath,
      name,
      formData,
      header: headers,
      success(res) {
        let body = {}
        try {
          body = JSON.parse(res.data || '{}')
        } catch (err) {
          reject(new Error('服务端返回了无法解析的数据'))
          return
        }

        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
          resolve(body.data)
          return
        }

        if (res.statusCode === 401) clearSession()

        const error = new Error(body.message || `上传失败（${res.statusCode}）`)
        error.statusCode = res.statusCode
        error.code = body.code
        error.data = body.data
        reject(error)
      },
      fail(err) {
        reject(new Error(err.errMsg || '上传失败，请稍后重试'))
      },
    })
  })
}

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
