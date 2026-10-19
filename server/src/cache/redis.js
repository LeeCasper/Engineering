'use strict'

/**
 * Redis 缓存实现（需求文档 §3.2：登录态、验证码、消息去重）。
 *
 * lazyConnect 避免 require 阶段就把进程卡在网络 IO 上；
 * maxRetriesPerRequest 设 1 而非默认的 20 —— 默认值会让一次 Redis 抖动把请求
 * 拖到十几秒，宁可快速失败让上层降级，也不要拖垮接口 P95。
 */

const Redis = require('ioredis')
const config = require('../../config')
const logger = require('../utils/logger')

class RedisCache {
  constructor() {
    this.client = new Redis({
      host: config.cache.redis.host,
      port: config.cache.redis.port,
      db: config.cache.redis.db,
      password: config.cache.redis.password || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    })

    this.client.on('error', (err) => {
      // Redis 抖动不该刷满错误日志，降为 warn；真正的不可用由 index.js 的降级兜底
      logger.warn('Redis 连接异常', { message: err.message })
    })
    this.client.on('ready', () => logger.info('Redis 已连接', { db: config.cache.redis.db }))
  }

  async ensureConnected() {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect()
    }
    return this.client
  }

  async get(key) {
    const client = await this.ensureConnected()
    return client.get(key)
  }

  async set(key, value, ttlSeconds) {
    const client = await this.ensureConnected()
    if (ttlSeconds) return client.set(key, value, 'EX', ttlSeconds)
    return client.set(key, value)
  }

  async del(...keys) {
    const flat = keys.flat()
    if (flat.length === 0) return 0
    const client = await this.ensureConnected()
    return client.del(...flat)
  }

  async incr(key) {
    const client = await this.ensureConnected()
    return client.incr(key)
  }

  async expire(key, ttlSeconds) {
    const client = await this.ensureConnected()
    return client.expire(key, ttlSeconds)
  }

  async ttl(key) {
    const client = await this.ensureConnected()
    return client.ttl(key)
  }

  async exists(key) {
    const client = await this.ensureConnected()
    return client.exists(key)
  }

  /** 仅测试使用。走 FLUSHDB，因此测试必须配独立的 REDIS_DB */
  async flush() {
    const client = await this.ensureConnected()
    await client.flushdb()
    return true
  }

  async close() {
    if (this.client.status === 'end') return
    await this.client.quit()
  }
}

module.exports = RedisCache
