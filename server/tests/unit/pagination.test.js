'use strict'

/**
 * 分页参数单测。
 *
 * 对应 §8.1「列表类接口一页 20 条，强制分页，禁止全量返回」
 * 与 AC-AD45「所有列表接口强制分页，单页不超过 50 条」。
 */

const { parsePaging, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('../../src/utils/pagination')

describe('pagination · 默认值（§8.1）', () => {
  it('无参数时默认第 1 页、每页 20 条', () => {
    expect(parsePaging({})).toEqual({ page: 1, pageSize: 20, offset: 0, limit: 20 })
    expect(DEFAULT_PAGE_SIZE).toBe(20)
  })

  it('无参数（undefined）也不崩', () => {
    expect(parsePaging().page).toBe(1)
  })

  it('offset 与 page / pageSize 一致', () => {
    expect(parsePaging({ page: 3, pageSize: 20 })).toEqual({
      page: 3,
      pageSize: 20,
      offset: 40,
      limit: 20,
    })
  })
})

describe('pagination · 上限钳制（AC-AD45）', () => {
  it('pageSize 超过 50 时钳到 50，而不是报错', () => {
    // 报错会让页面直接挂掉；钳制既满足「不超过 50」的约束又不打断用户
    expect(parsePaging({ pageSize: 200 }).pageSize).toBe(MAX_PAGE_SIZE)
    expect(parsePaging({ pageSize: 999999 }).pageSize).toBe(50)
  })

  it('pageSize 不超过上限时原样保留', () => {
    expect(parsePaging({ pageSize: 50 }).pageSize).toBe(50)
    expect(parsePaging({ pageSize: 1 }).pageSize).toBe(1)
  })

  it('接受下划线写法 page_size', () => {
    expect(parsePaging({ page_size: 30 }).pageSize).toBe(30)
  })
})

describe('pagination · 非法输入回落', () => {
  it('负数、零、小数、中文、Infinity 一律回落默认值', () => {
    for (const bad of ['-1', '0', '1.5', 'abc', '', 'Infinity', null]) {
      expect(parsePaging({ page: bad }).page).toBe(1)
      expect(parsePaging({ pageSize: bad }).pageSize).toBe(20)
    }
  })

  it("'12abc' 不被静默解析成 12（Number 与 parseInt 的关键区别）", () => {
    expect(parsePaging({ page: '12abc' }).page).toBe(1)
  })

  it('超大页码被限制，避免 OFFSET 溢出', () => {
    expect(parsePaging({ page: '99999999999' }).page).toBe(1_000_000)
  })
})
