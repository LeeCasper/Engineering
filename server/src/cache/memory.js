'use strict'

/**
 * 内存缓存实现。用于测试环境（需要瞬时清空、不该依赖外部服务）与没装 Redis 的本机。
 *
 * 生产环境**不要**用它：多实例部署下各进程各有一份缓存，验证码在 A 实例签发、
 * B 实例校验会直接失败。
 *
 * 过期策略是「读时惰性判断 + 定时清扫」，定时器 unref() 不阻止进程退出 ——
 * 否则测试跑完会挂住。
 */

const SWEEP_INTERVAL_MS = 60_000
/** 单进程内存缓存的安全上限：超过后直接拒绝写入，防止把服务撑 OOM */
const MAX_ENTRIES = 10_000

class MemoryCache {
  constructor() {
    /** @type {Map<string, {value: string, expiresAt: number|null}>} */
    this.store = new Map()
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    if (typeof this.sweeper.unref === 'function') this.sweeper.unref()
  }

  /** 返回未过期的记录，过期则顺手删除 */
  entry(key) {
    const item = this.store.get(key)
    if (!item) return null
    if (item.expiresAt !== null && item.expiresAt <= Date.now()) {
      this.store.delete(key)
      return null
    }
    return item
  }

  async get(key) {
    const item = this.entry(key)
    return item ? item.value : null
  }

  /** value 是调用方已序列化好的字符串；ttlSeconds 缺省表示永不过期 */
  async set(key, value, ttlSeconds) {
    if (!this.store.has(key) && this.store.size >= MAX_ENTRIES) {
      throw new Error(`内存缓存条目数达到上限 ${MAX_ENTRIES}，请改用 Redis 或检查是否有键未设 TTL`)
    }
    this.store.set(key, {
      value: String(value),
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    })
    return true
  }

  async del(...keys) {
    let removed = 0
    for (const key of keys.flat()) {
      if (this.store.delete(key)) removed += 1
    }
    return removed
  }

  /** 原子取出并删除。用于验证码等「一次性消费」的键 */
  async take(key) {
    const item = this.entry(key)
    if (!item) return null
    this.store.delete(key)
    return item.value
  }

  /** 原子自增。用于登录失败计数（AC-AD03）与接口限流 */
  async incr(key) {
    const item = this.entry(key)
    const next = (item ? Number.parseInt(item.value, 10) || 0 : 0) + 1
    this.store.set(key, { value: String(next), expiresAt: item ? item.expiresAt : null })
    return next
  }

  async expire(key, ttlSeconds) {
    const item = this.entry(key)
    if (!item) return 0
    item.expiresAt = Date.now() + ttlSeconds * 1000
    return 1
  }

  /** 剩余有效期（秒）。-1 表示存在但无 TTL，-2 表示不存在 —— 与 Redis 语义对齐 */
  async ttl(key) {
    const item = this.entry(key)
    if (!item) return -2
    if (item.expiresAt === null) return -1
    return Math.ceil((item.expiresAt - Date.now()) / 1000)
  }

  async exists(key) {
    return this.entry(key) ? 1 : 0
  }

  /** 仅供测试调用，生产代码里出现即视为 bug */
  async flush() {
    this.store.clear()
    return true
  }

  /** 清理已过期条目 */
  sweep() {
    const now = Date.now()
    for (const [key, item] of this.store.entries()) {
      if (item.expiresAt !== null && item.expiresAt <= now) this.store.delete(key)
    }
  }

  async close() {
    clearInterval(this.sweeper)
    this.store.clear()
  }
}

module.exports = MemoryCache
