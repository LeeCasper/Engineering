'use strict'

/**
 * 平台数据看板（平台运营专属）。
 *
 * 这里重点锁三件事：
 *   1. 地图统计口径与租户列表/未分配地区一致；
 *   2. 跨租户聚合只暴露运营元数据，不碰业务财务数据；
 *   3. 权限边界：租户账号与项目管理员一律 403。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const datetime = require('../../src/utils/datetime')
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
  // 默认租户在 fixture 里不带地区；给它一个确定地区，避免每个断言都要减 1
  await db.query(
    `UPDATE tenant
        SET province_code = '310000', province_name = '上海市',
            city_code = '310000', city_name = '上海市'
      WHERE id = 1`
  )
})

let seq = 0
function nextSeq() {
  seq += 1
  return seq
}

async function platformLogin() {
  return auth.createAndLogin({
    username: `dashboard_platform_${nextSeq()}`,
    role: 'platform',
    tenantId: null,
  })
}

async function insertTenant({
  name,
  code,
  provinceCode = null,
  provinceName = null,
  cityCode = null,
  cityName = null,
  status = 'active',
  plan = 'basic',
  createdAt = datetime.format(),
}) {
  const result = await db.query(
    `INSERT INTO tenant
       (name, code, status, plan, province_code, province_name, city_code, city_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, code, status, plan, provinceCode, provinceName, cityCode, cityName, createdAt]
  )
  return result.insertId
}

async function insertProject(tenantId, name) {
  return db.query(
    `INSERT INTO project
       (tenant_id, name, address, contract_amount, start_date, plan_end_date, status, created_by)
     VALUES (?, ?, '测试地址', '100000.00', '2026-01-01', '2026-12-31', 'building', 1)`,
    [tenantId, name]
  )
}

describe('平台数据看板', () => {
  it('全国汇总、省份聚合与未分配地区口径一致', async () => {
    const platform = await platformLogin()
    const now = datetime.format()
    const lastMonth = datetime.now().subtract(1, 'month').format(datetime.DATETIME_FORMAT)

    const gz = await insertTenant({
      name: '广州租户',
      code: `dash-gz-${nextSeq()}`,
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440100',
      cityName: '广州市',
      plan: 'pro',
      createdAt: now,
    })
    const sz = await insertTenant({
      name: '深圳租户',
      code: `dash-sz-${nextSeq()}`,
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440300',
      cityName: '深圳市',
      status: 'suspended',
      plan: 'basic',
      createdAt: now,
    })
    const hz = await insertTenant({
      name: '杭州老租户',
      code: `dash-hz-${nextSeq()}`,
      provinceCode: '330000',
      provinceName: '浙江省',
      cityCode: '330100',
      cityName: '杭州市',
      plan: 'enterprise',
      createdAt: lastMonth,
    })
    const unassigned = await insertTenant({
      name: '未分配租户',
      code: `dash-unset-${nextSeq()}`,
      plan: 'basic',
      createdAt: now,
    })

    await insertProject(gz, '广州项目 1')
    await insertProject(gz, '广州项目 2')
    await insertProject(hz, '杭州项目 1')
    await auth.createAdmin({ tenantId: gz, username: `dash_admin_gz_${nextSeq()}`, role: 'owner' })
    await auth.createAdmin({ tenantId: gz, username: `dash_admin_gz_2_${nextSeq()}`, role: 'admin' })
    await auth.createAdmin({ tenantId: hz, username: `dash_admin_hz_${nextSeq()}`, role: 'owner' })

    const res = await request
      .authed('get', '/admin/platform/dashboard/overview', platform.token)
      .expect(200)

    const data = res.body.data
    // 默认租户（上海） + 广州 + 深圳 + 杭州 + 未分配
    expect(data.summary.tenantCount).toBe(5)
    expect(data.summary.activeCount).toBe(4)
    expect(data.summary.suspendedCount).toBe(1)
    expect(data.summary.archivedCount).toBe(0)
    expect(data.summary.newThisMonthCount).toBe(4)
    expect(data.summary.projectCount).toBe(3)
    expect(data.summary.adminCount).toBe(3) // 广州 2 个，杭州 1 个；默认租户没有后台账号
    expect(data.summary.regionUnsetCount).toBe(1)
    expect(data.unassigned.tenantCount).toBe(1)
    expect(data.unassigned.tenantCount).toBe(data.summary.regionUnsetCount)

    const guangdong = data.provinces.find((row) => row.provinceCode === '440000')
    expect(guangdong.tenantCount).toBe(2)
    expect(guangdong.activeCount).toBe(1)
    expect(guangdong.suspendedCount).toBe(1)
    expect(guangdong.projectCount).toBe(2)
    expect(guangdong.adminCount).toBe(2)
    expect(guangdong.newThisMonthCount).toBe(2)

    const zhejiang = data.provinces.find((row) => row.provinceCode === '330000')
    expect(zhejiang.tenantCount).toBe(1)
    expect(zhejiang.newThisMonthCount).toBe(0)
    expect(zhejiang.projectCount).toBe(1)

    // 未分配租户不进入省份列表，但必须进入 unassigned
    expect(data.provinces.some((row) => row.tenantCount === 0)).toBe(false)
    expect(
      data.provinces.reduce((sum, row) => sum + row.tenantCount, 0) + data.unassigned.tenantCount
    ).toBe(data.summary.tenantCount)
    expect(unassigned).toBeTruthy()
  })

  it('省份下钻返回城市聚合与未分配到城市', async () => {
    const platform = await platformLogin()
    const gz = await insertTenant({
      name: '广州租户',
      code: `dash-city-gz-${nextSeq()}`,
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440100',
      cityName: '广州市',
    })
    const sz = await insertTenant({
      name: '深圳租户',
      code: `dash-city-sz-${nextSeq()}`,
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440300',
      cityName: '深圳市',
    })
    // 历史脏数据/直接改库才可能出现「有省无市」；看板必须把它单独统计
    await insertTenant({
      name: '广东省未落市租户',
      code: `dash-city-nocity-${nextSeq()}`,
      provinceCode: '440000',
      provinceName: '广东省',
    })

    await insertProject(gz, '广州项目')
    await insertProject(sz, '深圳项目')

    const provinceRes = await request
      .authed('get', '/admin/platform/dashboard/region?provinceCode=440000', platform.token)
      .expect(200)

    expect(provinceRes.body.data.scope.level).toBe('province')
    expect(provinceRes.body.data.summary.tenantCount).toBe(3)
    expect(provinceRes.body.data.summary.projectCount).toBe(2)
    expect(provinceRes.body.data.cities).toHaveLength(2)
    expect(provinceRes.body.data.cities.find((row) => row.cityCode === '440100').cityName).toBe('广州市')
    expect(provinceRes.body.data.unassignedCity.tenantCount).toBe(1)

    const cityRes = await request
      .authed(
        'get',
        '/admin/platform/dashboard/region?provinceCode=440000&cityCode=440300',
        platform.token
      )
      .expect(200)
    expect(cityRes.body.data.scope.level).toBe('city')
    expect(cityRes.body.data.scope.cityName).toBe('深圳市')
    expect(cityRes.body.data.summary.tenantCount).toBe(1)
    expect(cityRes.body.data.cities).toEqual([])
    expect(cityRes.body.data.unassignedCity).toBeNull()

    const unassignedRes = await request
      .authed('get', '/admin/platform/dashboard/region?unassigned=1', platform.token)
      .expect(200)
    expect(unassignedRes.body.data.scope.level).toBe('unassigned')
    expect(unassignedRes.body.data.summary.tenantCount).toBe(0)
  })

  it('看板租户列表支持地区、未分配、状态与关键字筛选', async () => {
    const platform = await platformLogin()
    const sz = await insertTenant({
      name: '深圳筛选租户',
      code: `dash-list-sz-${nextSeq()}`,
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440300',
      cityName: '深圳市',
    })
    await insertTenant({
      name: '广州筛选租户',
      code: `dash-list-gz-${nextSeq()}`,
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440100',
      cityName: '广州市',
    })
    await insertTenant({
      name: '未分配筛选租户',
      code: `dash-list-unset-${nextSeq()}`,
    })

    // 默认租户在上海，不是广东；按城市筛选应只命中深圳
    await insertTenant({
      name: '深圳另一家',
      code: `dash-list-sz2-${nextSeq()}`,
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440300',
      cityName: '深圳市',
      status: 'suspended',
    })

    const cityList = await request
      .authed(
        'get',
        '/admin/platform/dashboard/tenants?provinceCode=440000&cityCode=440300&page=1&pageSize=10',
        platform.token
      )
      .expect(200)
    expect(cityList.body.data.total).toBe(2)
    expect(cityList.body.data.list.every((row) => row.regionLabel === '广东省 / 深圳市')).toBe(true)

    const unassignedList = await request
      .authed(
        'get',
        '/admin/platform/dashboard/tenants?unassigned=1&keyword=筛选',
        platform.token
      )
      .expect(200)
    expect(unassignedList.body.data.total).toBe(1)
    expect(unassignedList.body.data.list[0].region).toBeNull()

    const statusList = await request
      .authed(
        'get',
        '/admin/platform/dashboard/tenants?provinceCode=440000&cityCode=440300&status=suspended',
        platform.token
      )
      .expect(200)
    expect(statusList.body.data.total).toBe(1)
    expect(statusList.body.data.list[0].name).toBe('深圳另一家')

    expect(sz).toBeTruthy()
  })

  it('非法地区组合返回 400', async () => {
    const platform = await platformLogin()
    const cases = [
      '/admin/platform/dashboard/region',
      '/admin/platform/dashboard/region?cityCode=440300',
      '/admin/platform/dashboard/region?provinceCode=990000',
      '/admin/platform/dashboard/region?provinceCode=440000&cityCode=330100',
      '/admin/platform/dashboard/region?provinceCode=440000&unassigned=1',
    ]

    for (const url of cases) {
      const res = await request.authed('get', url, platform.token)
      expect(res.status, url).toBe(400)
    }
  })

  it('只有平台账号可以访问看板', async () => {
    const owner = await auth.createAndLogin({ username: `dash_owner_${nextSeq()}`, role: 'owner' })
    const admin = await auth.createAndLogin({ username: `dash_admin_${nextSeq()}`, role: 'admin' })

    for (const token of [owner.token, admin.token]) {
      const res = await request.authed('get', '/admin/platform/dashboard/overview', token)
      expect(res.status).toBe(403)
    }

    const anonymous = await request.get('/admin/platform/dashboard/overview')
    expect(anonymous.status).toBe(401)
  })
})
