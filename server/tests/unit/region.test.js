'use strict'

/**
 * 租户地区校验（平台看板的数据基础）。
 *
 * 重点不是「能解析一个省」，而是代码与名称只能由服务端派生：
 * 前端传代码和名称不一致时，不能出现「按代码聚合、按名称展示」两边对不上。
 */

const region = require('../../src/utils/region')
const regions = require('../../src/data/regions.json')

describe('地区数据集', () => {
  it('包含 34 个省级行政区，代码唯一', () => {
    expect(regions).toHaveLength(34)
    expect(new Set(regions.map((row) => row.code)).size).toBe(34)
  })

  it('每个城市代码属于所属省份，且省内代码唯一', () => {
    for (const province of regions) {
      const codes = new Set()
      expect(province.name).toBeTruthy()
      expect(province.cities.length).toBeGreaterThan(0)

      for (const city of province.cities) {
        expect(city.code).toMatch(/^\d{6}$/)
        expect(city.code.startsWith(province.code.slice(0, 2))).toBe(true)
        expect(codes.has(city.code)).toBe(false)
        codes.add(city.code)
      }
    }
  })
})

describe('resolveRegion 新建地区', () => {
  it('解析省份与城市名称', () => {
    expect(region.resolveRegion({ provinceCode: '330000', cityCode: '330100' })).toEqual({
      provinceCode: '330000',
      provinceName: '浙江省',
      cityCode: '330100',
      cityName: '杭州市',
    })
  })

  it('直辖市的城市代码等于省级代码', () => {
    expect(region.resolveRegion({ provinceCode: '110000', cityCode: '110000' })).toEqual({
      provinceCode: '110000',
      provinceName: '北京市',
      cityCode: '110000',
      cityName: '北京市',
    })
  })

  it('拒绝未知省份、跨省城市与非法代码', () => {
    expect(() => region.resolveRegion({ provinceCode: '990000', cityCode: '990100' })).toThrow(
      '省份代码不存在'
    )
    expect(() => region.resolveRegion({ provinceCode: '330000', cityCode: '440100' })).toThrow(
      '城市不属于所选省份'
    )
    expect(() => region.resolveRegion({ provinceCode: '33', cityCode: '330100' })).toThrow(
      '省份代码应为 6 位数字'
    )
  })
})

describe('resolveRegionUpdate 修改地区', () => {
  it('未传字段表示不修改', () => {
    expect(region.resolveRegionUpdate({})).toEqual({})
  })

  it('省市都传 null 表示清空', () => {
    expect(region.resolveRegionUpdate({ provinceCode: null, cityCode: null })).toEqual({
      provinceCode: null,
      provinceName: null,
      cityCode: null,
      cityName: null,
    })
  })

  it('只传省或只传市拒绝', () => {
    expect(() => region.resolveRegionUpdate({ provinceCode: '330000' })).toThrow(
      '省份和城市必须同时选择'
    )
    expect(() => region.resolveRegionUpdate({ cityCode: '330100' })).toThrow(
      '省份和城市必须同时选择'
    )
  })
})
