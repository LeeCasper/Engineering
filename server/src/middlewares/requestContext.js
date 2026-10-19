'use strict'

/**
 * 请求上下文：为每个请求分配 requestId，并记录访问日志。
 *
 * requestId 的作用不是好看，而是把「客户端报的一个错误」和「服务端的一行日志」
 * 对上。没有它，用户说「刚才提交汇报失败了」时只能按时间戳猜是哪条。
 * 同时通过 X-Request-Id 响应头回传，前端在错误提示里带上它即可。
 */

const { nanoid } = require('nanoid')
const logger = require('../utils/logger')

/** 允许上游网关传入 requestId 以便全链路串联，但要做长度与字符白名单过滤，防止注入日志 */
const INBOUND_HEADER = 'x-request-id'
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/

function requestContext(req, res, next) {
  const inbound = req.get(INBOUND_HEADER)
  req.id = inbound && SAFE_ID.test(inbound) ? inbound : nanoid(16)
  res.setHeader('X-Request-Id', req.id)
  next()
}

/**
 * 访问日志。
 *
 * 只记方法、路径、状态码、耗时、用户标识 —— **不记 query 与 body**：
 * 登录接口的 body 里含明文密码，账目接口含金额，这些都不该进日志。
 * 需要排查具体入参时用 requestId 关联业务日志。
 */
function accessLog(req, res, next) {
  const started = process.hrtime.bigint()

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6
    const meta = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    }
    // 身份按端分别取：B 端 admin，C 端 user
    if (req.auth) {
      meta.actor = req.auth.type === 'admin' ? `admin:${req.auth.id}` : `user:${req.auth.id}`
    }

    // 5xx 记 error，4xx 记 warn，其余 info。
    // 这样「按级别过滤日志」就能直接得到「有哪些故障」，
    // 不必在几千行 access log 里翻状态码。
    if (res.statusCode >= 500) logger.error('请求失败', meta)
    else if (res.statusCode >= 400) logger.warn('请求被拒绝', meta)
    else logger.info('请求完成', meta)
  })

  next()
}

module.exports = { requestContext, accessLog }
