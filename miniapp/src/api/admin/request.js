import { API_BASE } from '../../config'
import { getAdminToken, clearAdminSession, setAdminRedirect } from '../../store/adminSession'

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
  if (!page || !page.route) return '/pages/admin/projects/index'

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
  return '/pages/admin/projects/index'
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

export function isAdminUnauthorized(err) {
  return Boolean(err && err.statusCode === 401)
}
