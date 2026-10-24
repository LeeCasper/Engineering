'use strict'

/**
 * 验收模块集成测试（AC-A01 ~ AC-A26）。
 *
 * 这是本轮逻辑最密的一个模块：状态机、多角色权限、只追加的流转记录、
 * 事务外联动（付款节点解锁 / PDF 生成）。因此断言的重点不只是「成功了吗」，
 * 更多是「**不该成功的有没有被拦住**」与「失败之后状态有没有被搞脏」。
 */

const sharp = require('sharp')
const fs = require('node:fs')
const path = require('node:path')

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const config = require('../../config')
const sysConfigService = require('../../src/services/sysConfig.service')
const signedUrl = require('../../src/utils/signedUrl')
const acceptanceService = require('../../src/services/acceptance.service')
const acceptanceTimeoutJob = require('../../src/jobs/acceptanceTimeout')
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
  await cache.flush()
  await fixtures.resetBusinessTables()
  sysConfigService.invalidate()
})

async function makeJpeg(width = 400, height = 300) {
  return sharp({ create: { width, height, channels: 3, background: { r: 230, g: 235, b: 240 } } })
    .jpeg({ quality: 80 })
    .toBuffer()
}

/** 一张带明显笔迹的「签名」图（白底 + 深色横线，够当图片处理） */
async function makeSignature() {
  return sharp({
    create: { width: 300, height: 120, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><path d="M20 80 Q 80 20 140 80 T 280 60" stroke="#111" stroke-width="3" fill="none"/></svg>'
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg()
    .toBuffer()
}

/**
 * 准备一个可以进行验收的项目：
 * 阶段进度 100%、主工长 + 监理 + 业主各一名、一个付款节点关联该阶段。
 */
async function setup({ withSupervisor = true, completeStage = true, gateStatus } = {}) {
  const admin = await auth.createAndLogin({ username: 'admin', role: 'owner' })
  const templateId = await fixtures.createTemplate({
    name: '模板',
    stages: [
      {
        name: '水电工程',
        planDays: 10,
        items: [{ name: '强电布线', checklist: ['强弱电分管分槽，间距 ≥ 30cm', '线管固定牢固，无松动'] }],
      },
      { name: '泥瓦工程', planDays: 10, items: [{ name: '防水施工' }] },
    ],
  })

  const created = await request.authed('post', '/admin/projects', admin.token).send({
    name: '测试项目',
    address: '上海市浦东新区世纪大道 100 号',
    contractAmount: '200000.00',
    startDate: '2026-01-01',
    planEndDate: '2026-06-01',
    templateId,
  })
  const projectId = created.body.data.id

  const detail = await request.authed('get', `/admin/projects/${projectId}`, admin.token)
  const stages = detail.body.data.stages
  const stageId = stages[0].id
  const itemId = stages[0].items[0].id

  const foreman = await mini.login('code-foreman')
  const owner = await mini.login('code-owner')
  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, is_primary, confirmed_at, joined_at)
     VALUES (?, ?, 'foreman', 'active', 1, NOW(), NOW())`,
    [projectId, foreman.userId]
  )
  await db.query(
    "INSERT INTO project_member (project_id, user_id, role, status, owner_type, confirmed_at, joined_at) VALUES (?, ?, 'owner', 'active', 'primary', NOW(), NOW())",
    [projectId, owner.userId]
  )

  let supervisor = null
  if (withSupervisor) {
    supervisor = await mini.login('code-supervisor')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status, confirmed_at, joined_at) VALUES (?, ?, 'supervisor', 'active', NOW(), NOW())",
      [projectId, supervisor.userId]
    )
  }

  if (completeStage) {
    // 直接把工序推到 100%，走的是 M6 的写入口，因此阶段完成度与门禁也会同步推进
    const progressService = require('../../src/services/progress.service')
    await progressService.applyItemProgress({
      projectId,
      itemId,
      userId: foreman.userId,
      progress: '100',
    })
  }

  if (gateStatus) {
    await db.query('UPDATE project_stage SET gate_status = ? WHERE id = ?', [gateStatus, stageId])
  }

  // 付款节点：一个关联阶段验收（应被解锁），一个手动触发（不该被动）
  await request.authed('put', `/admin/projects/${projectId}/payment-nodes`, admin.token).send({
    nodes: [
      { name: '水电验收款', amount: '60000.00', triggerType: 'stage_acceptance', triggerStageId: stageId },
      { name: '尾款', amount: '140000.00', triggerType: 'manual' },
    ],
  })

  return { admin, projectId, stageId, itemId, stages, foreman, owner, supervisor }
}

/** 发起验收 */
function initiate(ctx, token, fields = {}, files = []) {
  const req = request.post(`/projects/${ctx.projectId}/acceptances`).set('Authorization', `Bearer ${token}`)
  for (const [key, value] of Object.entries(fields)) req.field(key, String(value))
  for (const file of files) {
    req.attach(file.field || 'files', file.buffer, {
      filename: file.name || 'photo.jpg',
      contentType: file.mime || 'image/jpeg',
    })
  }
  return req
}

/** 走完整条通过流程，返回验收单 id */
async function passThrough(ctx, { signature = true } = {}) {
  const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId, description: '申请验收' })
  const id = created.body.data.id

  const items = created.body.data.items.map((i) => ({ id: i.id, result: 'pass' }))
  await mini.authed('post', `/acceptances/${id}/self-check`, ctx.foreman.token).send({ items })

  if (ctx.supervisor) {
    await mini.authed('post', `/acceptances/${id}/approve`, ctx.supervisor.token)
  }

  const req = mini.authed('post', `/acceptances/${id}/approve`, ctx.owner.token)
  if (signature) {
    req.attach('signature', await makeSignature(), { filename: 'sign.png', contentType: 'image/png' })
  }
  await req

  return id
}

describe('AC-A01 / AC-A02 / AC-A24 发起验收的前置条件', () => {
  it('AC-A24 仅主工长可发起，普通工长与业主均 403', async () => {
    const ctx = await setup()

    // 普通工长（非主工长）
    const ordinary = await mini.login('code-foreman-2')
    await db.query(
      `INSERT INTO project_member (project_id, user_id, role, status, is_primary, confirmed_at, joined_at)
       VALUES (?, ?, 'foreman', 'active', 0, NOW(), NOW())`,
      [ctx.projectId, ordinary.userId]
    )

    const byOrdinary = await initiate(ctx, ordinary.token, { stageId: ctx.stageId })
    expect(byOrdinary.status).toBe(403)
    expect(byOrdinary.body.message).toContain('主工长')

    const byOwner = await initiate(ctx, ctx.owner.token, { stageId: ctx.stageId })
    expect(byOwner.status).toBe(403)
  })

  it('AC-A01 阶段进度未达 100% 时拒绝发起，并说明当前进度', async () => {
    const ctx = await setup({ completeStage: false })

    const res = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('未达 100%')
  })

  it('AC-A02 进度补齐到 100% 后即可发起', async () => {
    const ctx = await setup({ completeStage: false })
    expect((await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })).status).toBe(409)

    const progressService = require('../../src/services/progress.service')
    await progressService.applyItemProgress({
      projectId: ctx.projectId,
      itemId: ctx.itemId,
      userId: ctx.foreman.userId,
      progress: '100',
    })

    const res = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    expect(res.status).toBe(200)
    // C-7.4 / §4.7.1：进度满 100% 时门禁由 active 进入 pending_acceptance
    const stage = await db.queryOne('SELECT gate_status FROM project_stage WHERE id = ?', [ctx.stageId])
    expect(stage.gate_status).toBe('pending_acceptance')
  })

  it('没有现场照片时支持 JSON 发起（前端不必强制 multipart）', async () => {
    const ctx = await setup()

    const res = await mini
      .authed('post', `/projects/${ctx.projectId}/acceptances`, ctx.foreman.token)
      .send({ stageId: ctx.stageId })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('draft')
  })

  it('工序级验收要求该工序本身也满 100%', async () => {
    const ctx = await setup({ completeStage: false })
    const res = await initiate(ctx, ctx.foreman.token, { itemId: ctx.itemId })
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('未达 100%')
  })

  it('既没传 stageId 也没传 itemId 时拒绝', async () => {
    const ctx = await setup()
    const res = await initiate(ctx, ctx.foreman.token, {})
    expect(res.status).toBe(400)
  })

  it('AC-S10 上一阶段未结清（gate_status=locked）时拒绝发起', async () => {
    const ctx = await setup({ gateStatus: 'locked' })
    const res = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('未结清')
  })

  it('已验收通过的阶段不能重复发起', async () => {
    const ctx = await setup({ gateStatus: 'accepted' })
    const res = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('已验收')
  })

  it('归档项目不能发起验收（AC-AD25）', async () => {
    const ctx = await setup()
    await db.query("UPDATE project SET status = 'archived', archived_at = NOW() WHERE id = ?", [ctx.projectId])

    const res = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('归档')
  })

  it('发起时上传的现场照片由服务端叠加水印', async () => {
    const ctx = await setup()
    const res = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId, description: '申请验收' }, [
      { buffer: await makeJpeg() },
    ])

    expect(res.status).toBe(200)
    const photo = res.body.data.photos[0]
    expect(photo.originalUrl).toBeTruthy()
    expect(photo.url).not.toBe(photo.originalUrl)
  })

  it('AC-AD32 自检清单由工序的 checklist 带入', async () => {
    const ctx = await setup()
    const res = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })

    const names = res.body.data.items.map((i) => i.name)
    expect(names).toHaveLength(2)
    // 阶段级验收时把工序名拼进验收项，否则散项看不出归属
    expect(names[0]).toContain('强电布线')
    expect(names[0]).toContain('强弱电分管分槽')
  })
})

describe('AC-A03 / AC-A04 / AC-A06 状态机边界', () => {
  it('AC-A03 同一阶段存在未终结验收单时重复发起返回 409', async () => {
    const ctx = await setup()
    const first = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    expect(first.status).toBe(200)

    const second = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    expect(second.status).toBe(409)
    expect(second.body.data.acceptanceId).toBe(first.body.data.id)
  })

  it('AC-A03 并发发起也只成功一次（行锁兜底）', async () => {
    const ctx = await setup()

    const results = await Promise.all([
      initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId }),
      initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId }),
      initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId }),
    ])

    // 「未终结」是状态条件而非唯一键，唯一索引帮不上忙 ——
    // 因此必须靠 SELECT ... FOR UPDATE，否则并发下会插出多张
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(await db.count('FROM acceptance WHERE project_stage_id = ?', [ctx.stageId])).toBe(1)
  })

  it('草稿状态不能直接通过（AC-A04 非法跃迁）', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })

    const res = await mini.authed('post', `/acceptances/${created.body.data.id}/approve`, ctx.supervisor.token)
    expect(res.status).toBe(409)
  })

  it('待监理审核时业主不能越过监理直接确认', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const res = await mini
      .authed('post', `/acceptances/${created.body.data.id}/approve`, ctx.owner.token)
      .attach('signature', await makeSignature(), { filename: 'sign.png', contentType: 'image/png' })
    expect(res.status).toBe(403)
  })

  it('AC-A06 已通过的验收单是终态，任何操作都被拒绝', async () => {
    const ctx = await setup()
    const id = await passThrough(ctx)

    const attempts = [
      await mini.authed('post', `/acceptances/${id}/approve`, ctx.owner.token),
      await mini.authed('post', `/acceptances/${id}/reject`, ctx.supervisor.token).send({ reason: '反悔了' }),
      await mini.authed('post', `/acceptances/${id}/self-check`, ctx.foreman.token).send({ items: [] }),
      await mini.authed('post', `/acceptances/${id}/resubmit`, ctx.foreman.token).send({}),
      await mini.authed('put', `/acceptances/${id}`, ctx.foreman.token).send({ description: '改一下' }),
    ]
    for (const res of attempts) {
      expect(res.status).toBe(409)
      expect(res.body.message).toContain('已通过')
    }
  })
})

describe('AC-A05 / AC-A09 监理环节的跳过', () => {
  it('AC-A05 未配置监理时自检后直接进入待业主确认', async () => {
    const ctx = await setup({ withSupervisor: false })
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })

    const res = await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('pending_owner')
    expect(res.body.data.currentStep).toBe('owner')

    // 流程记录里不该出现「待监理审核」这一环
    const flow = await mini.authed('get', `/acceptances/${created.body.data.id}/flow`, ctx.foreman.token)
    expect(flow.body.data.rounds[0].entries.map((e) => e.step)).toEqual(['self_check'])
  })

  it('AC-A09 有监理时自检后进入待监理审核', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })

    const res = await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    expect(res.body.data.status).toBe('pending_supervisor')
    expect(res.body.data.currentStep).toBe('supervisor')
  })

  it('只有 pending（未确认）的监理时同样跳过该环节（AC-AD18）', async () => {
    const ctx = await setup({ withSupervisor: false })
    const pendingSupervisor = await mini.login('code-pending-supervisor')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status) VALUES (?, ?, 'supervisor', 'pending')",
      [ctx.projectId, pendingSupervisor.userId]
    )

    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const res = await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    // pending 的监理还没确认邀请，若把他算进去，单子会卡在一个永远不会有人处理的状态
    expect(res.body.data.status).toBe('pending_owner')
  })
})

describe('AC-A07 / AC-A08 自检与草稿', () => {
  it('AC-A07 存在未勾选项时拒绝提交，并列出缺失项', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const items = created.body.data.items

    const partial = await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: [{ id: items[0].id, result: 'pass' }] })

    expect(partial.status).toBe(400)
    expect(partial.body.message).toContain('未勾选')
    expect(partial.body.data.missingItems).toHaveLength(1)
    expect(partial.body.data.missingItems[0].id).toBe(items[1].id)
  })

  it('自检项被标记为不合格时不允许提交（该先整改）', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const items = created.body.data.items

    const res = await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: [{ id: items[0].id, result: 'pass' }, { id: items[1].id, result: 'fail' }] })

    expect(res.status).toBe(409)
    expect(res.body.message).toContain('未通过')
  })

  it('AC-A08 草稿可保存并继续编辑，且不计入任何角色的待办', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })

    const saved = await mini
      .authed('put', `/acceptances/${created.body.data.id}`, ctx.foreman.token)
      .send({ description: '写了一半', items: [{ id: created.body.data.items[0].id, result: 'pass' }] })
    expect(saved.status).toBe(200)
    expect(saved.body.data.description).toBe('写了一半')

    // 各方视角下待办都应为 0 —— 草稿是「没写完的东西」，计入待办等于催自己交作业
    for (const token of [ctx.foreman.token, ctx.supervisor.token, ctx.owner.token]) {
      const list = await mini.authed('get', `/projects/${ctx.projectId}/acceptances`, token)
      expect(list.body.data.todoCount).toBe(0)
    }
  })
})

describe('AC-A10 ~ AC-A15 审核、驳回与整改', () => {
  it('AC-A11 驳回原因必填', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const empty = await mini
      .authed('post', `/acceptances/${created.body.data.id}/reject`, ctx.supervisor.token)
      .send({ reason: '   ' })
    expect(empty.status).toBe(400)
    expect(empty.body.message).toContain('驳回原因必填')
  })

  it('AC-A10 监理只能处理待监理审核的单，对业主环节的单返回 403', async () => {
    const ctx = await setup({ withSupervisor: false })
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const lone = await mini.login('code-lone-supervisor')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status, confirmed_at) VALUES (?, ?, 'supervisor', 'active', NOW())",
      [ctx.projectId, lone.userId]
    )

    const res = await mini
      .authed('post', `/acceptances/${created.body.data.id}/approve`, lone.token)
    expect(res.status).toBe(403)
  })

  it('AC-A12 / AC-A13 驳回可附照片，状态变为待整改，记录完整保留', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const id = created.body.data.id
    await mini
      .authed('post', `/acceptances/${id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const rejected = await mini
      .authed('post', `/acceptances/${id}/reject`, ctx.supervisor.token)
      // multipart 请求要用 .field() 而不是 .send() —— supertest 不允许两者混用，
      // 混用会直接报 "can't mix .send() and .attach()"
      .field('reason', '线管固定不牢，第二张照片可见松动')
      .attach('files', await makeJpeg(), { filename: 'issue.jpg', contentType: 'image/jpeg' })

    expect(rejected.status).toBe(200)
    expect(rejected.body.data.status).toBe('pending_rectify')

    const flow = rejected.body.data.flow
    const rejectEntry = flow.find((e) => e.action === 'reject')
    expect(rejectEntry.reason).toContain('线管固定不牢')
    expect(rejectEntry.images).toHaveLength(1)
    expect(rejectEntry.round).toBe(1)
  })

  it('AC-A14 重新提交后回到流程首环节，此前记录不被覆盖或删除', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const id = created.body.data.id
    const items = created.body.data.items.map((i) => ({ id: i.id, result: 'pass' }))

    await mini.authed('post', `/acceptances/${id}/self-check`, ctx.foreman.token).send({ items })
    await mini.authed('post', `/acceptances/${id}/reject`, ctx.supervisor.token).send({ reason: '不合格' })

    const resubmitted = await mini
      .authed('post', `/acceptances/${id}/resubmit`, ctx.foreman.token)
      .send({ items, description: '已整改' })

    expect(resubmitted.status).toBe(200)
    expect(resubmitted.body.data.status).toBe('pending_supervisor')
    expect(resubmitted.body.data.resubmitCount).toBe(1)

    const flow = resubmitted.body.data.flow
    // 创建草稿**不写**流转记录（草稿只是没写完的东西），
    // 因此第 1 轮是「提交 + 驳回」两条，第 2 轮是「重新提交」一条
    expect(flow).toHaveLength(3)
    expect(flow.map((e) => e.round)).toEqual([1, 1, 2])
    expect(flow[1].reason).toBe('不合格')

    // submitted_at 是「首次提交」，重新提交不改它（G-01）
    const row = await db.queryOne('SELECT submitted_at, resubmit_count FROM acceptance WHERE id = ?', [id])
    expect(row.resubmit_count).toBe(1)
    expect(row.submitted_at).toBeTruthy()
  })

  it('AC-A15 业主可驳回待业主确认的单', async () => {
    const ctx = await setup({ withSupervisor: false })
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const res = await mini
      .authed('post', `/acceptances/${created.body.data.id}/reject`, ctx.owner.token)
      .send({ reason: '墙面还有一处没补平' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('pending_rectify')
  })
})

describe('AC-A16 / AC-A17 电子签名', () => {
  it('AC-A16 业主确认未带签名时拒绝', async () => {
    const ctx = await setup({ withSupervisor: false })
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const res = await mini.authed('post', `/acceptances/${created.body.data.id}/approve`, ctx.owner.token)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('签名')
  })

  it('AC-A17 签名与验收单一并归档，详情页可查看', async () => {
    const ctx = await setup({ withSupervisor: false })
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const id = created.body.data.id
    await mini
      .authed('post', `/acceptances/${id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const approved = await mini
      .authed('post', `/acceptances/${id}/approve`, ctx.owner.token)
      .attach('signature', await makeSignature(), { filename: 'sign.png', contentType: 'image/png' })

    expect(approved.status).toBe(200)
    expect(approved.body.data.status).toBe('passed')
    expect(approved.body.data.signatureUrl).toContain('/uploads/signatures/')

    // 文件真的存在
    const key = approved.body.data.signatureUrl.split('/uploads/')[1]
    expect(fs.existsSync(path.join(config.upload.dir, key))).toBe(true)
  })

  it('监理环节通过不需要签名', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const res = await mini.authed('post', `/acceptances/${created.body.data.id}/approve`, ctx.supervisor.token)
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('pending_owner')
  })
})

describe('AC-A21 验收通过与付款节点联动', () => {
  it('解锁关联该阶段的付款节点，手动触发的节点不受影响', async () => {
    const ctx = await setup()
    await passThrough(ctx)

    const nodes = await db.query('SELECT name, trigger_type, status FROM payment_node ORDER BY seq')
    const byName = Object.fromEntries(nodes.map((n) => [n.name, n]))

    expect(byName['水电验收款'].status).toBe('unlocked')
    // 手动触发的节点只能由管理员在后台解锁（AC-L15）
    expect(byName['尾款'].status).toBe('not_started')
  })

  it('验收通过后工长与业主各收到一条通知', async () => {
    const ctx = await setup()
    await passThrough(ctx)

    const rows = await db.query("SELECT user_id, type, title FROM notification WHERE type = 'payment'")
    const userIds = rows.map((r) => r.user_id)
    expect(userIds).toContain(ctx.foreman.userId)
    expect(userIds).toContain(ctx.owner.userId)
    expect(rows[0].title).toContain('付款节点已解锁')
  })

  it('阶段门禁进入 accepted 而**不是** settled（结算要等对账，AC-S08）', async () => {
    const ctx = await setup()
    await passThrough(ctx)

    const stage = await db.queryOne('SELECT gate_status, status FROM project_stage WHERE id = ?', [ctx.stageId])
    expect(stage.gate_status).toBe('accepted')
    // 展示状态派生出「已验收」（AC-P02）
    expect(stage.status).toBe('accepted')
  })

  it('重复触达解锁不会把已解锁的节点退回', async () => {
    const ctx = await setup()
    const id = await passThrough(ctx)

    // 再跑一次联动（模拟重试）
    const acceptance = await require('../../src/models/acceptance.model').findById(id)
    await require('../../src/services/acceptance.service')
    await db.withTransaction((tx) =>
      require('../../src/models/paymentNode.model').unlockByStage(ctx.projectId, ctx.stageId, tx)
    )
    expect(acceptance.status).toBe('passed')

    const node = await db.queryOne("SELECT status FROM payment_node WHERE name = '水电验收款'")
    // AC-L13：节点状态只能单向流转，降级会把已登记的收款状态抹掉
    expect(node.status).toBe('unlocked')
  })
})

describe('AC-A18 / AC-A19 / AC-A20 验收报告 PDF', () => {
  it('AC-A18 验收通过后自动生成 PDF，内容含验收项、照片、审核意见与签名', async () => {
    const ctx = await setup()
    const id = await passThrough(ctx)

    const row = await db.queryOne('SELECT report_pdf_status, report_pdf_url FROM acceptance WHERE id = ?', [id])
    expect(row.report_pdf_status).toBe('success')
    expect(row.report_pdf_url).toContain('/uploads/acceptance-reports/')

    const key = row.report_pdf_url.split('/uploads/')[1]
    const fullPath = path.join(config.upload.dir, key)
    expect(fs.existsSync(fullPath)).toBe(true)

    const pdf = fs.readFileSync(fullPath)
    // PDF 文件头
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    // 内嵌了字体 —— 这是中文能正常显示的前提。
    // FontFile2 用于 TrueType，FontFile3 用于 OpenType/CFF，
    // 而 Noto Sans CJK 是 CFF 的，因此两种都要接受
    expect(/FontFile[23]/.test(pdf.toString('latin1'))).toBe(true)
    expect(pdf.length).toBeGreaterThan(5000)
  })

  it('AC-A19 PDF 生成失败不阻断验收进入已通过，且提供重试入口', async () => {
    const ctx = await setup()
    const storage = require('../../src/storage')

    // 让**保存**这一步失败，而不是把 generate 整个替换掉。
    // 替换 generate 就绕过了它内部的 try/catch，report_pdf_status 会停在默认值上，
    // 测不到「失败被记录成 failed」这个真正要验的行为。
    // 打桩打在 render 之后的落盘步骤上，才能走完真实的失败路径
    const originalSaveGenerated = storage.saveGenerated
    storage.saveGenerated = async () => {
      throw new Error('模拟的磁盘写入失败')
    }

    try {
      const id = await passThrough(ctx)

      const row = await db.queryOne(
        'SELECT status, report_pdf_status, report_pdf_error FROM acceptance WHERE id = ?',
        [id]
      )
      // 关键：验收**确实通过了**，PDF 失败没有把它拖住
      expect(row.status).toBe('passed')
      expect(row.report_pdf_status).toBe('failed')
      expect(row.report_pdf_error).toContain('模拟的磁盘写入失败')

      // 恢复后可以通过重试入口补生成（AC-A19 的「提供可重试入口」）
      storage.saveGenerated = originalSaveGenerated
      const retried = await mini.authed('post', `/acceptances/${id}/report/retry`, ctx.owner.token)
      expect(retried.status).toBe(200)
      expect(retried.body.data.reportPdf.status).toBe('success')
    } finally {
      storage.saveGenerated = originalSaveGenerated
    }
  })

  it('字体缺失时 PDF 生成直接报错，而不是产出无法阅读的报告', () => {
    const acceptancePdfService = require('../../src/services/acceptancePdf.service')
    expect(() => acceptancePdfService.checkFontAvailable('/nonexistent/font.ttc')).toThrow(/字体文件不存在/)
    expect(acceptancePdfService.checkFontAvailable(config.acceptancePdf.fontPath)).toBe(true)
  })

  it('AC-A20 通过带签名的临时 URL 下载，签名错误或过期被拒绝', async () => {
    const ctx = await setup()
    const id = await passThrough(ctx)

    const detail = await mini.authed('get', `/acceptances/${id}`, ctx.owner.token)
    const signedPath = detail.body.data.reportPdf.signedPath
    expect(signedPath).toContain('expires=')
    expect(signedPath).toContain('sig=')

    // 带正确签名：无需登录态即可下载（AC-A20 要求可转发）
    const ok = await request.raw('get', signedPath)
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toContain('application/pdf')

    // 篡改签名
    const tampered = signedPath.replace(/sig=[0-9a-f]+/, 'sig=' + 'a'.repeat(64))
    expect((await request.raw('get', tampered)).status).toBe(403)

    // 过期
    const expired = signedUrl.buildPath({
      resource: 'acceptance-report',
      id,
      path: `/api/v1/acceptances/${id}/report.pdf`,
      ttlSeconds: -10,
    })
    const expiredRes = await request.raw('get', expired)
    expect(expiredRes.status).toBe(403)
    expect(expiredRes.body.message).toContain('过期')

    // 过期后重新获取即可正常下载
    const refreshed = await mini.authed('get', `/acceptances/${id}`, ctx.owner.token)
    expect((await request.raw('get', refreshed.body.data.reportPdf.signedPath)).status).toBe(200)
  })

  it('签名 URL 不能跨验收单复用', async () => {
    const ctx = await setup()
    const idA = await passThrough(ctx)

    // 另一张单的签名不能拿来下载 A 的报告
    const { expires, signature } = signedUrl.sign({ resource: 'acceptance-report', id: idA + 1 })
    const res = await request.raw(
      'get',
      `/api/v1/acceptances/${idA}/report.pdf?expires=${expires}&sig=${signature}`
    )
    expect(res.status).toBe(403)
  })

  it('报告尚未生成时下载返回 404', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const id = created.body.data.id

    const { expires, signature } = signedUrl.sign({ resource: 'acceptance-report', id })
    const res = await request.raw('get', `/api/v1/acceptances/${id}/report.pdf?expires=${expires}&sig=${signature}`)
    expect(res.status).toBe(404)
  })
})

describe('AC-A22 验收超时提醒', () => {
  it('超过配置时长未处理时向当前环节负责人推送一次', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    // 把进入环节的时间改到 49 小时前
    const datetime = require('../../src/utils/datetime')
    await db.query('UPDATE acceptance SET step_entered_at = ? WHERE id = ?', [
      datetime.now().subtract(49, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      created.body.data.id,
    ])

    const result = await acceptanceTimeoutJob.runOnce()
    expect(result.reminded).toBe(1)

    // 监理还会收到「有一张验收单待你审核」，因此要挑出超时那一条
    const notification = await db.queryOne(
      "SELECT user_id, title FROM notification WHERE user_id = ? AND type = 'acceptance' AND title LIKE '%等待超过%'",
      [ctx.supervisor.userId]
    )
    expect(notification).toBeTruthy()
    expect(notification.title).toContain('48 小时')
  })

  it('未超时不提醒；重复扫描不重复推送', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    // 未超时
    expect((await acceptanceTimeoutJob.runOnce()).reminded).toBe(0)

    const datetime = require('../../src/utils/datetime')
    await db.query('UPDATE acceptance SET step_entered_at = ? WHERE id = ?', [
      datetime.now().subtract(49, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      created.body.data.id,
    ])

    expect((await acceptanceTimeoutJob.runOnce()).reminded).toBe(1)
    expect((await acceptanceTimeoutJob.runOnce()).reminded).toBe(0)
    expect((await acceptanceTimeoutJob.runOnce()).reminded).toBe(0)
  })

  it('超时时长可通过系统配置调整（B-5.3）', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const datetime = require('../../src/utils/datetime')
    await db.query('UPDATE acceptance SET step_entered_at = ? WHERE id = ?', [
      datetime.now().subtract(5, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      created.body.data.id,
    ])

    expect((await acceptanceTimeoutJob.runOnce()).reminded).toBe(0)

    await db.query(
      `INSERT INTO sys_config (tenant_id, config_key, config_value, scope, description)
       VALUES (1, 'acceptance_timeout_hours', '4', 'global', 'test')
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`
    )
    sysConfigService.invalidate()

    expect((await acceptanceTimeoutJob.runOnce()).reminded).toBe(1)
  })

  it('重新提交后进入新的一轮，会再次提醒（不是同一次超时的重复）', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const id = created.body.data.id
    const items = created.body.data.items.map((i) => ({ id: i.id, result: 'pass' }))
    await mini.authed('post', `/acceptances/${id}/self-check`, ctx.foreman.token).send({ items })

    const datetime = require('../../src/utils/datetime')
    const old = datetime.now().subtract(49, 'hour').format('YYYY-MM-DD HH:mm:ss')
    await db.query('UPDATE acceptance SET step_entered_at = ? WHERE id = ?', [old, id])
    expect((await acceptanceTimeoutJob.runOnce()).reminded).toBe(1)

    // 被驳回 → 重新提交 → 又进入待监理审核
    await mini.authed('post', `/acceptances/${id}/reject`, ctx.supervisor.token).send({ reason: '重做' })
    await mini.authed('post', `/acceptances/${id}/resubmit`, ctx.foreman.token).send({ items })

    // 第二次等待同样超时
    await db.query('UPDATE acceptance SET step_entered_at = ? WHERE id = ?', [old, id])
    expect((await acceptanceTimeoutJob.runOnce()).reminded).toBe(1)

    expect(
      await db.count(
        "FROM notification WHERE user_id = ? AND type = 'acceptance' AND title LIKE '%等待超过%'",
        [ctx.supervisor.userId]
      )
    ).toBe(2)
  })
})

describe('AC-A23 验收列表分组', () => {
  it('按「待我处理 / 进行中 / 已完成」分组，计数与红点同源', async () => {
    const ctx = await setup()

    // 一张走到待监理审核
    const one = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${one.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: one.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    // 监理视角：待我处理 1
    const asSupervisor = await mini.authed('get', `/projects/${ctx.projectId}/acceptances`, ctx.supervisor.token)
    const todoGroup = asSupervisor.body.data.groups.find((g) => g.key === 'todo')
    expect(todoGroup.count).toBe(1)
    expect(todoGroup.items[0].id).toBe(one.body.data.id)
    // tab 红点角标与分组计数必须同源
    expect(asSupervisor.body.data.todoCount).toBe(todoGroup.count)

    // 业主视角：此刻不轮到他，待我处理 0
    const asOwner = await mini.authed('get', `/projects/${ctx.projectId}/acceptances`, ctx.owner.token)
    expect(asOwner.body.data.todoCount).toBe(0)
  })

  it('驳回后待办转到工长，通过后进入已完成', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const items = created.body.data.items.map((i) => ({ id: i.id, result: 'pass' }))
    await mini.authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token).send({ items })

    await mini.authed('post', `/acceptances/${created.body.data.id}/reject`, ctx.supervisor.token).send({ reason: '整改' })

    const asForeman = await mini.authed('get', `/projects/${ctx.projectId}/acceptances`, ctx.foreman.token)
    const todo = asForeman.body.data.groups.find((g) => g.key === 'todo')
    expect(todo.count).toBe(1)
    // 整改阶段的 item 状态是待整改
    expect(todo.items[0].status).toBe('pending_rectify')

    // 走完整条通过流程后进入已完成
    await mini.authed('post', `/acceptances/${created.body.data.id}/resubmit`, ctx.foreman.token).send({ items })
    await mini.authed('post', `/acceptances/${created.body.data.id}/approve`, ctx.supervisor.token)
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/approve`, ctx.owner.token)
      .attach('signature', await makeSignature(), { filename: 'sign.png', contentType: 'image/png' })

    const after = await mini.authed('get', `/projects/${ctx.projectId}/acceptances`, ctx.owner.token)
    const done = after.body.data.groups.find((g) => g.key === 'done')
    expect(done.count).toBe(1)
    expect(after.body.data.todoCount).toBe(0)
  })

  it('myActions 与实际接口权限一致（避免「按钮可点但 403」）', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })

    // 草稿：主工长可提交
    const asForeman = await mini.authed('get', `/acceptances/${created.body.data.id}`, ctx.foreman.token)
    expect(asForeman.body.data.myActions).toContain('submit')
    expect(asForeman.body.data.myActions).not.toContain('approve')

    // 监理此时不该有任何动作（还在草稿阶段）
    const asSupervisor = await mini.authed('get', `/acceptances/${created.body.data.id}`, ctx.supervisor.token)
    expect(asSupervisor.body.data.myActions).toEqual([])

    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const asSupervisor2 = await mini.authed('get', `/acceptances/${created.body.data.id}`, ctx.supervisor.token)
    expect(asSupervisor2.body.data.myActions).toEqual(expect.arrayContaining(['approve', 'reject']))
  })
})

