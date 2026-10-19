'use strict'

/**
 * 时间处理。§6.2 约定所有时间存 DATETIME、时区固定 Asia/Shanghai，§7.1 约定
 * 传输格式 `YYYY-MM-DD HH:mm:ss`。时区在这里**钉死**，业务代码不再各自换算 ——
 * AC-P23（连续 3 个自然日未汇报）与 AC-N25（当日重复签到）这类判定一旦掺进
 * 时区歧义，就会出现跨零点算错一天的问题。
 */

const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter')

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isSameOrBefore)
dayjs.extend(isSameOrAfter)

/** 系统统一时区。需求文档多处明确写 Asia/Shanghai */
const TIMEZONE = 'Asia/Shanghai'

/** 数据库 / 接口统一的时间格式 */
const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'
const DATE_FORMAT = 'YYYY-MM-DD'

/**
 * 当前时间（上海时区）。
 * 返回 dayjs 对象而不是 Date —— 避免调用方又掉进本地时区。
 */
function now() {
  return dayjs().tz(TIMEZONE)
}

/**
 * 字符串末尾是否带显式时区偏移（`...Z`、`...+08:00`、`...+0800`）。
 *
 * 这个判断决定字符串该按「绝对时刻」还是「墙上时间」理解，是 parse 里唯一
 * 容易搞错的地方：`2026-01-01 08:00:00` 是上海本地的墙上时间，而
 * `2026-01-01T00:00:00Z` 是绝对时刻（等于北京时间 08:00）。若两者都当墙上时间处理，
 * 后者会整整差 8 小时。
 */
const HAS_TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i

/** 解析失败返回 null，不抛错也不产生 Invalid Date */
function parse(input) {
  if (input === null || input === undefined || input === '') return null
  if (dayjs.isDayjs(input)) return input.tz(TIMEZONE)
  if (input instanceof Date) return dayjs(input).tz(TIMEZONE)

  const text = String(input).trim()

  // 带显式时区 → 先作为绝对时刻解析，再换算到东八区
  if (HAS_TIMEZONE_SUFFIX.test(text)) {
    const absolute = dayjs(text)
    if (absolute.isValid()) return absolute.tz(TIMEZONE)
  }

  // 无时区信息（含 'YYYY-MM-DD HH:mm:ss' 与纯日期）→ 按上海时区的墙上时间理解。
  // 注意不要写成 dayjs.tz(text, FORMAT, TIMEZONE)：三参重载的第三个参数是 locale
  // 而不是时区，会导致解析结果静默错误（此坑已由单测锁定）。
  const wallClock = dayjs.tz(text, TIMEZONE)
  return wallClock.isValid() ? wallClock : null
}

/** 格式化为 `YYYY-MM-DD HH:mm:ss`，缺省取当前时间 */
function format(input) {
  const d = input === undefined ? now() : parse(input)
  return d ? d.format(DATETIME_FORMAT) : null
}

/** 格式化为 `YYYY-MM-DD`，用于「当日」类判定的日期键 */
function formatDate(input) {
  const d = input === undefined ? now() : parse(input)
  return d ? d.format(DATE_FORMAT) : null
}

/**
 * 转为适用于 MySQL DATETIME 字面量的字符串。
 * 连接层已设 timezone=+08:00，因此直接传本地格式即可，无需转 UTC。
 */
function toDb(input) {
  return format(input)
}

/**
 * 两个时间之间的自然日数（按上海时区算，**不是** 24 小时差）。
 * 用于 AC-P23「连续 3 个自然日未汇报」—— 相隔 2 小时但跨零点要算 1 天。
 * 参数非法返回 NaN。
 */
function diffCalendarDays(from, to) {
  const a = parse(from)
  const b = parse(to)
  if (!a || !b) return Number.NaN
  return b.startOf('day').diff(a.startOf('day'), 'day')
}

/** 小时数，带小数。用于 AC-A22「进入待处理超过 48 小时」 */
function diffHours(from, to) {
  const a = parse(from)
  const b = parse(to)
  if (!a || !b) return Number.NaN
  return b.diff(a, 'hour', true)
}

/** 早于或等于（按天比较） */
function isSameOrBeforeDay(a, b) {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return false
  return x.isSameOrBefore(y, 'day')
}

/** 晚于或等于（按天比较） */
function isSameOrAfterDay(a, b) {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return false
  return x.isSameOrAfter(y, 'day')
}

/** 是否同一天（上海时区）。用于 AC-N25 当日重复签到 */
function isSameDay(a, b) {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return false
  return x.isSame(y, 'day')
}

/** 日期加天数，返回 `YYYY-MM-DD`。按模板生成阶段计划起止日期时用（plan_days → plan_end） */
function addDays(input, days) {
  const d = parse(input)
  if (!d) return null
  return d.add(Number(days) || 0, 'day').format(DATE_FORMAT)
}

function rangeOf(startInput, endInput) {
  const start = parse(startInput)
  const end = parse(endInput)
  if (!start || !end) return null
  return { start: start.format(DATETIME_FORMAT), end: end.format(DATETIME_FORMAT) }
}

/** 解析时长字符串（如 '30m' / '8h' / '7d'）为毫秒，用于 JWT 空闲超时判定 */
function parseDurationMs(input, fallbackMs = 0) {
  if (typeof input === 'number' && Number.isFinite(input)) return input
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(String(input || '').trim())
  if (!match) return fallbackMs
  const value = Number.parseFloat(match[1])
  const unit = match[2] || 'ms'
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]
  return Math.round(value * factor)
}

module.exports = {
  dayjs,
  TIMEZONE,
  DATETIME_FORMAT,
  DATE_FORMAT,
  now,
  parse,
  format,
  formatDate,
  toDb,
  diffCalendarDays,
  diffHours,
  isSameOrBeforeDay,
  isSameOrAfterDay,
  isSameDay,
  addDays,
  rangeOf,
  parseDurationMs,
}
