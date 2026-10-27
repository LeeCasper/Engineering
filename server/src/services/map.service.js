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
 *   reverseGeocode 坐标 → 文字地址，用于签到水印的「签到位置」。两者都没配时返回
 *                null，由调用方保留坐标并显示「实时地址未解析」。
 *   drivingRoute 两点驾车路线。只走高德；未配置 Key 时抛 MapUnavailableError，
 *                由路线服务降级为「按顺序列表 + 单点导航」（AC-N12）。
 *
 * ── 安全 ──
 * AC-N13：地图服务 Key 仅存服务端环境变量，**不下发小程序、不写入日志**。
 * 本模块所有日志都不得包含完整请求 URL（URL 里带 Key）。
 */

const https = require('node:https')
const config = require('../../config')
const logger = require('../utils/logger')

const AMAP_GEOCODE_URL = 'https://restapi.amap.com/v3/geocode/geo'
const AMAP_REGEO_URL = 'https://restapi.amap.com/v3/geocode/regeo'
const AMAP_DRIVING_URL = 'https://restapi.amap.com/v3/direction/driving'
const AMAP_STATICMAP_URL = 'https://restapi.amap.com/v3/staticmap'
const TENCENT_GEOCODE_URL = 'https://apis.map.qq.com/ws/geocoder/v1/'
const REQUEST_TIMEOUT_MS = 7000
// 签到提交要等逆地理编码，不能像建档那样等 7 秒；超时就退回坐标水印
const REVERSE_GEO_TIMEOUT_MS = 4000
// 静态地图会返回几百 KB 的图片，超时比普通 JSON 稍宽松
const STATIC_MAP_TIMEOUT_MS = 6000
const STATIC_MAP_MAX_BYTES = 512 * 1024
// 高德静态地图的 zoom 比标准 Web Mercator 大 1：
// 实测 zoom=16 的覆盖范围等同于 256*2^17 世界像素。
// bounds 与拖拽换算必须使用同一个偏移，否则拖动会偏一倍。
const STATIC_MAP_ZOOM_OFFSET = 1
// Web Mercator 在南北极附近发散；项目坐标实际都在中国，这里只是防呆
const MERCATOR_MAX_LAT = 85.0511287798066

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
 * 地图服务的底层 HTTPS 请求。
 *
 * 刻意不用全局 fetch：高德域名同时解析出 IPv4 / IPv6，而部分部署网络没有
 * IPv6，Undici 的 Happy Eyeballs 会偶发先连 IPv6 并超时（实测同一进程里
 * 第一次失败、第二次成功）。这里显式 `family: 4`，结果稳定可复现。
 * https.request 也不会读取 HTTP_PROXY，本地代理未启动时不影响地图调用。
 *
 * 只接受 URL 与查询参数；**不记录完整 URL**，因为 URL 里带 Key（AC-N13）。
 */
function requestBuffer(url, params, timeoutMs) {
  const query = new URLSearchParams(params)
  const target = `${url}?${query.toString()}`

  return new Promise((resolve, reject) => {
    const req = https.get(target, { family: 4, timeout: timeoutMs }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          contentType: (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(),
          buffer: Buffer.concat(chunks),
        })
      })
      res.on('error', reject)
    })

    req.on('timeout', () => req.destroy(new Error('地图服务请求超时')))
    req.on('error', reject)
  })
}

/**
 * 带超时的 JSON 请求。
 *
 * 只接受 URL 与查询参数，Key 在调用方拼进参数里；本函数不会把 URL 打日志。
 */
async function fetchJson(url, params, timeoutMs = REQUEST_TIMEOUT_MS) {
  try {
    const { status, buffer } = await requestBuffer(url, params, timeoutMs)
    if (status < 200 || status >= 300) {
      throw new MapUnavailableError(`地图服务返回 HTTP ${status}`)
    }
    return JSON.parse(buffer.toString('utf8'))
  } catch (err) {
    if (err instanceof MapUnavailableError) throw err
    throw new MapUnavailableError('地图服务请求失败', { cause: err })
  }
}

/**
 * 带超时的二进制请求（静态地图）。
 *
 * 与 fetchJson 一样只接受 URL 与查询参数；**不记录完整 URL**，
 * 因为 URL 里带 Key（AC-N13）。
 */
