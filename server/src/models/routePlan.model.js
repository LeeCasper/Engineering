'use strict'

/**
 * route_plan / route_plan_point 数据访问层（§4.6）。
 *
 * 只提供「属于本人」的读取与写入：考察计划是个人资产，不跨用户共享。
 * 所有方法都显式带 `owner_id`，避免某个入口忘了加过滤条件导致越权。
 */

const db = require('../db/pool')

/** 列表字段。path_json 不取 —— 列表不需要折线，省一次大字段 IO */
const PLAN_COLUMNS = `
  rp.id, rp.owner_id, rp.name, rp.origin_type, rp.origin_lat, rp.origin_lng,
  rp.origin_name, rp.point_count, rp.total_distance, rp.total_duration,
  rp.origin_leg_distance, rp.origin_leg_duration,
  rp.plan_hash, rp.stale_at, rp.created_at, rp.updated_at
`

const DETAIL_COLUMNS = `${PLAN_COLUMNS}, rp.path_json`

/**
 * 路线规划可用的项目。只返回当前用户是 active 成员的项目，
 * 以及项目当前的坐标；角色判断交给 service（需要区分 owner 与 admin 的提示）。
 */
/**
 * 当前用户是否至少有一个「工长 / 监理」身份。
 *
 * 用于列表 / 详情 / 删除这类没有 projectId 的入口：需求 AC-N15 要求业主和管理员
 * 访问路线规划返回 403，而不是拿到一个空列表。归档项目上的历史身份不计入 ——
 * 那些项目已经不能参与规划，不应该成为绕过拦截的依据。
 */
async function hasPlannerRole(userId) {
  const row = await db.queryOne(
    `SELECT 1 AS ok
       FROM project_member pm
       JOIN project p ON p.id = pm.project_id AND p.deleted_at IS NULL AND p.status <> 'archived'
      WHERE pm.user_id = ? AND pm.role IN ('foreman', 'supervisor')
        AND pm.status = 'active' AND pm.deleted_at IS NULL
      LIMIT 1`,
    [userId]
  )
  return Boolean(row)
}

async function findRoutableProjects(userId, projectIds) {
  if (!Array.isArray(projectIds) || projectIds.length === 0) return []
  const placeholders = projectIds.map(() => '?').join(', ')

  return db.query(
    `SELECT p.id, p.tenant_id, p.name, p.address, p.status,
            p.longitude, p.latitude, pm.role
       FROM project p
       JOIN project_member pm
         ON pm.project_id = p.id AND pm.user_id = ?
        AND pm.status = 'active' AND pm.deleted_at IS NULL
      WHERE p.id IN (${placeholders}) AND p.deleted_at IS NULL`,
    [userId, ...projectIds]
  )
}

