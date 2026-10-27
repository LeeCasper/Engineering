'use strict'

/**
 * project 数据访问层。
 *
 * ── 本文件最重要的约定 ──
 * 所有**后台**查询方法都强制要求 `scope` 参数（来自 dataScope.buildFilter），
 * 缺失时由 dataScope.assertValid 直接抛错。
 *
 * 这不是为了显得严格：AC-AD52 要求「项目管理员在列表、详情、导出、看板各处均只能
 * 看到自己创建或被授权的项目」。把过滤做成「记得就加」的约定，迟早会有人忘；
 * 做成「不加就报错」的机制，忘了会立刻发现。
 */

const db = require('../db/pool')
const dataScope = require('../services/dataScope.service')

/** 列表字段。合同金额单独控制 —— 它只在有需要时返回 */
const LIST_COLUMNS = `
  p.id, p.tenant_id, p.name, p.address, p.status, p.area, p.contract_amount,
  p.longitude, p.latitude, p.geocoded_at,
  p.start_date, p.plan_end_date, p.actual_end_date,
  p.template_id, p.created_by, p.archived_at, p.created_at, p.updated_at
`

/** 允许的排序字段白名单。用户可控的排序字段直接拼进 SQL 就是注入 */
const SORTABLE = {
  created_at: 'p.created_at',
  start_date: 'p.start_date',
  plan_end_date: 'p.plan_end_date',
  contract_amount: 'p.contract_amount',
  name: 'p.name',
}

/**
 * 后台项目列表（AC-AD11）。
 *
 * @param {object} params
 * @param {object} params.scope 必需，dataScope.buildFilter 的返回值
 * @param {object} params.filters name / address / status / foremanId / createdBy
 * @param {{offset:number, limit:number}} params.paging
 * @param {{field:string, direction:string}} [params.sort]
 */
async function list({ scope, filters = {}, paging, sort }) {
  dataScope.assertValid(scope)

  const where = ['p.deleted_at IS NULL', scope.clause]
  const params = [...scope.params]

  if (filters.name) {
    where.push('p.name LIKE ?')
    // 转义 LIKE 通配符：用户输入的 % 与 _ 应当按字面匹配，
    // 否则一个「%」就能把全部项目捞出来
    params.push(`%${escapeLike(filters.name)}%`)
  }
  if (filters.address) {
    where.push('p.address LIKE ?')
    params.push(`%${escapeLike(filters.address)}%`)
  }
  if (filters.status) {
    where.push('p.status = ?')
    params.push(filters.status)
  }
  if (filters.templateId) {
    where.push('p.template_id = ?')
    params.push(filters.templateId)
  }
  if (filters.foremanId) {
    // 工长是成员关系而非项目字段，需要用 EXISTS 而不是 JOIN ——
    // JOIN 会让「一个项目多个工长」时列表出现重复行，把分页的 total 算错
    where.push(`EXISTS (
      SELECT 1 FROM project_member pm
       WHERE pm.project_id = p.id AND pm.role = 'foreman'
         AND pm.status = 'active' AND pm.deleted_at IS NULL AND pm.user_id = ?
    )`)
    params.push(filters.foremanId)
  }

  const clause = `FROM project p WHERE ${where.join(' AND ')}`
  const total = await db.count(clause, params)

  const orderBy = buildOrderBy(sort)
  const rows = await db.query(
    `SELECT ${LIST_COLUMNS} ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, paging.limit, paging.offset]
  )

  return { total, rows }
}

/**
 * 排序子句。字段走白名单，方向只认 asc/desc ——
 * 这两处都是把用户输入拼进 SQL 的典型位置，不能有例外。
 */
function buildOrderBy(sort) {
  const field = sort && SORTABLE[sort.field] ? SORTABLE[sort.field] : 'p.id'
  const direction = sort && String(sort.direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  return `${field} ${direction}`
}

/** 转义 LIKE 的通配符，使 % 与 _ 按字面匹配 */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * 按 id 取项目（后台，带数据权限）。
 * @returns {Promise<object|null>}
 */
async function findByIdScoped(id, scope) {
  dataScope.assertValid(scope)
  return db.queryOne(
    `SELECT ${LIST_COLUMNS}, p.remark FROM project p
      WHERE p.id = ? AND p.deleted_at IS NULL AND ${scope.clause}`,
    [id, ...scope.params]
  )
}

/**
 * 不带数据权限的取项目。
 *
 * **仅供 C 端使用** —— C 端的可见性由 project_member 决定，不适用后台的
 * scope 规则。命名上刻意加 Unscoped 前缀，让它在 code review 里显眼。
 */
async function findByIdUnscoped(id) {
  return db.queryOne(
    `SELECT ${LIST_COLUMNS}, p.remark FROM project p WHERE p.id = ? AND p.deleted_at IS NULL`,
    [id]
  )
}

/**
 * 建档（B-2.3）。
 * created_by 必须显式传操作者 —— 数据权限以它为依据，缺了就等于建了一个
 * 「谁都管不了」的项目。
 *
 * tenantId 同样必传：项目是租户的根对象，`tenant_id` 是 `NOT NULL`，
 * 漏传会直接报数据库错误（这是好事 —— 比静默归错租户强）。
 */
async function create(data, tx = db) {
  const result = await tx.query(
    `INSERT INTO project
       (tenant_id, name, address, longitude, latitude, geocoded_at, area, contract_amount,
        start_date, plan_end_date, template_id, remark, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      data.tenantId,
      data.name,
      data.address,
      data.longitude ?? null,
      data.latitude ?? null,
      data.geocodedAt ?? null,
      data.area ?? null,
      data.contractAmount,
      data.startDate,
      data.planEndDate,
      data.templateId ?? null,
      data.remark ?? null,
      data.createdBy,
    ]
  )
  return result.insertId
}

