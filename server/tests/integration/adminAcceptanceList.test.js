'use strict'

/**
 * 后台验收报告列表（AC-AD45）。
 *
 * 这个接口此前返回项目全量验收单，由后台前端在拿到数据后再筛选；
 * 项目一多，列表既没有分页也把筛选算在了浏览器里。本文件锁住改造后的契约：
 * 1. 强制分页，pageSize 超过 50 钳制到 50；
 * 2. 翻页不重不漏（按 id 倒序，id 唯一所以稳定）；
 * 3. status / type / keyword 三个筛选在服务端完成，且可组合；
 * 4. summary 始终按项目全量统计，不随筛选变化；
 * 5. 数据权限与改造前一致：无权 403、跨租户 404。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const datetime = require('../../src/utils/datetime')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
const auth = require('./helpers/auth')
const fixtures = require('./helpers/fixtures')

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
})

const TODAY = datetime.formatDate()
const TOMORROW = datetime.now().add(1, 'day').format('YYYY-MM-DD')

function projectPayload(name) {
  return {
    name,
    address: '上海市浦东新区世纪大道 100 号',
    contractAmount: '200000.00',
    startDate: TODAY,
    planEndDate: TOMORROW,
  }
}

async function createUser(openid, nickname = null) {
  const result = await db.query('INSERT INTO user (openid, nickname) VALUES (?, ?)', [openid, nickname])
  return result.insertId
}

/**
 * 建一个带两个阶段 / 两个工序的项目。
 * 验收单直接写库：本文件测的是列表查询，不依赖验收状态机。
 */
async function setup({ username = 'acc-list-owner' } = {}) {
  const owner = await auth.createAndLogin({ username, role: 'owner' })
  const templateId = await fixtures.createTemplate({
    name: '验收列表模板',
    stages: [
      { name: '水电工程', planDays: 10, items: [{ name: '强电布线' }] },
      { name: '泥瓦工程', planDays: 10, items: [{ name: '防水施工' }] },
    ],
  })

  const created = await request
    .authed('post', '/admin/projects', owner.token)
    .send({ ...projectPayload('验收列表项目'), templateId })
  if (created.status !== 200) throw new Error(`创建项目失败：${created.status} ${created.text}`)
  const projectId = created.body.data.id

  const detail = await request.authed('get', `/admin/projects/${projectId}`, owner.token)
  const [stageA, stageB] = detail.body.data.stages

  return { owner, projectId, stageA, stageB }
}

