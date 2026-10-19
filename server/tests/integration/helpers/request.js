'use strict'

/**
 * 集成测试的请求工具。supertest 直接打 createApp() 返回的 app，**不监听真实端口** ——
 * 没有端口冲突、没有启动竞态、跑完不留残余进程。HTTP 服务器自身的配置
 * （超时、TLS）不在覆盖范围内，那部分由冒烟脚本对真实进程验证。
 */

const supertest = require('supertest')
const { createApp } = require('../../../src/app')
const config = require('../../../config')

let app = null

/** 复用同一个 app 实例：createApp 会注册各种中间件，没必要每个用例重建 */
function getApp() {
  if (!app) app = createApp()
  return app
}

/** 路径写接口相对路径即可（'/projects'），API_PREFIX 自动补上，避免测试里硬编码 /api/v1 */
function request(method, url) {
  const full = url.startsWith('/') ? `${config.server.apiPrefix}${url}` : url
  return supertest(getApp())[method](full)
}

/** 带 token 的请求 */
function authed(method, url, token) {
  return request(method, url).set('Authorization', `Bearer ${token}`)
}

/**
 * 发起一个**期望二进制响应**的请求。
 *
 * ── 为什么不能直接用 res.body ──
 * superagent 对不认识的 Content-Type（如 xlsx 的 `application/vnd.openxmlformats-...`）
 * 不做解析：`res.body` 是空对象，数据落在 `res.text` 里 ——
 * 而 `res.text` 已经按 UTF-8 解码过了，字节 >127 的部分**已经损坏**，
 * 再 `Buffer.from(text, 'binary')` 也救不回来。
 *
 * 因此必须自己收集数据流。这也是唯一能拿到 xlsx / PDF 原始字节的办法。
 *
 * @returns {Promise<{status: number, headers: object, buffer: Buffer}>}
 */
function binary(method, url, { token } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(method, url).buffer(true)

    // 自定义 parser：Node 环境下 superagent 把响应流交给我们，
    // 我们自己拼 Buffer，绕开它内置的解码
    req.parse((res, callback) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => callback(null, Buffer.concat(chunks)))
      res.on('error', reject)
    })

    if (token) req.set('Authorization', `Bearer ${token}`)

    req.end((err, res) => {
      if (err && !res) return reject(err)
      resolve({ status: res.status, headers: res.headers, buffer: res.body })
    })
  })
}

module.exports = {
  binary,
  get: (url) => request('get', url),
  post: (url) => request('post', url),
  put: (url) => request('put', url),
  del: (url) => request('delete', url),
  authed,
  getApp,
  /** 不带 API 前缀的请求，用于 /health 这类根级路由 */
  raw: (method, url) => supertest(getApp())[method](url),
}
