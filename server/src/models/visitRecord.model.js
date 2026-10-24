'use strict'

/**
 * 现场签到数据访问层（§4.6 / C-6.13 ~ C-6.20）。
 *
 * ── 只追加 ──
 * AC-N26 要求签到记录对任何角色（含管理员）只读，没有编辑 / 删除入口。
 * MySQL 没有表级只读约束，因此在仓储层强制：本模块**只导出 SELECT / INSERT**，
 * 不提供 update / delete。后续要改签到只能新增一条记录（当前受当日唯一键限制，
 * 见 service 的说明）。
 *
 * ── 租户 ──
 * visit_record / visit_media 没有 tenant_id，租户由 project 派生（约束 75）。
 * 因此所有按 id 读取的入口都必须先回表拿 project_id，再由 service 校验成员关系。
 */

const db = require('../db/pool')

/**
 * 写一条签到记录。
 *
 * `checkin_at` 显式写入而不是依赖 DEFAULT CURRENT_TIMESTAMP：服务层需要把
 * 同一个时间同时用于水印、返回值和「当日」预检，三处必须完全一致。
 *
 * @returns {Promise<number>} visit_record.id
 */
async function create(data, tx = db) {
  const result = await tx.query(
    `INSERT INTO visit_record
       (project_id, user_id, route_plan_id, seq_in_plan, checkin_at,
        checkin_lat, checkin_lng, distance_m, threshold_m,
        is_abnormal, abnormal_reason, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.projectId,
      data.userId,
      data.routePlanId ?? null,
      data.seqInPlan ?? null,
      data.checkinAt,
      data.checkinLat,
      data.checkinLng,
      data.distanceM,
      data.thresholdM,
      data.isAbnormal ? 1 : 0,
      data.abnormalReason ?? null,
      data.remark ?? null,
    ]
  )
  return result.insertId
}

/**
 * 批量写签到照片。
 *
 * sort_order 直接取数组下标 —— 调用方传入的顺序就是前端选择的顺序，
 * 不在数据库里再按 id 排一次。
 *
 * @param {Array<{visitId:number,url:string,watermarkUrl:string|null,sizeBytes:number|null,width:number|null,height:number|null}>} items
 */
async function addMedia(items, tx = db) {
  if (!Array.isArray(items) || items.length === 0) return 0

  const placeholders = items.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
  const params = []

  items.forEach((item, index) => {
    params.push(
      item.visitId,
      'image',
      item.url,
      item.watermarkUrl ?? null,
      item.sizeBytes ?? null,
      item.width ?? null,
      item.height ?? null,
      index
    )
  })

  const result = await tx.query(
    `INSERT INTO visit_media
       (visit_id, type, url, watermark_url, size_bytes, width, height, sort_order)
     VALUES ${placeholders}`,
    params
  )
  return result.affectedRows
}

/** 按 id 取签到记录（不带照片），用于归属校验 */
async function findById(id) {
  return db.queryOne(
    'SELECT * FROM visit_record WHERE id = ? AND deleted_at IS NULL',
    [id]
  )
}

/**
 * 签到详情行：签到记录 + 签到人展示字段 + 项目信息。
 *
 * 角色取 `user.role`（账号级固定角色）而不是 project_member.role：
 * 成员关系后来被解除时，历史签到仍然要能显示「工长 / 监理」。
 * 项目已软删时仍能读到记录本身，但 project_name 可能为空。
 */
async function findDetailRow(id) {
  return db.queryOne(
    `SELECT vr.*,
            u.nickname, u.avatar,
            COALESCE(u.role, pm.role) AS user_role,
            p.name AS project_name, p.address AS project_address
       FROM visit_record vr
       JOIN user u ON u.id = vr.user_id
       LEFT JOIN project_member pm
         ON pm.project_id = vr.project_id AND pm.user_id = vr.user_id
        AND pm.deleted_at IS NULL
       LEFT JOIN project p ON p.id = vr.project_id
      WHERE vr.id = ? AND vr.deleted_at IS NULL`,
    [id]
  )
}

/**
 * 当日预检。
 *
 * `checkin_date` 是数据库生成列，按会话时区（+08:00）计算；这里传
 * `YYYY-MM-DD` 字符串比较，不自己在应用层算「今天」—— 应用层时区一旦
 * 与 MySQL 会话时区不一致，跨零点就会算错一天（AC-N25）。
 */
async function findByProjectUserDate(projectId, userId, date) {
  return db.queryOne(
    `SELECT id, checkin_at
       FROM visit_record
      WHERE project_id = ? AND user_id = ? AND checkin_date = ?
        AND deleted_at IS NULL`,
    [projectId, userId, date]
  )
}

/** 项目考察记录列表（倒序分页） */
async function listByProject({ projectId, offset, limit }) {
  const total = await db.count(
    'FROM visit_record vr WHERE vr.project_id = ? AND vr.deleted_at IS NULL',
    [projectId]
  )

  const rows = await db.query(
    `SELECT vr.*,
            u.nickname, u.avatar,
            COALESCE(u.role, pm.role) AS user_role
       FROM visit_record vr
       JOIN user u ON u.id = vr.user_id
       LEFT JOIN project_member pm
         ON pm.project_id = vr.project_id AND pm.user_id = vr.user_id
        AND pm.deleted_at IS NULL
      WHERE vr.project_id = ? AND vr.deleted_at IS NULL
      ORDER BY vr.checkin_at DESC, vr.id DESC
      LIMIT ? OFFSET ?`,
    [projectId, limit, offset]
  )

  return { total, rows }
}

/**
 * 批量取签到照片。
 *
 * @param {number[]} visitIds
 * @returns {Promise<Map<number, Array>>}
 */
async function loadMedia(visitIds) {
  const ids = (Array.isArray(visitIds) ? visitIds : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)

  const map = new Map()
  if (ids.length === 0) return map

  const placeholders = ids.map(() => '?').join(', ')
  const rows = await db.query(
    `SELECT id, visit_id, type, url, watermark_url, width, height, sort_order
       FROM visit_media
      WHERE visit_id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY visit_id ASC, sort_order ASC, id ASC`,
    ids
  )

  for (const row of rows) {
    const list = map.get(Number(row.visit_id)) || []
    list.push(row)
    map.set(Number(row.visit_id), list)
  }
  return map
}

module.exports = {
  create,
  addMedia,
  findById,
  findDetailRow,
  findByProjectUserDate,
  listByProject,
  loadMedia,
}
