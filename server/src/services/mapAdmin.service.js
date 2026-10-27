'use strict'

/**
 * 管理端地图用例编排。
 *
 * 与 map.service.js 的分工：
 *   - map.service  只负责与高德 / 腾讯通信，返回坐标、Buffer 等原始结果；
 *   - 本模块       负责管理端表单需要的响应形状、坐标字符串、短缓存与降级。
 *
 * 所有预期失败（未配置 Key、地址未命中、地图服务异常）都通过
 * found / available = false 返回，不抛给 HTTP 层 —— 建档绝不能因此被阻断
 * （AC-AD54）。地图 Key 只在这里被使用，响应与日志都不会出现 Key。
 */

const config = require('../../config')
const mapService = require('./map.service')
const logger = require('../utils/logger')

const GEOCODE_CACHE_TTL_MS = 5 * 60 * 1000
const GEOCODE_CACHE_MAX = 50
const STATIC_MAP_CACHE_TTL_MS = 5 * 60 * 1000
const STATIC_MAP_CACHE_MAX = 20

const geocodeCache = new Map()
const staticMapCache = new Map()

function readCache(cache, key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function writeCache(cache, key, value, max, ttlMs) {
  // Map 保持插入顺序；超过上限时删最早的一条，避免进程内存随地址增长
  if (cache.size >= max && !cache.has(key)) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

function formatCoordinate(value) {
  return Number(value).toFixed(7)
}

/**
 * 地址 → 坐标。
 *
 * 成功结果缓存 5 分钟：表单失焦、提交前、重复打开弹窗都会重复问同一个地址，
 * 没必要每次都消耗高德配额。失败结果不缓存，避免服务商短暂故障被固化。
 */
async function geocodeAddress(address) {
  const normalized = String(address || '').trim()
  if (!normalized) {
    return {
      found: false,
      reason: 'not_found',
      address: normalized,
      longitude: null,
      latitude: null,
      cached: false,
    }
  }

  const cached = readCache(geocodeCache, normalized)
  if (cached) return { ...cached, cached: true }

  try {
    const point = await mapService.geocode(normalized)
    if (!point) {
      return {
        found: false,
        reason: config.map.enabled ? 'not_found' : 'unavailable',
        address: normalized,
        longitude: null,
        latitude: null,
        cached: false,
      }
    }

    const value = {
      found: true,
      address: normalized,
      longitude: formatCoordinate(point.longitude),
      latitude: formatCoordinate(point.latitude),
      cached: false,
    }
    writeCache(geocodeCache, normalized, value, GEOCODE_CACHE_MAX, GEOCODE_CACHE_TTL_MS)
    return value
  } catch (err) {
    logger.warn('管理端地址定位失败', { message: err.message })
    return {
      found: false,
      reason: 'unavailable',
      address: normalized,
      longitude: null,
      latitude: null,
      cached: false,
    }
  }
}

/** 坐标 → 文字地址（地图选点后「填入地址」） */
async function reverseGeocode({ longitude, latitude }) {
  const lng = formatCoordinate(longitude)
  const lat = formatCoordinate(latitude)

  try {
    const address = await mapService.reverseGeocode({
      latitude: Number(lat),
      longitude: Number(lng),
    })
    return { found: Boolean(address), address: address || null, longitude: lng, latitude: lat }
  } catch (err) {
    logger.warn('管理端逆地理编码失败', { message: err.message })
    return { found: false, address: null, longitude: lng, latitude: lat }
  }
}

/**
 * 静态地图预览。
 *
 * 返回 data URL 而不是二进制响应，前端 <img>/<image> 不需要带 Authorization
 * 头，也不会把 Key 暴露到浏览器。缓存的是完整结果（含 base64），只放内存，
 * 避免几百 KB 的图片进入 Redis。
 */
async function staticMapPreview({ longitude, latitude, zoom, width, height, scale }) {
  const lng = formatCoordinate(longitude)
  const lat = formatCoordinate(latitude)
  const z = Math.trunc(Number(zoom))
  const w = Math.trunc(Number(width))
  const h = Math.trunc(Number(height))
  const requestedScale = Number(scale) === 1 ? 1 : 2

  const cacheKey = `${lng},${lat},${z},${w},${h},${requestedScale}`
  const cached = readCache(staticMapCache, cacheKey)
  if (cached) return { ...cached, cached: true }

  try {
    const result = await mapService.staticMap({
      longitude: lng,
      latitude: lat,
      zoom: z,
      width: w,
      height: h,
      scale: requestedScale,
    })

    const contentType = result.contentType || 'image/png'
    const value = {
      available: true,
      dataUrl: `data:${contentType};base64,${result.buffer.toString('base64')}`,
      width: w,
      height: h,
      pixelWidth: w * result.scale,
      pixelHeight: h * result.scale,
      zoom: z,
      scale: result.scale,
      center: { longitude: lng, latitude: lat },
      bounds: mapService.staticMapBounds({ longitude: lng, latitude: lat }, z, w, h),
      cached: false,
    }
    writeCache(staticMapCache, cacheKey, value, STATIC_MAP_CACHE_MAX, STATIC_MAP_CACHE_TTL_MS)
    return value
  } catch (err) {
    if (err instanceof mapService.MapUnavailableError) {
      logger.warn('静态地图不可用，前端应降级为手工坐标', { message: err.message })
      return { available: false, message: err.message }
    }
    logger.warn('静态地图生成异常', { message: err.message })
    return { available: false, message: '地图预览暂时不可用，请手工填写坐标' }
  }
}

module.exports = {
  geocodeAddress,
  reverseGeocode,
  staticMapPreview,
  /** 仅测试使用：清空进程内缓存，避免用例之间互相命中 */
  _clearCaches() {
    geocodeCache.clear()
    staticMapCache.clear()
  },
}