/** 编辑项目。只允许改业务字段，status 与 created_by 走各自的专门方法 */
async function update(id, data, tx = db) {
  const fields = []
  const params = []
  const mapping = {
    name: data.name,
    address: data.address,
    area: data.area,
    contract_amount: data.contractAmount,
    start_date: data.startDate,
    plan_end_date: data.planEndDate,
    remark: data.remark,
  }

  for (const [column, value] of Object.entries(mapping)) {
    if (value !== undefined) {
      fields.push(`${column} = ?`)
      params.push(value)
    }
  }

  // 坐标写入与 address 解耦：地图选点允许只改坐标、不动地址。
  // 服务层在地址变更但解析失败时会显式传 null，从而清空旧坐标
  // （项目停留在旧地址坐标会让导航带到错误地点，AC-N10）。
  if (data.longitude !== undefined && data.latitude !== undefined) {
    fields.push('longitude = ?', 'latitude = ?')
    params.push(data.longitude, data.latitude)
  }

  // geocoded_at 独立判断：手工坐标与地址解析都要留下最近一次定位时间
  if (data.geocodedAt !== undefined) {
    fields.push('geocoded_at = ?')
    params.push(data.geocodedAt)
  }

  if (fields.length === 0) return

  params.push(id)
  await tx.query(`UPDATE project SET ${fields.join(', ')} WHERE id = ?`, params)
}

/** 仅更新坐标（地图手工拾取，AC-AD54） */
async function updateCoordinates(id, { longitude, latitude, geocodedAt }) {
  await db.query('UPDATE project SET longitude = ?, latitude = ?, geocoded_at = ? WHERE id = ?', [
    longitude,
    latitude,
    geocodedAt,
    id,
  ])
}

/**
 * 状态流转（B-2.10）。合法性由 service 层判定。
 *
 * `archived_at` 必须**双向**维护：进归档时置为当前时间，离开归档时清空。
 * 只写不清的话，把项目从已归档改回已完工之后，`archived_at` 还留着旧时间 ——
 * 任何按它筛选「已归档项目」的报表都会把这个项目算进去，
 * 而它的 status 明明已经不是 archived 了。
 */
async function updateStatus(id, status, tx = db) {
  await tx.query(
    'UPDATE project SET status = ?, archived_at = IF(? = ?, NOW(), NULL) WHERE id = ?',
    [status, status, 'archived', id]
  )
}

/** 软删除（AC-AD26）。仅超级管理员可操作，由 service 层判定 */
async function softDelete(id, tx = db) {
  await tx.query('UPDATE project SET deleted_at = NOW() WHERE id = ?', [id])
}

/** 恢复软删除的项目（AC-AD27：恢复后阶段、汇报、验收、账目数据完整无缺失） */
async function restore(id, tx = db) {
  await tx.query('UPDATE project SET deleted_at = NULL WHERE id = ?', [id])
}

/** 批量取成员，用于列表页展示工长 */
async function listForemenOfProjects(projectIds) {
  if (projectIds.length === 0) return []
  const placeholders = projectIds.map(() => '?').join(', ')
  return db.query(
    `SELECT pm.project_id, pm.role, pm.status, pm.is_primary, pm.owner_type,
            u.id AS user_id, u.nickname, u.phone
       FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL
      WHERE pm.project_id IN (${placeholders}) AND pm.deleted_at IS NULL
      ORDER BY pm.project_id, FIELD(pm.role, 'foreman', 'supervisor', 'owner'),
               pm.is_primary DESC, FIELD(pm.owner_type, 'primary', 'temporary'), pm.id`,
    projectIds
  )
}

