'use strict'

/**
 * 考察计划与路线规划（§4.6 / C-6.3 ~ C-6.12）。
 *
 * ── 两条必须守住的边界 ──
 * 1. 只有工长 / 监理能规划，并且只能规划自己 active 参与的项目（AC-N15/N16）。
 *    业主和管理员即使能看见项目，也不能进入这个模块。
 * 2. 地图服务是辅助能力，不是主流程。未配置 Key、超时、配额耗尽都必须
 *    降级成「按顺序列表 + 单点导航」，不能把用户挡在功能外面（AC-N12）。
 *
 * ── 距离口径 ──
 * 排序用球面距离（routeOptimizer），展示与落库的距离 / 耗时全部来自地图服务，
 * 并保证「总里程 = 各分段之和」（AC-N05）。降级时宁可不显示数字，也不编造里程。
 */

const crypto = require('node:crypto')
const AppError = require('../utils/AppError')
const config = require('../../config')
const cache = require('../cache')
const db = require('../db/pool')
const logger = require('../utils/logger')
const { optimizeOrder } = require('../utils/routeOptimizer')
const mapService = require('./map.service')
const sysConfigService = require('./sysConfig.service')
const routePlanModel = require('../models/routePlan.model')

const PLANNING_ROLES = new Set(['foreman', 'supervisor'])
const CACHE_TTL_SECONDS = 5 * 60
/** 与 sysConfig 的上限一致；配置被写坏时也不会把地图接口打出离谱的并发 */
const MAX_SAFETY_POINTS = 20
const LEG_CONCURRENCY = 3

async function assertPlanner(userId) {
  if (!(await routePlanModel.hasPlannerRole(userId))) {
    throw AppError.forbidden('仅工长与监理可规划考察路线')
  }
}

function normalizeOrigin(origin) {
  const latitude = Number(origin && origin.latitude)
  const longitude = Number(origin && origin.longitude)

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw AppError.badRequest('起点纬度不合法')
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw AppError.badRequest('起点经度不合法')
  }

  return {
    latitude,
    longitude,
    name: String((origin && origin.name) || '').trim().slice(0, 100) || '当前位置',
  }
}

async function maxPointsFor(tenantId) {
  const configured = await sysConfigService.getInt(tenantId ?? null, 'route_max_points')
  return Math.min(Math.max(configured, 2), MAX_SAFETY_POINTS)
}

/**
 * 跨租户路线取所有相关租户中的**最小值**。
 *
 * C 端用户可能同时属于多家装修公司（CLAUDE.md 第 74 条），而途经点上限是
 * 按租户配置的。取最小值可以保证不会因为 A 公司允许 20 个，就把 B 公司
 * 只允许 10 个的限制绕过去。
 */
async function maxPointsForProjects(projects) {
  const tenantIds = [...new Set(projects.map((project) => project.tenant_id))]
  const limits = await Promise.all(tenantIds.map((tenantId) => maxPointsFor(tenantId)))
  return Math.min(...limits)
}

/**
 * 校验项目归属、角色、坐标与数量，并按调用方传入的顺序返回。
 *
 * 404 与 403 的选择：C 端的项目可见性由 project_member 决定。不是成员时
 * 统一 403「只能规划自己参与的项目」，不暴露项目是否存在（AC-P26 同口径）。
 */
async function loadPlanningProjects(userId, rawProjectIds) {
  if (!Array.isArray(rawProjectIds) || rawProjectIds.length === 0) {
    throw AppError.badRequest('请至少选择一个工地')
  }

  const projectIds = rawProjectIds.map((id) => Number(id))
  if (projectIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw AppError.badRequest('项目 ID 不合法')
  }
  if (new Set(projectIds).size !== projectIds.length) {
    throw AppError.badRequest('同一个项目不能重复加入路线')
  }

  const rows = await routePlanModel.findRoutableProjects(userId, projectIds)
  if (rows.length !== projectIds.length) {
    throw AppError.forbidden('只能规划自己参与的项目')
  }

  if (rows.some((row) => !PLANNING_ROLES.has(row.role))) {
    throw AppError.forbidden('仅工长与监理可规划考察路线')
  }

  if (rows.some((row) => row.status === 'archived')) {
    throw AppError.badRequest('已归档项目不能加入考察路线')
  }

  const missingCoordinates = rows.filter((row) => row.longitude === null || row.latitude === null)
  if (missingCoordinates.length > 0) {
    throw AppError.badRequest(
      `以下项目尚未设置坐标：${missingCoordinates.map((row) => row.name).join('、')}。请联系管理员补全地址`
    )
  }

  const maxPoints = await maxPointsForProjects(rows)
  if (projectIds.length > maxPoints) {
    throw AppError.badRequest(`一次最多规划 ${maxPoints} 个途经点，请分批规划`)
  }

  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  return projectIds.map((id) => byId.get(id))
}

