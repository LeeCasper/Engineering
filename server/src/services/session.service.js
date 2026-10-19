'use strict'

/**
 * B 端会话管理。
 *
 * ── 为什么需要它，而不是只靠 JWT 的 exp ──
 * B-1.7 要求「token 有效期**与空闲超时**」。JWT 的 exp 只能表达绝对有效期，
 * 表达不了「30 分钟没操作就失效」。因此登录时在缓存里建一个会话键，
 * 每次请求刷新它的 TTL，TTL 到点即空闲超时。
 *
 * 键里带 iat（token 的签发时间）而不是只用 adminId：一个人可能同时开着两个
 * 浏览器标签登录，两个 token 的活跃状态应当独立，用 adminId 做键会让
 * 登出其中一个把另一个也踢掉。
 *
 * 会话键**必须存在**才放行，而不是「不存在就当作首次请求放行」。
 * 后者看似能容忍缓存重启，实际后果是登出永远失效 —— 登出删掉键之后，
 * 下一次请求会因为「不存在」而被放行并重新建键。
 */

const config = require('../../config')
const cache = require('../cache')
const datetime = require('../utils/datetime')

function key(adminId, issuedAt) {
  return `admin:session:${adminId}:${issuedAt}`
}

/** 空闲超时窗口（秒）。配错时回落到 30 分钟，不让配置错误把所有人锁在门外 */
function idleSeconds() {
  const ms = datetime.parseDurationMs(config.jwt.admin.idle, 30 * 60 * 1000)
  return Math.floor(ms / 1000)
}

/** 登录成功后建立会话，起始 TTL 即空闲窗口 */
async function start(adminId, issuedAt) {
  await cache.set(key(adminId, issuedAt), 1, idleSeconds())
}

/** 刷新空闲计时。返回 false 表示会话已失效（登出 / 空闲超时 / 缓存被清） */
async function touch(adminId, issuedAt) {
  const k = key(adminId, issuedAt)
  const exists = await cache.get(k)
  if (exists === null) return false
  await cache.expire(k, idleSeconds())
  return true
}

/** 登出：删掉会话键，该 token 立即失效 */
async function end(adminId, issuedAt) {
  await cache.del(key(adminId, issuedAt))
}

module.exports = { key, idleSeconds, start, touch, end }