/**
 * 管理端项目概览统计。
 *
 * 所有查询都必须复用 dataScope 产出的 clause —— 统计口径与列表、详情同源，
 * 项目管理员才不会在概览里看到未授权项目的数字（AC-AD52）。
 *
 * 统计是全局口径，不受列表的搜索/状态筛选影响。
 */
async function getStats(scope, { today }) {
  dataScope.assertValid(scope)

  const [projectRow, acceptanceRow, invitationRow] = await Promise.all([
    db.queryOne(
      `SELECT
         COUNT(*) AS total,
         SUM(p.status = 'pending') AS pending,
         SUM(p.status = 'building') AS building,
         SUM(p.status = 'finished') AS finished,
         SUM(p.status = 'archived') AS archived,
         SUM(
           CASE
             WHEN p.status <> 'archived'
              AND p.plan_end_date IS NOT NULL
              AND COALESCE(p.actual_end_date, ?) > p.plan_end_date
             THEN 1 ELSE 0
           END
         ) AS overdue
         FROM project p
        WHERE p.deleted_at IS NULL AND ${scope.clause}`,
      [today, ...scope.params]
    ),
    db.queryOne(
      `SELECT COUNT(*) AS count
         FROM acceptance a
         JOIN project p ON p.id = a.project_id AND p.deleted_at IS NULL
        WHERE a.deleted_at IS NULL
          AND a.status IN ('pending_supervisor', 'pending_owner')
          AND p.status <> 'archived'
          AND ${scope.clause}`,
      [...scope.params]
    ),
    db.queryOne(
      `SELECT COUNT(*) AS count
         FROM project_member pm
         JOIN project p ON p.id = pm.project_id AND p.deleted_at IS NULL
        WHERE pm.deleted_at IS NULL
          AND pm.status = 'pending'
          AND p.status <> 'archived'
          AND ${scope.clause}`,
      [...scope.params]
    ),
  ])

  const row = projectRow || {}
  return {
    total: Number(row.total) || 0,
    statusCounts: {
      pending: Number(row.pending) || 0,
      building: Number(row.building) || 0,
      finished: Number(row.finished) || 0,
      archived: Number(row.archived) || 0,
    },
    overdue: Number(row.overdue) || 0,
    pendingAcceptance: Number(acceptanceRow && acceptanceRow.count) || 0,
    pendingInvitations: Number(invitationRow && invitationRow.count) || 0,
  }
}

/**
 * 批量取多个项目的阶段，用于算项目总进度。
 * 一次查回再在内存里分组，而不是逐项目查 —— N+1 是列表接口变慢的头号原因。
 */
async function listStagesOfProjects(projectIds) {
  if (projectIds.length === 0) return []
  const placeholders = projectIds.map(() => '?').join(', ')
  return db.query(
    `SELECT id, project_id, name, seq, progress, weight, status, gate_status
       FROM project_stage
      WHERE project_id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY project_id, seq`,
    projectIds
  )
}

/**
 * 查某个用户参与的全部项目（C 端）。可见性由成员关系决定，不走后台 scope。
 *
 * 多租户下带出 `tenant_id` / `tenant_name`：一个工长可能同时给两家装修公司干活，
 * 前端要按租户分组展示，否则项目列表会把两家的单子混在一起。
 */
async function listByUser(userId, { tenantId } = {}) {
  const where = ['pm.user_id = ?', "pm.status = 'active'", 'pm.deleted_at IS NULL', 'p.deleted_at IS NULL']
  const params = [userId]

  if (tenantId) {
    where.push('p.tenant_id = ?')
    params.push(tenantId)
  }

  return db.query(
    `SELECT ${LIST_COLUMNS}, pm.role AS my_role, pm.owner_type AS my_owner_type, pm.id AS member_id,
            t.name AS tenant_name, t.code AS tenant_code
       FROM project_member pm
       JOIN project p ON p.id = pm.project_id AND p.deleted_at IS NULL
       JOIN tenant t ON t.id = p.tenant_id AND t.deleted_at IS NULL
      WHERE ${where.join(' AND ')}
      ORDER BY p.tenant_id, FIELD(pm.role, 'foreman', 'supervisor', 'owner'), p.id DESC`,
    params
  )
}

module.exports = {
  LIST_COLUMNS,
  SORTABLE,
  escapeLike,
  list,
  findByIdScoped,
  findByIdUnscoped,
  create,
  update,
  updateCoordinates,
  updateStatus,
  softDelete,
  restore,
  listForemenOfProjects,
  listStagesOfProjects,
  listByUser,
  getStats,
}
