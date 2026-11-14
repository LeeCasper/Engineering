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

const { createRateLimit, createMethodRateLimit } = require('../../src/middlewares/rateLimit')

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

  it('按请求方法选阈值：GET 走读档、POST 走写档', async () => {
    // 读档 180、写档 60 是默认配置；这里用小阈值把两档都打满，
    // 断言的是「用哪一档」而不是具体数字。
    const middleware = createMethodRateLimit({
      scope: `unit-${Date.now()}-method`,
      readMax: 2,
      writeMax: 1,
      identity: (req) => req.auth.id,
    })

    // 同一用户：2 次 GET 全部放行（读档 2）
    expect(await run(middleware, { ...makeReq('user-e'), method: 'GET' }, makeRes())).toBeNull()
    expect(await run(middleware, { ...makeReq('user-e'), method: 'GET' }, makeRes())).toBeNull()
    expect(await run(middleware, { ...makeReq('user-e'), method: 'GET' }, makeRes())).toBeTruthy()

    // 读档被打满不影响同一用户的写档 —— 写档 1，第一次放行、第二次拦下
    expect(await run(middleware, { ...makeReq('user-e'), method: 'POST' }, makeRes())).toBeNull()
    const writeErr = await run(middleware, { ...makeReq('user-e'), method: 'POST' }, makeRes())
    expect(writeErr).toBeTruthy()
    expect(writeErr.status).toBe(429)
  })

  it('HEAD / OPTIONS 也算读请求，DELETE / PATCH 算写请求', async () => {
    const middleware = createMethodRateLimit({
      scope: `unit-${Date.now()}-verbs`,
      readMax: 1,
      writeMax: 10,
      identity: (req) => req.auth.id,
    })

    expect(await run(middleware, { ...makeReq('u-head'), method: 'HEAD' }, makeRes())).toBeNull()
    expect(await run(middleware, { ...makeReq('u-head'), method: 'HEAD' }, makeRes())).toBeTruthy()

    expect(await run(middleware, { ...makeReq('u-opt'), method: 'OPTIONS' }, makeRes())).toBeNull()
    expect(await run(middleware, { ...makeReq('u-opt'), method: 'OPTIONS' }, makeRes())).toBeTruthy()

    // 写档 10：DELETE 不会因为读档为 1 就被拦
    expect(await run(middleware, { ...makeReq('u-del'), method: 'DELETE' }, makeRes())).toBeNull()
    expect(await run(middleware, { ...makeReq('u-del'), method: 'PATCH' }, makeRes())).toBeNull()
  })

  it('读阈值为 0 时读写两档同时关闭（集成测试只设置这一项）', async () => {
    const middleware = createMethodRateLimit({
      scope: `unit-${Date.now()}-read-off`,
      readMax: 0,
      writeMax: 1,
      identity: (req) => req.auth.id,
    })

    for (let i = 0; i < 100; i += 1) {
      expect(await run(middleware, { ...makeReq('user-f'), method: 'GET' }, makeRes())).toBeNull()
      expect(await run(middleware, { ...makeReq('user-f'), method: 'POST' }, makeRes())).toBeNull()
    }
  })

  it('只把写阈值设为 0 时仅关闭写档', async () => {
    const middleware = createMethodRateLimit({
      scope: `unit-${Date.now()}-write-off`,
      readMax: 1,
      writeMax: 0,
      identity: (req) => req.auth.id,
    })

    // 写档关闭：同一用户连打 50 次写请求全部放行
    for (let i = 0; i < 50; i += 1) {
      expect(await run(middleware, { ...makeReq('user-g'), method: 'POST' }, makeRes())).toBeNull()
    }
    // 读档仍然生效
    expect(await run(middleware, { ...makeReq('user-g'), method: 'GET' }, makeRes())).toBeNull()
    expect(await run(middleware, { ...makeReq('user-g'), method: 'GET' }, makeRes())).toBeTruthy()
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
