'use strict'

/**
 * 现场签到纯函数单测（C-6.13 ~ C-6.20）。
 *
 * 这里刻意只测「不碰数据库、不碰文件」的三处：
 * 坐标范围、阈值边界、水印文案。它们一旦写错，表现分别是脏数据落库、
 * 正常签到被误判异常、水印无法说明照片来自哪个工地。
 */

const visit = require('../../src/utils/visit')

describe('visit · 坐标校验（AC-N17 / AC-N28）', () => {
  it('接受数字与数字字符串，并归一化为 number', () => {
    const result = visit.normalizeCoordinates({ latitude: '31.2304', longitude: 121.4737 })
    expect(result).toEqual({ latitude: 31.2304, longitude: 121.4737 })
  })

  it('拒绝缺失、空串、NaN', () => {
    for (const input of [
      {},
      { latitude: null, longitude: 121 },
      { latitude: '', longitude: 121 },
      { latitude: 'abc', longitude: 121 },
      { latitude: 31, longitude: undefined },
    ]) {
      expect(() => visit.normalizeCoordinates(input)).toThrow('无法获取当前位置')
    }
  })

  it('拒绝越界坐标', () => {
    expect(() => visit.normalizeCoordinates({ latitude: 91, longitude: 0 })).toThrow('纬度')
    expect(() => visit.normalizeCoordinates({ latitude: -91, longitude: 0 })).toThrow('纬度')
    expect(() => visit.normalizeCoordinates({ latitude: 0, longitude: 181 })).toThrow('经度')
    expect(() => visit.normalizeCoordinates({ latitude: 0, longitude: -181 })).toThrow('经度')
  })
})

describe('visit · 阈值判定（AC-N19）', () => {
  it('小于阈值是正常', () => {
    expect(visit.isAbnormalDistance(499.99, 500)).toBe(false)
  })

  it('等于阈值是正常（边界值不能被 >= 误判）', () => {
    expect(visit.isAbnormalDistance(500, 500)).toBe(false)
  })

  it('严格大于阈值才是异常', () => {
    expect(visit.isAbnormalDistance(500.01, 500)).toBe(true)
    expect(visit.isAbnormalDistance(1200, 500)).toBe(true)
  })

  it('非数字返回 false，不抛错', () => {
    expect(visit.isAbnormalDistance('abc', 500)).toBe(false)
    expect(visit.isAbnormalDistance(100, null)).toBe(false)
  })
})

describe('visit · 水印文案（AC-N18）', () => {
  it('包含签到时间、实时位置、项目地址与坐标', () => {
    const lines = visit.buildWatermarkLines({
      checkinAt: '2026-10-24 09:31:12',
      address: '上海市浦东新区世纪大道 100 号',
      locationAddress: '上海市浦东新区世纪大道 88 号附近',
      latitude: 31.2304,
      longitude: 121.4737,
    })

    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('2026-10-24 09:31:12')
    expect(lines[1]).toBe('签到位置：上海市浦东新区世纪大道 88 号附近')
    expect(lines[2]).toBe('项目地址：上海市浦东新区世纪大道 100 号')
    expect(lines[3]).toBe('坐标 31.230400, 121.473700')
  })

  it('地址为空时给出可读兜底，不编造实时地址', () => {
    const lines = visit.buildWatermarkLines({
      checkinAt: '2026-10-24 09:31:12',
      address: '   ',
      latitude: 31.2304,
      longitude: 121.4737,
    })
    expect(lines[1]).toBe('签到位置：实时地址未解析')
    expect(lines[2]).toBe('项目地址：项目地址未填写')
  })
})

describe('visit · 扩展名提取', () => {
  it('从 URL / key 中提取允许的图片扩展名', () => {
    expect(visit.extractExtension('https://x/uploads/visits/a.JPG')).toBe('jpg')
    expect(visit.extractExtension('visits/2026/10/24/a.png')).toBe('png')
    expect(visit.extractExtension('https://x/a.webp?x=1')).toBe('webp')
  })

  it('未知扩展名回落到 jpg', () => {
    expect(visit.extractExtension('')).toBe('jpg')
    expect(visit.extractExtension('https://x/a.exe')).toBe('jpg')
    expect(visit.extractExtension(null)).toBe('jpg')
  })
})
