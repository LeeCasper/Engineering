'use strict'

/**
 * Express 应用装配。
 *
 * 与 src/server.js 分开是刻意的：本文件只**构造** app 并返回，
 * 不监听端口。集成测试直接 `require('./src/app')` 拿到的就是这个 app，
 * 用 supertest 打它即可，不必先起一个真实端口再连 localhost ——
 * 后者会带来端口冲突、启动竞态、以及测试跑完端口没释放的问题。
 */

const express = require('express')
const helmet = require('helmet')
const cors = require('cors')

const config = require('../config')
const { attachResponseHelpers } = require('./utils/response')
const { requestContext, accessLog } = require('./middlewares/requestContext')
const { globalRateLimit } = require('./middlewares/rateLimit')
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler')
const routes = require('./routes')

function createApp() {
  const app = express()

  // 不在响应头里暴露技术栈（AC-AD46 的精神：少给攻击者一点信息）
  app.disable('x-powered-by')

  // 部署在 nginx 之后时，req.ip 取的是代理 IP 而不是真实客户端 IP，
  // 会让限流把所有人算成同一个用户。信任一层代理即可拿到 X-Forwarded-For。
  app.set('trust proxy', 1)

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(cors())

  app.use(requestContext)
  app.use(attachResponseHelpers)
  app.use(accessLog)

  // 电子签回调必须在 express.json() 之前：验签依赖原始 body。
  // 也放在 globalRateLimit 之前，避免服务商重试被误伤。
  app.use(
    `${config.server.apiPrefix}/esign/callback`,
    express.raw({ type: '*/*', limit: '1mb' }),
    require('./routes/esignCallback.routes')
  )

  // 请求体大小限制：附件走 multipart（multer），JSON body 不该很大。
  // 不限的话一个超大 JSON 就能把进程内存打满。
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))

  app.use(globalRateLimit)

  // 健康检查放在业务前缀之外：它服务于负载均衡与运维探针，
  // 不应该跟着 API 版本走（/api/v1 → /api/v2 时探针不该跟着改）
  app.get('/health', (req, res) => {
    res.ok({ status: 'ok', env: config.env, time: new Date().toISOString() })
  })

  // ── 上传文件的静态服务 ──
  // 仅本地存储适配器需要（storage/index.js）。换成对象存储后这段可以删掉，
  // 图片会由 CDN 直接提供。
  //
  // 三个选项都关掉是刻意的：
  //   dotfiles: 'deny'     禁止访问 .htaccess 之类的点文件
  //   index: false         不要目录索引（列目录等于免费提供一份文件清单）
  //   redirect: false      不做目录重定向，避免暴露目录结构
  app.use(
    config.upload.publicPath,
    express.static(config.upload.dir, { dotfiles: 'deny', index: false, redirect: false })
  )

  app.use(config.server.apiPrefix, routes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

module.exports = { createApp }
