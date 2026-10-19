'use strict'

/**
 * 金额运算。
 *
 * 背景（需求文档 §6.2、AC-L11）：所有金额字段为 `DECIMAL(12,2)`，
 * **禁止使用浮点类型**；验收标准直接点名要构造 `0.1 + 0.2` 这类数据验证合计精确到分。
 *
 * 因此本项目有三条硬规矩：
 *   1. 数据库连接固定 `decimalNumbers: false`，DECIMAL 以**字符串**形式进出，
 *      绝不在读取环节就落进 JS Number（见 src/db/pool.js）；
 *   2. 所有加减乘除一律走本模块，内部用 decimal.js 做十进制运算；
 *   3. 业务代码里不允许出现 `parseFloat(amount)` / `Number(amount)` / `+amount`。
 *
 * 违反第 3 条不会立刻报错，只会在某个金额上悄悄少一分钱 —— 这正是要防的。
 */

const Decimal = require('decimal.js')

// DECIMAL(12,2)：10 位整数 + 2 位小数
const MONEY_PRECISION = 12
const MONEY_SCALE = 2

// 全局精度调高，避免中间结果（如按比例分摊）被过早截断
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP })

/** 空值按 0 处理；非法数值（如 'abc'）直接抛，不静默当 0 —— 静默会让一笔错账无人发现 */
function toDecimal(value) {
  if (value === null || value === undefined || value === '') return new Decimal(0)
  if (value instanceof Decimal) return value
  try {
    return new Decimal(value)
  } catch (err) {
    throw new Error(`非法金额值：${JSON.stringify(value)}`)
  }
}

/** 格式化为固定两位小数的**字符串**（不是 number，这是防止精度丢失的最后一道闸） */
function format(value) {
  return toDecimal(value).toFixed(MONEY_SCALE)
}

/** 求和。账目汇总用（AC-L07：已收款 = 全部 income 流水之和） */
function sum(values) {
  if (!Array.isArray(values)) return format(0)
  let total = new Decimal(0)
  for (const v of values) total = total.plus(toDecimal(v))
  return total.toFixed(MONEY_SCALE)
}

/** 差可以**为负**（AC-L08 的「已超收」、AC-L09 的负余额），因此不做非负钳制，由前端标红 */
function subtract(a, b) {
  return toDecimal(a).minus(toDecimal(b)).toFixed(MONEY_SCALE)
}

function add(a, b) {
  return toDecimal(a).plus(toDecimal(b)).toFixed(MONEY_SCALE)
}

/** 按分四舍五入 */
function multiply(a, b) {
  return toDecimal(a).times(toDecimal(b)).toFixed(MONEY_SCALE)
}

function compare(a, b) {
  return toDecimal(a).comparedTo(toDecimal(b))
}

function isZero(value) {
  return toDecimal(value).isZero()
}

function isNegative(value) {
  return toDecimal(value).isNegative()
}

/**
 * 校验金额输入：必须 > 0，最多两位小数（AC-L03 新增支出、AC-AD13 合同金额）。
 * allowZero 供权重类场景放开零值。
 *
 * 小数位必须用字符串正则判断，不能用 `Number.isInteger(v * 100)` ——
 * 那正好会踩到浮点误差（0.29 * 100 === 28.999999999999996）。
 */
function validate(value, options = {}) {
  const { allowZero = false } = options

  if (value === null || value === undefined || value === '') {
    return { ok: false, reason: '金额不能为空' }
  }

  const raw = String(value).trim()

  // 只接受「可选负号 + 数字 + 可选小数」；中文、字母、正号、科学计数法一律拒绝
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    return { ok: false, reason: '金额必须为数字，且最多保留两位小数' }
  }

  let decimal
  try {
    decimal = new Decimal(raw)
  } catch {
    return { ok: false, reason: '金额格式不正确' }
  }

  if (!decimal.isFinite()) return { ok: false, reason: '金额格式不正确' }
  if (decimal.isNegative()) return { ok: false, reason: '金额不能为负数' }
  if (decimal.isZero() && !allowZero) return { ok: false, reason: '金额必须大于 0' }

  // 整数位上限：DECIMAL(12,2) 共 12 位，扣掉 2 位小数还剩 10 位
  const integerDigits = decimal.abs().trunc().toFixed(0).replace('-', '').length
  if (integerDigits > MONEY_PRECISION - MONEY_SCALE) {
    return { ok: false, reason: `金额不得超过 ${MONEY_PRECISION - MONEY_SCALE} 位整数` }
  }

  return { ok: true, value: decimal.toFixed(MONEY_SCALE) }
}

module.exports = {
  Decimal,
  MONEY_PRECISION,
  MONEY_SCALE,
  toDecimal,
  format,
  sum,
  add,
  subtract,
  multiply,
  compare,
  isZero,
  isNegative,
  validate,
}