describe('AC-A25 / AC-A26 跨项目与只读', () => {
  it('AC-A25 非本项目成员访问验收单返回 404，不泄露存在性', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const outsider = await mini.login('code-outsider-m8')

    const notMine = await mini.authed('get', `/acceptances/${created.body.data.id}`, outsider.token)
    const notExist = await mini.authed('get', '/acceptances/999999', outsider.token)

    expect(notMine.status).toBe(404)
    expect(notMine.body.message).toBe(notExist.body.message)
  })

  it('AC-A25 别的项目的监理不能处理本项目验收单', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    // 另一个项目的监理
    const otherAdmin = await auth.createAndLogin({ username: 'admin2', role: 'owner' })
    const otherTemplate = await fixtures.createTemplate({ name: '另一模板' })
    const otherProject = await request.authed('post', '/admin/projects', otherAdmin.token).send({
      name: '另一个项目',
      address: '北京市某路 2 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
      templateId: otherTemplate,
    })

    const foreignSupervisor = await mini.login('code-foreign-supervisor')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status, confirmed_at) VALUES (?, ?, 'supervisor', 'active', NOW())",
      [otherProject.body.data.id, foreignSupervisor.userId]
    )

    const res = await mini.authed('post', `/acceptances/${created.body.data.id}/approve`, foreignSupervisor.token)
    expect(res.status).toBe(404)
  })

  it('AC-A26 流转记录只读：接口层不提供任何修改入口', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const id = created.body.data.id

    // 没有 PATCH / PUT / DELETE 到 flow 的路由
    expect((await request.authed('put', `/acceptances/${id}/flow`, ctx.foreman.token).send({})).status).toBe(404)
    expect((await request.authed('delete', `/acceptances/${id}/flow`, ctx.foreman.token)).status).toBe(404)

    // model 层也不导出任何修改方法 —— 这是设计约束，不是「暂时没写」
    const acceptanceModel = require('../../src/models/acceptance.model')
    const forbidden = Object.keys(acceptanceModel).filter((k) =>
      /^(update|delete|remove|edit).*[Ff]low/.test(k)
    )
    expect(forbidden).toEqual([])
  })

  it('管理员也改不了流转记录（只有 C 端接口，且无修改入口）', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })

    // 后台账号的 token 调 C 端接口一律 401（AC-AD10）
    const res = await request.authed('get', `/acceptances/${created.body.data.id}/flow`, ctx.admin.token)
    expect(res.status).toBe(401)
  })
})

