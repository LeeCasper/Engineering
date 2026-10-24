'use strict'

/**
 * 现场签到集成测试（C-6.13 ~ C-6.20 / AC-N17 ~ N28）。
 *
 * 照片走真实 multipart：真 JPEG 才会跑完整的水印链路（sharp → SVG → 合成），
 * 伪造 Buffer 只能证明「接口没报错」，证明不了水印真的生成了。
 */

const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const config = require('../../config')
const sysConfigService = require('../../src/services/sysConfig.service')
const visitService = require('../../src/services/visit.service')
const visitMediaCleanup = require('../../src/jobs/visitMediaCleanup')
const visitRecordModel = require('../../src/models/visitRecord.model')
const storage = require('../../src/storage')
const watermark = require('../../src/utils/watermark')
const datetime = require('../../src/utils/datetime')
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

async function makeJpeg(width = 640, height = 480) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 210, g: 215, b: 220 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer()
}

let setupSeq = 0

/** 项目 + 管理员（通知收件人）+ 工长 / 监理 / 业主 */
async function setup({
  status = 'building',
  latitude = 31.2304,
  longitude = 121.4737,
  name = '签到测试项目',
  tenantId = 1,
  ownerAdmin = null,
} = {}) {
  setupSeq += 1
  const admin =
    ownerAdmin ||
    (await auth.createAndLogin({
      username: `owner-${setupSeq}-${Date.now()}`,
      role: 'owner',
    }))
  const projectId = await mini.createProject({
    name,
    address: '上海市浦东新区世纪大道 100 号',
    latitude,
    longitude,
    status,
    tenantId,
    createdBy: admin.admin.id,
  })

  const foreman = await mini.login(`visit-foreman-${projectId}`)
  await mini.addMember({ projectId, userId: foreman.userId, role: 'foreman' })

  const supervisor = await mini.login(`visit-supervisor-${projectId}`)
  await mini.addMember({ projectId, userId: supervisor.userId, role: 'supervisor' })

  const owner = await mini.login(`visit-owner-${projectId}`)
  await mini.addMember({ projectId, userId: owner.userId, role: 'owner' })

  return { admin, projectId, foreman, supervisor, owner }
}

function stageReq(projectId, token, buffer) {
  return request
    .authed('post', `/projects/${projectId}/visits/media`, token)
    .attach('file', buffer, { filename: 'site.jpg', contentType: 'image/jpeg' })
}

async function stage(projectId, token) {
  const res = await stageReq(projectId, token, await makeJpeg())
  if (res.status !== 200) throw new Error(`stage failed: ${res.status} ${res.body.message}`)
  return res.body.data.mediaId
}

function submitReq(projectId, token, fields) {
  return request.authed('post', `/projects/${projectId}/visits`, token).send(fields)
}

function near(offsetLat = 0.0001) {
  return { latitude: 31.2304 + offsetLat, longitude: 121.4737 }
}