async function createPlan(data, tx = db) {
  const result = await tx.query(
    `INSERT INTO route_plan
       (tenant_id, owner_id, name, origin_type, origin_lat, origin_lng, origin_name,
        point_count, total_distance, total_duration, origin_leg_distance,
        origin_leg_duration, plan_hash, path_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      // route_plan 在 M13 加了 NOT NULL tenant_id。路线方案是个人资产，
      // 但多租户结构要求根对象有归属；以首个途经项目的租户为准（见 service 的说明）
      data.tenantId,
      data.ownerId,
      data.name,
      data.originType,
      data.originLat,
      data.originLng,
      data.originName ?? null,
      data.pointCount,
      data.totalDistance ?? null,
      data.totalDuration ?? null,
      data.originLegDistance ?? null,
      data.originLegDuration ?? null,
      data.planHash,
      data.pathJson ?? null,
    ]
  )
  return result.insertId
}

async function createPoints(planId, points, tx = db) {
  if (!Array.isArray(points) || points.length === 0) return
  const placeholders = points.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')
  const params = []

  for (const point of points) {
    params.push(
      planId,
      point.seq,
      point.projectId,
      point.latitude,
      point.longitude,
      point.legDistance ?? null,
      point.legDuration ?? null
    )
  }

  await tx.query(
    `INSERT INTO route_plan_point
       (route_plan_id, seq, project_id, latitude, longitude, leg_distance, leg_duration)
     VALUES ${placeholders}`,
    params
  )
}

async function listByOwner(ownerId, { offset, limit }) {
  const total = await db.count(
    'FROM route_plan rp WHERE rp.owner_id = ? AND rp.deleted_at IS NULL',
    [ownerId]
  )
  const rows = await db.query(
    `SELECT ${PLAN_COLUMNS}
       FROM route_plan rp
      WHERE rp.owner_id = ? AND rp.deleted_at IS NULL
      ORDER BY rp.created_at DESC, rp.id DESC
      LIMIT ? OFFSET ?`,
    [ownerId, limit, offset]
  )
  return { total, rows }
}

async function findByIdForOwner(id, ownerId) {
  return db.queryOne(
    `SELECT ${DETAIL_COLUMNS}
       FROM route_plan rp
      WHERE rp.id = ? AND rp.owner_id = ? AND rp.deleted_at IS NULL`,
    [id, ownerId]
  )
}

/**
 * 批量取途经点 + 项目当前坐标。
 *
 * `p` 用 LEFT JOIN：项目被删除后仍能取到路线点，由 service 判为「需重新规划」，
 * 而不是让整条计划凭空消失。
 */
async function findPointsByPlanIds(planIds) {
  if (!Array.isArray(planIds) || planIds.length === 0) return []
  const placeholders = planIds.map(() => '?').join(', ')

  return db.query(
    `SELECT rpp.id, rpp.route_plan_id, rpp.seq, rpp.project_id,
            rpp.latitude, rpp.longitude, rpp.leg_distance, rpp.leg_duration,
            rpp.visited_at,
            p.name AS project_name, p.address, p.status AS project_status,
            p.longitude AS current_longitude, p.latitude AS current_latitude,
            p.deleted_at AS project_deleted_at
       FROM route_plan_point rpp
       LEFT JOIN project p ON p.id = rpp.project_id
      WHERE rpp.route_plan_id IN (${placeholders}) AND rpp.deleted_at IS NULL
      ORDER BY rpp.route_plan_id, rpp.seq`,
    planIds
  )
}

async function findPointsByPlanId(planId) {
  const rows = await findPointsByPlanIds([planId])
  return rows
}

/**
 * 取某个考察计划中的指定站点，并校验方案属于本人。
 *
 * 供现场签到使用：只有从自己的考察计划发起的签到才能回填 `visited_at`，
 * 不能让用户拿别人的 planId 把别人的「已考察」点亮。
 */
async function findOwnedPoint({ planId, ownerId, seq }) {
  return db.queryOne(
    `SELECT rpp.id, rpp.route_plan_id, rpp.seq, rpp.project_id, rpp.visited_at
       FROM route_plan_point rpp
       JOIN route_plan rp ON rp.id = rpp.route_plan_id
      WHERE rpp.route_plan_id = ? AND rpp.seq = ?
        AND rp.owner_id = ? AND rp.deleted_at IS NULL
        AND rpp.deleted_at IS NULL`,
    [planId, seq, ownerId]
  )
}

/**
 * 签到成功后回填途经点的「已考察」时间。
 *
 * 条件里带 `visited_at IS NULL`：同一站点重复签到（不同日期）时保留第一次
 * 到达时间，不让后一次覆盖。返回 0 表示已经考察过，不是错误。
 */
async function markPointVisited({ planId, seq, projectId, visitedAt }, tx = db) {
  const result = await tx.query(
    `UPDATE route_plan_point
        SET visited_at = ?
      WHERE route_plan_id = ? AND seq = ? AND project_id = ?
        AND visited_at IS NULL AND deleted_at IS NULL`,
    [visitedAt, planId, seq, projectId]
  )
  return result.affectedRows
}

async function softDelete(id, ownerId, tx = db) {
  const result = await tx.query(
    'UPDATE route_plan SET deleted_at = NOW() WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
    [id, ownerId]
  )
  if (result.affectedRows > 0) {
    await tx.query(
      'UPDATE route_plan_point SET deleted_at = NOW() WHERE route_plan_id = ? AND deleted_at IS NULL',
      [id]
    )
  }
  return result.affectedRows > 0
}

/** 项目坐标变更后的标记。只在尚未标记时写入，保留首次失效时间 */
async function markStale(id) {
  await db.query(
    'UPDATE route_plan SET stale_at = NOW() WHERE id = ? AND stale_at IS NULL AND deleted_at IS NULL',
    [id]
  )
}

module.exports = {
  hasPlannerRole,
  findRoutableProjects,
  createPlan,
  createPoints,
  listByOwner,
  findByIdForOwner,
  findPointsByPlanIds,
  findPointsByPlanId,
  findOwnedPoint,
  markPointVisited,
  softDelete,
  markStale,
}
