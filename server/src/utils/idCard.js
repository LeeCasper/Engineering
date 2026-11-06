'use strict'

/**
 * 身份证号与姓名的本地校验（实名认证基础层）。
 *
 * ── 这里能做什么、不能做什么 ──
 * 能做：18 位格式、GB 11643 校验位、出生日期真实性、省级行政区前缀。
 * 不能做：判断「姓名与证件号是否属于同一个人」—— 那需要公安库或第三方
 * 二要素服务，本模块刻意不假装自己具备这个能力。对外必须把核验等级
 * 标成 `basic`，不要写成「公安库核验通过」。
 *
 * 证件号明文只在本模块的入参里出现，**不落库、不写日志**；调用方拿到
 * `maskIdCard()` 的结果后再持久化。
 */

const regions = require('../data/regions.json')

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const CHECK_CODES = '10X98765432'
const ID_CARD_PATTERN = /^\d{17}[\dX]$/
const NAME_PATTERN = /^[一-龥A-Za-z·.\s]{2,50}$/

const PROVINCE_CODES = new Set(regions.map((item) => String(item.code).slice(0, 2)))
const MIN_BIRTH_YEAR = 1900

function normalizeIdCard(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .toUpperCase()
}

function normalizeRealName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
}

/** 校验位：ISO 7064:1983 MOD 11-2 */
function checksum(id) {
  let sum = 0
  for (let i = 0; i < 17; i += 1) {
    sum += Number(id[i]) * WEIGHTS[i]
  }
  return CHECK_CODES[sum % 11]
}

/** 返回 YYYY-MM-DD；日期不存在时返回 null（2 月 30 日这类） */
function parseBirthDate(id) {
  const year = Number(id.slice(6, 10))
  const month = Number(id.slice(10, 12))
  const day = Number(id.slice(12, 14))
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * @returns {{valid:boolean, code?:string, message?:string, normalized?:string,
 *   birthDate?:string, gender?:'male'|'female', provinceCode?:string}}
 */
function validateIdCard(value) {
  const id = normalizeIdCard(value)

  if (!id) return { valid: false, code: 'EMPTY', message: '请输入身份证号' }
  if (id.length !== 18) return { valid: false, code: 'LENGTH', message: '身份证号应为 18 位' }
  if (!ID_CARD_PATTERN.test(id)) {
    return { valid: false, code: 'FORMAT', message: '身份证号格式不正确，前 17 位为数字，末位为数字或 X' }
  }
  if (!PROVINCE_CODES.has(id.slice(0, 2))) {
    return { valid: false, code: 'PROVINCE', message: '身份证号的省级行政区代码不正确' }
  }

  const birthDate = parseBirthDate(id)
  if (!birthDate) {
    return { valid: false, code: 'BIRTH_DATE', message: '身份证号中的出生日期不正确' }
  }

  const birth = new Date(`${birthDate}T00:00:00Z`)
  if (birth.getUTCFullYear() < MIN_BIRTH_YEAR) {
    return { valid: false, code: 'BIRTH_DATE', message: '身份证号中的出生日期不正确' }
  }
  if (birth.getTime() > Date.now()) {
    return { valid: false, code: 'BIRTH_DATE', message: '身份证号中的出生日期不能晚于今天' }
  }

  if (checksum(id) !== id[17]) {
    return { valid: false, code: 'CHECKSUM', message: '身份证号校验位不正确，请核对后重试' }
  }

  return {
    valid: true,
    normalized: id,
    birthDate,
    // 第 17 位顺序码：奇数为男，偶数为女
    gender: Number(id[16]) % 2 === 1 ? 'male' : 'female',
    provinceCode: id.slice(0, 2),
  }
}

function validateRealName(value) {
  const name = normalizeRealName(value)
  if (!name) return { valid: false, code: 'EMPTY', message: '请输入真实姓名' }
  if (name.length < 2) return { valid: false, code: 'LENGTH', message: '真实姓名至少 2 个字符' }
  if (name.length > 50) return { valid: false, code: 'LENGTH', message: '真实姓名最多 50 个字符' }
  if (!NAME_PATTERN.test(name)) {
    return {
      valid: false,
      code: 'FORMAT',
      message: '真实姓名只能包含中文、英文字母、空格和间隔号',
    }
  }
  return { valid: true, normalized: name }
}

/** 310101********1234 —— 保留前 6 位（行政区）与后 4 位（顺序码 + 校验位） */
function maskIdCard(value) {
  const id = normalizeIdCard(value)
  if (id.length !== 18) return ''
  return `${id.slice(0, 6)}${'*'.repeat(8)}${id.slice(-4)}`
}

/** 张* / 欧阳** —— 审计流水里只保留首字 */
function maskRealName(value) {
  const name = normalizeRealName(value)
  if (!name) return null
  if (name.length === 1) return '*'
  return `${name[0]}${'*'.repeat(name.length - 1)}`
}

module.exports = {
  normalizeIdCard,
  normalizeRealName,
  validateIdCard,
  validateRealName,
  maskIdCard,
  maskRealName,
}