describe('验收流程的完整闭环', () => {
  it('发起 → 自检 → 监理通过 → 业主签名确认 → 归档 + 解锁付款节点 + 生成报告', async () => {
    const ctx = await setup()
    const id = await passThrough(ctx)

    const detail = await mini.authed('get', `/acceptances/${id}`, ctx.owner.token)
    const data = detail.body.data

    expect(data.status).toBe('passed')
    expect(data.finishedAt).toBeTruthy()
    expect(data.signatureUrl).toBeTruthy()
    expect(data.reportPdf.status).toBe('success')
    expect(data.items.every((i) => i.result === 'pass')).toBe(true)

    // 流转记录四条，两步审核都在
    expect(data.flow.map((f) => `${f.step}:${f.action}`)).toEqual([
      'self_check:submit',
      'supervisor:approve',
      'owner:approve',
    ])

    const node = await db.queryOne("SELECT status FROM payment_node WHERE name = '水电验收款'")
    expect(node.status).toBe('unlocked')
  })

  it('驳回 → 整改 → 重新提交 → 通过，多轮记录完整可读', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const id = created.body.data.id
    const items = created.body.data.items.map((i) => ({ id: i.id, result: 'pass' }))

    await mini.authed('post', `/acceptances/${id}/self-check`, ctx.foreman.token).send({ items })
    await mini.authed('post', `/acceptances/${id}/reject`, ctx.supervisor.token).send({ reason: '线管松动' })
    await mini.authed('post', `/acceptances/${id}/resubmit`, ctx.foreman.token).send({ items })
    await mini.authed('post', `/acceptances/${id}/approve`, ctx.supervisor.token)

    // 业主这一步也驳回一次
    await mini.authed('post', `/acceptances/${id}/reject`, ctx.owner.token).send({ reason: '开关位置不对' })
    await mini.authed('post', `/acceptances/${id}/resubmit`, ctx.foreman.token).send({ items })
    await mini.authed('post', `/acceptances/${id}/approve`, ctx.supervisor.token)
    await mini
      .authed('post', `/acceptances/${id}/approve`, ctx.owner.token)
      .attach('signature', await makeSignature(), { filename: 'sign.png', contentType: 'image/png' })

    const flow = await mini.authed('get', `/acceptances/${id}/flow`, ctx.foreman.token)
    const rounds = flow.body.data.rounds
    expect(rounds).toHaveLength(3)
    expect(rounds[0].entries.map((e) => `${e.step}:${e.action}`)).toEqual([
      'self_check:submit',
      'supervisor:reject',
    ])
    expect(rounds[1].entries.map((e) => `${e.step}:${e.action}`)).toEqual([
      'self_check:submit',
      'supervisor:approve',
      'owner:reject',
    ])
    expect(rounds[2].entries.map((e) => `${e.step}:${e.action}`)).toEqual([
      'self_check:submit',
      'supervisor:approve',
      'owner:approve',
    ])

    const row = await db.queryOne('SELECT status, resubmit_count FROM acceptance WHERE id = ?', [id])
    expect(row.status).toBe('passed')
    expect(row.resubmit_count).toBe(2)
  })

  it('被驳回的单可以换成业主直通（无监理项目）并最终通过', async () => {
    const ctx = await setup({ withSupervisor: false })
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const id = created.body.data.id
    const items = created.body.data.items.map((i) => ({ id: i.id, result: 'pass' }))

    await mini.authed('post', `/acceptances/${id}/self-check`, ctx.foreman.token).send({ items })
    await mini.authed('post', `/acceptances/${id}/reject`, ctx.owner.token).send({ reason: '没做闭水试验' })
    await mini.authed('post', `/acceptances/${id}/resubmit`, ctx.foreman.token).send({ items })

    // 无监理，重新提交后直接回到业主手上
    const detail = await mini.authed('get', `/acceptances/${id}`, ctx.owner.token)
    expect(detail.body.data.status).toBe('pending_owner')

    const done = await mini
      .authed('post', `/acceptances/${id}/approve`, ctx.owner.token)
      .attach('signature', await makeSignature(), { filename: 'sign.png', contentType: 'image/png' })
    expect(done.body.data.status).toBe('passed')
  })

  it('验收通过后不能再用同一阶段发起验收', async () => {
    const ctx = await setup()
    await passThrough(ctx)

    const again = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    expect(again.status).toBe(409)
  })
})

