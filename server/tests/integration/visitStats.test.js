'use strict'

/**
 * 后台考察统计（B-4.6）与项目级签到阈值覆盖（B-5.1）集成测试。
 *
 * 重点不是「接口能返回 200」，而是两件容易做错的事：
 * 1. 阈值优先级必须是「项目 → 租户 → 平台 → 默认」，且改配置不改写历史快照；
 * 2. 统计的卡片数与明细必须同源，项目管理员只能统计自己可见的项目。
 */

const sharp = require('sharp')

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
const auth = require('./helpers/auth')
const fixtures = require('./helpers/fixtures')
const mini = require('./helpers/mini')

beforeAll(() => {
  prepareDatabase()
})

afterAll(async () => {
  await db.close()
  await cache.close()
})

beforeEach(async () => {
  vi.restoreAllMocks()
  await cache.flush()
  await fixtures.resetBusinessTables()
  sysConfigService.invalidate()
})

let seq = 0

/** 建项目 + 一名已确认工长；返回常用的 id 与 token */
async function setupProject({
  name = '考察项目',
  tenantId = 1,
  latitude = 31.2304,
  longitude = 121.4737,
  foremanCode = null,
  ownerAdmin = null,
} = {}) {
  seq += 1
  const admin = ownerAdmin || (await auth.createAndLogin({ username: `stats-owner-${seq}-${Date.now()}`, role: 'owner', tenantId }))
  const projectId = await mini.createProject({
    name,
    latitude,
    longitude,
    tenantId,
    createdBy: admin.admin.id,
  })

  const foreman = await mini.login(foremanCode || `stats-foreman-${seq}-${Date.now()}`)
  await db.query("UPDATE user SET role = 'foreman' WHERE id = ?", [foreman.userId])
  await mini.addMember({ projectId, userId: foreman.userId, role: 'foreman' })

  return { admin, projectId, foreman }
}

