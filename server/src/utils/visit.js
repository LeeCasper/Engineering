'use strict'

/**
 * 现场签到的纯函数（C-6.13 ~ C-6.20）。
 *
 * 这些逻辑不碰数据库、不碰文件，单独放在这里是为了能被单测直接覆盖：
 * 坐标范围、阈值边界、水印文案这三处一旦写错，表现分别是
 * 「脏数据落库」「正常签到被标异常」「水印内容不对」，都属于很难靠手工发现的错误。
 */

const AppError = require('./AppError')
const datetime = require('./datetime')

const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])

function toFiniteNumber(value) {
  // Number('') === 0，空串必须先单独排除；Number(null) === 0 同理
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 校验并归一化签到坐标。
 *
 * 不接受「缺失坐标」的签到（AC-N28）：定位失败时前端不应提交，
 * 服务端再兜一层，避免空坐标 / 0 坐标被当成合法签到写进库。
 *
 * @returns {{latitude:number, longitude:number}}
 * @throws {AppError} 400
 */
function normalizeCoordinates({ latitude, longitude } = {}) {
  const lat = toFiniteNumber(latitude)
  const lng = toFiniteNumber(longitude)

  if (lat === null || lng === null) {
    throw AppError.badRequest('无法获取当前位置，请重新定位后再签到')
  }
  if (lat < -90 || lat > 90) throw AppError.badRequest('签到纬度不合法')
  if (lng < -180 || lng > 180) throw AppError.badRequest('签到经度不合法')

  return { latitude: lat, longitude: lng }
}

/**
 * 偏差判定。
 *
 * AC-N19：偏差 ≤ 阈值是正常；**严格大于**阈值才是异常。
 * 边界值（正好等于 500m）属于正常，不能因为浮点比较写成 >=。
 */
function isAbnormalDistance(distanceM, thresholdM) {
  // Number(null) === 0、Number('') === 0；缺值不能被当成「0 米」，必须先排除
  if (distanceM === null || distanceM === undefined || distanceM === '') return false
  if (thresholdM === null || thresholdM === undefined || thresholdM === '') return false

  const distance = Number(distanceM)
  const threshold = Number(thresholdM)
  if (!Number.isFinite(distance) || !Number.isFinite(threshold)) return false
  return distance > threshold
}

/**
 * 水印三行：签到时间 + 项目地址 + 签到坐标。
 *
 * 与进度汇报共用 watermark.apply，只是 lines 不同（§4.6.2）。
 * 地址为空时给一句可读的兜底，避免水印第二行直接消失 ——
 * 一张只有时间和坐标的照片，在纠纷时很难说明是在哪个工地拍的。
 */
function buildWatermarkLines({ checkinAt, address, latitude, longitude }) {
  const time = datetime.format(checkinAt) || datetime.format()
  const place = String(address || '').trim() || '项目地址未填写'
  const lat = Number(latitude).toFixed(6)
  const lng = Number(longitude).toFixed(6)
  return [time, place, `坐标 ${lat}, ${lng}`]
}

/**
 * 从存储 URL / key 里取扩展名。
 *
 * 暂存表存了 ext，正常路径用不到这个函数；它留给「老数据 / 手工修库」时
 * 提交阶段仍能确定水印文件的保存类型，避免 storage.save 因扩展名为空而拒绝。
 */
function extractExtension(urlOrKey) {
  const value = String(urlOrKey || '')
  const match = value.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)
  const ext = match ? match[1].toLowerCase() : ''
  return ALLOWED_IMAGE_EXTENSIONS.has(ext) ? ext : 'jpg'
}

module.exports = {
  normalizeCoordinates,
  isAbnormalDistance,
  buildWatermarkLines,
  extractExtension,
}
