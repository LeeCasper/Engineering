'use strict'

/**
 * 后台考察统计（B-4.6 / §5.4）。
 *
 * 需求原文：「考察统计：按工长 / 时间区间统计考察次数、异常签到数与异常率、
 * 覆盖项目数」。§5.4 同时要求「统计口径必须在页面上可查」——
 * 因此每个响应都带一句 `caliber`，而不是让业务方拿着数字去猜分母。
 *
 * ── 口径 ──
 * - 考察次数 = 区间内 `visit_record` 的条数（同项目同人当日唯一，见 AC-N25）；
 * - 异常签到数 = `is_abnormal = 1` 的条数；
 * - 异常签到率 = 异常签到数 ÷ 签到总数（没有签到时为 0，不返回 NaN）；
 * - 覆盖项目数 = 区间内有过签到的**不同项目**数（COUNT DISTINCT）。
 *
 * ── 数据权限 ──
 * 与项目列表共用 `dataScope.buildFilter`。签到记录本身没有 tenant_id，
 * 租户由 project 派生（CLAUDE.md 第 75 条），所以这里必须 JOIN project
 * 并把 scope.clause 原样拼进 WHERE —— 项目管理员只能统计他能看到的项目（B-4.8）。
 *
 * ── 只读 ──
 * 本模块只查询，不写任何表。签到记录本身是只追加表（AC-N26）。
 */

const db = require('../db/pool')
const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const dataScope = require('./dataScope.service')

/** 单次导出的行数上限。超过时明确报错，而不是悄悄截断成一份「看着对」的文件 */
const EXPORT_ROW_LIMIT = 5000

const CALIBER =
  '考察次数按签到记录条数统计；异常签到数取判定结果为异常的记录；' +
  '异常签到率 = 异常签到数 ÷ 签到总数（无签到时为 0）；' +
  '覆盖项目数按区间内有过签到的不同项目数统计。'

/** 角色中文名。签到人可能是工长或监理，统计里如实标注，不硬归成「工长」 */
const ROLE_LABELS = { foreman: '工长', supervisor: '监理', owner: '业主', admin: '管理员' }

/**
 * 解析统计区间。
 *
 * 只接受 `YYYY-MM-DD`，且结束日期按**次日零点**作为开区间上界：
 * 用 `<= '2026-11-13'` 比较 DATETIME 时，当天 00:00 之后的记录全会漏掉 ——
 * 这是日期区间统计最典型的错法。
 *
 * 默认近 30 天（§5.4「时间范围（默认近 30 天）」）。
 */
function resolveRange({ startDate, endDate } = {}, { now = datetime.now() } = {}) {
  const today = datetime.parse(datetime.formatDate(now))

  const start = startDate ? datetime.parse(startDate) : today.subtract(29, 'day')
  const end = endDate ? datetime.parse(endDate) : today

  if (!start || !start.isValid()) throw AppError.badRequest('开始日期不是合法日期')
  if (!end || !end.isValid()) throw AppError.badRequest('结束日期不是合法日期')
  if (end.isBefore(start, 'day')) throw AppError.badRequest('结束日期不得早于开始日期')

  return {
    startDate: start.format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
    // [start 00:00:00, end+1d 00:00:00)
    from: `${start.format('YYYY-MM-DD')} 00:00:00`,
    toExclusive: `${end.add(1, 'day').format('YYYY-MM-DD')} 00:00:00`,
  }
}

/**
 * 构造统计的 FROM / WHERE。
 *
 * 所有统计（总数、异常数、按人分组、明细）共用这一份条件 ——
 * 各写一份 WHERE 是「卡片数与明细对不上」的根源（C-004 的失败判定）。
 */
