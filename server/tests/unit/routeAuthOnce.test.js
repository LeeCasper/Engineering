'use strict'

/**
 * 鉴权中间件的**幂等性**：一个 HTTP 请求只鉴权一次、只计一个限流额度。
 *
 * ── 为什么要专门锁这条 ──
 * `routes/index.js` 把 7 条子路由串在同一个 `/projects` 挂载点上，每条子路由
 * 自己 `use(requireMini)`。Express 对匹配不到路由的子路由**照样会执行它的
 * `use` 中间件**，于是一个 `/projects/:id/visits` 请求会穿过 7 条 requireMini：
 * 回库查 7 次用户、扣 7 个读限流额度。上线后实测进一次项目详情（聚合前 9 个
 * 接口）扣掉 24 个额度，用户可用量只剩标称的 1/3~1/4，限流被误伤。
 * 见 CLAUDE.md 第 95 条。
 *
 * 这组用例跑的是**真实的路由树与真实的中间件**，只把 jwt / 用户查询 / 缓存计数
 * 换成桩 —— 不碰数据库，也不依赖任何业务数据。
 */

// 必须在 require 配置之前：vitest.config.mjs 把用户级限流设成 0（集成测试要用
// 同一账号连打上百个请求），这里显式打开，否则限流器是空实现、计数恒为 0。
process.env.RATE_LIMIT_PER_USER_PER_MINUTE = '180'
process.env.RATE_LIMIT_PER_USER_WRITE_PER_MINUTE = '60'

const request = require('supertest')
const jwt = require('../../src/utils/jwt')
const userModel = require('../../src/models/user.model')
const cache = require('../../src/cache')
const { createApp } = require('../../src/app')

const AUTH_USER_ID = 4242

let readHits = 0
let writeHits = 0
let userLookups = 0

jwt.extractToken = () => 'stub-token'
jwt.verifyMini = () => ({ sub: AUTH_USER_ID })
userModel.findById = async (id) => {
  userLookups += 1
  return { id, status: 'active', openid: 'stub-openid', phone: '13800000000' }
}

// 只统计用户级限流的键，其余缓存访问原样交给真实实现
const realIncrWithTtl = cache.incrWithTtl.bind(cache)
cache.incrWithTtl = async (key, ttl) => {
  if (key.startsWith('ratelimit:user:read:')) {
    readHits += 1
    return 1
  }
  if (key.startsWith('ratelimit:user:write:')) {
    writeHits += 1
    return 1
  }
  return realIncrWithTtl(key, ttl)
}

const app = createApp()

/** 发一个请求，返回这次请求消耗的读 / 写额度与回库次数 */
async function measure(method, path) {
  const before = { readHits, writeHits, userLookups }
  await request(app)[method.toLowerCase()](path).set('Authorization', 'Bearer stub-token')
  return {
    read: readHits - before.readHits,
    write: writeHits - before.writeHits,
    lookups: userLookups - before.userLookups,
  }
}

describe('鉴权中间件幂等（一个请求只扣一次额度，CLAUDE.md 第 95 条）', () => {
  it('串在同一挂载点下的子路由不会重复计数', async () => {
    // 这四条分别命中 `/projects` 挂载链上的第 7 / 4 / 3 / 2 条子路由。
    // 修复前它们的消耗是 7 / 4 / 3 / 2，正是测试同学实测到的数字。
    const cases = [
      ['GET', '/api/v1/projects/1/visits'],
      ['GET', '/api/v1/projects/1/ledger/overview'],
      ['GET', '/api/v1/projects/1/acceptances'],
      ['GET', '/api/v1/projects/1/reports'],
    ]

    for (const [method, path] of cases) {
      const cost = await measure(method, path)
      expect({ path, read: cost.read }).toEqual({ path, read: 1 })
      // 同一个请求也不该重复回库查用户
      expect({ path, lookups: cost.lookups }).toEqual({ path, lookups: 1 })
    }
  })

  it('写请求同样只扣一次写额度', async () => {
    // 路径不存在也没关系 —— 限流与鉴权在路由之前就跑完了
    const cost = await measure('POST', '/api/v1/projects/1/visits')
    expect(cost.write).toBe(1)
    expect(cost.lookups).toBe(1)
  })

  it('只有一条子路由的普通挂载点仍然只扣一次（没有多扣，也没有漏扣）', async () => {
    const cost = await measure('GET', '/api/v1/notifications')
    expect(cost.read).toBe(1)
    expect(cost.lookups).toBe(1)
  })

  it('未登录请求既不计数也不回库', async () => {
    const before = { readHits, userLookups }
    jwt.extractToken = () => null
    await request(app).get('/api/v1/projects/1/visits')
    expect(readHits - before.readHits).toBe(0)
    expect(userLookups - before.userLookups).toBe(0)
    jwt.extractToken = () => 'stub-token'
  })
})
