import { API_BASE } from '../../config'
import { getAdminToken, clearAdminSession, setAdminRedirect } from '../../store/adminSession'

// 不能从 utils/admin 引 ADMIN_HOME：utils/admin 为了 401 跳转已经引用了本模块，
// 反向引用会形成循环 require（CLAUDE.md 第 63 条）。
const ADMIN_HOME = '/pages/admin/workbench/index'

/**
 * 管理员请求通道。
 *
 * 与 C 端 request.js 刻意分开：
 * - 只用 gc_admin_token；
 * - 401 只清管理员会话，不清 gc_token / gc_current_project；
 * - 登录与验证码用 auth:false，失败不触发跳转。
 */

let redirecting = false

function currentAdminPath() {
  const pages = getCurrentPages()
  const page = pages && pages.length ? pages[pages.length - 1] : null
  if (!page || !page.route) return ADMIN_HOME

  let path = `/${page.route}`
  const options = page.options || {}
  const query = Object.keys(options)
    .filter((key) => options[key] !== undefined && options[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`)
    .join('&')

  if (query) path += `?${query}`
  return path
}

function safeAdminRedirect(path) {
  if (typeof path === 'string' && path.startsWith('/pages/admin/')) return path
  return ADMIN_HOME
}

export function redirectToAdminLogin(reason = '') {
  if (redirecting) return
  const pages = getCurrentPages()
  const page = pages && pages.length ? pages[pages.length - 1] : null
  if (page && page.route === 'pages/admin/login/index') return

  redirecting = true
  const redirect = safeAdminRedirect(currentAdminPath())
  if (redirect) setAdminRedirect(redirect)
  const suffix = reason ? `?reason=${encodeURIComponent(reason)}` : ''

  uni.redirectTo({
    url: `/pages/admin/login/index${suffix}`,
    complete: () => {
      setTimeout(() => {
        redirecting = false
      }, 800)
    },
  })
}

export function adminRequest({ url, method = 'GET', data, auth = true, header = {} }) {
  return new Promise((resolve, reject) => {
    const token = getAdminToken()
    const headers = {
      'Content-Type': 'application/json',
      ...header,
    }
    if (auth && token) headers.Authorization = `Bearer ${token}`

    uni.request({
      url: `${API_BASE}/admin${url}`,
      method,
      data,
      header: headers,
      success(res) {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
          resolve(body.data)
          return
        }

        if (res.statusCode === 401 && auth) {
          clearAdminSession()
          redirectToAdminLogin('expired')
        }

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

/**
 * 管理端 multipart 上传。
 *
 * 与 C 端 `uploadFile` 的区别只有 token 与地址前缀：这里只用 gc_admin_token，
 * 401 只清管理员会话，绝不触碰 C 端 `gc_token`（CLAUDE.md 第 90 条）。
 */
export function adminUploadFile({ url, filePath, name = 'file', formData = {}, auth = true, header = {} }) {
  return new Promise((resolve, reject) => {
    const token = getAdminToken()
    const headers = { ...header }
    if (auth && token) headers.Authorization = `Bearer ${token}`

    uni.uploadFile({
      url: `${API_BASE}/admin${url}`,
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

        if (res.statusCode === 401 && auth) {
          clearAdminSession()
          redirectToAdminLogin('expired')
        }

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

export function isAdminUnauthorized(err) {
  return Boolean(err && err.statusCode === 401)
}
