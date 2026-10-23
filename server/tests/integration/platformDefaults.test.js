'use strict'

/**
 * 平台基础配置 / 基础内容页 / 平台日志中心（迁移 022）。
 *
 * 这三块解决的是同一个问题：小程序是共享入口，但租户各自经营。
 *   - 平台配置是「租户未覆盖时继承的基线」，不是替租户改配置；
 *   - 平台内容页是登录前（没有租户上下文）唯一能读到的协议版本；
 *   - 平台日志只包含 tenant_id IS NULL 的平台级事件，租户业务日志不横向开放。
 *
 * 重点断言的也是边界：租户不能改平台基线，平台不能借基础接口改租户数据。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
const operationLog = require('../../src/services/operationLog.service')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
const auth = require('./helpers/auth')
const fixtures = require('./helpers/fixtures')

beforeAll(() => {
  prepareDatabase()
})

afterAll(async () => {
  await db.close()
  await cache.close()
})

beforeEach(async () => {
  await cache.flush()
  await fixtures.resetBusinessTables()
  sysConfigService.invalidate()
})

let seq = 0
function nextSeq() {
  seq += 1
  return seq
}

async function platformLogin() {
  return auth.createAndLogin({
    username: `platform_defaults_${nextSeq()}`,
    role: 'platform',
    tenantId: null,
  })
}

async function tenantOwner() {
  return auth.createAndLogin({
    username: `defaults_owner_${nextSeq()}`,
    role: 'owner',
    tenantId: 1,
  })
}

describe('平台基础配置：租户继承与覆盖', () => {
  it('租户未配置时继承平台基础值，且缓存按租户隔离', async () => {
    const platform = await platformLogin()

    // 先把「出厂值」读进租户缓存。平台改完若不清理这个条目，
    // 租户最长 60 秒内仍会读到旧值 —— 管理员会以为保存没生效。
    expect(await sysConfigService.getInt(1, 'report_max_images')).toBe(9)

    const save = await request
      .authed('put', '/admin/platform/sys-configs/report_max_images', platform.token)
      .send({ value: '7' })

    expect(save.status).toBe(200)
    expect(save.body.data.source).toBe('platform')

    const owner = await tenantOwner()
    const list = await request.authed('get', '/admin/sys-configs', owner.token)
    const item = list.body.data.list.find((i) => i.key === 'report_max_images')

    expect(item.value).toBe('7')
    expect(item.source).toBe('platform')
    expect(item.inherited).toBe(true)
    expect(item.platformValue).toBe('7')

    // 真正的业务读取也必须走平台兜底，而不只是配置页显示对了
    expect(await sysConfigService.getInt(1, 'report_max_images')).toBe(7)
  })

  it('租户覆盖优先于平台；平台再改不会覆盖租户已设置的值', async () => {
    const platform = await platformLogin()
    const owner = await tenantOwner()

    await request
      .authed('put', '/admin/platform/sys-configs/report_max_images', platform.token)
      .send({ value: '7' })

    await request
      .authed('put', '/admin/sys-configs/report_max_images', owner.token)
      .send({ value: '5' })

    expect(await sysConfigService.getInt(1, 'report_max_images')).toBe(5)

    await request
      .authed('put', '/admin/platform/sys-configs/report_max_images', platform.token)
      .send({ value: '8' })

    // 租户显式覆盖必须保留；否则平台一次调参会把所有客户的制度改掉
    expect(await sysConfigService.getInt(1, 'report_max_images')).toBe(5)

    const list = await request.authed('get', '/admin/sys-configs', owner.token)
    const item = list.body.data.list.find((i) => i.key === 'report_max_images')
    expect(item.source).toBe('tenant')
    expect(item.platformValue).toBe('8')
  })

  it('恢复平台默认会删除租户覆盖，并立即回落到平台值', async () => {
    const platform = await platformLogin()
    const owner = await tenantOwner()

    await request
      .authed('put', '/admin/platform/sys-configs/report_max_images', platform.token)
      .send({ value: '7' })
    await request
      .authed('put', '/admin/sys-configs/report_max_images', owner.token)
      .send({ value: '4' })

    const reset = await request.authed(
      'delete',
      '/admin/sys-configs/report_max_images',
      owner.token
    )

    expect(reset.status).toBe(200)
    expect(reset.body.data.source).toBe('platform')
    expect(reset.body.data.value).toBe('7')
    expect(await sysConfigService.getInt(1, 'report_max_images')).toBe(7)

    // 覆盖行是软删除，审计与「当时配过什么」仍然可查
    const row = await db.queryOne(
      "SELECT deleted_at FROM sys_config WHERE tenant_id = 1 AND config_key = 'report_max_images'"
    )
    expect(row.deleted_at).toBeTruthy()

    const logs = await db.query('SELECT * FROM operation_log WHERE action = ?', [
      operationLog.ACTIONS.SYS_CONFIG_RESET,
    ])
    expect(logs).toHaveLength(1)
  })

  it('平台基础配置也走同一套区间校验', async () => {
    const platform = await platformLogin()

    const res = await request
      .authed('put', '/admin/platform/sys-configs/report_max_images', platform.token)
      .send({ value: '999' })

    expect(res.status).toBe(400)
    expect(await db.count('FROM sys_config WHERE deleted_at IS NULL')).toBe(0)
  })

  it('平台只能改平台基线，租户只能改自己的覆盖值', async () => {
    const platform = await platformLogin()
    const owner = await tenantOwner()

    // 租户账号拿不到平台基础配置入口
    const crossRead = await request.authed('get', '/admin/platform/sys-configs', owner.token)
    expect(crossRead.status).toBe(403)

    // 平台账号也不能通过租户接口改客户配置
    const crossWrite = await request
      .authed('put', '/admin/sys-configs/report_max_images', platform.token)
      .send({ value: '3' })
    expect(crossWrite.status).toBe(403)
  })
})

describe('平台基础内容页：登录前可读，租户可覆盖', () => {
  it('平台发布后，不带 tenantId 的 C 端请求也能读到', async () => {
    const platform = await platformLogin()

    const save = await request
      .authed('put', '/admin/platform/contents/privacy', platform.token)
      .send({
        title: '隐私政策（平台版）',
        content: '平台基础隐私政策正文',
        version: '2026-10-01',
        publish: true,
      })

    expect(save.status).toBe(200)

    const anonymous = await request.get('/contents/privacy')
    expect(anonymous.status).toBe(200)
    expect(anonymous.body.data.content).toBe('平台基础隐私政策正文')

    const platformList = await request.authed(
      'get',
      '/admin/platform/contents',
      platform.token
    )
    expect(
      platformList.body.data.list.find((i) => i.pageKey === 'privacy').effectiveSource
    ).toBe('platform')

    // 登录后进入某个租户的项目，该租户没发布时同样回落到平台版本
    const inTenant = await request.get('/contents/privacy?tenantId=1')
    expect(inTenant.status).toBe(200)
    expect(inTenant.body.data.content).toBe('平台基础隐私政策正文')
  })

  it('租户发布自己的版本后覆盖平台；只存草稿时仍继承平台', async () => {
    const platform = await platformLogin()
    const owner = await tenantOwner()

    await request
      .authed('put', '/admin/platform/contents/privacy', platform.token)
      .send({ title: '平台版', content: '平台正文', publish: true })

    await request
      .authed('put', '/admin/contents/privacy', owner.token)
      .send({ title: '租户草稿', content: '尚未发布的租户正文', publish: false })

    const draft = await request.get('/contents/privacy?tenantId=1')
    expect(draft.body.data.content).toBe('平台正文')

    await request
      .authed('put', '/admin/contents/privacy', owner.token)
      .send({ title: '租户版', content: '租户正文', publish: true })

    const published = await request.get('/contents/privacy?tenantId=1')
    expect(published.body.data.content).toBe('租户正文')

    // 平台版本仍然是登录前与无租户上下文的兜底，不能被租户覆盖影响
    const anonymous = await request.get('/contents/privacy')
    expect(anonymous.body.data.content).toBe('平台正文')

    const list = await request.authed('get', '/admin/contents', owner.token)
    const row = list.body.data.list.find((i) => i.pageKey === 'privacy')
    expect(row.effectiveSource).toBe('tenant')
  })

  it('平台基础内容页的修改写入操作日志，且 tenant_id 为 NULL', async () => {
    const platform = await platformLogin()

    await request
      .authed('put', '/admin/platform/contents/agreement', platform.token)
      .send({ title: '用户协议', content: '平台协议正文', publish: true })

    const rows = await db.query('SELECT * FROM operation_log WHERE action = ?', [
      operationLog.ACTIONS.CONTENT_UPDATE,
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].tenant_id).toBeNull()
    const detail = typeof rows[0].detail === 'string' ? JSON.parse(rows[0].detail) : rows[0].detail
    expect(detail.scope).toBe('platform')
  })

  it('租户账号不能访问平台基础内容页接口', async () => {
    const owner = await tenantOwner()

    const res = await request.authed('get', '/admin/platform/contents', owner.token)
    expect(res.status).toBe(403)
  })
})

describe('平台日志中心：只看平台级事件', () => {
  it('平台操作日志不混入租户业务日志', async () => {
    const platform = await platformLogin()
    const owner = await tenantOwner()

    await request
      .authed('put', '/admin/platform/sys-configs/stale_report_days', platform.token)
      .send({ value: '9' })
    await request
      .authed('put', '/admin/sys-configs/stale_report_days', owner.token)
      .send({ value: '5' })

    const platformLogs = await request.authed(
      'get',
      '/admin/platform/logs/operation',
      platform.token
    )

    expect(platformLogs.status).toBe(200)
    expect(platformLogs.body.data.total).toBe(1)
    expect(platformLogs.body.data.list[0].action).toBe(operationLog.ACTIONS.SYS_CONFIG_UPDATE)

    const tenantLogs = await request.authed('get', '/admin/operation-logs', owner.token)
    expect(tenantLogs.body.data.total).toBe(1)
  })

  it('平台登录日志包含平台账号，不混入租户账号登录', async () => {
    const platform = await platformLogin()
    await tenantOwner()

    const res = await request.authed('get', '/admin/platform/logs/login', platform.token)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(1)
    expect(res.body.data.list[0].username).toBe(platform.admin.username)
  })

  it('租户账号不能访问平台日志中心', async () => {
    const owner = await tenantOwner()

    const operation = await request.authed('get', '/admin/platform/logs/operation', owner.token)
    const login = await request.authed('get', '/admin/platform/logs/login', owner.token)

    expect(operation.status).toBe(403)
    expect(login.status).toBe(403)
  })
})
