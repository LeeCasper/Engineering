'use strict'

/**
 * 缓存门面：按 CACHE_DRIVER 选后端（redis / memory）、统一加键前缀、统一 JSON 序列化。
 *
 * 本门面**不吞异常**。Redis 挂了就是挂了，调用方立刻能看到，而不是拿到一个 null
 * 后误判成「键不存在」—— 那会让「验证码错误」和「验证码服务不可用」表现成同一种，
 * 线上无法区分。确实可以降级的少数场景（路线规划缓存、token 空闲续期），
 * 由调用点显式 try/catch，降级决策写在业务代码里而不是藏在这里。
 */

const config = require('../../config')
const logger = require('../utils/logger')
const MemoryCache = require('./memory')
const RedisCache = require('./redis')

const PREFIX = config.cache.prefix

let driver = null

function getDriver() {
  if (driver) return driver

  if (config.cache.driver === 'redis') {
    driver = new RedisCache()
    logger.info('缓存驱动：Redis', { host: config.cache.redis.host, db: config.cache.redis.db })
  } else {
    driver = new MemoryCache()
    logger.info('缓存驱动：内存（仅适用于单实例与测试环境）')
  }
  return driver
}

/** 加前缀。所有对外方法都必须经过它，否则前缀就形同虚设 */
function k(key) {
  return `${PREFIX}${key}`
}

/** 去掉前缀，供调试与测试断言使用 */
function stripPrefix(key) {
  return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key
}

async function get(key) {
  const raw = await getDriver().get(k(key))
  if (raw === null || raw === undefined) return null
  try {
    return JSON.parse(raw)
  } catch {
    // 非 JSON 内容说明键被外部程序改过，原样返回字符串比抛错更有用
    return raw
  }
}

/** ttlSeconds 不传表示永不过期 —— 慎用，无 TTL 的键是内存泄漏的常见来源 */
async function set(key, value, ttlSeconds) {
  return getDriver().set(k(key), JSON.stringify(value), ttlSeconds)
}

/** 仅当键不存在时写入，返回是否写入成功。用于「同一提醒只发一次」的抢占式去重 */
async function setIfAbsent(key, value, ttlSeconds) {
  const current = await getDriver().get(k(key))
  if (current !== null && current !== undefined) return false
  await getDriver().set(k(key), JSON.stringify(value), ttlSeconds)
  return true
}

/** 删除一个或多个键，返回实际删除数量 */
async function del(...keys) {
  return getDriver().del(keys.flat().map(k))
}

/**
 * 原子自增，返回自增后的值。
 * 自增键存的是裸数字字符串而非 JSON，与 get 的解析路径不同 ——
 * 计数器请统一用 incr 读，不要用 get 混读。
 */
async function incr(key) {
  return getDriver().incr(k(key))
}

/**
 * 自增并在首次创建时设置 TTL。
 * 用于「N 次/分钟」这类窗口限流：计数键必须带上窗口，否则计数永远涨。
 */
async function incrWithTtl(key, ttlSeconds) {
  const count = await getDriver().incr(k(key))
  if (count === 1 && ttlSeconds) await getDriver().expire(k(key), ttlSeconds)
  return count
}

/** 重设 TTL（秒） */
async function expire(key, ttlSeconds) {
  return getDriver().expire(k(key), ttlSeconds)
}

/** 剩余 TTL（秒）：-1 存在但无 TTL，-2 不存在 */
async function ttl(key) {
  return getDriver().ttl(k(key))
}

async function exists(key) {
  return (await getDriver().exists(k(key))) === 1
}

/** **仅供测试**。生产代码里出现即视为 bug —— 它会连带清掉所有用户的登录态 */
async function flush() {
  return getDriver().flush()
}

/** 探活。返回 false 不抛错，便于健康检查接口直接使用 */
async function isAvailable() {
  try {
    await getDriver().set(`${PREFIX}__ping`, '1', 10)
    return true
  } catch (err) {
    logger.warn('缓存不可用', { message: err.message })
    return false
  }
}

/** 关闭连接（进程退出、测试 teardown） */
async function close() {
  if (!driver) return
  await driver.close()
  driver = null
}

module.exports = {
  get,
  set,
  setIfAbsent,
  del,
  incr,
  incrWithTtl,
  expire,
  ttl,
  exists,
  flush,
  isAvailable,
  close,
  stripPrefix,
  /** 测试用：强制重建驱动以切换配置 */
  _reset() {
    driver = null
  },
  _kind() {
    return config.cache.driver
  },
}
