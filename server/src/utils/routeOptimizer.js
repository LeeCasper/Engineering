'use strict'

/**
 * 路线顺序优化（§4.6.2）。
 *
 * 腾讯 / 高德的「智能排序」可能属于商业授权能力，因此这里服务端自研：
 *   1. 最近邻（Nearest Neighbor）生成一个稳定、可解释的初始解；
 *   2. 2-opt 做局部优化，消除交叉边。
 *
 * ── 它只负责「建议顺序」 ──
 * 排序结果必须能被用户手动覆盖（C-6.7）。routePlan.service 在用户调整顺序后
 * 会以 `optimize:false` 重新请求，完全尊重传入顺序，不会再跑一次本算法。
 *
 * ── 这里算出的距离只用于排序 ──
 * 不写进响应、不落库。对外的总里程与分段耗时必须来自地图服务，
 * 否则「总里程 = 各段之和」会变成两个不同口径的数字（AC-N05）。
 */

const EARTH_RADIUS_M = 6_371_000

function toRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180
}

/** 球面距离（米）。只用于排序，精度足够 */
function haversineMeters(a, b) {
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)
  const dLat = lat2 - lat1
  const dLng = toRadians(Number(b.longitude) - Number(a.longitude))
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 从起点依次经过 stops 的总距离 */
function pathDistanceMeters(origin, stops) {
  let total = 0
  let previous = origin
  for (const stop of stops) {
    total += haversineMeters(previous, stop)
    previous = stop
  }
  return total
}

/** 最近邻初始解。距离相同时按 id 排序，保证同一输入得到同一顺序 */
function nearestNeighbor(origin, stops) {
  const remaining = stops.slice()
  const ordered = []
  let current = origin

  while (remaining.length > 0) {
    let bestIndex = 0
    let bestDistance = Infinity
    for (let i = 0; i < remaining.length; i += 1) {
      const distance = haversineMeters(current, remaining[i])
      if (distance < bestDistance - 1e-9) {
        bestDistance = distance
        bestIndex = i
      } else if (Math.abs(distance - bestDistance) <= 1e-9) {
        // 平局时取 id 小的，避免地图服务返回顺序不稳定导致缓存命中率下降
        if (Number(remaining[i].id) < Number(remaining[bestIndex].id)) bestIndex = i
      }
    }
    const next = remaining.splice(bestIndex, 1)[0]
    ordered.push(next)
    current = next
  }

  return ordered
}

/**
 * 2-opt。起点固定在数组外，只反转途经点区间。
 * n ≤ 10（§4.6.2），O(n²) 的反复扫描完全可以接受。
 */
function twoOpt(origin, stops) {
  if (stops.length < 3) return stops.slice()

  let best = stops.slice()
  let bestDistance = pathDistanceMeters(origin, best)
  let improved = true
  let guard = 0

  while (improved && guard < 20) {
    improved = false
    guard += 1
    for (let i = 0; i < best.length - 1; i += 1) {
      for (let k = i + 1; k < best.length; k += 1) {
        const candidate = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1))
        const distance = pathDistanceMeters(origin, candidate)
        if (distance < bestDistance - 1e-6) {
          best = candidate
          bestDistance = distance
          improved = true
        }
      }
    }
  }

  return best
}

/**
 * 生成推荐访问顺序。
 *
 * @param {{latitude: number|string, longitude: number|string}} origin
 * @param {Array<{id: number, latitude: number|string, longitude: number|string}>} stops
 * @returns {Array} 新的顺序数组（不修改入参）
 */
function optimizeOrder(origin, stops) {
  const list = Array.isArray(stops) ? stops : []
  if (list.length <= 1) return list.slice()
  return twoOpt(origin, nearestNeighbor(origin, list))
}

module.exports = {
  EARTH_RADIUS_M,
  haversineMeters,
  pathDistanceMeters,
  nearestNeighbor,
  twoOpt,
  optimizeOrder,
}
