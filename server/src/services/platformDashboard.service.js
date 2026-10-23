'use strict'

/**
 * 平台运营数据看板。
 *
 * 只返回租户级运营信息（状态、套餐、项目/账号用量、开通时间），
 * 不读取租户合同金额、业主人身信息或任何业务明细。
 */

const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const region = require('../utils/region')
const dashboardModel = require('../models/platformDashboard.model')
const tenantService = require('./tenant.service')

const STATUS_KEYS = ['active', 'suspended', 'archived']

function monthRange() {
  const now = datetime.now()
  return {
    month: now.format('YYYY-MM'),
    start: now.startOf('month').format(datetime.DATETIME_FORMAT),
    end: now.add(1, 'month').startOf('month').format(datetime.DATETIME_FORMAT),
  }
}

function blankSummary() {
  return {
    tenantCount: 0,
    activeCount: 0,
    suspendedCount: 0,
    archivedCount: 0,
    newThisMonthCount: 0,
    projectCount: 0,
    adminCount: 0,
    planCountMap: new Map(),
  }
}

function addRow(summary, row, range) {
  summary.tenantCount += 1
  if (STATUS_KEYS.includes(row.status)) {
    summary[`${row.status}Count`] += 1
  }
  const createdAt = datetime.format(row.created_at)
  if (createdAt && createdAt >= range.start && createdAt < range.end) {
    summary.newThisMonthCount += 1
  }
  summary.projectCount += Number(row.project_count || 0)
  summary.adminCount += Number(row.admin_count || 0)
  const plan = row.plan || '未设置'
  summary.planCountMap.set(plan, (summary.planCountMap.get(plan) || 0) + 1)
}

function finalizeSummary(summary) {
  const { planCountMap, ...rest } = summary
  return {
    ...rest,
    planCounts: [...planCountMap.entries()]
      .map(([plan, count]) => ({ plan, count }))
      .sort((a, b) => b.count - a.count || a.plan.localeCompare(b.plan)),
  }
}

function summarize(rows, range) {
  const summary = blankSummary()
  for (const row of rows) addRow(summary, row, range)
  return finalizeSummary(summary)
}

function groupByProvince(rows, range) {
  const groups = new Map()
  for (const row of rows) {
    if (!row.province_code) continue
    let group = groups.get(row.province_code)
    if (!group) {
      group = {
        provinceCode: row.province_code,
        provinceName: row.province_name,
        summary: blankSummary(),
      }
      groups.set(row.province_code, group)
    }
    addRow(group.summary, row, range)
  }

  return [...groups.values()]
    .map((group) => ({
      provinceCode: group.provinceCode,
      provinceName: group.provinceName,
      ...finalizeSummary(group.summary),
    }))
    .sort((a, b) => b.tenantCount - a.tenantCount || a.provinceCode.localeCompare(b.provinceCode))
}

function groupByCity(rows, range) {
  const groups = new Map()
  for (const row of rows) {
    if (!row.province_code || !row.city_code) continue
    const key = `${row.province_code}:${row.city_code}`
    let group = groups.get(key)
    if (!group) {
      group = {
        provinceCode: row.province_code,
        provinceName: row.province_name,
        cityCode: row.city_code,
        cityName: row.city_name,
        summary: blankSummary(),
      }
      groups.set(key, group)
    }
    addRow(group.summary, row, range)
  }

  return [...groups.values()]
    .map((group) => ({
      provinceCode: group.provinceCode,
      provinceName: group.provinceName,
      cityCode: group.cityCode,
      cityName: group.cityName,
      ...finalizeSummary(group.summary),
    }))
    .sort((a, b) => b.tenantCount - a.tenantCount || a.cityCode.localeCompare(b.cityCode))
}

function sumUnassignedCity(rows, range) {
  const matched = rows.filter((row) => !row.city_code)
  if (!matched.length) return null
  return summarize(matched, range)
}

async function overview() {
  const range = monthRange()
  const rows = await dashboardModel.tenantStats()
  const unassignedRows = rows.filter((row) => !row.province_code)

  return {
    month: range.month,
    summary: {
      ...summarize(rows, range),
      regionUnsetCount: unassignedRows.length,
    },
    provinces: groupByProvince(rows, range),
    unassigned: summarize(unassignedRows, range),
  }
}

function assertProvince(provinceCode) {
  const province = region.findProvince(provinceCode)
  if (!province) throw AppError.badRequest('省份代码不存在')
  return province
}

function assertCity(provinceCode, cityCode) {
  const province = assertProvince(provinceCode)
  const city = region.findCity(provinceCode, cityCode)
  if (!city) throw AppError.badRequest('城市不属于所选省份')
  return { province, city }
}

async function regionDetail({ provinceCode, cityCode, unassigned } = {}) {
  const range = monthRange()

  if (unassigned) {
    const rows = await dashboardModel.tenantStats({ unassigned: true })
    return {
      month: range.month,
      scope: {
        level: 'unassigned',
        provinceCode: null,
        provinceName: null,
        cityCode: null,
        cityName: null,
      },
      summary: summarize(rows, range),
      cities: [],
      unassignedCity: null,
    }
  }

  if (cityCode) {
    if (!provinceCode) throw AppError.badRequest('请选择省份')
    const { province, city } = assertCity(provinceCode, cityCode)
    const rows = await dashboardModel.tenantStats({ provinceCode, cityCode })
    return {
      month: range.month,
      scope: {
        level: 'city',
        provinceCode: province.code,
        provinceName: province.name,
        cityCode: city.code,
        cityName: city.name,
      },
      summary: summarize(rows, range),
      cities: [],
      unassignedCity: null,
    }
  }

  if (!provinceCode) {
    throw AppError.badRequest('请选择省份，或查看未分配地区')
  }

  const province = assertProvince(provinceCode)
  const rows = await dashboardModel.tenantStats({ provinceCode })
  return {
    month: range.month,
    scope: {
      level: 'province',
      provinceCode: province.code,
      provinceName: province.name,
      cityCode: null,
      cityName: null,
    },
    summary: summarize(rows, range),
    cities: groupByCity(rows, range),
    unassignedCity: sumUnassignedCity(rows, range),
  }
}

async function tenants(operator, query, paging) {
  return tenantService.list(operator, query, paging)
}

module.exports = {
  overview,
  regionDetail,
  tenants,
}