function toPoint(project, seq, distance = null, duration = null) {
  return {
    seq,
    projectId: Number(project.id),
    name: project.name,
    address: project.address,
    latitude: Number(project.latitude),
    longitude: Number(project.longitude),
    legDistance: distance,
    legDuration: duration,
  }
}

/** 有限并发地执行 leg 请求，所有错误收集后统一抛出，避免后台未处理的 rejection */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  const errors = []
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = await fn(items[index], index)
      } catch (err) {
        errors.push(err)
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  if (errors.length > 0) throw errors[0]
  return results
}

function degradedRoute(origin, projects, reason) {
  return {
    origin,
    points: projects.map((project, index) => toPoint(project, index + 1)),
    totalDistance: null,
    totalDuration: null,
    originLegDistance: null,
    originLegDuration: null,
    polyline: [],
    degraded: true,
    degradedReason: reason,
  }
}

/**
 * 按给定顺序请求地图服务。第一段的起点是用户起点，后续每段的起点是上一站。
 */
async function buildRoute(origin, projects) {
  if (projects.length === 0) {
    return {
      origin,
      points: [],
      totalDistance: 0,
      totalDuration: 0,
      originLegDistance: 0,
      originLegDuration: 0,
      polyline: [],
      degraded: false,
      degradedReason: null,
    }
  }

  try {
    const legs = projects.map((project, index) => ({
      from: index === 0 ? origin : projects[index - 1],
      to: project,
    }))
    const legResults = await mapLimit(legs, LEG_CONCURRENCY, (leg) =>
      mapService.drivingRoute(leg.from, leg.to)
    )

    let totalDistance = 0
    let totalDuration = 0
    const polyline = []
    let lastPoint = null

    for (const leg of legResults) {
      totalDistance += leg.distance
      totalDuration += leg.duration
      for (const point of leg.polyline || []) {
        if (
          lastPoint &&
          lastPoint.latitude === point.latitude &&
          lastPoint.longitude === point.longitude
        ) {
          continue
        }
        lastPoint = point
        polyline.push(point)
      }
    }

    return {
      origin,
      // 首站没有「上一站」，分段里程为 null；从第二站开始才展示分段数据
      points: projects.map((project, index) =>
        toPoint(
          project,
          index + 1,
          index === 0 ? null : legResults[index].distance,
          index === 0 ? null : legResults[index].duration
        )
      ),
      totalDistance,
      totalDuration,
      // 首站没有「上一站」，这段单独保存；列表里显示为「从起点出发 X km」
      originLegDistance: legResults[0].distance,
      originLegDuration: legResults[0].duration,
      polyline,
      degraded: false,
      degradedReason: null,
    }
  } catch (err) {
    // 不把第三方错误直接回给用户，也不记录起点 / 终点坐标
    logger.warn('路线规划失败，降级为按顺序单点导航', {
      message: err.message,
      provider: config.map.provider,
      projectCount: projects.length,
    })
    return degradedRoute(origin, projects, '地图服务暂时不可用，已改为按选择顺序逐点导航')
  }
}

