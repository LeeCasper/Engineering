'use strict'

/**
 * 分页参数解析。
 *
 * 需求文档 §8.1 与 AC-AD45 规定所有列表接口强制分页、一页 20 条、单页不超过 50 条。
 * 因此 pageSize 超限时**钳制**而不是报错 —— 前端传大了只是想要更多数据，
 * 报错会让页面直接挂掉，钳到 50 既满足约束又不打断用户。
 */

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50

function parsePaging(query = {}) {
  const page = toPositiveInt(query.page, DEFAULT_PAGE)
  const pageSize = clamp(toPositiveInt(query.pageSize ?? query.page_size, DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE)

  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize }
}

/**
 * 用 Number() 而非 parseInt()：后者会把 '12abc' 静默解析成 12。
 * 非法值一律回落默认值，并给页码封顶避免 OFFSET 溢出。
 */
function toPositiveInt(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) return fallback
  return Math.min(n, 1_000_000)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

module.exports = { parsePaging, DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE }
