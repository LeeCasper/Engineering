'use strict'

/**
 * 后台登录日志（B-1.8 / AC-AD51）读取侧。
 *
 * 与操作日志不同，登录日志的可见范围是：
 *   - 租户管理员：本租户全部账号；
 *   - 项目管理员：仅自己的登录记录；
 *   - 平台账号：接口在 requireTenant 就被拒（平台看租户日志要走排障授权）。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
const auth = require('./helpers/auth')

beforeAll(() => {
  prepareDatabase()
})

afterAll(async () => {
  await db.close()
  await cache.close()
})

beforeEach(async () => {
  await cache.flush()
  await db.query('SET FOREIGN_KEY_CHECKS = 0')
  await db.query('TRUNCATE TABLE admin_user')
  await db.query('TRUNCATE TABLE admin_login_log')
  await db.query('SET FOREIGN_KEY_CHECKS = 1')
})

describe('登录日志', () => {
  it('租户管理员可以看到本租户全部登录记录，失败记录带原因', async () => {
    const owner = await auth.createAndLogin({ username: 'ownerlog', role: 'owner', tenantId: 1 })
    await auth.createAdmin({ username: 'stafflog', role: 'admin', tenantId: 1, createdBy: owner.admin.id })
    await auth.login('stafflog', 'Test123456')
    await auth.loginExpectFailure('stafflog', 'Wrong123')

    const res = await request.authed('get', '/admin/login-logs', owner.token)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBeGreaterThanOrEqual(3)
    expect(res.body.data.list.some((row) => row.username === 'stafflog')).toBe(true)

    const failed = res.body.data.list.find((row) => row.username === 'stafflog' && row.result === 'failed')
    expect(failed.fail_reason || failed.failReason).toContain('密码错误')
  })

  it('按用户名与结果筛选', async () => {
    const owner = await auth.createAndLogin({ username: 'ownerlog', role: 'owner', tenantId: 1 })
    await auth.createAdmin({ username: 'stafflog', role: 'admin', tenantId: 1, createdBy: owner.admin.id })
    await auth.login('stafflog', 'Test123456')
    await auth.loginExpectFailure('stafflog', 'Wrong123')

    const res = await request.authed(
      'get',
      '/admin/login-logs?username=stafflog&result=failed',
      owner.token
    )

    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThanOrEqual(1)
    expect(
      res.body.data.list.every((row) => row.username === 'stafflog' && row.result === 'failed')
    ).toBe(true)
  })

  it('项目管理员只能看到自己的登录记录，adminUserId 参数不能越权', async () => {
    const staffA = await auth.createAndLogin({ username: 'staffa', role: 'admin', tenantId: 1 })
    const staffB = await auth.createAndLogin({ username: 'staffb', role: 'admin', tenantId: 1 })

    // 试图用 adminUserId 指向同事：服务端必须忽略并把范围强制改成自己
    const res = await request.authed(
      'get',
      `/admin/login-logs?adminUserId=${staffB.admin.id}`,
      staffA.token
    )

    expect(res.status).toBe(200)
    expect(res.body.data.list.length).toBeGreaterThanOrEqual(1)
    expect(res.body.data.list.every((row) => row.username === 'staffa')).toBe(true)
  })

  it('平台账号不能直接读取租户登录日志', async () => {
    const platform = await auth.createAndLogin({
      username: 'platformlog',
      role: 'platform',
      tenantId: null
    })

    const res = await request.authed('get', '/admin/login-logs', platform.token)

    expect(res.status).toBe(403)
  })
})
