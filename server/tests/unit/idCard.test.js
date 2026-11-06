'use strict'

/**
 * 身份证 / 姓名本地校验。
 *
 * 这些用例锁住的是「什么算合法输入」：校验位、出生日期、省级前缀。
 * 具体校验位算法本身不需要在这里重新推导 —— 用固定的合法 / 非法样本
 * 保证改动不会把明显不合法的证件号放过去。
 */

const idCard = require('../../src/utils/idCard')

describe('idCard · 身份证号校验', () => {
  it('接受合法的 18 位号码，并解析出生日期与性别', () => {
    const result = idCard.validateIdCard('310101199001011234')
    expect(result.valid).toBe(true)
    expect(result.normalized).toBe('310101199001011234')
    expect(result.birthDate).toBe('1990-01-01')
    expect(result.provinceCode).toBe('31')
    // 第 17 位 3 为奇数 → 男
    expect(result.gender).toBe('male')
  })

  it('第 17 位为偶数时识别为女', () => {
    const result = idCard.validateIdCard('440301199005151242')
    expect(result.valid).toBe(true)
    expect(result.gender).toBe('female')
  })

  it('末位 X 按大写处理', () => {
    const normalized = idCard.normalizeIdCard(' 31010119900101123x ')
    expect(normalized).toBe('31010119900101123X')
  })

  it('校验位错误时拒绝', () => {
    const result = idCard.validateIdCard('310101199001011235')
    expect(result.valid).toBe(false)
    expect(result.code).toBe('CHECKSUM')
    expect(result.message).toContain('校验位')
  })

  it('出生日期不存在时拒绝（2 月 30 日）', () => {
    const result = idCard.validateIdCard('310101199002301233')
    expect(result.valid).toBe(false)
    expect(result.code).toBe('BIRTH_DATE')
  })

  it('出生日期晚于今天时拒绝', () => {
    const result = idCard.validateIdCard('310101209901011236')
    expect(result.valid).toBe(false)
    expect(result.code).toBe('BIRTH_DATE')
  })

  it('省级行政区代码不存在时拒绝', () => {
    const result = idCard.validateIdCard('990101199001011234')
    expect(result.valid).toBe(false)
    // 990101 的校验位可能也不对，但省级前缀先被判出来
    expect(result.code).toBe('PROVINCE')
  })

  it('长度与格式错误分别给出可读提示', () => {
    expect(idCard.validateIdCard('31010119900101123')).toMatchObject({
      valid: false,
      code: 'LENGTH',
    })
    expect(idCard.validateIdCard('31010119900101123A')).toMatchObject({
      valid: false,
      code: 'FORMAT',
    })
    expect(idCard.validateIdCard('')).toMatchObject({ valid: false, code: 'EMPTY' })
  })
})

describe('idCard · 姓名校验', () => {
  it('接受中文姓名、间隔号与英文姓名', () => {
    expect(idCard.validateRealName('张三').valid).toBe(true)
    expect(idCard.validateRealName('欧阳·娜娜').valid).toBe(true)
    expect(idCard.validateRealName('John Smith').valid).toBe(true)
  })

  it('拒绝数字、单字与空姓名', () => {
    expect(idCard.validateRealName('张').code).toBe('LENGTH')
    expect(idCard.validateRealName('张三123').code).toBe('FORMAT')
    expect(idCard.validateRealName('   ').code).toBe('EMPTY')
  })
})

describe('idCard · 脱敏', () => {
  it('证件号只保留前 6 位与后 4 位', () => {
    expect(idCard.maskIdCard('310101199001011234')).toBe('310101********1234')
  })

  it('姓名只保留首字', () => {
    expect(idCard.maskRealName('张三')).toBe('张*')
    expect(idCard.maskRealName('欧阳娜娜')).toBe('欧***')
  })
})