function buildQuery(operator, range, filters = {}) {
  const scope = dataScope.buildFilter(operator)

  const where = [
    'vr.deleted_at IS NULL',
    'p.deleted_at IS NULL',
    'vr.checkin_at >= ?',
    'vr.checkin_at < ?',
  ]
  const params = [range.from, range.toExclusive]

  if (filters.foremanId) {
    where.push('vr.user_id = ?')
    params.push(filters.foremanId)
  }
  if (filters.projectId) {
    where.push('vr.project_id = ?')
    params.push(filters.projectId)
  }

  // scope.clause 由 dataScope 产出，带 `p.` 前缀的列名，直接拼进 WHERE
  where.push(scope.clause)
  params.push(...scope.params)

  return { clause: where.join(' AND '), params }
}

const FROM = `FROM visit_record vr
  JOIN project p ON p.id = vr.project_id
  JOIN user u ON u.id = vr.user_id`

/**
 * 考察统计（B-4.6）。
 *
 * 一次返回：汇总卡片、按签到人分组、明细分页、筛选器候选项、口径说明。
 * 卡片与明细必须同源 —— 明细走与汇总完全相同的 WHERE。
 */
async function getStats(operator, query = {}, { paging } = {}) {
  const range = resolveRange(query)
  const filters = {
    foremanId: toPositiveId(query.foremanId),
    projectId: toPositiveId(query.projectId),
  }
  const { clause, params } = buildQuery(operator, range, filters)

  const summaryRow = await db.queryOne(
    `SELECT COUNT(*) AS visit_count,
            COALESCE(SUM(vr.is_abnormal = 1), 0) AS abnormal_count,
            COUNT(DISTINCT vr.project_id) AS project_count
       ${FROM}
      WHERE ${clause}`,
    params
  )

  const visitCount = Number(summaryRow.visit_count) || 0
  const abnormalCount = Number(summaryRow.abnormal_count) || 0
  const projectCount = Number(summaryRow.project_count) || 0

  const byPersonRows = await db.query(
    `SELECT vr.user_id,
            u.real_name, u.nickname, u.role,
            COUNT(*) AS visit_count,
            COALESCE(SUM(vr.is_abnormal = 1), 0) AS abnormal_count,
            COUNT(DISTINCT vr.project_id) AS project_count
       ${FROM}
      WHERE ${clause}
      GROUP BY vr.user_id, u.real_name, u.nickname, u.role
      ORDER BY visit_count DESC, vr.user_id ASC`,
    params
  )

  const total = visitCount
  // 明细分页与汇总共用同一份条件；没有分页参数时按第一页返回
  const limit = paging ? paging.limit : 20
  const offset = paging ? paging.offset : 0

  const rows = await db.query(
    `SELECT vr.id, vr.checkin_at, vr.checkin_lat, vr.checkin_lng,
            vr.distance_m, vr.threshold_m, vr.is_abnormal, vr.abnormal_reason, vr.remark,
            vr.project_id, p.name AS project_name,
            vr.user_id, u.real_name, u.nickname, u.phone, u.role
       ${FROM}
      WHERE ${clause}
      ORDER BY vr.checkin_at DESC, vr.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const [foremen, projects] = await Promise.all([
    listSigners(operator),
    listProjectsWithVisits(operator),
  ])

  return {
    range: { startDate: range.startDate, endDate: range.endDate },
    summary: {
      visitCount,
      abnormalCount,
      projectCount,
      abnormalRate: rate(abnormalCount, visitCount),
    },
    byPerson: byPersonRows.map((row) => ({
      userId: Number(row.user_id),
      name: displayName(row),
      role: row.role,
      roleLabel: ROLE_LABELS[row.role] || row.role || '未知',
      visitCount: Number(row.visit_count),
      abnormalCount: Number(row.abnormal_count),
      projectCount: Number(row.project_count),
      abnormalRate: rate(Number(row.abnormal_count), Number(row.visit_count)),
    })),
    list: rows.map((row) => ({
      id: Number(row.id),
      projectId: Number(row.project_id),
      projectName: row.project_name,
      userId: Number(row.user_id),
      userName: displayName(row),
      role: row.role,
      roleLabel: ROLE_LABELS[row.role] || row.role || '未知',
      checkinAt: row.checkin_at,
      latitude: row.checkin_lat === null ? null : Number(row.checkin_lat),
      longitude: row.checkin_lng === null ? null : Number(row.checkin_lng),
      distanceM: Number(row.distance_m),
      // 判定时的阈值快照（AC-N21）：改配置不会改写历史记录
      thresholdM: Number(row.threshold_m),
      isAbnormal: Number(row.is_abnormal) === 1,
      abnormalReason: row.abnormal_reason,
      remark: row.remark,
    })),
    total,
    page: paging ? paging.page : 1,
    pageSize: limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    foremen,
    projects,
    caliber: CALIBER,
  }
}

/**
 * 导出筛选结果（B-4.6「明细表支持导出」）。
 *
 * 同步返回文件：考察记录的量级远小于项目列表，且这里只有一个明细表。
 * 超过 `EXPORT_ROW_LIMIT` 时明确报错而不是截断 —— 一份少了行的导出
 * 会被当成「统计就是这些」，比没有导出更糟。
 */
async function exportStats(operator, query = {}, { generatedBy } = {}) {
  const range = resolveRange(query)
  const filters = {
    foremanId: toPositiveId(query.foremanId),
    projectId: toPositiveId(query.projectId),
  }
  const { clause, params } = buildQuery(operator, range, filters)

  const total = await db.count(
    `FROM visit_record vr
      JOIN project p ON p.id = vr.project_id
     WHERE ${clause}`,
    params
  )

  if (total === 0) throw AppError.conflict('当前筛选条件下没有可导出的考察记录')
  if (total > EXPORT_ROW_LIMIT) {
    throw AppError.badRequest(`导出行数超过 ${EXPORT_ROW_LIMIT} 条，请缩短时间范围后再导出`)
  }

  const rows = await db.query(
    `SELECT vr.id, vr.checkin_at, vr.distance_m, vr.threshold_m,
            vr.is_abnormal, vr.abnormal_reason, vr.remark, vr.project_id,
            p.name AS project_name, u.real_name, u.nickname, u.phone, u.role
       ${FROM}
      WHERE ${clause}
      ORDER BY vr.checkin_at DESC, vr.id DESC`,
    params
  )

  const abnormalCount = rows.filter((row) => Number(row.is_abnormal) === 1).length
  const projectCount = new Set(rows.map((row) => Number(row.project_id))).size

  const buffer = await buildWorkbook(
    rows.map((row) => ({
      checkinAt: row.checkin_at,
      projectName: row.project_name,
      userName: displayName(row),
      roleLabel: ROLE_LABELS[row.role] || row.role || '未知',
      distance: Number(row.distance_m),
      threshold: Number(row.threshold_m),
      abnormal: Number(row.is_abnormal) === 1 ? '是' : '否',
      abnormalReason: row.abnormal_reason ?? '',
      remark: row.remark ?? '',
    })),
    {
      generatedBy,
      range,
      summary: {
        visitCount: rows.length,
        abnormalCount,
        projectCount,
        abnormalRate: rate(abnormalCount, rows.length),
      },
    }
  )

  return {
    buffer,
    filename: `考察统计_${range.startDate}_${range.endDate}.xlsx`,
    rowCount: rows.length,
    summary: {
      visitCount: rows.length,
      abnormalCount,
      projectCount,
      abnormalRate: rate(abnormalCount, rows.length),
    },
  }
}

async function buildWorkbook(rows, { generatedBy, range, summary }) {
  const ExcelJS = require('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '工程宝'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('考察明细')
  sheet.columns = [
    { header: '签到时间', key: 'checkinAt', width: 20 },
    { header: '项目', key: 'projectName', width: 22 },
    { header: '签到人', key: 'userName', width: 14 },
    { header: '角色', key: 'roleLabel', width: 10 },
    { header: '偏差(米)', key: 'distance', width: 12 },
    { header: '判定阈值(米)', key: 'threshold', width: 14 },
    { header: '是否异常', key: 'abnormal', width: 10 },
    { header: '异常说明', key: 'abnormalReason', width: 30 },
    { header: '备注', key: 'remark', width: 30 },
  ]
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  for (const row of rows) sheet.addRow(row)

  // 统计口径与合计单独一张表：这份文件会被转发给不在系统里的人，
  // 只给明细不给分母，收到的人会自己去算出一个不一样的比例
  const meta = workbook.addWorksheet('统计说明')
  meta.columns = [
    { header: '项', key: 'k', width: 20 },
    { header: '值', key: 'v', width: 60 },
  ]
  meta.getRow(1).font = { bold: true }
  meta.addRow({ k: '导出时间', v: datetime.format() })
  meta.addRow({ k: '导出人', v: generatedBy || '—' })
  meta.addRow({ k: '统计区间', v: `${range.startDate} ~ ${range.endDate}` })
  meta.addRow({ k: '考察次数', v: String(summary.visitCount) })
  meta.addRow({ k: '异常签到数', v: String(summary.abnormalCount) })
  meta.addRow({ k: '异常签到率', v: `${summary.abnormalRate}%` })
  meta.addRow({ k: '覆盖项目数', v: String(summary.projectCount) })
  meta.addRow({ k: '统计口径', v: CALIBER })
  meta.addRow({ k: '数据范围', v: '仅包含导出人有权限查看的项目（§5.1 数据权限）' })

  return workbook.xlsx.writeBuffer()
}

/**
 * 筛选器候选项：有过签到记录的人。
 *
 * 不加时间范围限制 —— 若候选列表跟着当前区间收缩，
 * 用户先选窄区间再想换人时会发现目标人「不见了」。
 */
async function listSigners(operator) {
  const scope = dataScope.buildFilter(operator)
  const rows = await db.query(
    `SELECT DISTINCT vr.user_id, u.real_name, u.nickname, u.phone, u.role
       FROM visit_record vr
       JOIN project p ON p.id = vr.project_id
       JOIN user u ON u.id = vr.user_id
      WHERE vr.deleted_at IS NULL AND p.deleted_at IS NULL AND ${scope.clause}
      ORDER BY u.role ASC, u.real_name ASC, u.nickname ASC`,
    scope.params
  )

  return rows.map((row) => ({
    userId: Number(row.user_id),
    name: displayName(row),
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role || '未知',
  }))
}

/** 筛选器候选项：有过签到记录的项目 */
async function listProjectsWithVisits(operator) {
  const scope = dataScope.buildFilter(operator)
  const rows = await db.query(
    `SELECT DISTINCT p.id, p.name
       FROM visit_record vr
       JOIN project p ON p.id = vr.project_id
      WHERE vr.deleted_at IS NULL AND p.deleted_at IS NULL AND ${scope.clause}
      ORDER BY p.name ASC`,
    scope.params
  )

  return rows.map((row) => ({ projectId: Number(row.id), name: row.name }))
}

/** 展示名优先级：实名 → 昵称 → 脱敏手机号 → 用户 id（与全系统一致） */
function displayName(row) {
  return row.real_name || row.nickname || maskPhone(row.phone) || `用户 #${row.user_id ?? row.id ?? ''}`
}

function maskPhone(phone) {
  const text = String(phone ?? '').trim()
  if (text.length < 7) return ''
  return `${text.slice(0, 3)}****${text.slice(-4)}`
}

/** 百分比，保留一位小数。分母为 0 时返回 0，避免 NaN / Infinity 出现在 JSON 里 */
function rate(part, whole) {
  if (!whole) return 0
  return Number(((part / whole) * 100).toFixed(1))
}

function toPositiveId(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

module.exports = {
  CALIBER,
  EXPORT_ROW_LIMIT,
  resolveRange,
  getStats,
  exportStats,
}