function buildPlanHash({ origin, projects, optimize }) {
  const payload = {
    version: 1,
    provider: config.map.routingEnabled ? 'amap' : 'none',
    optimize: Boolean(optimize),
    origin: [Number(origin.longitude).toFixed(7), Number(origin.latitude).toFixed(7)],
    points: projects.map((project) => ({
      id: Number(project.id),
      latitude: Number(project.latitude).toFixed(7),
      longitude: Number(project.longitude).toFixed(7),
    })),
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function preview(userId, input) {
  const projects = await loadPlanningProjects(userId, input.projectIds)
  const origin = normalizeOrigin(input.origin)
  const optimize = input.optimize !== false
  const ordered = optimize ? optimizeOrder(origin, projects) : projects
  const planHash = buildPlanHash({ origin, projects: ordered, optimize })
  const cacheKey = `route-plan:preview:${planHash}`
  const maxPoints = await maxPointsForProjects(projects)

  try {
    const cached = await cache.get(cacheKey)
    if (cached) {
      // 起点名称只是展示文案，不参与 plan_hash；命中缓存时用本次请求的名称覆盖，
      // 否则用户选了「公司」却看到上次缓存的「当前位置」
      return {
        ...cached,
        origin: { ...cached.origin, name: origin.name },
        maxPoints,
        cached: true,
      }
    }
  } catch (err) {
    // 缓存不可用只是少一次优化，不影响路线规划本身
    logger.debug('路线缓存读取失败', { message: err.message })
  }

  const route = await buildRoute(origin, ordered)
  const payload = { ...route, planHash, maxPoints, cached: false }

  if (!route.degraded) {
    try {
      await cache.set(cacheKey, { ...payload, cached: false }, CACHE_TTL_SECONDS)
    } catch (err) {
      logger.debug('路线缓存写入失败', { message: err.message })
    }
  }

  return payload
}

async function save(userId, input) {
  const projects = await loadPlanningProjects(userId, input.projectIds)
  const origin = normalizeOrigin(input.origin)
  const originType = input.originType === 'custom' ? 'custom' : 'current'
  const route = await buildRoute(origin, projects)
  const planHash = buildPlanHash({ origin, projects, optimize: false })

  const planId = await db.withTransaction(async (tx) => {
    const id = await routePlanModel.createPlan(
      {
        // M13 的 route_plan.tenant_id 为 NOT NULL。路线方案是个人资产，
        // 不参与后台租户数据浏览；归属取首个途经项目的租户。
        // 跨租户项目允许出现在同一路线里（C 端用户可跨租户，CLAUDE.md 第 74 条），
        // 因为读取始终以 owner_id 为准，不会因此串到别人的租户视图。
        tenantId: projects[0].tenant_id,
        ownerId: userId,
        name: input.name,
        originType,
        originLat: origin.latitude,
        originLng: origin.longitude,
        originName: origin.name,
        pointCount: route.points.length,
        totalDistance: route.totalDistance,
        totalDuration: route.totalDuration,
        originLegDistance: route.originLegDistance,
        originLegDuration: route.originLegDuration,
        planHash,
        pathJson: route.polyline.length > 0 ? JSON.stringify(route.polyline) : null,
      },
      tx
    )

    await routePlanModel.createPoints(id, route.points, tx)
    return id
  })

  return detail(userId, planId)
}

function sameCoordinate(left, right) {
  const a = Number(left)
  const b = Number(right)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  // 坐标按 DECIMAL(10,7) 存储，1e-7 约等于 1cm；比这更小的变化没有业务意义
  return Math.abs(a - b) < 1e-7
}

function evaluateStale(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { stale: true, reason: '路线方案缺少途经点' }
  }

  for (const point of points) {
    if (point.project_deleted_at || point.project_name === null) {
      return { stale: true, reason: '途经项目已不可用' }
    }
    if (point.current_longitude === null || point.current_latitude === null) {
      return { stale: true, reason: '项目坐标已变更，需重新规划' }
    }
    if (
      !sameCoordinate(point.longitude, point.current_longitude) ||
      !sameCoordinate(point.latitude, point.current_latitude)
    ) {
      return { stale: true, reason: '项目坐标已变更，需重新规划' }
    }
  }

  return { stale: false, reason: null }
}

function parsePath(pathJson) {
  if (!pathJson) return []
  try {
    const parsed = JSON.parse(pathJson)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (point) =>
        point &&
        Number.isFinite(Number(point.latitude)) &&
        Number.isFinite(Number(point.longitude))
    )
  } catch {
    return []
  }
}

function planPoints(points) {
  return points.map((point) => ({
    seq: Number(point.seq),
    projectId: Number(point.project_id),
    name: point.project_name || '项目已不可用',
    address: point.address || '',
    // 这是规划时的坐标快照，用于和当前坐标比较；导航优先用 current*
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    currentLatitude: point.current_latitude === null ? null : Number(point.current_latitude),
    currentLongitude: point.current_longitude === null ? null : Number(point.current_longitude),
    legDistance: point.leg_distance === null ? null : Number(point.leg_distance),
    legDuration: point.leg_duration === null ? null : Number(point.leg_duration),
    visitedAt: point.visited_at,
  }))
}

