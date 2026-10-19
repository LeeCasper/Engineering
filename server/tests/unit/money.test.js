'use strict'

/**
 * 金额运算单测。
 *
 * 对应验收标准 AC-L11：「全链路金额使用 DECIMAL(12,2)，无浮点运算；
 * 构造 0.1 + 0.2 类数据，合计精确到分」。
 *
 * 这些用例的价值不在覆盖率，而在于**锁死行为**：
 * 将来任何人把 money.js 里的 decimal.js 换成原生 Number，
 * 下面第一个用例就会红，而不是等到某个项目对账时少一分钱才发现。
 */

// describe / it / expect 由 vitest 以全局形式注入（见 vitest.config.mjs 的 globals）
const money = require('../../src/utils/money')

describe('money · 精度（AC-L11）', () => {
  it('0.1 + 0.2 精确等于 0.30（原生浮点会得到 0.30000000000000004）', () => {
    expect(money.add('0.1', '0.2')).toBe('0.30')
  })

  it('先证明原生浮点确实会错，再证明本模块不会', () => {
    // 这一行是「为什么需要 decimal.js」的可执行论据。
    // 若某天有人想把金额换成 Number，先看这里。
    expect(0.1 + 0.2).not.toBe(0.3)

    const values = ['0.1', '0.2']
    expect(money.sum(values)).toBe('0.30')
  })

  it('100 笔 0.01 累加精确等于 1.00', () => {
    const values = Array.from({ length: 100 }, () => '0.01')
    expect(money.sum(values)).toBe('1.00')
  })

  it('1000 条随机两位小数流水的合计与逐条精确累加一致', () => {
    // 构造固定序列（不用随机数），保证用例可复现
    const values = Array.from({ length: 1000 }, (_, i) => ((i * 37) % 10000) / 100)
    // 用 BigInt 做「分」为单位的整数累加，作为独立参照实现
    const expectedCents = values.reduce((acc, v) => acc + BigInt(Math.round(v * 100)), 0n)
    const expected = `${expectedCents / 100n}.${String(expectedCents % 100n).padStart(2, '0')}`

    expect(money.sum(values.map(String))).toBe(expected)
  })

  it('减法允许为负：待收金额 = 合同额 − 已收款，超收时为负（AC-L08）', () => {
    expect(money.subtract('100000.00', '120000.00')).toBe('-20000.00')
    expect(money.isNegative('-20000.00')).toBe(true)
  })

  it('乘法按分四舍五入，不给浮点留缝', () => {
    // 大额支出提醒比例（AC-L30）：合同额 × 10%
    expect(money.multiply('33333.33', '0.1')).toBe('3333.33')
  })

  it('空数组求和为 0.00', () => {
    expect(money.sum([])).toBe('0.00')
  })
})

describe('money · 输入校验（AC-L03 / AC-AD13）', () => {
  it('接受合法金额并规范为两位小数', () => {
    expect(money.validate('100')).toEqual({ ok: true, value: '100.00' })
    expect(money.validate('99.9')).toEqual({ ok: true, value: '99.90' })
    expect(money.validate('0.01')).toEqual({ ok: true, value: '0.01' })
  })

  it('拒绝中文、字母、空值', () => {
    expect(money.validate('一百').ok).toBe(false)
    expect(money.validate('12a').ok).toBe(false)
    expect(money.validate('').ok).toBe(false)
    expect(money.validate(null).ok).toBe(false)
    expect(money.validate(undefined).ok).toBe(false)
  })

  it('拒绝负数与零', () => {
    expect(money.validate('-1').ok).toBe(false)
    expect(money.validate('0').ok).toBe(false)
    expect(money.validate('0.00').ok).toBe(false)
  })

  it('拒绝超过两位小数', () => {
    expect(money.validate('1.234').ok).toBe(false)
    // 用字符串正则判断小数位，而不是 Number.isInteger(v * 100) ——
    // 0.29 * 100 === 28.999999999999996，那个写法会把合法值判成非法
    expect(money.validate('0.29').ok).toBe(true)
  })

  it('允许零当且仅当显式放开（权重类场景）', () => {
    expect(money.validate('0', { allowZero: true })).toEqual({ ok: true, value: '0.00' })
  })

  it('整数位不能超过 DECIMAL(12,2) 的容量（10 位整数）', () => {
    expect(money.validate('9999999999.99').ok).toBe(true) // 10 位整数，刚好
    expect(money.validate('99999999999.99').ok).toBe(false) // 11 位整数，超限
  })

  it('拒绝科学计数法（前端输入框不该产生，接口层也要挡住）', () => {
    expect(money.validate('1e3').ok).toBe(false)
  })

  it('非法值抛错而不是静默当 0', () => {
    // 静默归零会让一笔错账无人发现，这是比报错严重得多的后果
    expect(() => money.toDecimal('abc')).toThrow(/非法金额值/)
  })
})

describe('money · 比较与格式化', () => {
  it('compare 返回 -1 / 0 / 1', () => {
    expect(money.compare('1.00', '2.00')).toBe(-1)
    expect(money.compare('2.00', '2.00')).toBe(0)
    expect(money.compare('2.01', '2.00')).toBe(1)
  })

  it('format 固定两位小数', () => {
    expect(money.format('5')).toBe('5.00')
    expect(money.format(5.005)).toBe('5.01') // ROUND_HALF_UP
    expect(money.format(null)).toBe('0.00')
  })
})
