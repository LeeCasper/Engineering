'use strict'

/**
 * 接口限流（需求文档 §8.2）。
 *
 * 建在缓存抽象层上而非引 express-rate-limit：后者默认的 MemoryStore 在多实例下无效，
 * 而复用本项目已有的 cache 抽象（Redis / 内存可切），限流计数能与验证码、
 * 登录态走同一套降级策略。
 *
 * 三处限流：
 *   globalRateLimit  路由之前按 IP 计数，挡未登录的洪水请求（此时还不知道用户是谁）
 *   userReadRateLimit  鉴权之后按用户 ID 计数，**读接口** 默认 180 次/分钟
 *   userWriteRateLimit 鉴权之后按用户 ID 计数，**写接口** 默认 60 次/分钟
 *
 * 只做 IP 限流会让同一办公室的用户共用一个出口 IP 而互相误伤；只做用户限流则未登录请求不设防。
 *
 * ── 为什么读写分档 ──
 * §8.2 原文只写了「单用户 60 次/分钟」，但 C 端一个页面就要并发十几个 GET
 * （项目详情 9 个、记账页 8~10 个），每个 tab 页 onShow 还会静默刷新，
 * 列表 ↔ 详情 ↔ 记账来回切四五趟就会把 60 次/分钟打满，正常用户被误伤成 429。
 * 因此读接口单独放宽到 180 次/分钟，写接口维持原文的 60 次/分钟 ——
 * 真正需要防的是写操作的刷量与误触，读请求的代价只是带宽。
 * 这与需求文档的差异已同步到 §8.2 与 CLAUDE.md。
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
  // max <= 0 表示关闭该类限流（集成测试会在 vitest.config.mjs 里显式置 0）：
  // 测试文件经常用同一个账号连打上百个请求，限流会把功能测试变成随机的 429。
  if (!Number.isFinite(max) || max <= 0) {
    return function disabledRateLimit(req, res, next) {
      return next()
    }
  }

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

/** GET / HEAD / OPTIONS 算读请求，其余方法（含 DELETE）一律算写 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function isReadMethod(method) {
  return READ_METHODS.has(String(method || 'GET').toUpperCase())
}

/**
 * 按请求方法选阈值的限流器。
 *
 * 读写各用一个独立的 scope：合用一个计数器会让写操作的配额被读请求吃掉，
 * 反过来也一样，分档就失去意义了。两档都以“用户 id”为键，
 * 同一账号多端（手机 + H5）仍然合并计数 —— 这是刻意的，配额属于账号。
 */
function createMethodRateLimit({ scope, identity, readMax, writeMax, readMessage, writeMessage }) {
  // 读阈值 <= 0 表示整个用户级限流关闭：集成测试只设置 RATE_LIMIT_PER_USER_PER_MINUTE=0，
  // 若只关读档，测试里连续的写请求仍会随机撞 429。
  const effectiveWriteMax = readMax > 0 ? writeMax : 0

  const readLimiter = createRateLimit({
    scope: `${scope}:read`,
    max: readMax,
    identity,
    message: readMessage,
  })
  const writeLimiter = createRateLimit({
    scope: `${scope}:write`,
    max: effectiveWriteMax,
    identity,
    message: writeMessage,
  })

  return function methodRateLimit(req, res, next) {
    const limiter = isReadMethod(req.method) ? readLimiter : writeLimiter
    return limiter(req, res, next)
  }
}

/** 登录用户读写分档限流：§8.2 原文 60 次/分钟，读接口放宽到 180（见文件头说明） */
const userRateLimit = createMethodRateLimit({
  scope: 'user',
  identity: (req) => (req.auth ? `${req.auth.type}:${req.auth.id}` : null),
  readMax: config.rateLimit.perUserReadPerMinute,
  writeMax: config.rateLimit.perUserWritePerMinute,
  readMessage: `请求过于频繁，请稍后再试（读接口上限 ${config.rateLimit.perUserReadPerMinute} 次/分钟）`,
  writeMessage: `请求过于频繁，请稍后再试（写接口上限 ${config.rateLimit.perUserWritePerMinute} 次/分钟）`,
})

/** 全局 IP 限流。阈值放宽到用户限流的数倍 —— 它挡的是脚本，不该挡正常用户 */
const globalRateLimit = createRateLimit({
  scope: 'ip',
  max: config.rateLimit.perMinute * 5,
  identity: (req) => req.ip,
})

module.exports = {
  createRateLimit,
  createMethodRateLimit,
  isReadMethod,
  globalRateLimit,
  userRateLimit,
  WINDOW_SECONDS,
}
