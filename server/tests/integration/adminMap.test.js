'use strict'

/**
 * 管理端地图接口（地理编码 / 逆地理编码 / 静态地图）。
 *
 * 外部地图服务全部 mock：测试只验证鉴权、参数校验、响应形状与降级，
 * 不依赖真实 AMap Key，也不会消耗第三方配额。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const mapService = require('../../src/services/map.service')
const mapAdminService = require('../../src/services/mapAdmin.service')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
const auth = require('./helpers/auth')
const fixtures = require('./helpers/fixtures')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])

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
  mapAdminService._clearCaches()
  vi.restoreAllMocks()
})

async function tenantOwner() {
  return auth.createAndLogin({ username: 'map-owner', role: 'owner' })
}

describe('地图接口鉴权', () => {
  it('未登录访问返回 401', async () => {
    const res = await request.get('/admin/maps/geocode?address=上海')
    expect(res.status).toBe(401)
  })

  it('平台账号不能使用租户地图接口', async () => {
    const { token } = await auth.createAndLogin({
      username: 'map-platform',
      role: 'platform',
      tenantId: null,
    })

    const res = await request.authed('get', '/admin/maps/geocode?address=上海', token)
    expect(res.status).toBe(403)
  })
})

describe('GET /admin/maps/geocode', () => {
  it('地址为空或过长时返回 400', async () => {
    const { token } = await tenantOwner()

    const empty = await request.authed('get', '/admin/maps/geocode', token)
    expect(empty.status).toBe(400)

    const tooLong = await request.authed(
      'get',
      `/admin/maps/geocode?address=${encodeURIComponent('上'.repeat(201))}`,
      token
    )
    expect(tooLong.status).toBe(400)
  })

  it('命中地址时返回 7 位小数字符串坐标，并缓存重复查询', async () => {
    const { token } = await tenantOwner()
    const spy = vi.spyOn(mapService, 'geocode').mockResolvedValue({
      longitude: '121.4737010',
      latitude: '31.2304160',
    })

    const first = await request.authed(
      'get',
      `/admin/maps/geocode?address=${encodeURIComponent('上海市黄浦区人民大道 200 号')}`,
      token
    )
    expect(first.status).toBe(200)
    expect(first.body.data).toMatchObject({
      found: true,
      longitude: '121.4737010',
      latitude: '31.2304160',
      cached: false,
    })

    const second = await request.authed(
      'get',
      `/admin/maps/geocode?address=${encodeURIComponent('上海市黄浦区人民大道 200 号')}`,
      token
    )
    expect(second.body.data.cached).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('地址未命中时返回 200 + found:false，不阻断建档', async () => {
    const { token } = await tenantOwner()
    vi.spyOn(mapService, 'geocode').mockResolvedValue(null)

    const res = await request.authed(
      'get',
      `/admin/maps/geocode?address=${encodeURIComponent('不存在的地址 XYZ')}`,
      token
    )
    expect(res.status).toBe(200)
    expect(res.body.data.found).toBe(false)
    expect(res.body.data.longitude).toBeNull()
    expect(res.body.data.latitude).toBeNull()
  })
})

describe('GET /admin/maps/reverse-geocode', () => {
  it('缺少或非法坐标返回 400', async () => {
    const { token } = await tenantOwner()

    const missing = await request.authed('get', '/admin/maps/reverse-geocode', token)
    expect(missing.status).toBe(400)

    const bad = await request.authed(
      'get',
      '/admin/maps/reverse-geocode?longitude=200&latitude=31',
      token
    )
    expect(bad.status).toBe(400)
  })

  it('返回可读地址', async () => {
    const { token } = await tenantOwner()
    vi.spyOn(mapService, 'reverseGeocode').mockResolvedValue('上海市黄浦区人民广场')

    const res = await request.authed(
      'get',
      '/admin/maps/reverse-geocode?longitude=121.4737010&latitude=31.2304160',
      token
    )
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      found: true,
      address: '上海市黄浦区人民广场',
      longitude: '121.4737010',
      latitude: '31.2304160',
    })
  })
})

describe('GET /admin/maps/static', () => {
  const STATIC_QUERY = 'longitude=121.4737010&latitude=31.2304160&zoom=16&width=640&height=360&scale=2'

  it('缺少坐标或参数越界返回 400', async () => {
    const { token } = await tenantOwner()

    const missing = await request.authed('get', '/admin/maps/static', token)
    expect(missing.status).toBe(400)

    const zoom = await request.authed(
      'get',
      '/admin/maps/static?longitude=121.4737&latitude=31.2304&zoom=18',
      token
    )
    expect(zoom.status).toBe(400)

    const scale = await request.authed(
      'get',
      '/admin/maps/static?longitude=121.4737&latitude=31.2304&scale=3',
      token
    )
    expect(scale.status).toBe(400)

    const tooLarge = await request.authed(
      'get',
      '/admin/maps/static?longitude=121.4737&latitude=31.2304&width=900&height=900',
      token
    )
    expect(tooLarge.status).toBe(400)
  })

  it('返回 data URL、中心点与可视范围，并缓存重复请求', async () => {
    const { token } = await tenantOwner()
    const spy = vi.spyOn(mapService, 'staticMap').mockResolvedValue({
      buffer: PNG,
      contentType: 'image/png',
      scale: 2,
    })

    const first = await request.authed('get', `/admin/maps/static?${STATIC_QUERY}`, token)
    expect(first.status).toBe(200)
    expect(first.headers['cache-control']).toBe('no-store')
    expect(first.body.data.available).toBe(true)
    expect(first.body.data.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(first.body.data.center).toEqual({
      longitude: '121.4737010',
      latitude: '31.2304160',
    })
    expect(first.body.data.bounds.west).toBeLessThan(121.473701)
    expect(first.body.data.bounds.east).toBeGreaterThan(121.473701)
    expect(first.body.data.bounds.south).toBeLessThan(31.230416)
    expect(first.body.data.bounds.north).toBeGreaterThan(31.230416)
    expect(first.body.data.cached).toBe(false)

    const second = await request.authed('get', `/admin/maps/static?${STATIC_QUERY}`, token)
    expect(second.body.data.cached).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('地图服务不可用时返回 200 + available:false，前端可降级手工坐标', async () => {
    const { token } = await tenantOwner()
    vi.spyOn(mapService, 'staticMap').mockRejectedValue(
      new mapService.MapUnavailableError('未配置高德 Web 服务 Key，无法生成地图预览')
    )

    const res = await request.authed('get', `/admin/maps/static?${STATIC_QUERY}`, token)
    expect(res.status).toBe(200)
    expect(res.body.data.available).toBe(false)
    expect(res.body.data.message).toContain('地图')
    expect(JSON.stringify(res.body)).not.toContain('AMAP_KEY')
    expect(JSON.stringify(res.body)).not.toContain('restapi.amap.com')
  })
})