async function setTenantThreshold(tenantId, value) {
  await db.query(
    `INSERT INTO sys_config (tenant_id, config_key, config_value, scope, description)
     VALUES (?, 'sign_in_distance_threshold', ?, 'global', '测试')
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [tenantId, String(value)]
  )
  sysConfigService.invalidate()
}

async function makeJpeg() {
  return sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 210, g: 215, b: 220 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer()
}

async function stagePhoto(projectId, token) {
  const res = await request
    .authed('post', `/projects/${projectId}/visits/media`, token)
    .attach('file', await makeJpeg(), { filename: 'site.jpg', contentType: 'image/jpeg' })
  if (res.status !== 200) throw new Error(`暂存照片失败：${res.status} ${res.body.message}`)
  return res.body.data.mediaId
}

/**
 * 直接写签到记录：统计用例不需要跑完整的水印链路，
 * 但要能精确控制时间、距离、异常标记与判定阈值快照。
 *
 * `threshold_m` 显式传入而不是读配置 —— 它本来就是记录级快照（AC-N21）。
 */
async function insertVisit({
  projectId,
  userId,
  checkinAt,
  distanceM = 100,
  thresholdM = 500,
  isAbnormal = false,
  abnormalReason = null,
}) {
  const result = await db.query(
    `INSERT INTO visit_record
       (project_id, user_id, checkin_at, checkin_lat, checkin_lng,
        distance_m, threshold_m, is_abnormal, abnormal_reason)
     VALUES (?, ?, ?, 31.2304, 121.4737, ?, ?, ?, ?)`,
    [projectId, userId, checkinAt, distanceM, thresholdM, isAbnormal ? 1 : 0, abnormalReason]
  )
  return result.insertId
}

describe('B-5.1 项目级签到阈值覆盖', () => {
  it('项目覆盖优先于租户配置，未配置的项目跟随租户', async () => {
    const a = await setupProject({ name: '项目 A' })
    const b = await setupProject({ name: '项目 B' })
    await setTenantThreshold(1, 500)

    const put = await request
      .authed('put', `/admin/projects/${a.projectId}/visit-threshold`, a.admin.token)
      .send({ value: '300' })
    expect(put.status).toBe(200)
    expect(put.body.data.value).toBe('300')
    expect(put.body.data.source).toBe('project')
    expect(put.body.data.hasOverride).toBe(true)

    const readA = await request.authed('get', `/admin/projects/${a.projectId}/visit-threshold`, a.admin.token)
    expect(readA.body.data.value).toBe('300')
    expect(readA.body.data.projectValue).toBe('300')
    // 清除覆盖后应回到租户值
    expect(readA.body.data.tenantValue).toBe('500')

    const readB = await request.authed('get', `/admin/projects/${b.projectId}/visit-threshold`, a.admin.token)
    expect(readB.body.data.value).toBe('500')
    expect(readB.body.data.source).toBe('tenant')
    expect(readB.body.data.hasOverride).toBe(false)

    // C 端签到页的提示也必须读项目生效值 —— 显示 500 而判定按 300 是最难排查的错法
    const metaA = await request.authed('get', `/projects/${a.projectId}/visits/meta`, a.foreman.token)
    expect(metaA.body.data.thresholdM).toBe(300)
  })

  it('同一距离在两个项目得到不同判定，记录各自存下当时的阈值快照', async () => {
    const a = await setupProject({ name: '阈值 300 项目' })
    const b = await setupProject({ name: '阈值 500 项目' })
    await setTenantThreshold(1, 500)
    await request
      .authed('put', `/admin/projects/${a.projectId}/visit-threshold`, a.admin.token)
      .send({ value: '300' })

    // 距离项目坐标约 400 米：纬度每 0.001° 约 111 米
    const coords = { latitude: 31.2304 + 0.0036, longitude: 121.4737 }

    const mediaA = await stagePhoto(a.projectId, a.foreman.token)
    const rejected = await request.authed('post', `/projects/${a.projectId}/visits`, a.foreman.token).send({
      ...coords,
      mediaIds: [mediaA],
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.data.threshold).toBe(300)

    const okA = await request.authed('post', `/projects/${a.projectId}/visits`, a.foreman.token).send({
      ...coords,
      mediaIds: [mediaA],
      abnormalReason: '项目级阈值测试',
    })
    expect(okA.status).toBe(200)
    expect(okA.body.data.thresholdM).toBe(300)
    expect(okA.body.data.isAbnormal).toBe(true)

    const mediaB = await stagePhoto(b.projectId, b.foreman.token)
    const okB = await request.authed('post', `/projects/${b.projectId}/visits`, b.foreman.token).send({
      ...coords,
      mediaIds: [mediaB],
    })
    expect(okB.status).toBe(200)
    expect(okB.body.data.thresholdM).toBe(500)
    expect(okB.body.data.isAbnormal).toBe(false)
  })

  it('清除覆盖后回到租户配置，且历史记录的阈值快照不被改写', async () => {
    const { admin, projectId, foreman } = await setupProject({ name: '清除覆盖项目' })
    await setTenantThreshold(1, 500)

    await request
      .authed('put', `/admin/projects/${projectId}/visit-threshold`, admin.token)
      .send({ value: '300' })

    const media = await stagePhoto(projectId, foreman.token)
    const visit = await request.authed('post', `/projects/${projectId}/visits`, foreman.token).send({
      latitude: 31.2304 + 0.0036,
      longitude: 121.4737,
      mediaIds: [media],
      abnormalReason: '按 300 米判为异常',
    })
    expect(visit.status).toBe(200)
    expect(visit.body.data.thresholdM).toBe(300)

    const del = await request.authed('delete', `/admin/projects/${projectId}/visit-threshold`, admin.token)
    expect(del.status).toBe(200)
    expect(del.body.data.value).toBe('500')
    expect(del.body.data.source).toBe('tenant')
    expect(del.body.data.hasOverride).toBe(false)

    const meta = await request.authed('get', `/projects/${projectId}/visits/meta`, foreman.token)
    expect(meta.body.data.thresholdM).toBe(500)

    // AC-N21：历史记录保留判定当时的阈值，清除覆盖不能回溯改写
    const row = await db.queryOne('SELECT threshold_m, is_abnormal FROM visit_record WHERE id = ?', [visit.body.data.id])
    expect(row.threshold_m).toBe('300.00')
    expect(Number(row.is_abnormal)).toBe(1)
  })

  it('非法阈值被拒绝，库里的值保持不变', async () => {
    const { admin, projectId } = await setupProject({ name: '非法值项目' })

    await request
      .authed('put', `/admin/projects/${projectId}/visit-threshold`, admin.token)
      .send({ value: '300' })

    for (const value of ['0', '-100', 'abc', '999999']) {
      const res = await request
        .authed('put', `/admin/projects/${projectId}/visit-threshold`, admin.token)
        .send({ value })
      expect(res.status).toBe(400)
    }

    const read = await request.authed('get', `/admin/projects/${projectId}/visit-threshold`, admin.token)
    expect(read.body.data.value).toBe('300')
  })

  it('设置与清除覆盖都写操作日志，含变更前后值', async () => {
    const { admin, projectId } = await setupProject({ name: '留痕项目' })

    await request
      .authed('put', `/admin/projects/${projectId}/visit-threshold`, admin.token)
      .send({ value: '300' })
    await request.authed('delete', `/admin/projects/${projectId}/visit-threshold`, admin.token)

    const rows = await db.query(
      "SELECT action, project_id, detail FROM operation_log WHERE target_type = 'sys_config' AND project_id = ? ORDER BY id ASC",
      [projectId]
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].action).toBe('sys_config.update')
    expect(rows[1].action).toBe('sys_config.reset')

    const parseDetail = (row) => (typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail)
    const updateDetail = parseDetail(rows[0])
    expect(updateDetail.scope).toBe('project')
    expect(updateDetail.after.value).toBe('300')
    const resetDetail = parseDetail(rows[1])
    expect(resetDetail.before.value).toBe('300')
    expect(resetDetail.after.value).toBe('500')
  })

  it('项目管理员只能查看不能修改（§5.5 权限）', async () => {
    const { projectId } = await setupProject({ name: '权限项目' })
    const projectAdmin = await auth.createAndLogin({ username: `stats-padmin-${Date.now()}`, role: 'admin' })
    await fixtures.grantProjectScope(projectAdmin.admin.id, projectId)

    const read = await request.authed('get', `/admin/projects/${projectId}/visit-threshold`, projectAdmin.token)
    expect(read.status).toBe(200)
    expect(read.body.data.value).toBe('500')

    const write = await request
      .authed('put', `/admin/projects/${projectId}/visit-threshold`, projectAdmin.token)
      .send({ value: '300' })
    expect(write.status).toBe(403)
  })

  it('跨租户管理员不能修改其他租户项目的阈值', async () => {
    const { projectId } = await setupProject({ name: '租户一项目', tenantId: 1 })

    const tenant2 = await fixtures.createTenant({ name: '配置租户二' })
    const owner2 = await auth.createAndLogin({
      username: `stats-owner-t2-${Date.now()}`,
      role: 'owner',
      tenantId: tenant2,
    })

    const res = await request
      .authed('put', `/admin/projects/${projectId}/visit-threshold`, owner2.token)
      .send({ value: '300' })
    // 跨租户一律 404（不泄露另一租户的项目是否存在）
    expect(res.status).toBe(404)
  })
})

describe('B-4.6 后台考察统计', () => {
  it('汇总数与明细同源：考察次数、异常数、异常率、覆盖项目数', async () => {
    const a = await setupProject({ name: '统计项目 A' })
    const b = await setupProject({ name: '统计项目 B' })
    const second = await mini.login(`stats-second-user-${Date.now()}`)
    await db.query("UPDATE user SET role = 'supervisor' WHERE id = ?", [second.userId])
    await mini.addMember({ projectId: b.projectId, userId: second.userId, role: 'supervisor' })

    await insertVisit({ projectId: a.projectId, userId: a.foreman.userId, checkinAt: '2026-11-10 09:00:00' })
    await insertVisit({ projectId: a.projectId, userId: a.foreman.userId, checkinAt: '2026-11-11 09:00:00', distanceM: 800, isAbnormal: true, abnormalReason: '超阈值' })
    await insertVisit({ projectId: b.projectId, userId: second.userId, checkinAt: '2026-11-11 10:00:00' })
    // 区间外：默认近 30 天不应计入（2025 年的记录）
    await insertVisit({ projectId: b.projectId, userId: second.userId, checkinAt: '2025-01-01 10:00:00', isAbnormal: true })

    const res = await request.authed(
      'get',
      `/admin/visit-stats?startDate=2026-11-01&endDate=2026-11-13&page=1&pageSize=20`,
      a.admin.token
    )
    expect(res.status).toBe(200)

    const data = res.body.data
    expect(data.summary.visitCount).toBe(3)
    expect(data.summary.abnormalCount).toBe(1)
    expect(data.summary.projectCount).toBe(2)
    // 1 / 3 = 33.3%
    expect(data.summary.abnormalRate).toBe(33.3)
    expect(data.total).toBe(3)
    expect(data.list).toHaveLength(3)
    expect(data.caliber).toContain('异常签到率')

    const byPerson = data.byPerson
    const foremanRow = byPerson.find((row) => row.userId === a.foreman.userId)
    expect(foremanRow.visitCount).toBe(2)
    expect(foremanRow.abnormalCount).toBe(1)
    expect(foremanRow.abnormalRate).toBe(50)
    // 某人只在 A 项目签到，覆盖项目数是 1
    expect(foremanRow.projectCount).toBe(1)

    // 卡片与明细同源：明细里的异常条数应等于汇总
    expect(data.list.filter((row) => row.isAbnormal)).toHaveLength(1)
  })

  it('按签到人与项目筛选，日期区间外的记录不计入', async () => {
    const a = await setupProject({ name: '筛选项目 A' })
    const b = await setupProject({ name: '筛选项目 B' })

    await insertVisit({ projectId: a.projectId, userId: a.foreman.userId, checkinAt: '2026-11-10 09:00:00' })
    await insertVisit({ projectId: b.projectId, userId: b.foreman.userId, checkinAt: '2026-11-10 10:00:00' })
    await insertVisit({ projectId: a.projectId, userId: a.foreman.userId, checkinAt: '2026-11-12 09:00:00' })

    const byForeman = await request.authed(
      'get',
      `/admin/visit-stats?startDate=2026-11-01&endDate=2026-11-13&foremanId=${a.foreman.userId}`,
      a.admin.token
    )
    expect(byForeman.body.data.summary.visitCount).toBe(2)

    const byProject = await request.authed(
      'get',
      `/admin/visit-stats?startDate=2026-11-01&endDate=2026-11-13&projectId=${b.projectId}`,
      a.admin.token
    )
    expect(byProject.body.data.summary.visitCount).toBe(1)
    expect(byProject.body.data.summary.projectCount).toBe(1)

    const narrow = await request.authed(
      'get',
      `/admin/visit-stats?startDate=2026-11-12&endDate=2026-11-12`,
      a.admin.token
    )
    expect(narrow.body.data.summary.visitCount).toBe(1)

    const empty = await request.authed(
      'get',
      `/admin/visit-stats?startDate=2026-11-13&endDate=2026-11-13`,
      a.admin.token
    )
    expect(empty.status).toBe(200)
    // 没有签到时返回 0 而不是 NaN / Infinity
    expect(empty.body.data.summary.visitCount).toBe(0)
    expect(empty.body.data.summary.abnormalRate).toBe(0)
  })

  it('项目管理员只统计被授权范围内的项目（B-4.8 同源数据权限）', async () => {
    const a = await setupProject({ name: '可见项目' })
    const b = await setupProject({ name: '不可见项目' })
    await insertVisit({ projectId: a.projectId, userId: a.foreman.userId, checkinAt: '2026-11-10 09:00:00' })
    await insertVisit({ projectId: b.projectId, userId: b.foreman.userId, checkinAt: '2026-11-10 10:00:00' })

    const padmin = await auth.createAndLogin({ username: `stats-scope-${Date.now()}`, role: 'admin' })
    await fixtures.grantProjectScope(padmin.admin.id, a.projectId)

    const res = await request.authed(
      'get',
      `/admin/visit-stats?startDate=2026-11-01&endDate=2026-11-13`,
      padmin.token
    )
    expect(res.status).toBe(200)
    expect(res.body.data.summary.visitCount).toBe(1)
    expect(res.body.data.list).toHaveLength(1)
    expect(res.body.data.list[0].projectId).toBe(a.projectId)
  })

  it('导出与页面明细一致（行数与合计）', async () => {
    const a = await setupProject({ name: '导出项目' })
    await insertVisit({ projectId: a.projectId, userId: a.foreman.userId, checkinAt: '2026-11-10 09:00:00' })
    await insertVisit({ projectId: a.projectId, userId: a.foreman.userId, checkinAt: '2026-11-11 09:00:00', distanceM: 900, isAbnormal: true, abnormalReason: '超出阈值' })

    const res = await request.binary(
      'get',
      `/admin/visit-stats/export?startDate=2026-11-01&endDate=2026-11-13`,
      { token: a.admin.token }
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')

    const ExcelJS = require('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(res.buffer)

    const sheet = workbook.getWorksheet('考察明细')
    // 表头占一行，数据两行
    expect(sheet.rowCount).toBe(3)

    const meta = workbook.getWorksheet('统计说明')
    const values = []
    meta.eachRow((row) => values.push(String(row.getCell(2).value ?? '')))
    expect(values).toContain('2')
    expect(values).toContain('1')
  })

  it('筛选结果为空时导出返回 409，而不是一份只有表头的文件', async () => {
    const a = await setupProject({ name: '空导出项目' })

    const res = await request.binary(
      'get',
      `/admin/visit-stats/export?startDate=2026-11-01&endDate=2026-11-13`,
      { token: a.admin.token }
    )
    expect(res.status).toBe(409)
  })

  it('结束日期早于开始日期返回 400', async () => {
    const a = await setupProject({ name: '日期校验项目' })
    const res = await request.authed(
      'get',
      '/admin/visit-stats?startDate=2026-11-13&endDate=2026-11-01',
      a.admin.token
    )
    expect(res.status).toBe(400)
  })
})