async function addAcceptance(projectId, fields = {}) {
  const row = {
    project_stage_id: null,
    project_item_id: null,
    type: 'stage',
    status: 'draft',
    submitter_id: null,
    submitted_at: null,
    finished_at: null,
    report_pdf_status: 'pending',
    report_no: null,
    ...fields,
  }

  const result = await db.query(
    `INSERT INTO acceptance
       (project_id, project_stage_id, project_item_id, type, status, submitter_id,
        submitted_at, finished_at, report_pdf_status, report_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      row.project_stage_id,
      row.project_item_id,
      row.type,
      row.status,
      row.submitter_id,
      row.submitted_at,
      row.finished_at,
      row.report_pdf_status,
      row.report_no,
    ]
  )
  return result.insertId
}

function fetchList(token, projectId, query = '') {
  return request.authed('get', `/admin/projects/${projectId}/acceptances${query}`, token)
}

describe('AC-AD45 后台验收列表强制分页', () => {
  it('默认每页 20 条，pageSize 超过 50 钳制到 50', async () => {
    const { owner, projectId } = await setup()
    const submitter = await createUser('acc-page-submitter', '王工长')
    for (let i = 0; i < 60; i += 1) {
      await addAcceptance(projectId, { submitter_id: submitter })
    }

    const first = await fetchList(owner.token, projectId)
    expect(first.status).toBe(200)
    // 契约：list / total / page / pageSize / totalPages / summary
    expect(first.body.data.page).toBe(1)
    expect(first.body.data.pageSize).toBe(20)
    expect(first.body.data.total).toBe(60)
    expect(first.body.data.totalPages).toBe(3)
    expect(first.body.data.list).toHaveLength(20)
    expect(first.body.data.summary.total).toBe(60)

    // 前端传大了只是想要更多，钳到 50 而不是报错
    const oversized = await fetchList(owner.token, projectId, '?pageSize=200')
    expect(oversized.status).toBe(200)
    expect(oversized.body.data.pageSize).toBe(50)
    expect(oversized.body.data.totalPages).toBe(2)
    expect(oversized.body.data.list).toHaveLength(50)
  })

  it('翻页不重不漏：三页的 id 并集恰好是全量', async () => {
    const { owner, projectId } = await setup()
    const submitter = await createUser('acc-turn-submitter', '李工长')
    const ids = []
    for (let i = 0; i < 45; i += 1) {
      ids.push(await addAcceptance(projectId, { submitter_id: submitter }))
    }

    const pages = []
    for (let page = 1; page <= 3; page += 1) {
      const res = await fetchList(owner.token, projectId, `?page=${page}&pageSize=20`)
      expect(res.status).toBe(200)
      pages.push(res.body.data.list.map((item) => item.id))
    }

    const collected = pages.flat()
    expect(collected).toHaveLength(45)
    expect(new Set(collected).size).toBe(45)
    expect([...collected].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b))
    // 按 id 倒序：最新的一张排在第一页第一条
    expect(pages[0][0]).toBe(Math.max(...ids))
  })
})

describe('验收列表筛选（服务端）与摘要口径', () => {
  /**
   * 六张覆盖全部状态 / 类型组合的单子。
   * 昵称与阶段 / 工序名用于验证 keyword 的匹配范围。
   */
  async function seedFilters() {
    const ctx = await setup({ username: 'acc-filter-owner' })
    const wang = await createUser('acc-filter-wang', '王工长')
    const li = await createUser('acc-filter-li', '李监理')

    const passedComputed = await addAcceptance(ctx.projectId, {
      project_stage_id: ctx.stageA.id,
      status: 'passed',
      submitter_id: wang,
      submitted_at: '2026-11-05 09:00:00',
      finished_at: '2026-11-05 10:00:00',
      report_pdf_status: 'success',
    })
    const passedLegacy = await addAcceptance(ctx.projectId, {
      project_stage_id: ctx.stageA.id,
      project_item_id: ctx.stageA.items[0].id,
      type: 'item',
      status: 'passed',
      submitter_id: li,
      submitted_at: '2026-10-01 09:00:00',
      finished_at: '2026-10-01 10:00:00',
      report_pdf_status: 'pending',
      report_no: 'AC-000123',
    })
    const inSupervisor = await addAcceptance(ctx.projectId, {
      project_stage_id: ctx.stageB.id,
      status: 'pending_supervisor',
      submitter_id: wang,
    })
    const inOwner = await addAcceptance(ctx.projectId, {
      project_stage_id: ctx.stageB.id,
      project_item_id: ctx.stageB.items[0].id,
      type: 'item',
      status: 'pending_owner',
      submitter_id: li,
    })
    const rectify = await addAcceptance(ctx.projectId, {
      project_stage_id: ctx.stageA.id,
      status: 'pending_rectify',
      submitter_id: wang,
    })
    const draft = await addAcceptance(ctx.projectId, {
      project_stage_id: ctx.stageA.id,
      status: 'draft',
      submitter_id: wang,
    })

    return {
      ...ctx,
      ids: { passedComputed, passedLegacy, inSupervisor, inOwner, rectify, draft },
    }
  }

  it('status / type / keyword 可组合，total 反映筛选后的条数', async () => {
    const ctx = await seedFilters()
    const { projectId } = ctx
    const projectNo = (id) => `AC-20261105-${projectId}-${String(id).padStart(6, '0')}`

    const passed = await fetchList(ctx.owner.token, projectId, '?status=passed')
    expect(passed.body.data.total).toBe(2)

    const rectify = await fetchList(ctx.owner.token, projectId, '?status=rectify')
    expect(rectify.body.data.total).toBe(1)
    expect(rectify.body.data.list[0].id).toBe(ctx.ids.rectify)

    // pending = 非 passed 且非 pending_rectify：草稿与两个在途环节都算
    const pending = await fetchList(ctx.owner.token, projectId, '?status=pending')
    expect(pending.body.data.total).toBe(3)
    expect(pending.body.data.list.map((item) => item.id).sort((a, b) => a - b)).toEqual(
      [ctx.ids.inSupervisor, ctx.ids.inOwner, ctx.ids.draft].sort((a, b) => a - b)
    )

    const items = await fetchList(ctx.owner.token, projectId, '?type=item')
    expect(items.body.data.total).toBe(2)

    const combined = await fetchList(ctx.owner.token, projectId, '?status=pending&type=item')
    expect(combined.body.data.total).toBe(1)
    expect(combined.body.data.list[0].id).toBe(ctx.ids.inOwner)

    // keyword 覆盖提交人昵称
    const bySubmitter = await fetchList(ctx.owner.token, projectId, '?keyword=%E7%8E%8B%E5%B7%A5%E9%95%BF')
    expect(bySubmitter.body.data.total).toBe(4)

    // keyword 覆盖阶段名与工序名
    expect((await fetchList(ctx.owner.token, projectId, '?keyword=%E6%B0%B4%E7%94%B5')).body.data.total).toBe(4)
    expect(
      (await fetchList(ctx.owner.token, projectId, '?keyword=%E5%BC%BA%E7%94%B5%E5%B8%83%E7%BA%BF')).body.data.total
    ).toBe(1)

    // keyword 覆盖「已落库」的报告编号（旧编号）
    const byLegacyNo = await fetchList(ctx.owner.token, projectId, '?keyword=AC-000123')
    expect(byLegacyNo.body.data.total).toBe(1)
    expect(byLegacyNo.body.data.list[0].id).toBe(ctx.ids.passedLegacy)

    // keyword 覆盖「尚未落库、由同一规则推算」的报告编号
    const byComputedNo = await fetchList(
      ctx.owner.token,
      projectId,
      `?keyword=${encodeURIComponent(projectNo(ctx.ids.passedComputed))}`
    )
    expect(byComputedNo.body.data.total).toBe(1)
    expect(byComputedNo.body.data.list[0].id).toBe(ctx.ids.passedComputed)

    // keyword 覆盖验收单 id（编号里也含 id，因此只断言目标单在结果中）
    const byId = await fetchList(ctx.owner.token, projectId, `?keyword=${ctx.ids.draft}`)
    expect(byId.body.data.list.some((item) => item.id === ctx.ids.draft)).toBe(true)
  })

  it('summary 始终按项目全量统计，不随筛选变化', async () => {
    const ctx = await seedFilters()

    const all = await fetchList(ctx.owner.token, ctx.projectId)
    expect(all.body.data.summary).toEqual({
      total: 6,
      passed: 2,
      inProgress: 4,
      // 只有 passedComputed 的报告生成成功
      reportReady: 1,
    })

    for (const query of ['?status=rectify', '?type=item', '?keyword=AC-000123&status=passed']) {
      const filtered = await fetchList(ctx.owner.token, ctx.projectId, query)
      expect(filtered.body.data.summary).toEqual(all.body.data.summary)
    }
  })

  it('非法筛选值返回 400', async () => {
    const { owner, projectId } = await setup({ username: 'acc-filter-bad' })
    expect((await fetchList(owner.token, projectId, '?status=whatever')).status).toBe(400)
    expect((await fetchList(owner.token, projectId, '?type=nope')).status).toBe(400)
  })
})

describe('验收列表的数据权限与改造前一致', () => {
  it('租户内无权项目 403，跨租户项目 404', async () => {
    const { owner, projectId } = await setup({ username: 'acc-scope-owner' })

    // 同租户、未授权的项目管理员
    const outsider = await auth.createAndLogin({ username: 'acc-scope-outsider', role: 'admin' })
    const forbidden = await fetchList(outsider.token, projectId)
    expect(forbidden.status).toBe(403)

    // 跨租户：一律 404，不暴露项目是否存在
    const tenant2 = await fixtures.createTenant({ name: '验收列表租户2' })
    const otherAdmin = await auth.createAndLogin({
      username: 'acc-scope-other',
      role: 'owner',
      tenantId: tenant2,
    })
    const otherTemplate = await fixtures.createTemplate({ tenantId: tenant2, createdBy: otherAdmin.admin.id })
    const otherProject = await request
      .authed('post', '/admin/projects', otherAdmin.token)
      .send({ ...projectPayload('别的租户项目'), templateId: otherTemplate })

    const crossTenant = await fetchList(owner.token, otherProject.body.data.id)
    expect(crossTenant.status).toBe(404)
  })
})
