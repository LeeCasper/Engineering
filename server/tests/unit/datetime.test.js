'use strict'

/**
 * 时间工具单测。
 *
 * 重点验证「时区被钉死在 Asia/Shanghai」这一条 ——
 * AC-P23（连续 3 个自然日未汇报）、AC-N25（当日重复签到）都依赖自然日判定，
 * 一旦判定掺进时区歧义，就会出现跨零点算错一天的问题。
 */

const dt = require('../../src/utils/datetime')

describe('datetime · 时区固定为 Asia/Shanghai', () => {
  it('无论进程 TZ 是什么，解析结果都按东八区解释', () => {
    const parsed = dt.parse('2026-01-01 08:00:00')
    expect(parsed.format('YYYY-MM-DD HH:mm:ss')).toBe('2026-01-01 08:00:00')
    expect(parsed.utcOffset()).toBe(8 * 60)
  })

  it('带时区信息的输入会换算到东八区', () => {
    // UTC 00:00 = 北京时间 08:00
    const parsed = dt.parse('2026-01-01T00:00:00Z')
    expect(parsed.format('YYYY-MM-DD HH:mm:ss')).toBe('2026-01-01 08:00:00')
  })

  it('format 输出需求文档 §7.1 约定的格式', () => {
    expect(dt.format('2026-01-01 08:00:00')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('非法输入返回 null 而不是抛错或产生 Invalid Date', () => {
    expect(dt.parse('不是时间')).toBeNull()
    expect(dt.format('不是时间')).toBeNull()
    expect(dt.formatDate('')).toBeNull()
  })
})

describe('datetime · 自然日差值（AC-P23 连续 3 天未汇报）', () => {
  it('按自然日算，不是按 24 小时算', () => {
    // 相隔仅 2 小时，但跨了一天 —— 必须算 1 天
    expect(dt.diffCalendarDays('2026-01-01 23:00:00', '2026-01-02 01:00:00')).toBe(1)
  })

  it('同一天内任何时刻差值为 0', () => {
    expect(dt.diffCalendarDays('2026-01-01 00:01:00', '2026-01-01 23:59:00')).toBe(0)
  })

  it('正好 3 个自然日', () => {
    expect(dt.diffCalendarDays('2026-01-01 09:00:00', '2026-01-04 09:00:00')).toBe(3)
  })

  it('跨月跨年正确', () => {
    expect(dt.diffCalendarDays('2026-01-31 10:00:00', '2026-02-02 10:00:00')).toBe(2)
    expect(dt.diffCalendarDays('2026-12-31 10:00:00', '2027-01-01 10:00:00')).toBe(1)
  })

  it('参数非法返回 NaN，便于调用方显式判断', () => {
    expect(Number.isNaN(dt.diffCalendarDays('坏数据', '2026-01-01'))).toBe(true)
  })
})

describe('datetime · 小时差（AC-A22 验收超时 48 小时）', () => {
  it('精确到小时，带小数', () => {
    expect(dt.diffHours('2026-01-01 00:00:00', '2026-01-03 00:00:00')).toBe(48)
    expect(dt.diffHours('2026-01-01 00:00:00', '2026-01-01 12:30:00')).toBe(12.5)
  })
})

describe('datetime · 同日判定（AC-N25 当日重复签到）', () => {
  it('同一天不同时刻为真', () => {
    expect(dt.isSameDay('2026-01-01 00:00:01', '2026-01-01 23:59:59')).toBe(true)
  })

  it('跨零点即为假', () => {
    expect(dt.isSameDay('2026-01-01 23:59:59', '2026-01-02 00:00:00')).toBe(false)
  })
})

describe('datetime · 日期计算与时长解析', () => {
  it('addDays 按日期加减', () => {
    expect(dt.addDays('2026-01-30', 3)).toBe('2026-02-02')
    expect(dt.addDays('2026-01-01', 0)).toBe('2026-01-01')
  })

  it('parseDurationMs 支持 ms/s/m/h/d', () => {
    expect(dt.parseDurationMs('30m')).toBe(1_800_000)
    expect(dt.parseDurationMs('8h')).toBe(28_800_000)
    expect(dt.parseDurationMs('7d')).toBe(604_800_000)
    expect(dt.parseDurationMs(5000)).toBe(5000)
  })

  it('parseDurationMs 无法识别时回落默认值', () => {
    expect(dt.parseDurationMs('半小时', 123)).toBe(123)
    expect(dt.parseDurationMs(null, 456)).toBe(456)
  })
})