function summarizePlan(plan, points) {
  const stale = evaluateStale(points)
  return {
    id: Number(plan.id),
    name: plan.name,
    originType: plan.origin_type,
    originName: plan.origin_name,
    pointCount: Number(plan.point_count),
    totalDistance: plan.total_distance === null ? null : Number(plan.total_distance),
    totalDuration: plan.total_duration === null ? null : Number(plan.total_duration),
    originLegDistance:
      plan.origin_leg_distance === undefined || plan.origin_leg_distance === null
        ? null
        : Number(plan.origin_leg_distance),
    originLegDuration:
      plan.origin_leg_duration === undefined || plan.origin_leg_duration === null
        ? null
        : Number(plan.origin_leg_duration),
    visitedCount: points.filter((point) => point.visited_at).length,
    stale: stale.stale,
    staleReason: stale.reason,
    createdAt: plan.created_at,
  }
}

async function list(userId, { paging, tenantId }) {
  await assertPlanner(userId)
  const { total, rows } = await routePlanModel.listByOwner(userId, paging)
  const pointRows = await routePlanModel.findPointsByPlanIds(rows.map((row) => row.id))
  const byPlan = new Map()
  for (const point of pointRows) {
    if (!byPlan.has(point.route_plan_id)) byPlan.set(point.route_plan_id, [])
    byPlan.get(point.route_plan_id).push(point)
  }

  const listItems = rows.map((plan) => {
    const points = byPlan.get(plan.id) || []
    return {
      ...summarizePlan(plan, points),
      points: points.map((point) => ({
        seq: Number(point.seq),
        projectId: Number(point.project_id),
        name: point.project_name || '项目已不可用',
      })),
    }
  })

  return {
    list: listItems,
    total,
    page: paging.page,
    pageSize: paging.pageSize,
    totalPages: paging.pageSize > 0 ? Math.ceil(total / paging.pageSize) : 0,
    maxPoints: await maxPointsFor(tenantId),
  }
}

async function detail(userId, planId) {
  await assertPlanner(userId)
  const plan = await routePlanModel.findByIdForOwner(planId, userId)
  if (!plan) throw AppError.notFound('考察计划不存在')

  const points = await routePlanModel.findPointsByPlanId(plan.id)
  const stale = evaluateStale(points)
  if (stale.stale && !plan.stale_at) {
    try {
      await routePlanModel.markStale(plan.id)
    } catch (err) {
      // 标记失效失败不应影响读取；下次打开会再次检测
      logger.warn('标记考察计划失效失败', { planId: plan.id, message: err.message })
    }
  }

  return {
    id: Number(plan.id),
    name: plan.name,
    origin: {
      type: plan.origin_type,
      latitude: plan.origin_lat === null ? null : Number(plan.origin_lat),
      longitude: plan.origin_lng === null ? null : Number(plan.origin_lng),
      name: plan.origin_name,
    },
    pointCount: Number(plan.point_count),
    totalDistance: plan.total_distance === null ? null : Number(plan.total_distance),
    totalDuration: plan.total_duration === null ? null : Number(plan.total_duration),
    originLegDistance:
      plan.origin_leg_distance === null ? null : Number(plan.origin_leg_distance),
    originLegDuration:
      plan.origin_leg_duration === null ? null : Number(plan.origin_leg_duration),
    visitedCount: points.filter((point) => point.visited_at).length,
    degraded: plan.total_distance === null,
    stale: stale.stale,
    staleReason: stale.reason,
    // 旧折线对应旧坐标，标记失效后不返回，避免用户误以为路线仍然有效
    path: stale.stale ? [] : parsePath(plan.path_json),
    points: planPoints(points),
    createdAt: plan.created_at,
    updatedAt: plan.updated_at,
  }
}

async function remove(userId, planId) {
  await assertPlanner(userId)
  const plan = await routePlanModel.findByIdForOwner(planId, userId)
  if (!plan) throw AppError.notFound('考察计划不存在')

  await routePlanModel.softDelete(planId, userId)
  return { id: Number(planId), deleted: true }
}

module.exports = {
  preview,
  save,
  list,
  detail,
  remove,
  // 供单测直接验证，不对外暴露为接口
  _buildPlanHash: buildPlanHash,
  _evaluateStale: evaluateStale,
}
