'use strict'

/**
 * 接口限流（需求文档 §8.2：单用户 60 次/分钟）。
 *
 * 建在缓存抽象层上而非引 express-rate-limit：后者默认的 MemoryStore 在多实例下无效，
 * 而复用本项目已有的 cache 抽象（Redis / 内存可切），限流计数能与验证码、
 * 登录态走同一套降级策略。
 *
 * 两处限流分工不同，缺一不可：
 *   globalRateLimit  路由之前按 IP 计数，挡未登录的洪水请求（此时还不知道用户是谁）
 *   userRateLimit    鉴权之后按用户 ID 计数，即 §8.2 说的「单用户 60 次/分钟」
 *
 * 只做 IP 限流会让同一办公室的用户共用一个出口 IP 而互相误伤；只做用户限流则未登录请求不设防。
 */

const cache = require('../cache')
const config = require('../../config')
const AppError = require('../utils/AppError')
const logger = require('../utils/logger')

const WINDOW_SECONDS = 60

/**
 * 固定窗口计数器。选它是因为实现简单、键数量恒定；代价是窗口边界处可能出现
 * 「两倍瞬时量」（第 59 秒打满、第 61 秒又打满）。对「防误触与脚本刷」足够 ——
 * 真要防精确的恶意流量应该在网关层做，而不是在应用层调窗口算法。
 *
 * identity 返回 null 表示该请求不参与限流。
 */
function createRateLimit({ scope, max, identity, message }) {
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const id = identity(req)
      if (!id) return next()

      // 窗口序号直接烧进键名，靠 TTL 自动回收 ——
      // 不需要任何清理任务，也不会有「键过期但计数器还在」的中间态
      const windowIndex = Math.floor(Date.now() / (WINDOW_SECONDS * 1000))
      const key = `ratelimit:${scope}:${id}:${windowIndex}`

      const hits = await cache.incrWithTtl(key, WINDOW_SECONDS + 1)

      // 用标准限流响应头暴露配额，前端可在 429 前就自我克制
      res.setHeader('X-RateLimit-Limit', String(max))
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - hits)))

      if (hits > max) {
        const ttl = await cache.ttl(key)
        if (ttl > 0) res.setHeader('Retry-After', String(ttl))
        return next(AppError.tooManyRequests(message))
      }

      return next()
    } catch (err) {
      // 限流依赖的缓存不可用时**放行**而不是拒绝。
      // 理由：把限流做到「缓存挂了就全站不可用」，等于用一个非核心功能
      // 制造了比它要防的问题更严重的故障。这里记 error 级日志，
      // 让运维能发现缓存异常，但业务继续。
      logger.error('限流中间件异常，已放行', { err, scope })
      return next()
    }
  }
}

/** 全局 IP 限流。阈值放宽到用户限流的数倍 —— 它挡的是脚本，不该挡正常用户 */
const globalRateLimit = createRateLimit({
  scope: 'ip',
  max: config.rateLimit.perMinute * 5,
  identity: (req) => req.ip,
})

/** 登录用户限流，§8.2 的 60 次/分钟 */
const userRateLimit = createRateLimit({
  scope: 'user',
  max: config.rateLimit.perMinute,
  identity: (req) => (req.auth ? `${req.auth.type}:${req.auth.id}` : null),
  message: `请求过于频繁，请稍后再试（上限 ${config.rateLimit.perMinute} 次/分钟）`,
})

module.exports = { createRateLimit, globalRateLimit, userRateLimit, WINDOW_SECONDS }