describe('C-3.1 跨项目验收收件箱（验收 tab）', () => {
  /**
   * 在已有用户的基础上再建一个项目。
   * 这里不复用 setup()：setup 会新建同名 admin，撞 admin_user 的租户内唯一键。
   */
  async function addSecondProject(ctx, { complete = true } = {}) {
    const projectId = await mini.createProject({ name: '第二个项目' })
    await mini.addMember({ projectId, userId: ctx.foreman.userId, role: 'foreman' })
    await db.query('UPDATE project_member SET is_primary = 1 WHERE project_id = ? AND user_id = ?', [
      projectId,
      ctx.foreman.userId,
    ])
    await mini.addMember({ projectId, userId: ctx.owner.userId, role: 'owner' })
    await mini.addMember({ projectId, userId: ctx.supervisor.userId, role: 'supervisor' })

    const stageId = await mini.createStage({
      projectId,
      name: '水电工程',
      seq: 1,
      progress: complete ? '100.00' : '60.00',
      gateStatus: complete ? 'pending_acceptance' : 'active',
    })

    return { projectId, stageId }
  }

  it('同一业主在多个项目的验收单都出现在收件箱，并按项目内角色判定待办', async () => {
    const ctx = await setup()
    const second = await addSecondProject(ctx)

    // 项目 A：走到待业主确认
    const createdA = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const idA = createdA.body.data.id
    await mini
      .authed('post', `/acceptances/${idA}/self-check`, ctx.foreman.token)
      .send({ items: createdA.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })
    await mini.authed('post', `/acceptances/${idA}/approve`, ctx.supervisor.token)

    // 项目 B：只走到待监理审核
    const createdB = await initiate(
      { ...ctx, projectId: second.projectId },
      ctx.foreman.token,
      { stageId: second.stageId }
    )
    const idB = createdB.body.data.id
    await mini
      .authed('post', `/acceptances/${idB}/self-check`, ctx.foreman.token)
      .send({ items: createdB.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })

    const ownerInbox = await mini.authed('get', '/acceptances', ctx.owner.token)
    expect(ownerInbox.status).toBe(200)
    expect(ownerInbox.body.data.counts.all).toBe(2)
    // A 待业主确认 → 待我处理；B 待监理审核 → 进行中
    expect(ownerInbox.body.data.counts.todo).toBe(1)
    expect(ownerInbox.body.data.counts.inProgress).toBe(1)
    expect(ownerInbox.body.data.items.map((i) => i.projectId).sort()).toEqual(
      [ctx.projectId, second.projectId].sort()
    )
    expect(ownerInbox.body.data.items.find((i) => i.id === idA).isMine).toBe(true)
    expect(ownerInbox.body.data.items.find((i) => i.id === idB).isMine).toBe(false)
    expect(ownerInbox.body.data.projects).toHaveLength(2)

    const supervisorInbox = await mini.authed('get', '/acceptances', ctx.supervisor.token)
    expect(supervisorInbox.body.data.counts.todo).toBe(1)
    expect(supervisorInbox.body.data.items.find((i) => i.id === idB).isMine).toBe(true)
    expect(supervisorInbox.body.data.items.find((i) => i.id === idA).isMine).toBe(false)
  })

  it('主工长可以发起的阶段出现在待我处理，发起后立即消失', async () => {
    const ctx = await setup()

    const before = await mini.authed('get', '/acceptances', ctx.foreman.token)
    const initiable = before.body.data.items.find(
      (i) => i.canInitiate && i.stageId === ctx.stageId && i.projectId === ctx.projectId
    )
    expect(initiable).toBeTruthy()
    expect(initiable.status).toBe('can_initiate')
    expect(before.body.data.counts.todo).toBeGreaterThanOrEqual(1)

    await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })

    const after = await mini.authed('get', '/acceptances', ctx.foreman.token)
    const stillInitiable = after.body.data.items.find(
      (i) => i.canInitiate && i.stageId === ctx.stageId && i.projectId === ctx.projectId
    )
    expect(stillInitiable).toBeUndefined()
  })

  it('详情返回首页/详情页需要的项目地址、阶段进度与门禁状态', async () => {
    const ctx = await setup()
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    const id = created.body.data.id
    await mini
      .authed('post', `/acceptances/${id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })
    await mini.authed('post', `/acceptances/${id}/approve`, ctx.supervisor.token)

    const detail = await mini.authed('get', `/acceptances/${id}`, ctx.owner.token)
    expect(detail.status).toBe(200)
    expect(detail.body.data.projectAddress).toBe('上海市浦东新区世纪大道 100 号')
    expect(detail.body.data.stageProgress).toBe('100.00')
    expect(detail.body.data.stageGateStatus).toBe('pending_acceptance')
    expect(detail.body.data.hasSupervisor).toBe(true)
    expect(detail.body.data.round).toBe(1)
    expect(detail.body.data.waitingHours).toBeGreaterThanOrEqual(0)
  })

  it('不是任何项目成员的用户收件箱为空；未登录返回 401', async () => {
    const outsider = await mini.login('code-inbox-outsider')
    const inbox = await mini.authed('get', '/acceptances', outsider.token)
    expect(inbox.status).toBe(200)
    expect(inbox.body.data.items).toEqual([])
    expect(inbox.body.data.counts.all).toBe(0)

    const anonymous = await request.get('/acceptances')
    expect(anonymous.status).toBe(401)
  })
})

describe('主业主 / 临时业主（v2.12）', () => {
  async function addTemporaryOwner(ctx, code = 'code-owner-temp') {
    const temporary = await mini.login(code)
    await mini.addMember({
      projectId: ctx.projectId,
      userId: temporary.userId,
      role: 'owner',
      ownerType: 'temporary',
    })
    return temporary
  }

  async function toPendingOwner(ctx) {
    const created = await initiate(ctx, ctx.foreman.token, { stageId: ctx.stageId })
    await mini
      .authed('post', `/acceptances/${created.body.data.id}/self-check`, ctx.foreman.token)
      .send({ items: created.body.data.items.map((i) => ({ id: i.id, result: 'pass' })) })
    await mini.authed('post', `/acceptances/${created.body.data.id}/approve`, ctx.supervisor.token)
    return created.body.data.id
  }

  it('临时业主不能确认或驳回，myActions 为空且不算待我处理', async () => {
    const ctx = await setup()
    const temporary = await addTemporaryOwner(ctx)
    const acceptanceId = await toPendingOwner(ctx)

    const detail = await mini.authed('get', `/acceptances/${acceptanceId}`, temporary.token)
    expect(detail.status).toBe(200)
    expect(detail.body.data.myRole).toBe('owner')
    expect(detail.body.data.ownerType).toBe('temporary')
    expect(detail.body.data.isPrimaryOwner).toBe(false)
    expect(detail.body.data.myActions).not.toContain('approve')
    expect(detail.body.data.myActions).not.toContain('reject')

    const list = await mini.authed('get', `/projects/${ctx.projectId}/acceptances`, temporary.token)
    const item = list.body.data.groups.flatMap((g) => g.items).find((i) => i.id === acceptanceId)
    expect(item.isMine).toBe(false)
    expect(item.ownerType).toBe('temporary')

    const rejected = await mini
      .authed('post', `/acceptances/${acceptanceId}/reject`, temporary.token)
      .send({ reason: '不同意' })
    expect(rejected.status).toBe(403)
    expect(rejected.body.message).toMatch(/主业主/)

    const approved = await mini
      .authed('post', `/acceptances/${acceptanceId}/approve`, temporary.token)
      .attach('signature', await makeSignature(), { filename: 'sign.png', contentType: 'image/png' })
    expect(approved.status).toBe(403)
    expect(approved.body.message).toMatch(/主业主/)
  })

  it('验收超时提醒只发给主业主，不发给临时业主', async () => {
    const ctx = await setup()
    const temporary = await addTemporaryOwner(ctx, 'code-owner-temp-timeout')
    await toPendingOwner(ctx)

    const datetime = require('../../src/utils/datetime')
    await db.query('UPDATE acceptance SET step_entered_at = ? WHERE status = ?', [
      datetime.now().subtract(49, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      'pending_owner',
    ])

    await acceptanceTimeoutJob.runOnce()

    const primaryNotice = await db.queryOne(
      "SELECT id FROM notification WHERE user_id = ? AND title LIKE '%等待超过%'",
      [ctx.owner.userId]
    )
    const tempNotice = await db.queryOne(
      "SELECT id FROM notification WHERE user_id = ? AND title LIKE '%等待超过%'",
      [temporary.userId]
    )
    expect(primaryNotice).toBeTruthy()
    expect(tempNotice).toBeNull()
  })
})
