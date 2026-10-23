'use strict'

/**
 * 租户地区校验与名称派生。
 *
 * `regions.json` 由管理后台的 scripts/gen-geo-assets.mjs 生成，代码与名称
 * 与地图数据同源。API 只接收行政区划代码，名称一律在这里派生 ——
 * 否则前端可以提交「province_code=440000 + province_name=湖南省」这种
 * 代码与名称不一致的数据，看板按代码聚合、列表按名称展示，两边会对不上。
 *
 * 直辖市、香港、澳门、台湾：cityCode 等于 provinceCode。
 */

const AppError = require('./AppError')
const regions = require('../data/regions.json')

const provinceByCode = new Map()
const cityByProvinceAndCode = new Map()

for (const province of regions) {
  provinceByCode.set(province.code, province)
  const cityMap = new Map()
  for (const city of province.cities) cityMap.set(city.code, city)
  cityByProvinceAndCode.set(province.code, cityMap)
}

const CODE_PATTERN = /^\d{6}$/

function assertCode(value, label) {
  if (!CODE_PATTERN.test(String(value ?? ''))) {
    throw AppError.badRequest(`${label}代码应为 6 位数字`)
  }
}

function findProvince(code) {
  return provinceByCode.get(String(code ?? '')) || null
}

function findCity(provinceCode, cityCode) {
  const cities = cityByProvinceAndCode.get(String(provinceCode ?? ''))
  return cities ? cities.get(String(cityCode ?? '')) || null : null
}

/**
 * 新建租户：省、市都必填，且城市必须属于该省。
 * @returns {{provinceCode:string,provinceName:string,cityCode:string,cityName:string}}
 */
function resolveRegion({ provinceCode, cityCode } = {}) {
  assertCode(provinceCode, '省份')
  assertCode(cityCode, '城市')

  const province = findProvince(provinceCode)
  if (!province) throw AppError.badRequest('省份代码不存在')

  const city = findCity(province.code, cityCode)
  if (!city) throw AppError.badRequest('城市不属于所选省份')

  return {
    provinceCode: province.code,
    provinceName: province.name,
    cityCode: city.code,
    cityName: city.name,
  }
}

/**
 * 调整租户地区：
 * - 两个字段都没出现 → 不修改；
 * - 两个都显式传 null → 清空；
 * - 只传一个，或一个为空一个非空 → 400；
 * - 两个都传 → 按新建规则校验。
 *
 * 老租户没有地区，可以通过这里补录；新建租户必须走 resolveRegion。
 */
function resolveRegionUpdate(input = {}) {
  const hasProvince = Object.prototype.hasOwnProperty.call(input, 'provinceCode')
  const hasCity = Object.prototype.hasOwnProperty.call(input, 'cityCode')
  if (!hasProvince && !hasCity) return {}

  const provinceCode = input.provinceCode
  const cityCode = input.cityCode

  if (provinceCode == null && cityCode == null) {
    return {
      provinceCode: null,
      provinceName: null,
      cityCode: null,
      cityName: null,
    }
  }

  if (provinceCode == null || cityCode == null) {
    throw AppError.badRequest('省份和城市必须同时选择')
  }

  return resolveRegion({ provinceCode, cityCode })
}

module.exports = {
  findProvince,
  findCity,
  resolveRegion,
  resolveRegionUpdate,
}