async function fetchBinary(url, params, timeoutMs = REQUEST_TIMEOUT_MS) {
  try {
    const { status, contentType, buffer } = await requestBuffer(url, params, timeoutMs)
    if (status < 200 || status >= 300) {
      throw new MapUnavailableError(`地图服务返回 HTTP ${status}`)
    }
    return { buffer, contentType }
  } catch (err) {
    if (err instanceof MapUnavailableError) throw err
    throw new MapUnavailableError('地图服务请求失败', { cause: err })
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

/** 把服务商可能返回数组 / 空值的地址字段收敛成可读文本 */
function normalizeAddressText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('').trim()
  return String(value || '').trim()
}

/** 高德逆地理编码响应 → 文字地址；失败返回 null */
function parseAmapRegeo(data) {
  if (!data || String(data.status) !== '1') return null
  const regeo = data.regeocode || {}
  const formatted = normalizeAddressText(regeo.formatted_address)
  if (formatted) return formatted

  // 少数行政区没有 formatted_address，用结构化字段拼一个可读地址
  const component = regeo.addressComponent || {}
  const streetNumber = component.streetNumber || {}
  return normalizeAddressText(
    [
      component.province,
      component.city,
      component.district,
      component.township,
      streetNumber.street,
      streetNumber.number,
    ]
      .filter(Boolean)
      .join('')
  ) || null
}

/** 腾讯逆地理编码响应 → 文字地址；失败返回 null */
function parseTencentRegeo(data) {
  if (!data || Number(data.status) !== 0) return null
  const result = data.result || {}
  return (
    normalizeAddressText(result.address) ||
    normalizeAddressText(result.formatted_addresses && result.formatted_addresses.recommend) ||
    null
  )
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

async function reverseGeocodeWithAmap(latitude, longitude) {
  const data = await fetchJson(
    AMAP_REGEO_URL,
    {
      location: `${longitude},${latitude}`,
      key: config.map.amapKey,
      output: 'JSON',
      extensions: 'base',
    },
    REVERSE_GEO_TIMEOUT_MS
  )
  if (String(data.status) !== '1') {
    logger.warn('高德逆地理编码失败', { status: data.status, info: data.info, infocode: data.infocode })
    return null
  }
  return parseAmapRegeo(data)
}

async function reverseGeocodeWithTencent(latitude, longitude) {
  const data = await fetchJson(
    TENCENT_GEOCODE_URL,
    {
      location: `${latitude},${longitude}`,
      key: config.map.tencentKey,
      get_poi: 0,
    },
    REVERSE_GEO_TIMEOUT_MS
  )
  if (Number(data.status) !== 0) {
    logger.warn('腾讯逆地理编码失败', { status: data.status, message: data.message })
    return null
  }
  return parseTencentRegeo(data)
}

/**
 * 坐标 → 文字地址（GCJ-02）。
 *
 * 用于签到水印里的「签到位置」行。未配置地图 Key、服务商超时或配额耗尽时
 * 返回 null；调用方应保留坐标、给出「实时地址未解析」的明确兜底，不能编造地址。
 *
 * @param {{latitude: number|string, longitude: number|string}} coords
 * @returns {Promise<string|null>}
 */
async function reverseGeocode({ latitude, longitude }) {
  const lat = Number(latitude)
  const lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

  const provider = config.map.provider
  const candidates = []
  if (config.map.amapKey && provider !== 'tencent') candidates.push(reverseGeocodeWithAmap)
  if (config.map.tencentKey && provider !== 'amap') candidates.push(reverseGeocodeWithTencent)

  if (candidates.length === 0) {
    logger.debug('地图服务未配置，跳过逆地理编码（签到水印只保留坐标）')
    return null
  }

  for (const attempt of candidates) {
    try {
      const address = await attempt(lat, lng)
      if (address) return address
    } catch (err) {
      logger.warn('逆地理编码请求异常，尝试下一个服务商', { message: err.message })
    }
  }

  return null
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** GCJ-02 经纬度 → Web Mercator 世界像素坐标（zoom 对应的 256*2^z 世界） */
function lngLatToMercator(longitude, latitude, zoom) {
  const worldSize = 256 * 2 ** (zoom + STATIC_MAP_ZOOM_OFFSET)
  const lng = Number(longitude)
  const lat = clampNumber(Number(latitude), -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT)
  const x = ((lng + 180) / 360) * worldSize
  const rad = (lat * Math.PI) / 180
  const y =
    (0.5 - Math.log((1 + Math.sin(rad)) / (1 - Math.sin(rad))) / (4 * Math.PI)) * worldSize
  return { x, y, worldSize }
}

/** Web Mercator 世界像素坐标 → GCJ-02 经纬度 */
function mercatorToLngLat(x, y, zoom) {
  const worldSize = 256 * 2 ** (zoom + STATIC_MAP_ZOOM_OFFSET)
  const longitude = (x / worldSize) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / worldSize
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return {
    longitude: clampNumber(longitude, -180, 180),
    latitude: clampNumber(latitude, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT),
  }
}

/**
 * 静态地图的可视范围。
 *
 * width / height 是**前端 CSS 显示尺寸**，不是乘过 scale 的图片像素。
 * scale 只影响清晰度，不改变地理覆盖范围。
 */
function staticMapBounds({ longitude, latitude }, zoom, width, height) {
  const { x, y } = lngLatToMercator(longitude, latitude, zoom)
  return {
    west: mercatorToLngLat(x - width / 2, y, zoom).longitude,
    east: mercatorToLngLat(x + width / 2, y, zoom).longitude,
    north: mercatorToLngLat(x, y - height / 2, zoom).latitude,
    south: mercatorToLngLat(x, y + height / 2, zoom).latitude,
  }
}

/**
 * 按拖拽像素移动中心。
 *
 * dx > 0 表示把地图向右拖，中心应该往西（经度变小）；
 * dy > 0 表示把地图向下拖，中心应该往北（纬度变大）。
 */
function moveCenterByPixels({ longitude, latitude }, dx, dy, zoom) {
  const { x, y } = lngLatToMercator(longitude, latitude, zoom)
  return mercatorToLngLat(x - dx, y - dy, zoom)
}

/** 有的响应会漏掉 Content-Type，PNG 文件头作为兜底 */
function isPngBuffer(buffer) {
  return (
    buffer &&
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
}

/** 高德静态地图失败时返回 JSON（HTTP 仍可能是 200），提取可读原因 */
function parseAmapStaticError(buffer) {
  try {
    const data = JSON.parse(buffer.toString('utf8'))
    return data.info || data.message || data.infocode || '未知错误'
  } catch {
    return '返回了非图片内容'
  }
}

/**
 * 高德静态地图。
 *
 * 返回原始 Buffer 与 Content-Type，由上层决定是否转 data URL。
 * 不传 markers：前端用固定中心图钉表示选中点，避免图片内标记与图钉重复。
 *
 * @returns {Promise<{buffer: Buffer, contentType: string, scale: 1|2}>}
 * @throws {MapUnavailableError}
 */
async function staticMap({ longitude, latitude, zoom = 16, width = 640, height = 360, scale = 2 }) {
  const lng = Number(longitude)
  const lat = Number(latitude)
  const z = Math.trunc(Number(zoom))
  const w = Math.trunc(Number(width))
  const h = Math.trunc(Number(height))
  const requestedScale = Number(scale)

  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new MapUnavailableError('经度不合法')
  }
  if (!Number.isFinite(lat) || lat < -MERCATOR_MAX_LAT || lat > MERCATOR_MAX_LAT) {
    throw new MapUnavailableError('纬度不合法')
  }
  if (!Number.isInteger(z) || z < 1 || z > 17) {
    throw new MapUnavailableError('地图缩放级别不合法')
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 1024 || h > 1024) {
    throw new MapUnavailableError('地图尺寸不合法')
  }
  if (w * h > 640 * 480) {
    throw new MapUnavailableError('地图预览尺寸过大')
  }
  if (requestedScale !== 1 && requestedScale !== 2) {
    throw new MapUnavailableError('地图缩放比例不合法')
  }
  if (!config.map.amapKey || config.map.provider === 'tencent') {
    throw new MapUnavailableError('未配置高德 Web 服务 Key，无法生成地图预览')
  }

  const center = `${lng.toFixed(7)},${lat.toFixed(7)}`
  const request = (actualScale) =>
    fetchBinary(
      AMAP_STATICMAP_URL,
      {
        location: center,
        zoom: z,
        size: `${w}*${h}`,
        scale: actualScale,
        key: config.map.amapKey,
      },
      STATIC_MAP_TIMEOUT_MS
    )

  const normalize = (result, usedScale) => {
    if (result.contentType.startsWith('image/') || isPngBuffer(result.buffer)) {
      return { ...result, scale: usedScale }
    }
    throw new MapUnavailableError(`高德静态地图失败：${parseAmapStaticError(result.buffer)}`)
  }

  let actualScale = requestedScale
  let result = normalize(await request(actualScale), actualScale)

  // Retina 图会明显更大；超过上限时降级清晰度，而不是让整个预览失败
  if (result.buffer.length > STATIC_MAP_MAX_BYTES && actualScale === 2) {
    actualScale = 1
    result = normalize(await request(actualScale), actualScale)
  }
  if (result.buffer.length > STATIC_MAP_MAX_BYTES) {
    throw new MapUnavailableError('地图预览过大，请缩小预览尺寸')
  }

  return result
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
  reverseGeocode,
  drivingRoute,
  staticMap,
  staticMapBounds,
  moveCenterByPixels,
  decodeAmapPolyline,
  parseAmapLocation,
  parseAmapRegeo,
  parseTencentRegeo,
  parseAmapStaticError,
}
