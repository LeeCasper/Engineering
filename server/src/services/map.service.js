'use strict'

/**
 * 地图服务（高德 / 腾讯位置服务）。
 *
 * 本模块只做「与第三方地图服务通信并把响应收敛成系统内部的形状」，
 * 不做权限、项目成员、路线排序等业务判断 —— 那些在 routePlan.service.js。
 *
 * ── 能力与降级 ──
 *   geocode      地址 → GCJ-02 坐标。高德优先，腾讯兜底；两者都没配时返回 null，
 *                建档照常保存，由管理员手工拾取坐标（AC-AD54）。
 *   drivingRoute 两点驾车路线。只走高德；未配置 Key 时抛 MapUnavailableError，
 *                由路线服务降级为「按顺序列表 + 单点导航」（AC-N12）。
 *
 * ── 安全 ──
 * AC-N13：地图服务 Key 仅存服务端环境变量，**不下发小程序、不写入日志**。
 * 本模块所有日志都不得包含完整请求 URL（URL 里带 Key）。
 */

const config = require('../../config')
const logger = require('../utils/logger')

const AMAP_GEOCODE_URL = 'https://restapi.amap.com/v3/geocode/geo'
const AMAP_DRIVING_URL = 'https://restapi.amap.com/v3/direction/driving'
const TENCENT_GEOCODE_URL = 'https://apis.map.qq.com/ws/geocoder/v1/'
const REQUEST_TIMEOUT_MS = 7000

/** 地图服务不可用。路线服务据此降级，而不是把整个请求打成 500 */
class MapUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'MapUnavailableError'
    this.expected = true
    this.cause = options.cause
  }
}

/**
 * 带超时的 JSON 请求。
 *
 * 只接受 URL 与查询参数，Key 在调用方拼进参数里；本函数不会把 URL 打日志。
 */