async function setThreshold(tenantId, value) {
  await db.query(
    `INSERT INTO sys_config (tenant_id, config_key, config_value, scope, description)
     VALUES (?, 'sign_in_distance_threshold', ?, 'global', '测试')
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [tenantId, String(value)]
  )
  sysConfigService.invalidate()
}

describe('现场签到 · 权限（AC-N27）', () => {
  it('工长与监理可以签到，业主 403', async () => {
    const { projectId, foreman, supervisor, owner } = await setup()

    const foremanMedia = await stage(projectId, foreman.token)
    const foremanRes = await submitReq(projectId, foreman.token, {
      ...near(),
      mediaIds: [foremanMedia],
    })
    expect(foremanRes.status).toBe(200)
    expect(foremanRes.body.data.signer.role).toBe('foreman')

    const supervisorMedia = await stage(projectId, supervisor.token)
    const supervisorRes = await submitReq(projectId, supervisor.token, {
      ...near(),
      mediaIds: [supervisorMedia],
    })
    expect(supervisorRes.status).toBe(200)
    expect(supervisorRes.body.data.signer.role).toBe('supervisor')

    const ownerStage = await stageReq(projectId, owner.token, await makeJpeg())
    expect(ownerStage.status).toBe(403)

    const ownerSubmit = await submitReq(projectId, owner.token, {
      ...near(),
      mediaIds: [foremanMedia],
    })
    expect(ownerSubmit.status).toBe(403)
    expect(ownerSubmit.body.message).toContain('工长与监理')
  })

  it('非成员与 pending 成员都是 404', async () => {
    const { projectId } = await setup()
    const stranger = await mini.login('visit-stranger')
    expect((await request.authed('get', `/projects/${projectId}/visits/meta`, stranger.token)).status).toBe(404)
    expect((await stageReq(projectId, stranger.token, await makeJpeg())).status).toBe(404)

    const pending = await mini.login('visit-pending')
    await mini.addMember({ projectId, userId: pending.userId, role: 'foreman', status: 'pending' })
    expect((await request.authed('get', `/projects/${projectId}/visits/meta`, pending.token)).status).toBe(404)
  })

  it('管理员 token 访问 C 端签到接口返回 401', async () => {
    const { admin, projectId } = await setup()
    const token = admin.token

    expect((await request.authed('get', `/projects/${projectId}/visits/meta`, token)).status).toBe(401)
    expect((await request.authed('get', `/projects/${projectId}/visits`, token)).status).toBe(401)
    expect((await submitReq(projectId, token, { ...near(), mediaIds: [1] })).status).toBe(401)
  })

  it('归档项目拒绝签到，只有 archived 是只读终态', async () => {
    const { projectId, foreman } = await setup({ status: 'archived' })

    const meta = await request.authed('get', `/projects/${projectId}/visits/meta`, foreman.token)
    expect(meta.status).toBe(200)
    expect(meta.body.data.canCheckin).toBe(false)
    expect(meta.body.data.reason).toBe('PROJECT_ARCHIVED')

    expect((await stageReq(projectId, foreman.token, await makeJpeg())).status).toBe(403)
    expect(
      (await submitReq(projectId, foreman.token, { ...near(), mediaIds: [1] })).status
    ).toBe(403)
  })

  it('项目没有坐标时不可签到', async () => {
    const { projectId, foreman } = await setup({ latitude: null, longitude: null })

    const meta = await request.authed('get', `/projects/${projectId}/visits/meta`, foreman.token)
    expect(meta.body.data.canCheckin).toBe(false)
    expect(meta.body.data.reason).toBe('NO_COORDINATES')

    expect((await stageReq(projectId, foreman.token, await makeJpeg())).status).toBe(400)
    expect(
      (await submitReq(projectId, foreman.token, { ...near(), mediaIds: [1] })).status
    ).toBe(400)
  })
})

describe('现场签到 · 正常签到与水印（AC-N17 / AC-N18）', () => {
  it('空坐标 / 越界坐标被拒绝，不生成记录（AC-N28）', async () => {
    const { projectId, foreman } = await setup()

    const empty = await submitReq(projectId, foreman.token, {
      latitude: '',
      longitude: '',
      mediaIds: [1],
    })
    expect(empty.status).toBe(400)

    const outOfRange = await submitReq(projectId, foreman.token, {
      latitude: 91,
      longitude: 121,
      mediaIds: [1],
    })
    expect(outOfRange.status).toBe(400)

    expect(await db.count('FROM visit_record WHERE project_id = ?', [projectId])).toBe(0)
  })

  it('记录时间、坐标、偏差，并生成服务端水印照片', async () => {
    const { projectId, foreman } = await setup()
    const spy = vi.spyOn(watermark, 'apply')

    const mediaId = await stage(projectId, foreman.token)
    const res = await submitReq(projectId, foreman.token, {
      ...near(),
      mediaIds: [mediaId],
      remark: '墙面空鼓，已拍照记录',
    })

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.projectId).toBe(projectId)
    expect(data.checkinAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(data.latitude).toBeCloseTo(near().latitude, 4)
    expect(data.longitude).toBeCloseTo(near().longitude, 4)
    expect(data.distanceM).toBeGreaterThan(0)
    expect(data.distanceM).toBeLessThan(100)
    expect(data.thresholdM).toBe(500)
    expect(data.isAbnormal).toBe(false)
    expect(data.remark).toBe('墙面空鼓，已拍照记录')
    expect(data.media).toHaveLength(1)
    expect(data.media[0].url).not.toBe(data.media[0].originalUrl)

    // 服务端确实调用了水印组件，且三行内容符合 §4.6.2
    expect(spy).toHaveBeenCalledTimes(1)
    const lines = spy.mock.calls[0][1].lines
    expect(lines[0]).toBe(data.checkinAt)
    expect(lines[1]).toContain('世纪大道')
    expect(lines[2]).toContain('31.230')
    expect(lines[2]).toContain('121.473')

    // 原图与水印图都真实落盘
    const originalKey = storage.extractKey(data.media[0].originalUrl)
    const markedKey = storage.extractKey(data.media[0].url)
    expect(fs.existsSync(path.join(config.upload.dir, originalKey))).toBe(true)
    expect(fs.existsSync(path.join(config.upload.dir, markedKey))).toBe(true)

    const rows = await db.query('SELECT * FROM visit_record WHERE id = ?', [data.id])
    expect(rows).toHaveLength(1)
    expect(rows[0].distance_m).toBe(data.distanceM.toFixed(2))
    expect(rows[0].threshold_m).toBe('500.00')
  })
})

describe('现场签到 · 异常签到（AC-N19 / AC-N20 / AC-N21）', () => {
  it('超阈值必须填写说明；填写后标记异常并通知管理员', async () => {
    const { admin, projectId, foreman } = await setup()
    const mediaId = await stage(projectId, foreman.token)
    const far = { latitude: 31.5, longitude: 121.9 }

    const rejected = await submitReq(projectId, foreman.token, {
      ...far,
      mediaIds: [mediaId],
    })
    expect(rejected.status).toBe(400)
    expect(rejected.body.message).toContain('请填写说明')
    expect(rejected.body.data.distance).toBeGreaterThan(500)
    expect(rejected.body.data.threshold).toBe(500)

    // 被拒后照片仍可复用
    const ok = await submitReq(projectId, foreman.token, {
      ...far,
      mediaIds: [mediaId],
      abnormalReason: 'GPS 漂移，人在现场',
    })
    expect(ok.status).toBe(200)
    expect(ok.body.data.isAbnormal).toBe(true)
    expect(ok.body.data.abnormalReason).toBe('GPS 漂移，人在现场')
    expect(ok.body.data.thresholdM).toBe(500)

    const notifications = await db.query(
      'SELECT * FROM admin_notification WHERE ref_type = ? AND ref_id = ?',
      ['visit', ok.body.data.id]
    )
    expect(notifications).toHaveLength(1)
    expect(notifications[0].admin_user_id).toBe(admin.admin.id)
    expect(notifications[0].type).toBe('project')
    expect(notifications[0].title).toContain('异常签到')
    expect(notifications[0].content).toContain('GPS 漂移')
  })

  it('正常签到不发管理员通知', async () => {
    const { projectId, foreman } = await setup()
    const mediaId = await stage(projectId, foreman.token)
    const res = await submitReq(projectId, foreman.token, { ...near(), mediaIds: [mediaId] })
    expect(res.status).toBe(200)

    const rows = await db.query('SELECT * FROM admin_notification WHERE ref_type = ?', ['visit'])
    expect(rows).toHaveLength(0)
  })

  it('阈值变更只影响新签到，历史记录保留当时的阈值快照', async () => {
    const { projectId, foreman, supervisor } = await setup()
    await setThreshold(1, 100)

    const media1 = await stage(projectId, foreman.token)
    const first = await submitReq(projectId, foreman.token, {
      latitude: 31.2322, // 约 200m
      longitude: 121.4737,
      mediaIds: [media1],
      abnormalReason: '测试阈值',
    })
    expect(first.status).toBe(200)
    expect(first.body.data.thresholdM).toBe(100)
    expect(first.body.data.isAbnormal).toBe(true)

    await setThreshold(1, 500)

    const media2 = await stage(projectId, supervisor.token)
    const second = await submitReq(projectId, supervisor.token, {
      latitude: 31.2322,
      longitude: 121.4737,
      mediaIds: [media2],
    })
    expect(second.status).toBe(200)
    expect(second.body.data.thresholdM).toBe(500)
    expect(second.body.data.isAbnormal).toBe(false)

    const old = await db.query('SELECT threshold_m FROM visit_record WHERE id = ?', [first.body.data.id])
    expect(old[0].threshold_m).toBe('100.00')
  })
})

describe('现场签到 · 照片校验（AC-N22）', () => {
  it('没有照片、超过 3 张、重复 ID 都拒绝', async () => {
    const { projectId, foreman } = await setup()
    const mediaId = await stage(projectId, foreman.token)

    expect((await submitReq(projectId, foreman.token, { ...near(), mediaIds: [] })).status).toBe(400)
    expect(
      (await submitReq(projectId, foreman.token, { ...near(), mediaIds: [mediaId, mediaId] })).status
    ).toBe(400)
    expect(
      (await submitReq(projectId, foreman.token, { ...near(), mediaIds: [1, 2, 3, 4] })).status
    ).toBe(400)
  })

  it('不能消费别人的 / 别的项目的 / 已使用的照片', async () => {
    const first = await setup()
    const second = await setup({ name: '第二个项目' })

    // 同一项目下另一个用户的照片
    const foremanMedia = await stage(first.projectId, first.foreman.token)
    const otherForeman = await mini.login('visit-other-foreman')
    await mini.addMember({ projectId: first.projectId, userId: otherForeman.userId, role: 'foreman' })
    const crossUser = await submitReq(first.projectId, otherForeman.token, {
      ...near(),
      mediaIds: [foremanMedia],
    })
    expect(crossUser.status).toBe(400)

    // 别的项目的照片：该用户同时是两个项目的工长
    await mini.addMember({ projectId: second.projectId, userId: first.foreman.userId, role: 'foreman' })
    const crossProject = await submitReq(second.projectId, first.foreman.token, {
      ...near(),
      mediaIds: [foremanMedia],
    })
    expect(crossProject.status).toBe(400)

    // 已消费的照片不能再挂到另一条签到
    const usedMedia = await stage(second.projectId, first.foreman.token)
    const ok = await submitReq(second.projectId, first.foreman.token, {
      ...near(),
      mediaIds: [usedMedia],
    })
    expect(ok.status).toBe(200)

    await db.query("UPDATE visit_media_staging SET status = 'used' WHERE id = ?", [usedMedia])
    const reused = await submitReq(first.projectId, first.foreman.token, {
      ...near(),
      mediaIds: [usedMedia],
    })
    expect(reused.status).toBe(400)
  })

  it('签到只接受图片，视频在多文件上传层就被拒绝', async () => {
    const { projectId, foreman } = await setup()
    const fakeMp4 = Buffer.from([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    ])
    const res = await request
      .authed('post', `/projects/${projectId}/visits/media`, foreman.token)
      .attach('file', fakeMp4, { filename: 'site.mp4', contentType: 'video/mp4' })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('只支持上传照片')
  })
})

describe('现场签到 · 当日去重（AC-N25）', () => {
  it('同一人同项目同一天第二次签到返回 409，记录不增加', async () => {
    const { projectId, foreman } = await setup()
    const firstMedia = await stage(projectId, foreman.token)
    const first = await submitReq(projectId, foreman.token, {
      ...near(),
      mediaIds: [firstMedia],
    })
    expect(first.status).toBe(200)

    const secondMedia = await stage(projectId, foreman.token)
    const second = await submitReq(projectId, foreman.token, {
      ...near(),
      mediaIds: [secondMedia],
    })
    expect(second.status).toBe(409)
    expect(second.body.message).toBe('今日已签到')
    expect(second.body.data.visitId).toBe(first.body.data.id)

    const count = await db.count('FROM visit_record WHERE project_id = ?', [projectId])
    expect(count).toBe(1)
  })

  it('另一名成员同一天可以签到', async () => {
    const { projectId, foreman, supervisor } = await setup()
    const media1 = await stage(projectId, foreman.token)
    expect((await submitReq(projectId, foreman.token, { ...near(), mediaIds: [media1] })).status).toBe(200)

    const media2 = await stage(projectId, supervisor.token)
    expect((await submitReq(projectId, supervisor.token, { ...near(), mediaIds: [media2] })).status).toBe(200)
  })

  it('次日可以再次签到（service 注入时间）', async () => {
    const { projectId, foreman } = await setup()
    const media1 = await stage(projectId, foreman.token)
    expect((await submitReq(projectId, foreman.token, { ...near(), mediaIds: [media1] })).status).toBe(200)

    const media2 = await stage(projectId, foreman.token)
    const tomorrow = datetime.now().add(1, 'day')
    const second = await visitService.submitVisit(
      foreman.userId,
      projectId,
      { ...near(), mediaIds: [media2] },
      { now: tomorrow }
    )
    expect(second.id).toBeTruthy()
    expect(second.checkinAt).toBe(datetime.toDb(tomorrow))

    const count = await db.count('FROM visit_record WHERE project_id = ?', [projectId])
    expect(count).toBe(2)
  })
})

describe('现场签到 · 时间轴与详情（AC-N24 / AC-N26）', () => {
  it('列表倒序、分页，业主可读，非成员 404', async () => {
    const { projectId, foreman, supervisor, owner } = await setup()
    const media1 = await stage(projectId, foreman.token)
    const first = await submitReq(projectId, foreman.token, {
      ...near(),
      mediaIds: [media1],
      remark: '工长记录',
    })
    const media2 = await stage(projectId, supervisor.token)
    const second = await submitReq(projectId, supervisor.token, {
      ...near(),
      mediaIds: [media2],
      remark: '监理记录',
    })

    const list = await request.authed('get', `/projects/${projectId}/visits?page=1&pageSize=1`, owner.token)
    expect(list.status).toBe(200)
    expect(list.body.data.total).toBe(2)
    expect(list.body.data.list).toHaveLength(1)
    expect(list.body.data.list[0].id).toBe(second.body.data.id) // 倒序，最新的在前

    const page2 = await request.authed('get', `/projects/${projectId}/visits?page=2&pageSize=1`, owner.token)
    expect(page2.body.data.list[0].id).toBe(first.body.data.id)

    const stranger = await mini.login('visit-list-stranger')
    expect((await request.authed('get', `/projects/${projectId}/visits`, stranger.token)).status).toBe(404)
  })

  it('详情按 id 读取；非成员 404；接口不提供修改 / 删除', async () => {
    const { projectId, foreman, owner } = await setup()
    const media = await stage(projectId, foreman.token)
    const created = await submitReq(projectId, foreman.token, { ...near(), mediaIds: [media] })
    const visitId = created.body.data.id

    const detail = await request.authed('get', `/visits/${visitId}`, owner.token)
    expect(detail.status).toBe(200)
    expect(detail.body.data.id).toBe(visitId)

    const stranger = await mini.login('visit-detail-stranger')
    expect((await request.authed('get', `/visits/${visitId}`, stranger.token)).status).toBe(404)

    expect((await request.authed('put', `/visits/${visitId}`, foreman.token)).status).toBe(404)
    expect((await request.authed('del', `/visits/${visitId}`, foreman.token)).status).toBe(404)
    expect(visitRecordModel.update).toBeUndefined()
    expect(visitRecordModel.delete).toBeUndefined()
    expect(visitRecordModel.remove).toBeUndefined()
  })
})

describe('现场签到 · meta', () => {
  it('工长签到前 / 后与业主的引导信息', async () => {
    const { projectId, foreman, owner } = await setup()

    const before = await request.authed('get', `/projects/${projectId}/visits/meta`, foreman.token)
    expect(before.status).toBe(200)
    expect(before.body.data.canCheckin).toBe(true)
    expect(before.body.data.thresholdM).toBe(500)
    expect(before.body.data.maxPhotos).toBe(3)
    expect(before.body.data.todayVisit).toBeNull()

    const media = await stage(projectId, foreman.token)
    const created = await submitReq(projectId, foreman.token, { ...near(), mediaIds: [media] })

    const after = await request.authed('get', `/projects/${projectId}/visits/meta`, foreman.token)
    expect(after.body.data.canCheckin).toBe(false)
    expect(after.body.data.reason).toBe('ALREADY_CHECKED_IN')
    expect(after.body.data.todayVisit.id).toBe(created.body.data.id)

    const ownerMeta = await request.authed('get', `/projects/${projectId}/visits/meta`, owner.token)
    expect(ownerMeta.status).toBe(200)
    expect(ownerMeta.body.data.canCheckin).toBe(false)
    expect(ownerMeta.body.data.reason).toBe('ROLE_NOT_ALLOWED')
  })
})

describe('现场签到 · 考察计划联动（AC-N23）', () => {
  async function createPlan(token, projectIds) {
    const res = await request.authed('post', '/route-plans', token).send({
      name: '测试考察计划',
      originType: 'custom',
      origin: { latitude: 31.2304, longitude: 121.4737, name: '公司' },
      projectIds,
    })
    expect(res.status).toBe(200)
    return res.body.data
  }

  it('从考察计划签到后回填 visited_at，进度计数增加', async () => {
    const first = await setup({ name: '路线项目一' })
    const secondProjectId = await mini.createProject({
      name: '路线项目二',
      address: '上海市徐汇区漕溪北路 88 号',
      latitude: 31.195,
      longitude: 121.437,
      createdBy: first.admin.admin.id,
    })
    await mini.addMember({ projectId: secondProjectId, userId: first.foreman.userId, role: 'foreman' })

    const plan = await createPlan(first.foreman.token, [first.projectId, secondProjectId])
    // 服务端可能按最近邻重排顺序，不能假设第一个项目就是 seq 1
    const seq = plan.points.find((point) => point.projectId === first.projectId).seq
    const media = await stage(first.projectId, first.foreman.token)
    const res = await submitReq(first.projectId, first.foreman.token, {
      ...near(),
      mediaIds: [media],
      routePlanId: plan.id,
      seqInPlan: seq,
    })
    expect(res.status).toBe(200)
    expect(res.body.data.route).toEqual({ planId: plan.id, seqInPlan: seq })

    const point = await db.queryOne(
      'SELECT visited_at FROM route_plan_point WHERE route_plan_id = ? AND seq = ?',
      [plan.id, seq]
    )
    expect(point.visited_at).toBe(res.body.data.checkinAt)

    const detail = await request.authed('get', `/route-plans/${plan.id}`, first.foreman.token)
    expect(detail.body.data.visitedCount).toBe(1)
    expect(
      detail.body.data.points.find((item) => item.seq === seq).visitedAt
    ).toBe(res.body.data.checkinAt)
  })

  it('错误的计划 / 序号 / 项目对应关系返回 400', async () => {
    const first = await setup({ name: '路线项目一' })
    const secondProjectId = await mini.createProject({
      name: '路线项目二',
      address: '上海市徐汇区漕溪北路 88 号',
      latitude: 31.195,
      longitude: 121.437,
      createdBy: first.admin.admin.id,
    })
    await mini.addMember({ projectId: secondProjectId, userId: first.foreman.userId, role: 'foreman' })
    const plan = await createPlan(first.foreman.token, [first.projectId, secondProjectId])
    const otherSeq = plan.points.find((point) => point.projectId === secondProjectId).seq

    const media1 = await stage(first.projectId, first.foreman.token)
    const wrongProject = await submitReq(first.projectId, first.foreman.token, {
      ...near(),
      mediaIds: [media1],
      routePlanId: plan.id,
      seqInPlan: otherSeq, // 该站属于另一个项目
    })
    expect(wrongProject.status).toBe(400)

    const media2 = await stage(first.projectId, first.foreman.token)
    const wrongSeq = await submitReq(first.projectId, first.foreman.token, {
      ...near(),
      mediaIds: [media2],
      routePlanId: plan.id,
      seqInPlan: 99,
    })
    expect(wrongSeq.status).toBe(400)

    const media3 = await stage(first.projectId, first.foreman.token)
    const missingPair = await submitReq(first.projectId, first.foreman.token, {
      ...near(),
      mediaIds: [media3],
      routePlanId: plan.id,
    })
    expect(missingPair.status).toBe(400)
  })
})

describe('现场签到 · 暂存清理', () => {
  it('过期未提交的照片会被认领、删文件并删行', async () => {
    const { projectId, foreman } = await setup()
    const res = await stageReq(projectId, foreman.token, await makeJpeg())
    const mediaId = res.body.data.mediaId
    const key = storage.extractKey(res.body.data.url)

    expect(fs.existsSync(path.join(config.upload.dir, key))).toBe(true)

    // 把创建时间改到两天前，模拟用户上传后离开
    await db.query(
      "UPDATE visit_media_staging SET created_at = ? WHERE id = ?",
      [datetime.now().subtract(2, 'day').format(datetime.DATETIME_FORMAT), mediaId]
    )

    const result = await visitMediaCleanup.runOnce({ now: datetime.now() })
    expect(result.claimed).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(path.join(config.upload.dir, key))).toBe(false)

    const row = await db.queryOne('SELECT id FROM visit_media_staging WHERE id = ?', [mediaId])
    expect(row).toBeNull()
  })
})

describe('现场签到 · 跨租户', () => {
  it('租户 2 的项目使用租户 2 的阈值与通知', async () => {
    const tenantId = await fixtures.createTenant({ name: '签到租户二' })
    const ownerAdmin = await auth.createAndLogin({
      username: `owner-t${tenantId}`,
      role: 'owner',
      tenantId,
    })
    await setThreshold(tenantId, 100)

    const { projectId, foreman } = await setup({
      name: '租户二项目',
      tenantId,
      ownerAdmin,
    })

    const media = await stage(projectId, foreman.token)
    const res = await submitReq(projectId, foreman.token, {
      latitude: 31.2322, // 约 200m，超过租户 2 的 100m 阈值
      longitude: 121.4737,
      mediaIds: [media],
      abnormalReason: '跨租户阈值测试',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.thresholdM).toBe(100)
    expect(res.body.data.isAbnormal).toBe(true)

    const notifications = await db.query(
      'SELECT * FROM admin_notification WHERE ref_type = ? AND ref_id = ?',
      ['visit', res.body.data.id]
    )
    expect(notifications).toHaveLength(1)
    expect(notifications[0].tenant_id).toBe(tenantId)
  })
})
