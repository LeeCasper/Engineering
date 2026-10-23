'use strict'

/**
 * C 端考察计划集成测试（§4.6 / AC-N04、N05、N09、N10、N12、N14、N15、N16）。
 *
 * ── 地图服务在测试里被替换 ──
 * 真实高德接口会产生网络依赖与配额消耗，测试中统一 mock `mapService.drivingRoute`，
 * 但**不 mock 路线服务本身**：排序、缓存、降级、权限、落库都走真实代码。
 * 这样既稳定，又能覆盖「总里程 = 各段之和」与缓存不重复请求这两条关键口径。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
const mapService = require('../../src/services/map.service')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
const mini = require('./helpers/mini')
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
  vi.restoreAllMocks()
})

let seq = 0

async function createPlanner(role = 'foreman', { count = 3, withCoordinates = true } = {}) {
  const login = await mini.login(`route-planner-${(seq += 1)}`)
  const projectIds = []

  for (let index = 0; index < count; index += 1) {
    const projectId = await mini.createProject({
      name: `考察工地-${seq}-${index + 1}`,
      address: `上海市测试路 ${index + 1} 号`,
      longitude: withCoordinates ? (121.4737 + index * 0.01).toFixed(7) : null,
      latitude: withCoordinates ? (31.2304 + index * 0.01).toFixed(7) : null,
    })
    await mini.addMember({ projectId, userId: login.userId, role })
    projectIds.push(projectId)
  }

  return { ...login, projectIds }
}

function mockDrivingRoute() {
  return vi.spyOn(mapService, 'drivingRoute').mockImplementation(async (from, to) => ({
    distance: 1000,
    duration: 600,
    provider: 'amap',
    polyline: [
      { latitude: Number(from.latitude), longitude: Number(from.longitude) },
      { latitude: Number(to.latitude), longitude: Number(to.longitude) },
    ],
  }))
}

const ORIGIN = { latitude: 31.2304, longitude: 121.4737, name: '当前位置' }

describe('POST /route-plans/preview', () => {
  it('返回推荐顺序、总里程与分段耗时，总里程等于分段之和', async () => {
    const planner = await createPlanner('foreman')
    mockDrivingRoute()

    const res = await request
      .authed('post', '/route-plans/preview', planner.token)
      .send({ origin: ORIGIN, projectIds: planner.projectIds })

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.degraded).toBe(false)
    expect(data.cached).toBe(false)
    expect(data.points).toHaveLength(3)
    expect(data.totalDistance).toBe(3000)
    expect(data.totalDuration).toBe(1800)
    expect(data.points[0].legDistance).toBeNull()
    // 首站没有「上一站」，起点 → 第一站单独返回；这样所有分段（含首段）相加
    // 才等于总里程（AC-N05）
    expect(data.originLegDistance).toBe(1000)
    expect(data.originLegDuration).toBe(600)

    const legSum = data.points
      .slice(1)
      .reduce((sum, point) => sum + point.legDistance, 0)
    expect(data.totalDistance).toBe(legSum + data.originLegDistance)
    expect(data.polyline.length).toBeGreaterThan(0)
    expect(data.maxPoints).toBe(10)
  })

  it('optimize=false 时严格保留用户调整后的顺序（C-6.7）', async () => {
    const planner = await createPlanner('foreman')
    mockDrivingRoute()
    const reversed = [...planner.projectIds].reverse()

    const res = await request
      .authed('post', '/route-plans/preview', planner.token)
      .send({ origin: ORIGIN, projectIds: reversed, optimize: false })

    expect(res.status).toBe(200)
    expect(res.body.data.points.map((point) => point.projectId)).toEqual(reversed)
  })

  it('AC-N14 相同输入 5 分钟内命中缓存，不重复调用地图服务', async () => {
    const planner = await createPlanner('foreman')
    const spy = mockDrivingRoute()
    const body = { origin: ORIGIN, projectIds: planner.projectIds }

    const first = await request.authed('post', '/route-plans/preview', planner.token).send(body)
    const callsAfterFirst = spy.mock.calls.length
    const second = await request.authed('post', '/route-plans/preview', planner.token).send(body)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.data.cached).toBe(true)
    expect(spy.mock.calls.length).toBe(callsAfterFirst)
  })

  it('AC-N15 业主不能规划考察路线', async () => {
    const planner = await createPlanner('owner')

    const res = await request
      .authed('post', '/route-plans/preview', planner.token)
      .send({ origin: ORIGIN, projectIds: [planner.projectIds[0]] })

    expect(res.status).toBe(403)
    expect(res.body.message).toContain('工长与监理')

    // AC-N15 对没有 projectId 的列表入口同样成立：不能用一个空列表假装放行
    const list = await request.authed('get', '/route-plans', planner.token)
    expect(list.status).toBe(403)
    expect(list.body.message).toContain('工长与监理')
  })

  it('AC-N16 不能把不是自己参与的项目加入路线', async () => {
    const planner = await createPlanner('foreman', { count: 1 })
    const stranger = await createPlanner('foreman', { count: 1 })

    const res = await request
      .authed('post', '/route-plans/preview', planner.token)
      .send({ origin: ORIGIN, projectIds: [planner.projectIds[0], stranger.projectIds[0]] })

    expect(res.status).toBe(403)
  })

  it('AC-N11 无坐标项目不能加入路线，并提示补全地址', async () => {
    const planner = await createPlanner('foreman', { count: 1, withCoordinates: false })

    const res = await request
      .authed('post', '/route-plans/preview', planner.token)
      .send({ origin: ORIGIN, projectIds: planner.projectIds })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('尚未设置坐标')
  })

  it('AC-N04 超过配置上限时在提交阶段拒绝', async () => {
    await db.query(
      "INSERT INTO sys_config (tenant_id, config_key, config_value, scope) VALUES (1, 'route_max_points', '3', 'global')"
    )
    sysConfigService.invalidate()
    const planner = await createPlanner('foreman', { count: 4 })

    const res = await request
      .authed('post', '/route-plans/preview', planner.token)
      .send({ origin: ORIGIN, projectIds: planner.projectIds })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('最多规划 3 个')
  })

  it('AC-N12 地图服务不可用时降级，而不是整体失败', async () => {
    const planner = await createPlanner('foreman')
    vi.spyOn(mapService, 'drivingRoute').mockRejectedValue(
      new mapService.MapUnavailableError('模拟地图服务不可用')
    )

    const res = await request
      .authed('post', '/route-plans/preview', planner.token)
      .send({ origin: ORIGIN, projectIds: planner.projectIds })

    expect(res.status).toBe(200)
    expect(res.body.data.degraded).toBe(true)
    expect(res.body.data.totalDistance).toBeNull()
    expect(res.body.data.points).toHaveLength(3)
    expect(res.body.data.points.every((point) => point.legDistance === null)).toBe(true)
  })
})

describe('考察计划的保存、复用与失效', () => {
  it('保存后列表/详情可复现顺序与里程（AC-N09）', async () => {
    const planner = await createPlanner('foreman')
    mockDrivingRoute()

    const save = await request
      .authed('post', '/route-plans', planner.token)
      .send({
        name: '周二上午 · 三个工地',
        originType: 'current',
        origin: ORIGIN,
        projectIds: planner.projectIds,
      })

    expect(save.status).toBe(200)
    const plan = save.body.data
    expect(plan.name).toBe('周二上午 · 三个工地')
    expect(plan.totalDistance).toBe(3000)
    expect(plan.originLegDistance).toBe(1000)
    expect(plan.points.map((point) => point.projectId)).toEqual(planner.projectIds)
    expect(plan.path.length).toBeGreaterThan(0)

    const list = await request.authed('get', '/route-plans', planner.token)
    expect(list.status).toBe(200)
    expect(list.body.data.list).toHaveLength(1)
    expect(list.body.data.list[0].points).toHaveLength(3)
    expect(list.body.data.maxPoints).toBe(10)

    const detail = await request.authed('get', `/route-plans/${plan.id}`, planner.token)
    expect(detail.status).toBe(200)
    expect(detail.body.data.totalDuration).toBe(1800)
    expect(detail.body.data.originLegDuration).toBe(600)
  })

  it('AC-N10 项目坐标变更后标记需重新规划，且不再返回旧折线', async () => {
    const planner = await createPlanner('foreman')
    mockDrivingRoute()

    const save = await request
      .authed('post', '/route-plans', planner.token)
      .send({
        name: '坐标变更测试',
        originType: 'current',
        origin: ORIGIN,
        projectIds: planner.projectIds,
      })
    const planId = save.body.data.id

    await db.query('UPDATE project SET longitude = ?, latitude = ? WHERE id = ?', [
      '121.5000000',
      '31.2500000',
      planner.projectIds[0],
    ])

    const detail = await request.authed('get', `/route-plans/${planId}`, planner.token)
    expect(detail.status).toBe(200)
    expect(detail.body.data.stale).toBe(true)
    expect(detail.body.data.staleReason).toContain('坐标')
    expect(detail.body.data.path).toEqual([])
  })

  it('只能读取和删除自己的考察计划', async () => {
    const owner = await createPlanner('foreman')
    const other = await createPlanner('foreman')
    mockDrivingRoute()

    const save = await request
      .authed('post', '/route-plans', owner.token)
      .send({
        name: '个人路线',
        originType: 'current',
        origin: ORIGIN,
        projectIds: owner.projectIds,
      })
    const planId = save.body.data.id

    const read = await request.authed('get', `/route-plans/${planId}`, other.token)
    const remove = await request.authed('del', `/route-plans/${planId}`, other.token)
    expect(read.status).toBe(404)
    expect(remove.status).toBe(404)

    const deleted = await request.authed('del', `/route-plans/${planId}`, owner.token)
    expect(deleted.status).toBe(200)

    const after = await request.authed('get', `/route-plans/${planId}`, owner.token)
    expect(after.status).toBe(404)
  })
})

describe('GET /projects/:id/location', () => {
  it('返回项目坐标与地址，不含地图 Key', async () => {
    const planner = await createPlanner('foreman', { count: 1 })

    const res = await request.authed('get', `/projects/${planner.projectIds[0]}/location`, planner.token)

    expect(res.status).toBe(200)
    expect(res.body.data.hasCoordinates).toBe(true)
    expect(res.body.data.longitude).toBeTruthy()
    expect(JSON.stringify(res.body)).not.toContain('AMAP')
  })
})
