'use strict'

/**
 * 接口限流单测（§8.2：「接口限流：单用户 60 次/分钟」）。
 *
 * 这条能力曾经只定义了中间件、从未挂载 —— 单测锁住的是中间件本身的行为，
 * 挂载点由集成测试间接覆盖（鉴权后的请求都会经过它）。
 *
 * 测试环境把 RATE_LIMIT_PER_MINUTE 置 0 关闭限流，因此这里显式传 max，
 * 不依赖配置文件。
 */

const { createRateLimit } = require('../../src/middlewares/rateLimit')

function makeReq(id) {
  return { auth: { type: 'mini', id }, ip: '127.0.0.1' }
}

function makeRes() {
  const headers = {}
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value
    },
  }
}

/** 跑一次中间件，返回 next 收到的错误（没有就是 null） */
function run(middleware, req, res) {
  return new Promise((resolve) => {
    middleware(req, res, (err) => resolve(err || null))
  })
}

describe('接口限流（§8.2）', () => {
  it('超过阈值返回 429，并在响应头暴露配额', async () => {
    const middleware = createRateLimit({
      scope: `unit-${Date.now()}-429`,
      max: 2,
      identity: (req) => req.auth.id,
      message: '请求过于频繁',
    })

    const req = makeReq('user-a')
    const errors = []
    const responses = []
    for (let i = 0; i < 3; i += 1) {
      const res = makeRes()
      responses.push(res)
      errors.push(await run(middleware, req, res))
    }

    expect(errors[0]).toBeNull()
    expect(errors[1]).toBeNull()
    expect(errors[2]).toBeTruthy()
    expect(errors[2].status).toBe(429)

    // 前两次先报 2、1，第三次触顶后剩余为 0
    expect(responses[0].headers['X-RateLimit-Limit']).toBe('2')
    expect(responses[0].headers['X-RateLimit-Remaining']).toBe('1')
    expect(responses[1].headers['X-RateLimit-Remaining']).toBe('0')
    // Retry-After 只在拒绝时下发，供客户端退避
    expect(Number(responses[2].headers['Retry-After'])).toBeGreaterThan(0)
  })

  it('不同身份各自计数，互不消耗配额', async () => {
    const middleware = createRateLimit({
      scope: `unit-${Date.now()}-identity`,
      max: 1,
      identity: (req) => req.auth.id,
    })

    expect(await run(middleware, makeReq('user-b'), makeRes())).toBeNull()
    expect(await run(middleware, makeReq('user-c'), makeRes())).toBeNull()
    // 同一个 user-b 第二次才被拦
    expect(await run(middleware, makeReq('user-b'), makeRes())).toBeTruthy()
  })

  it('未登录请求（identity 返回 null）不参与限流', async () => {
    let called = 0
    const middleware = createRateLimit({
      scope: `unit-${Date.now()}-anon`,
      max: 1,
      identity: () => null,
    })

    for (let i = 0; i < 5; i += 1) {
      const err = await run(middleware, { ip: '1.2.3.4' }, makeRes())
      expect(err).toBeNull()
      called += 1
    }
    expect(called).toBe(5)
  })

  it('max <= 0 时关闭限流（集成测试据此避免随机 429）', async () => {
    const middleware = createRateLimit({
      scope: `unit-${Date.now()}-off`,
      max: 0,
      identity: (req) => req.auth.id,
    })

    // 即使同一身份连打 100 次也全部放行
    for (let i = 0; i < 100; i += 1) {
      expect(await run(middleware, makeReq('user-d'), makeRes())).toBeNull()
    }
  })
})
