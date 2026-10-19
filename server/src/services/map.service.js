'use strict'

/**
 * 地图服务（腾讯位置服务）。
 *
 * V1.0 只用到一个能力：把项目地址解析成坐标（AC-AD54）。
 * 路线规划、签到距离计算属于 V1.2，届时在本文件扩展。
 *
 * ── 未配置 Key 时的行为 ──
 * `TENCENT_MAP_KEY` 为空时 `geocode` 直接返回 null，建档流程**不阻断** ——
 * 地址照常保存，`longitude/latitude` 留空，管理后台提示「可在地图上手工拾取坐标」。
 * 这也是 AC-AD54 要求的降级路径：解析失败时提供手工拾取入口。
 *
 * 之所以不让它报错：装修项目建档是高频操作，把「地图服务没配好」变成
 * 「不能建档」，等于用一个辅助功能卡死主流程。
 *
 * ── 安全 ──
 * AC-N13：地图服务 Key 仅存服务端环境变量，**不下发小程序、不写入日志**。
 * 本模块的日志里不得出现 Key。
 */

const config = require('../../config')
const logger = require('../utils/logger')

const GEOCODE_URL = 'https://apis.map.qq.com/ws/geocoder/v1/'
const REQUEST_TIMEOUT_MS = 5000

/**
 * 地址 → GCJ-02 坐标。
 *
 * 全系统坐标统一 GCJ-02（§6.2）。腾讯位置服务本身就返回 GCJ-02，
 * 因此这里不需要转换；但若将来换用返回 WGS-84 的服务，
 * **必须在此处转换后再落库**，否则导航会偏移数百米（AC-N03）。
 *
 * @param {string} address
 * @returns {Promise<{longitude: string, latitude: string}|null>} 解析失败或未配置时返回 null
 */
async function geocode(address) {
  if (!config.map.enabled) {
    logger.debug('地图服务未配置，跳过地理编码（AC-AD54 的手工拾取路径）')
    return null
  }
  if (!address) return null

  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(config.map.tencentKey)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url, { signal: controller.signal })
    const data = await res.json()

    if (data.status !== 0) {
      // 只记 status 与 message，**不记 URL**（URL 里带 Key）
      logger.warn('地理编码失败，等待管理员手工拾取坐标', { status: data.status, message: data.message })
      return null
    }

    const location = data.result && data.result.location
    if (!location) return null

    return {
      // DECIMAL(10,7) 以字符串进出（见 db/pool.js），这里保持字符串
      longitude: Number(location.lng).toFixed(7),
      latitude: Number(location.lat).toFixed(7),
    }
  } catch (err) {
    logger.warn('地理编码请求异常，等待管理员手工拾取坐标', { message: err.message })
    return null
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { geocode }
