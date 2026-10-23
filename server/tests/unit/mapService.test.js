'use strict'

/**
 * 地图响应的纯解析逻辑单测。
 *
 * 不触碰网络：只验证高德返回的 `lng,lat` 与折线字符串能否被收敛成
 * 系统内部的 GCJ-02 坐标。Key 是否配置、接口是否可达属于集成环境问题，
 * 不应混进这里。
 */

const { decodeAmapPolyline, parseAmapLocation } = require('../../src/services/map.service')

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
