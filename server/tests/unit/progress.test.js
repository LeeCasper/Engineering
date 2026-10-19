'use strict'

/**
 * 完成度计算单测。
 *
 * 需求文档 §4.2.1 给了一个同时充当验收标准的例子，AC-P14 要求
 * 「按 §4.2.1 示例构造数据（权重 1:1:2，完成度 40/60/80），
 * 阶段完成度计算结果应为 65%」—— 下面第一条用例就是它。
 */

const progress = require('../../src/utils/progress')

/** 构造工序记录 */
function items(rows) {
  return rows.map(([value, weight], index) => ({
    name: `工序${index + 1}`,
    progress: value,
    weight,
  }))
}

describe('progress · 阶段完成度（AC-P14 / AC-P15）', () => {
  it('AC-P14 文档示例：权重 1:1:2、完成度 40/60/80 → 65%', () => {
    // (40 + 60 + 80×2) ÷ 4 = 260 ÷ 4 = 65
    const list = items([
      [40, 1],
      [60, 1],
      [80, 2],
    ])
    expect(progress.stageProgress(list)).toBe('65.00')
  })

  it('AC-P15 未配置权重时按工序数等权平均', () => {
    const list = items([
      [40, null],
      [60, null],
      [80, null],
    ])
    // (40 + 60 + 80) ÷ 3 = 60
    expect(progress.stageProgress(list)).toBe('60.00')
  })

  it('权重为 0 视为未配置（AC-AD23 权重须为正数，0 不是有效权重）', () => {
    const list = items([
      [40, 0],
      [60, 0],
    ])
    expect(progress.stageProgress(list)).toBe('50.00')
  })

  it('部分配置权重时整体退化为等权，而不是混合加权', () => {
    // 这是文档未定义、由本模块显式选择的语义（见 progress.js 顶部说明）。
    // 若改成混合加权，这个用例会红 —— 那是刻意的，改行为必须同时改这里。
    const list = items([
      [100, 3],
      [0, null],
    ])
    expect(progress.stageProgress(list)).toBe('50.00')
  })

  it('全部完工时为 100.00，全部未开始为 0.00', () => {
    expect(progress.stageProgress(items([[100, 1], [100, 2]]))).toBe('100.00')
    expect(progress.stageProgress(items([[0, 1], [0, 2]]))).toBe('0.00')
  })

  it('空集合返回 0.00，不抛错也不返回 NaN', () => {
    expect(progress.stageProgress([])).toBe('0.00')
  })

  it('权重为小数时仍精确（权重是 DECIMAL(5,2)）', () => {
    const list = items([
      [50, '0.5'],
      [100, '0.5'],
    ])
    expect(progress.stageProgress(list)).toBe('75.00')
  })

  it('结果四舍五入到两位小数，不产生超长小数', () => {
    const list = items([
      [10, 1],
      [20, 1],
      [20, 1],
    ])
    // (10+20+20)/3 = 16.666… → 16.67
    expect(progress.stageProgress(list)).toBe('16.67')
  })
})

describe('progress · 项目总进度（AC-P16）', () => {
  it('各阶段按阶段权重加权平均', () => {
    const stages = [
      { name: '开工准备', progress: '100.00', weight: 1 },
      { name: '水电工程', progress: '50.00', weight: 3 },
    ]
    // (100×1 + 50×3) ÷ 4 = 250 ÷ 4 = 62.5
    expect(progress.projectProgress(stages)).toBe('62.50')
  })

  it('AC-P16 未配置阶段权重时等权', () => {
    const stages = [
      { progress: '100.00', weight: null },
      { progress: '0.00', weight: null },
    ]
    expect(progress.projectProgress(stages)).toBe('50.00')
  })

  it('项目总进度读的是已落库的阶段 progress，不向下钻取工序', () => {
    // 这条约束保证「项目总进度」与「阶段详情」用同一份数据，
    // 两处各算一遍是进度对不上的经典来源
    const stages = [
      { progress: '65.00', weight: 1 },
      { progress: '35.00', weight: 1 },
    ]
    expect(progress.projectProgress(stages)).toBe('50.00')
  })
})

describe('progress · 输入校验（AC-P06）', () => {
  it('接受 0–100 且为 5 的整数倍的值', () => {
    for (const value of ['0', '5', '35', '65', '95', '100']) {
      expect(progress.validateProgress(value).ok).toBe(true)
    }
  })

  it('拒绝非 5 的整数倍（AC-P06 点名的 37）', () => {
    for (const value of ['1', '37', '99', '-5', '101', '105']) {
      expect(progress.validateProgress(value).ok).toBe(false)
    }
  })

  it('拒绝中文、字母与空值', () => {
    expect(progress.validateProgress('一半').ok).toBe(false)
    expect(progress.validateProgress('50%').ok).toBe(false)
    expect(progress.validateProgress('').ok).toBe(false)
    expect(progress.validateProgress(null).ok).toBe(false)
  })

  it('规范化输出为两位小数', () => {
    expect(progress.validateProgress('65')).toEqual({ ok: true, value: '65.00' })
  })

  it('拒绝小数形式的完成度（步进 5% 意味着只能是整数百分比）', () => {
    expect(progress.validateProgress('37.5').ok).toBe(false)
    expect(progress.validateProgress('5.0').ok).toBe(true)
  })
})

describe('progress · 权重规范化', () => {
  it('正数为有效权重', () => {
    expect(progress.normalizeWeight(1).toString()).toBe('1')
    expect(progress.normalizeWeight('2.5').toString()).toBe('2.5')
  })

  it('null / 0 / 负数 / 非数字都视为未配置', () => {
    for (const value of [null, undefined, '', 0, '0', -1, 'abc']) {
      expect(progress.normalizeWeight(value)).toBeNull()
    }
  })
})
