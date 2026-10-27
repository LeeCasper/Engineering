'use strict'

/**
 * 地图响应的纯解析逻辑单测。
 *
 * 不触碰网络：只验证高德返回的 `lng,lat` 与折线字符串能否被收敛成
 * 系统内部的 GCJ-02 坐标。Key 是否配置、接口是否可达属于集成环境问题，
 * 不应混进这里。
 */

const {
  decodeAmapPolyline,
  parseAmapLocation,
  parseAmapRegeo,
  parseTencentRegeo,
  staticMapBounds,
  moveCenterByPixels,
  parseAmapStaticError,
} = require('../../src/services/map.service')

describe('parseAmapLocation', () => {
  it('把 "lng,lat" 解析成 GCJ-02 字符串坐标，保留 7 位小数', () => {
    expect(parseAmapLocation('121.473701,31.230416')).toEqual({
      longitude: '121.4737010',
      latitude: '31.2304160',
    })
  })

  it('非法或越界的坐标返回 null，避免 NaN 落库', () => {
    expect(parseAmapLocation('')).toBeNull()
    expect(parseAmapLocation('abc,def')).toBeNull()
    expect(parseAmapLocation('181,31')).toBeNull()
    expect(parseAmapLocation('121,91')).toBeNull()
  })
})

describe('parseAmapRegeo / parseTencentRegeo', () => {
  it('从高德逆地理编码响应提取文字地址', () => {
    expect(
      parseAmapRegeo({
        status: '1',
        regeocode: { formatted_address: '上海市浦东新区世纪大道 100 号' },
      })
    ).toBe('上海市浦东新区世纪大道 100 号')
  })

  it('高德没有 formatted_address 时用行政区字段拼接', () => {
    expect(
      parseAmapRegeo({
        status: '1',
        regeocode: {
          addressComponent: {
            province: '上海市',
            city: [],
            district: '浦东新区',
            township: '陆家嘴街道',
            streetNumber: { street: '世纪大道', number: '100号' },
          },
        },
      })
    ).toBe('上海市浦东新区陆家嘴街道世纪大道100号')
  })

  it('高德失败返回 null，不伪造地址', () => {
    expect(parseAmapRegeo({ status: '0' })).toBeNull()
    expect(parseAmapRegeo(null)).toBeNull()
  })

  it('从腾讯逆地理编码响应提取文字地址', () => {
    expect(
      parseTencentRegeo({
        status: 0,
        result: { address: '上海市浦东新区世纪大道 100 号' },
      })
    ).toBe('上海市浦东新区世纪大道 100 号')
    expect(parseTencentRegeo({ status: 1 })).toBeNull()
  })
})

describe('staticMapBounds / moveCenterByPixels', () => {
  const center = { longitude: 121.473701, latitude: 31.230416 }

  it('中心落在可视范围内，东西南北方向正确', () => {
    const bounds = staticMapBounds(center, 16, 640, 360)

    expect(bounds.west).toBeLessThan(center.longitude)
    expect(bounds.east).toBeGreaterThan(center.longitude)
    expect(bounds.south).toBeLessThan(center.latitude)
    expect(bounds.north).toBeGreaterThan(center.latitude)
    expect((bounds.east + bounds.west) / 2).toBeCloseTo(center.longitude, 9)
  })

  it('经度跨度符合高德静态图的 zoom / 像素关系（AMap zoom 比标准 Mercator 大 1）', () => {
    const bounds = staticMapBounds(center, 16, 640, 360)
    const expected = (640 / (256 * 2 ** 17)) * 360

    expect(bounds.east - bounds.west).toBeCloseTo(expected, 9)
  })

  it('拖动方向与中心变化方向一致：右拖往西、下拖往北', () => {
    const right = moveCenterByPixels(center, 100, 0, 16)
    const down = moveCenterByPixels(center, 0, 100, 16)
    const left = moveCenterByPixels(center, -100, 0, 16)
    const up = moveCenterByPixels(center, 0, -100, 16)

    expect(right.longitude).toBeLessThan(center.longitude)
    expect(left.longitude).toBeGreaterThan(center.longitude)
    expect(down.latitude).toBeGreaterThan(center.latitude)
    expect(up.latitude).toBeLessThan(center.latitude)
  })

  it('零位移是恒等变换，往返位移可回到原点附近', () => {
    const same = moveCenterByPixels(center, 0, 0, 16)
    expect(same.longitude).toBeCloseTo(center.longitude, 9)
    expect(same.latitude).toBeCloseTo(center.latitude, 9)

    const moved = moveCenterByPixels(center, 120, -80, 16)
    const back = moveCenterByPixels(moved, -120, 80, 16)
    expect(back.longitude).toBeCloseTo(center.longitude, 9)
    expect(back.latitude).toBeCloseTo(center.latitude, 9)
  })

  it('极区边界被限制在 Web Mercator 可用纬度内', () => {
    const bounds = staticMapBounds({ longitude: 0, latitude: 85.05 }, 3, 640, 360)

    expect(bounds.north).toBeLessThanOrEqual(85.0511287798066 + 1e-9)
    expect(bounds.south).toBeGreaterThanOrEqual(-85.0511287798066 - 1e-9)
  })
})

describe('parseAmapStaticError', () => {
  it('提取高德 JSON 错误中的可读原因', () => {
    expect(
      parseAmapStaticError(Buffer.from(JSON.stringify({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' })))
    ).toBe('INVALID_USER_KEY')
  })

  it('非 JSON 响应给出通用原因，不回显原始内容', () => {
    const message = parseAmapStaticError(Buffer.from('<html>gateway error</html>'))
    expect(message).toBe('返回了非图片内容')
    expect(message).not.toContain('key')
  })
})

describe('decodeAmapPolyline', () => {
  it('解析多段折线并去掉相邻重复点', () => {
    const points = decodeAmapPolyline([
      { polyline: '121.1,31.1;121.2,31.2' },
      { polyline: '121.2,31.2;121.3,31.3' },
    ])

    expect(points).toEqual([
      { longitude: 121.1, latitude: 31.1 },
      { longitude: 121.2, latitude: 31.2 },
      { longitude: 121.3, latitude: 31.3 },
    ])
  })

  it('跳过缺失或非法的折线段', () => {
    const points = decodeAmapPolyline([
      {},
      { polyline: 'bad;121.4,31.4' },
      { polyline: '121.5,31.5' },
    ])

    expect(points).toEqual([
      { longitude: 121.4, latitude: 31.4 },
      { longitude: 121.5, latitude: 31.5 },
    ])
  })
})
