'use strict'

/**
 * 路线排序算法单测。
 *
 * 算法本身不碰数据库、不调地图服务，因此可以纯逻辑验证：
 *   1. 最近邻不会跳过更近的点；
 *   2. 2-opt 至少不会让顺序变差；
 *   3. 平局与重复输入结果稳定（同一输入必须得到同一顺序，缓存才有意义）。
 */

const {
  haversineMeters,
  pathDistanceMeters,
  optimizeOrder,
} = require('../../src/utils/routeOptimizer')

// 上海人民广场附近的一组点，约每 0.01 度 ≈ 1.1km
const ORIGIN = { latitude: 31.2304, longitude: 121.4737 }
const STOPS = [
  { id: 3, latitude: 31.2604, longitude: 121.5137 },
  { id: 1, latitude: 31.2314, longitude: 121.4747 },
  { id: 2, latitude: 31.2404, longitude: 121.4837 },
]

describe('haversineMeters', () => {
  it('同一坐标距离为 0', () => {
    expect(haversineMeters(ORIGIN, ORIGIN)).toBe(0)
  })

  it('纬度相差 1 度约 111km', () => {
    const distance = haversineMeters(
      { latitude: 31, longitude: 121 },
      { latitude: 32, longitude: 121 }
    )
    // 子午线 1 度约 111.2km，允许少量球面模型误差
    expect(distance).toBeGreaterThan(110_000)
    expect(distance).toBeLessThan(112_000)
  })
})

describe('optimizeOrder', () => {
  it('从起点出发优先选择更近的点', () => {
    const ordered = optimizeOrder(ORIGIN, STOPS)
    // id=1 离起点最近，必须排第一
    expect(ordered[0].id).toBe(1)
    expect(ordered).toHaveLength(3)
  })

  it('排序后的总距离不劣于原始顺序', () => {
    const before = pathDistanceMeters(ORIGIN, STOPS)
    const after = pathDistanceMeters(ORIGIN, optimizeOrder(ORIGIN, STOPS))
    expect(after).toBeLessThanOrEqual(before + 1e-6)
  })

  it('同样的输入两次得到同样的顺序', () => {
    const first = optimizeOrder(ORIGIN, STOPS).map((point) => point.id)
    const second = optimizeOrder(ORIGIN, STOPS).map((point) => point.id)
    expect(first).toEqual(second)
  })

  it('只有一个点时原样返回，不修改入参', () => {
    const input = [STOPS[0]]
    const ordered = optimizeOrder(ORIGIN, input)
    expect(ordered).toEqual(input)
    expect(ordered).not.toBe(input)
  })

  it('空数组返回空数组', () => {
    expect(optimizeOrder(ORIGIN, [])).toEqual([])
  })
})