async function fetchJson(url, params) {
  const query = new URLSearchParams(params)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(`${url}?${query.toString()}`, { signal: controller.signal })
    if (!res.ok) throw new MapUnavailableError(`地图服务返回 HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    if (err instanceof MapUnavailableError) throw err
    throw new MapUnavailableError('地图服务请求失败', { cause: err })
  } finally {
    clearTimeout(timer)
  }
}

/** 解析高德返回的 "lng,lat"。非法值返回 null，避免把 NaN 落库 */
function parseAmapLocation(location) {
  if (!location || typeof location !== 'string') return null
  const [lngRaw, latRaw] = location.split(',')
  const lng = Number(lngRaw)
  const lat = Number(latRaw)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null
  return { longitude: lng.toFixed(7), latitude: lat.toFixed(7) }
}

/** 高德地理编码。成功返回 GCJ-02 坐标，失败返回 null（由调用方决定是否兜底） */
async function geocodeWithAmap(address) {
  const data = await fetchJson(AMAP_GEOCODE_URL, {
    address,
    key: config.map.amapKey,
    output: 'JSON',
  })

  if (String(data.status) !== '1') {
    logger.warn('高德地理编码失败', { status: data.status, info: data.info, infocode: data.infocode })
    return null
  }

  const first = Array.isArray(data.geocodes) ? data.geocodes[0] : null
  return first ? parseAmapLocation(first.location) : null
}

/** 腾讯地理编码。保留 V1.0 的兜底能力 */
async function geocodeWithTencent(address) {
  const data = await fetchJson(TENCENT_GEOCODE_URL, {
    address,
    key: config.map.tencentKey,
  })

  if (data.status !== 0) {
    logger.warn('腾讯地理编码失败，等待管理员手工拾取坐标', { status: data.status, message: data.message })
    return null
  }

  const location = data.result && data.result.location
  if (!location) return null

  return {
    longitude: Number(location.lng).toFixed(7),
    latitude: Number(location.lat).toFixed(7),
  }
}

/**
 * 地址 → GCJ-02 坐标。
 *
 * 全系统坐标统一 GCJ-02（§6.2）。高德与腾讯返回的都是 GCJ-02，因此这里
 * 不需要转换；若将来换用返回 WGS-84 的服务，**必须在此处转换后再落库**，
 * 否则导航会偏移数百米（AC-N03）。
 *
 * @param {string} address
 * @returns {Promise<{longitude: string, latitude: string}|null>}
 */
async function geocode(address) {
  if (!address) return null

  const provider = config.map.provider
  const candidates = []
  if (config.map.amapKey && provider !== 'tencent') candidates.push(geocodeWithAmap)
  if (config.map.tencentKey && provider !== 'amap') candidates.push(geocodeWithTencent)

  if (candidates.length === 0) {
    logger.debug('地图服务未配置，跳过地理编码（AC-AD54 的手工拾取路径）')
    return null
  }

  for (const attempt of candidates) {
    try {
      const result = await attempt(address)
      if (result) return result
    } catch (err) {
      logger.warn('地理编码请求异常，尝试下一个服务商', { message: err.message })
    }
  }

  return null
}

/**
 * 解析高德路径中的折线。
 *
 * 高德驾车接口把每一步的折线放在 `step.polyline`，格式是
 * `lng,lat;lng,lat;...`。相邻步骤的首尾点通常重复，这里按坐标去重，
 * 避免小程序画线时出现重叠段。
 *
 * @param {Array<{polyline?: string}>} steps
 * @returns {Array<{latitude: number, longitude: number}>}
 */
function decodeAmapPolyline(steps = []) {
  const points = []
  let last = null

  for (const step of steps) {
    if (!step || typeof step.polyline !== 'string') continue
    for (const token of step.polyline.split(';')) {
      const [lngRaw, latRaw] = token.split(',')
      const lng = Number(lngRaw)
      const lat = Number(latRaw)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue
      if (last && last.longitude === lng && last.latitude === lat) continue
      last = { latitude: lat, longitude: lng }
      points.push(last)
    }
  }

  return points
}

/**
 * 两点驾车路线。
 *
 * @param {{latitude: number|string, longitude: number|string}} from
 * @param {{latitude: number|string, longitude: number|string}} to
 * @returns {Promise<{distance: number, duration: number, polyline: Array<{latitude:number,longitude:number}>, provider: string}>}
 * @throws {MapUnavailableError}
 */
async function drivingRoute(from, to) {
  if (!config.map.routingEnabled) {
    throw new MapUnavailableError('未启用高德驾车路线服务')
  }

  const origin = `${Number(from.longitude)},${Number(from.latitude)}`
  const destination = `${Number(to.longitude)},${Number(to.latitude)}`
  if (origin.includes('NaN') || destination.includes('NaN')) {
    throw new MapUnavailableError('路线起点或终点坐标不合法')
  }

  const data = await fetchJson(AMAP_DRIVING_URL, {
    origin,
    destination,
    extensions: 'base',
    strategy: '0',
    output: 'JSON',
    key: config.map.amapKey,
  })

  if (String(data.status) !== '1') {
    // 只记服务商返回的 codepoint，不记 URL（URL 带 Key）
    throw new MapUnavailableError(`高德路线规划失败：${data.info || data.infocode || '未知错误'}`)
  }

  const path = data.route && Array.isArray(data.route.paths) ? data.route.paths[0] : null
  if (!path) throw new MapUnavailableError('高德未返回可用路线')

  const distance = Number(path.distance)
  const duration = Number(path.duration)
  if (!Number.isFinite(distance) || !Number.isFinite(duration)) {
    throw new MapUnavailableError('高德返回的里程或耗时不是有效数字')
  }

  return {
    distance,
    duration,
    polyline: decodeAmapPolyline(path.steps),
    provider: 'amap',
  }
}

module.exports = {
  MapUnavailableError,
  geocode,
  drivingRoute,
  decodeAmapPolyline,
  parseAmapLocation,
}
