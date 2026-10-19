'use strict'

/**
 * 完成度计算（需求文档 §4.2.1）。
 *
 * 规则原文：
 *   - 工序完成度由工长手动填写（0–100%，步进 5%）；
 *   - 阶段完成度 = 各工序完成度按工序权重加权平均；未配置权重时按工序数等权平均；
 *   - 项目总进度 = 各阶段完成度按阶段权重加权平均。
 *
 * 文档给了一个同时充当 AC-P14 验证用例的例子：
 *   3 个工序，权重 1、1、2，完成度 40%、60%、80%
 *   → (40 + 60 + 80×2) ÷ 4 = 65%
 * 本模块的 `weightedAverage` 必须能算出这个 65。
 *
 * ── 一处需要明确的歧义 ──
 * 「未配置权重时等权」没有说明「部分工序配了权重、部分没配」该怎么办。
 * 本模块的选择是：**只有全部条目都配了正权重才走加权，否则整个集合退化为等权**。
 * 理由：混合加权会算出一个谁都解释不清的数字（凭什么这个算 1 份那个算 0.7 份），
 * 而看板上一个说不清来源的百分比，比一个保守的等权平均值更糟糕。
 */

const Decimal = require('decimal.js')

const PROGRESS_STEP = 5
const PROGRESS_MIN = 0
const PROGRESS_MAX = 100
/** 落库精度，对应 DECIMAL(5,2) */
const PROGRESS_SCALE = 2

/**
 * 校验工序完成度：0–100 且为 5 的整数倍（AC-P06）。
 *
 * 倍数用整数运算判断，不用 `value % 5 === 0` —— 后者对 '37.0' 这类字符串输入
 * 与浮点表示都不稳。
 */
function validateProgress(value) {
  if (value === null || value === undefined || value === '') {
    return { ok: false, reason: '完成度不能为空' }
  }

  const raw = String(value).trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return { ok: false, reason: '完成度必须为数字' }
  }

  const decimal = new Decimal(raw)
  if (decimal.lt(PROGRESS_MIN) || decimal.gt(PROGRESS_MAX)) {
    return { ok: false, reason: `完成度必须在 ${PROGRESS_MIN}–${PROGRESS_MAX} 之间` }
  }

  // 步进校验：×100 后用整数取模，绕开浮点
  const scaled = decimal.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
  const stepScaled = PROGRESS_STEP * 100
  if (!scaled.mod(stepScaled).isZero()) {
    return { ok: false, reason: `完成度必须为 ${PROGRESS_STEP} 的整数倍` }
  }

  return { ok: true, value: decimal.toFixed(PROGRESS_SCALE) }
}

/**
 * 规范化权重：null / undefined / 0 / 负数 一律视为「未配置」（AC-AD23 要求权重为正数）。
 * 已配置返回正 Decimal，未配置返回 null。
 */
function normalizeWeight(value) {
  if (value === null || value === undefined || value === '') return null
  let decimal
  try {
    decimal = new Decimal(value)
  } catch {
    return null
  }
  if (!decimal.isFinite() || decimal.lte(0)) return null
  return decimal
}

/** weighted=false 表示退化为等权（此时 weights 全部为 1） */
function resolveWeights(items, weightKey) {
  const configured = items.map((item) => normalizeWeight(item[weightKey]))
  const allConfigured = configured.length > 0 && configured.every((w) => w !== null)

  if (!allConfigured) {
    return { weighted: false, weights: items.map(() => new Decimal(1)) }
  }
  return { weighted: true, weights: configured }
}

/** 加权平均，返回两位小数字符串（如 '65.00'）；空集合返回 '0.00' */
function weightedAverage(items, keys = {}) {
  const { valueKey, weightKey = 'weight' } = keys
  if (!valueKey) throw new Error('weightedAverage 缺少 valueKey')
  if (!Array.isArray(items) || items.length === 0) return new Decimal(0).toFixed(PROGRESS_SCALE)

  const { weights } = resolveWeights(items, weightKey)

  let weightedSum = new Decimal(0)
  let weightTotal = new Decimal(0)

  items.forEach((item, index) => {
    const weight = weights[index]
    let value
    try {
      value = new Decimal(item[valueKey] ?? 0)
    } catch {
      value = new Decimal(0)
    }
    weightedSum = weightedSum.plus(value.times(weight))
    weightTotal = weightTotal.plus(weight)
  })

  // weights 由 resolveWeights 保证全为正，不会出现除零；
  // 这里仍显式兜底，避免将来有人改动 resolveWeights 时静默产生 Infinity
  if (weightTotal.isZero()) return new Decimal(0).toFixed(PROGRESS_SCALE)

  return weightedSum.dividedBy(weightTotal).toDecimalPlaces(PROGRESS_SCALE, Decimal.ROUND_HALF_UP).toFixed(PROGRESS_SCALE)
}

/** 阶段完成度 = 该阶段下全部工序的加权平均（AC-P14 / AC-P15） */
function stageProgress(items) {
  return weightedAverage(items, { valueKey: 'progress', weightKey: 'weight' })
}

/**
 * 项目总进度 = 各阶段完成度的加权平均（AC-P16）。
 *
 * 入参的 `progress` 应已由 stageProgress 算好并落库，这里**不向下钻取工序** ——
 * 保证「项目总进度」与「阶段详情」用同一份数据，两处各算一遍是进度对不上的经典来源。
 */
function projectProgress(stages) {
  return weightedAverage(stages, { valueKey: 'progress', weightKey: 'weight' })
}

module.exports = {
  PROGRESS_STEP,
  PROGRESS_MIN,
  PROGRESS_MAX,
  PROGRESS_SCALE,
  validateProgress,
  normalizeWeight,
  resolveWeights,
  weightedAverage,
  stageProgress,
  projectProgress,
}
