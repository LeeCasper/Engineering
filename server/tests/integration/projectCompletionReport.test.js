'use strict'

/**
 * 项目竣工总报告集成测试。
 *
 * 重点不在 PDF 排版，而在三条边界：
 *   1. 未完工不能生成；
 *   2. 监理不能看到含账务的总报告；
 *   3. 生成后通过签名 URL 可下载，签名错误被拒。
 */

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
  await cache.flush()
  await fixtures.resetBusinessTables()
  sysConfigService.invalidate()
})

async function setup({ status = 'finished' } = {}) {
  const admin = await auth.createAndLogin({ username: 'admin', role: 'owner' })
  const templateId = await fixtures.createTemplate({
    stages: [
      {
        name: '水电工程',
        planDays: 10,
        items: [{ name: '强电布线' }],
      },
    ],
  })

  const created = await request.authed('post', '/admin/projects', admin.token).send({
    name: '竣工报告测试项目',
    address: '上海市浦东新区世纪大道 100 号',
    contractAmount: '200000.00',
    startDate: '2026-01-01',
    planEndDate: '2026-06-01',
    templateId,
  })
  const projectId = created.body.data.id

  const detail = await request.authed('get', `/admin/projects/${projectId}`, admin.token)
  const stageId = detail.body.data.stages[0].id

  const foreman = await mini.login('completion-report-foreman')
  const owner = await mini.login('completion-report-owner')
  const supervisor = await mini.login('completion-report-supervisor')

  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, is_primary, confirmed_at, joined_at)
     VALUES (?, ?, 'foreman', 'active', 1, NOW(), NOW())`,
    [projectId, foreman.userId]
  )
  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, owner_type, confirmed_at, joined_at)
     VALUES (?, ?, 'owner', 'active', 'primary', NOW(), NOW())`,
    [projectId, owner.userId]
  )
  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, confirmed_at, joined_at)
     VALUES (?, ?, 'supervisor', 'active', NOW(), NOW())`,
    [projectId, supervisor.userId]
  )

  await db.query(
    `UPDATE project SET status = ?, actual_end_date = '2026-05-20' WHERE id = ?`,
    [status, projectId]
  )
  await db.query(
    `UPDATE project_stage SET status = 'accepted', gate_status = 'accepted', progress = 100 WHERE id = ?`,
    [stageId]
  )

  // 一条已通过的阶段验收，总报告应能汇总进去
  await db.query(
    `INSERT INTO acceptance
       (project_id, project_stage_id, type, status, submitter_id, submitted_at, finished_at,
        signature_mode, signature_url, esign_status)
     VALUES (?, ?, 'stage', 'passed', ?, NOW(), NOW(), 'legacy', 'https://example.com/sign.png', 'legacy')`,
    [projectId, stageId, foreman.userId]
  )

  await request.authed('put', `/admin/projects/${projectId}/payment-nodes`, admin.token).send({
    nodes: [{ name: '水电验收款', amount: '60000.00', triggerType: 'manual' }],
  })

  return { admin, projectId, stageId, foreman, owner, supervisor }
}

describe('项目竣工总报告', () => {
  it('完工后生成报告，并通过签名 URL 下载 PDF', async () => {
    const { projectId, owner } = await setup()

    const initial = await request.authed('get', `/projects/${projectId}/completion-report`, owner.token)
    expect(initial.status).toBe(200)
    expect(initial.body.data.available).toBe(true)
    expect(initial.body.data.status).toBe('none')
    expect(initial.body.data.signedPath).toBeNull()

    const generated = await request
      .authed('post', `/projects/${projectId}/completion-report`, owner.token)
      .send({})
    expect(generated.status).toBe(200)
    expect(generated.body.data.status).toBe('success')
    expect(generated.body.data.signedPath).toContain('expires=')
    expect(generated.body.data.signedPath).toContain('sig=')

    const row = await db.queryOne(
      'SELECT status, file_url, file_key, sha256 FROM project_completion_report WHERE project_id = ?',
      [projectId]
    )
    expect(row.status).toBe('success')
    // 总报告含账务，已改私有存储：不再写公开 URL
    expect(row.file_url).toBeNull()
    expect(row.file_key).toContain('project-completion-reports/')
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/)

    const pdf = await request.raw('get', generated.body.data.signedPath)
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('未完工时不能生成总报告', async () => {
    const { projectId, owner } = await setup({ status: 'building' })

    const state = await request.authed('get', `/projects/${projectId}/completion-report`, owner.token)
    expect(state.body.data.available).toBe(false)

    const res = await request
      .authed('post', `/projects/${projectId}/completion-report`, owner.token)
      .send({})
    expect(res.status).toBe(409)
  })

  it('监理不能查看或生成含账务的总报告', async () => {
    const { projectId, supervisor } = await setup()

    expect(
      (await request.authed('get', `/projects/${projectId}/completion-report`, supervisor.token)).status
    ).toBe(403)
    expect(
      (
        await request
          .authed('post', `/projects/${projectId}/completion-report`, supervisor.token)
          .send({})
      ).status
    ).toBe(403)
  })

  it('后台可以查看状态并生成', async () => {
    const { admin, projectId } = await setup()

    const state = await request.authed('get', `/admin/projects/${projectId}/completion-report`, admin.token)
    expect(state.status).toBe(200)
    expect(state.body.data.status).toBe('none')

    const generated = await request
      .authed('post', `/admin/projects/${projectId}/completion-report`, admin.token)
      .send({})
    expect(generated.status).toBe(200)
    expect(generated.body.data.status).toBe('success')
  })

  it('已生成后默认复用，refresh=1 时重新生成', async () => {
    const { projectId, owner } = await setup()

    const first = await request
      .authed('post', `/projects/${projectId}/completion-report`, owner.token)
      .send({})
    const firstRow = await db.queryOne(
      'SELECT file_url, sha256 FROM project_completion_report WHERE project_id = ?',
      [projectId]
    )

    // 普通 POST 不会无谓地重写归档文件
    await request.authed('post', `/projects/${projectId}/completion-report`, owner.token).send({})
    const reused = await db.queryOne(
      'SELECT file_url, sha256 FROM project_completion_report WHERE project_id = ?',
      [projectId]
    )
    expect(reused.file_url).toBe(firstRow.file_url)
    expect(reused.sha256).toBe(firstRow.sha256)
    expect(first.body.data.status).toBe('success')

    // 项目数据变化后明确要求刷新，内容与哈希都应当更新
    await db.query('UPDATE project SET name = ? WHERE id = ?', ['竣工报告测试项目（更新）', projectId])
    await request
      .authed('post', `/projects/${projectId}/completion-report?refresh=1`, owner.token)
      .send({})
    const refreshed = await db.queryOne(
      'SELECT file_url, sha256 FROM project_completion_report WHERE project_id = ?',
      [projectId]
    )
    expect(refreshed.sha256).not.toBe(firstRow.sha256)
  })

  it('签名错误不能下载报告', async () => {
    const { projectId, owner } = await setup()
    const generated = await request
      .authed('post', `/projects/${projectId}/completion-report`, owner.token)
      .send({})

    const tampered = generated.body.data.signedPath.replace(/sig=[0-9a-f]+/, `sig=${'a'.repeat(64)}`)
    expect((await request.raw('get', tampered)).status).toBe(403)
  })
})
