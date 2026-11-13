'use strict'

/**
 * 多租户隔离骨架（M13 / P1）。
 *
 * ── 这个文件要证明的唯一一件事 ──
 * **租户 A 的数据，在租户 B 的任何接口上都拿不到。**
 *
 * 不是「列表里没有」就够了 —— 列表、详情、子资源、导出、日志、消息、配置、
 * 模板、账号、反馈，每一个入口都要单独验证。多租户最典型的失败形态是
 * 「列表过滤了、详情忘了」：页面上看不到，但换个自增 id 就能打开别家的项目。
 *
 * ── 为什么跨租户断言的是 404 而不是 403 ──
 * 项目 id 自增可枚举。403 等于告诉租户 A「租户 B 确实有这个 id 的项目」，
 * 扫一遍就能数出对方有多少单。租户**内部**无权才保留 403 ——
 * 那是同一家公司的人，区分「不存在」与「没权限」便于排查。
 *
 * ── 为什么平台账号在这里就要求 403 ──
 * 平台运营默认看不到任何租户业务数据。P4 会加 `platform_access_grant`
 * 时间窗，但那是**唯一**的合法入口；在此之前，所有租户业务接口对平台关闭。
 * 让它查出一片空列表不是更安全的做法：空列表会让「角色不该在这里」
 * 这个事实被掩盖，且 stage_template 一类强制要求 tenantId 的查询会直接 500。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
const dataScope = require('../../src/services/dataScope.service')
const adminNotificationModel = require('../../src/models/adminNotification.model')
const adminNotificationService = require('../../src/services/adminNotification.service')
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
  // 配置有 60 秒进程内缓存。清库不重置它，上一个用例写进去的值会漏到下一个
  // （CLAUDE.md 第 17 条）
  sysConfigService.invalidate()
})

let seq = 0
function nextSeq() {
  seq += 1
  return seq
}

/**
 * 建两个租户，各有一个 owner、一个默认模板。
 *
 * 用户名刻意不同：登录接口在未传 tenantCode 时会因为「同名账号存在于多个租户」
 * 而返回 400（那是刻意的，不猜）。跨租户用例不该被这个规则绊住。
 */
async function setupTenants() {
  const n = nextSeq()
  const tenantB = await fixtures.createTenant({ name: `B 装修公司 ${n}`, code: `tenant-b-${n}` })

  const a = await auth.createAndLogin({ username: `owner_a_${n}`, role: 'owner', tenantId: 1 })
  const b = await auth.createAndLogin({ username: `owner_b_${n}`, role: 'owner', tenantId: tenantB })

  const tplA = await fixtures.createTemplate({ tenantId: 1, isDefault: true, name: `A 默认模板 ${n}` })
  const tplB = await fixtures.createTemplate({ tenantId: tenantB, isDefault: true, name: `B 默认模板 ${n}` })

  return { tenantA: 1, tenantB, a, b, tplA, tplB }
}

/** 通过接口建档，返回项目 id */
async function createProject(token, name, templateId) {
  const res = await request.authed('post', '/admin/projects', token).send({
    name,
    address: '上海市某区某路 1 号',
    contractAmount: '100000.00',
    startDate: '2026-01-01',
    planEndDate: '2026-06-01',
    templateId,
  })
  expect(res.status).toBe(200)
  return res.body.data.id
}

const TEMPLATE_BODY = (name) => ({
  name,
  stages: [{ name: '开工准备', planDays: 2, items: [{ name: '现场交底' }] }],
})

// ─────────────────────────────────────────────────────────────
// 项目：列表 / 详情 / 写操作 / 子资源
// ─────────────────────────────────────────────────────────────

describe('P1 · 项目：租户 A 的项目在租户 B 的每个入口都不可见', () => {
  it('列表只含本租户的项目', async () => {
    const { a, b, tplA, tplB } = await setupTenants()
    const projA = await createProject(a.token, 'A 的项目', tplA)
    const projB = await createProject(b.token, 'B 的项目', tplB)

    const listA = await request.authed('get', '/admin/projects', a.token).expect(200)
    expect(listA.body.data.list.map((p) => p.id)).toEqual([projA])
    expect(listA.body.data.total).toBe(1)

    const listB = await request.authed('get', '/admin/projects', b.token).expect(200)
    expect(listB.body.data.list.map((p) => p.id)).toEqual([projB])
    expect(listB.body.data.total).toBe(1)
  })

  it('详情、成员、付款节点：跨租户一律 404', async () => {
    const { a, b, tplA } = await setupTenants()
    const projA = await createProject(a.token, 'A 的项目', tplA)

    for (const url of [
      `/admin/projects/${projA}`,
      `/admin/projects/${projA}/members`,
      `/admin/projects/${projA}/payment-nodes`,
    ]) {
      const res = await request.authed('get', url, b.token)
      expect(res.status).toBe(404)
      // 与「项目不存在」完全同一句提示，不泄露 id 是否真实存在
      expect(res.body.message).toBe('项目不存在')
    }
  })

  it('修改、删除、归档、批量归档：跨租户一律拒绝，且数据不变', async () => {
    const { a, b, tplA } = await setupTenants()
    const projA = await createProject(a.token, 'A 的项目', tplA)

    const update = await request.authed('put', `/admin/projects/${projA}`, b.token).send({ name: '被 B 改掉' })
    expect(update.status).toBe(404)

    const archive = await request.authed('post', `/admin/projects/${projA}/archive`, b.token)
    expect(archive.status).toBe(404)

    // 删除要求二次确认；先过参数校验，才轮到「这个项目不属于你」
    const remove = await request
      .authed('delete', `/admin/projects/${projA}`, b.token)
      .send({ confirm: true })
    expect(remove.status).toBe(404)

    // 批量操作逐条报告结果，不会因为一条越权就整体 500 ——
    // 但必须在 failures 里明确列出，不能静默跳过（AC-AD60）
    const batch = await request
      .authed('post', '/admin/projects/batch/archive', b.token)
      .send({ projectIds: [projA], confirm: true })
    expect(batch.body.data.failureCount).toBe(1)
    expect(batch.body.data.failures[0].projectId).toBe(projA)

    const row = await db.queryOne('SELECT name, status, deleted_at FROM project WHERE id = ?', [projA])
    expect(row.name).toBe('A 的项目')
    expect(row.status).not.toBe('archived')
    expect(row.deleted_at).toBeNull()
  })

  it('租户内无权是 403，跨租户是 404 —— 两种语义不能混', async () => {
    const { a, b, tplA } = await setupTenants()
    const projA = await createProject(a.token, 'A 的项目', tplA)

    // 与 A 同租户的项目管理员，但项目既不是他建的、也没授权给他
    const colleague = await auth.createAndLogin({
      username: `colleague_${nextSeq()}`,
      role: 'admin',
      tenantId: 1,
    })

    const sameTenant = await request.authed('get', `/admin/projects/${projA}`, colleague.token)
    expect(sameTenant.status).toBe(403)
    expect(sameTenant.body.message).toBe('无权访问该项目')

    const crossTenant = await request.authed('get', `/admin/projects/${projA}`, b.token)
    expect(crossTenant.status).toBe(404)
  })

  it('阶段结构的写操作同样先过项目归属校验', async () => {
    const { a, b, tplA } = await setupTenants()
    const projA = await createProject(a.token, 'A 的项目', tplA)

    const res = await request
      .authed('post', `/admin/projects/${projA}/stages`, b.token)
      .send({ name: 'B 加的阶段' })
    expect(res.status).toBe(404)

    const added = await db.queryOne(
      'SELECT id FROM project_stage WHERE project_id = ? AND name = ?',
      [projA, 'B 加的阶段']
    )
    expect(added).toBeNull()
  })

  it('导出不会把别家项目带出来', async () => {
    const { a, b, tplA } = await setupTenants()
    await createProject(a.token, 'A 的项目', tplA)

    // B 一个项目都没有。若导出泄漏了 A 的项目，这里会返回 200 + xlsx 文件，
    // 而不是「没有可导出的项目」
    const res = await request.authed('get', '/admin/projects/export', b.token)
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('没有可导出')
  })

  it('批量分配工长同样不能跨租户', async () => {
    const { a, b, tplA } = await setupTenants()
    const projA = await createProject(a.token, 'A 的项目', tplA)

    const res = await request
      .authed('post', '/admin/projects/batch/assign', b.token)
      .send({ projectIds: [projA], phone: '13800138000' })

    expect(res.body.data.failureCount).toBe(1)
    const members = await db.query('SELECT id FROM project_member WHERE project_id = ?', [projA])
    expect(members).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────
// 阶段模板：绕过 dataScope 的第一个模块
// ─────────────────────────────────────────────────────────────

describe('P1 · 阶段模板：按租户隔离，默认模板各租户独立', () => {
  it('列表、详情、修改、删除、复制、设默认全部跨租户不可见', async () => {
    const { a, b, tplA } = await setupTenants()

    const list = await request.authed('get', '/admin/stage-templates', b.token).expect(200)
    expect(list.body.data.list.map((t) => t.id)).not.toContain(tplA)

    const detail = await request.authed('get', `/admin/stage-templates/${tplA}`, b.token)
    expect(detail.status).toBe(404)

    const update = await request
      .authed('put', `/admin/stage-templates/${tplA}`, b.token)
      .send({ name: 'B 改名' })
    expect(update.status).toBe(404)

    const duplicate = await request
      .authed('post', `/admin/stage-templates/${tplA}/duplicate`, b.token)
      .send({ name: 'B 的副本' })
    expect(duplicate.status).toBe(404)

    const setDefault = await request.authed('put', `/admin/stage-templates/${tplA}/default`, b.token)
    expect(setDefault.status).toBe(404)

    const remove = await request.authed('delete', `/admin/stage-templates/${tplA}`, b.token)
    expect(remove.status).toBe(404)

    // A 的模板原样还在，名称没有被改
    const row = await db.queryOne('SELECT name FROM stage_template WHERE id = ?', [tplA])
    expect(row.name).toMatch(/^A 默认模板/)
  })

  it('每个租户各有一个默认模板，设默认不会清掉别家的', async () => {
    const { a, b, tplA, tplB, tenantB } = await setupTenants()

    const defaults = await db.query(
      'SELECT tenant_id, id FROM stage_template WHERE is_default = 1 AND deleted_at IS NULL ORDER BY tenant_id'
    )
    expect(defaults).toHaveLength(2)
    expect(defaults.map((r) => Number(r.tenant_id)).sort((x, y) => x - y)).toEqual(
      [1, Number(tenantB)].sort((x, y) => x - y)
    )
    expect(defaults.map((r) => Number(r.id)).sort((x, y) => x - y)).toEqual([tplA, tplB].sort((x, y) => x - y))

    // A 新建一套模板并设为默认
    const created = await request
      .authed('post', '/admin/stage-templates', a.token)
      .send(TEMPLATE_BODY('A 的新默认模板'))
    expect(created.status).toBe(200)
    const newTplA = created.body.data.id

    const setDefault = await request
      .authed('put', `/admin/stage-templates/${newTplA}/default`, a.token)
      .expect(200)
    expect(setDefault.body.data.isDefault).toBe(true)

    // B 的默认模板必须原封不动 —— 这是 clearDefault 必须带 tenant_id 的原因
    const bDefault = await db.queryOne(
      'SELECT id FROM stage_template WHERE tenant_id = ? AND is_default = 1 AND deleted_at IS NULL',
      [b.loginBody.data.admin.tenantId]
    )
    expect(bDefault.id).toBe(tplB)

    const aDefault = await db.queryOne(
      'SELECT id FROM stage_template WHERE tenant_id = 1 AND is_default = 1 AND deleted_at IS NULL'
    )
    expect(aDefault.id).toBe(newTplA)
    void b
  })

  it('未显式选模板时，建档取的是本租户的默认模板', async () => {
    const { a, b, tplA, tplB } = await setupTenants()

    // 不传 templateId，由服务端回落默认模板
    const projA = await createProject(a.token, 'A 无模板项目', undefined)
    const projB = await createProject(b.token, 'B 无模板项目', undefined)

    const rows = await db.query('SELECT id, tenant_id, template_id FROM project WHERE id IN (?, ?) ORDER BY id', [
      projA,
      projB,
    ])
    expect(rows[0].template_id).toBe(tplA)
    expect(rows[1].template_id).toBe(tplB)
  })
})

// ─────────────────────────────────────────────────────────────
// 系统配置：绕过 dataScope 的第二个模块
// ─────────────────────────────────────────────────────────────

describe('P1 · 系统配置：每个租户一套，互不影响', () => {
  it('改自己的配置不影响别的租户', async () => {
    const { a, b, tenantB } = await setupTenants()

    await request.authed('put', '/admin/sys-configs/stale_report_days', a.token).send({ value: 7 }).expect(200)
    await request.authed('put', '/admin/sys-configs/stale_report_days', b.token).send({ value: 10 }).expect(200)

    const configA = await request.authed('get', '/admin/sys-configs', a.token).expect(200)
    const configB = await request.authed('get', '/admin/sys-configs', b.token).expect(200)

    expect(configA.body.data.list.find((c) => c.key === 'stale_report_days').value).toBe('7')
    expect(configB.body.data.list.find((c) => c.key === 'stale_report_days').value).toBe('10')

    const rows = await db.query(
      "SELECT tenant_id, config_value FROM sys_config WHERE config_key = 'stale_report_days' ORDER BY tenant_id"
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => Number(r.tenant_id)).sort((x, y) => x - y)).toEqual([1, Number(tenantB)].sort((x, y) => x - y))
  })

  it('B 没配过的项读到默认值，不会读到 A 的值', async () => {
    const { a, b } = await setupTenants()

    await request.authed('put', '/admin/sys-configs/stale_report_days', a.token).send({ value: 7 }).expect(200)

    const configB = await request.authed('get', '/admin/sys-configs', b.token).expect(200)
    const item = configB.body.data.list.find((c) => c.key === 'stale_report_days')
    expect(item.value).toBe('3')
    expect(item.isDefault).toBe(true)
    void b
  })

  it('项目管理员（非 owner）不能改配置，但可以读', async () => {
    const { tenantA } = await setupTenants()
    const admin = await auth.createAndLogin({ username: `cfg_admin_${nextSeq()}`, role: 'admin', tenantId: tenantA })

    await request.authed('get', '/admin/sys-configs', admin.token).expect(200)
    const res = await request.authed('put', '/admin/sys-configs/stale_report_days', admin.token).send({ value: 5 })
    expect(res.status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────
// 内容页：绕过 dataScope 的第三个模块，且 C 端读取未登录
// ─────────────────────────────────────────────────────────────

describe('P1 · 内容页：按租户维护，C 端按 tenantId 读取', () => {
  it('A 发布的隐私政策只有 A 的 tenantId 能读到', async () => {
    const { a, b, tenantB } = await setupTenants()

    await request
      .authed('put', '/admin/contents/privacy', a.token)
      .send({ title: '隐私政策 A', content: 'A 公司的隐私政策正文', publish: true })
      .expect(200)

    const readA = await request.get('/contents/privacy?tenantId=1').expect(200)
    expect(readA.body.data.content).toBe('A 公司的隐私政策正文')

    // 不带 tenantId → 平台默认版本；平台没有发布过，因此 404
    // （不是返回空内容：空内容会让小程序白屏，404 才能给出「暂不可用」）
    const platform = await request.get('/contents/privacy')
    expect(platform.status).toBe(404)
    expect(platform.body.message).toBe('页面尚未发布')

    const readB = await request.get(`/contents/privacy?tenantId=${tenantB}`)
    expect(readB.status).toBe(404)
  })

  it('B 保存同名内容页不会覆盖 A 的；两边各自维护', async () => {
    const { a, b, tenantB } = await setupTenants()

    await request
      .authed('put', '/admin/contents/privacy', a.token)
      .send({ title: '隐私政策 A', content: 'A 正文', publish: true })
      .expect(200)
    await request
      .authed('put', '/admin/contents/privacy', b.token)
      .send({ title: '隐私政策 B', content: 'B 正文', publish: true })
      .expect(200)

    const readA = await request.get('/contents/privacy?tenantId=1').expect(200)
    const readB = await request.get(`/contents/privacy?tenantId=${tenantB}`).expect(200)
    expect(readA.body.data.content).toBe('A 正文')
    expect(readB.body.data.content).toBe('B 正文')

    // 后台详情同样不串
    const adminA = await request.authed('get', '/admin/contents/privacy', a.token).expect(200)
    const adminB = await request.authed('get', '/admin/contents/privacy', b.token).expect(200)
    expect(adminA.body.data.content).toBe('A 正文')
    expect(adminB.body.data.content).toBe('B 正文')
  })
})

// ─────────────────────────────────────────────────────────────
// 意见反馈：绕过 dataScope 的第四个模块
// ─────────────────────────────────────────────────────────────

describe('P1 · 意见反馈：列表按租户，处理按租户校验', () => {
  it('A 项目下的反馈在 B 的列表里不出现，按 id 也处理不了', async () => {
    const { a, b, tplA } = await setupTenants()
    const projA = await createProject(a.token, 'A 的项目', tplA)

    const user = await mini.login(`tenancy-feedback-${nextSeq()}`)
    // 反馈要按项目归属租户，服务端会先校验调用者是该项目的 active 成员 ——
    // 否则任何微信用户拿一个自增 projectId 就能把反馈写进别人的租户
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status, confirmed_at, joined_at) VALUES (?, ?, 'foreman', 'active', NOW(), NOW())",
      [projA, user.userId]
    )
    const submitted = await request
      .authed('post', '/feedback', user.token)
      .field('content', '这个项目的进度照片打不开')
      .field('projectId', String(projA))
    expect(submitted.status).toBe(200)
    const feedbackId = submitted.body.data.id

    const listA = await request.authed('get', '/admin/feedback', a.token).expect(200)
    expect(listA.body.data.list.map((f) => f.id)).toContain(feedbackId)

    const listB = await request.authed('get', '/admin/feedback', b.token).expect(200)
    expect(listB.body.data.list.map((f) => f.id)).not.toContain(feedbackId)
    expect(listB.body.data.total).toBe(0)

    const handle = await request
      .authed('put', `/admin/feedback/${feedbackId}`, b.token)
      .send({ status: 'processing' })
    expect(handle.status).toBe(404)

    const row = await db.queryOne('SELECT status FROM feedback WHERE id = ?', [feedbackId])
    expect(row.status).toBe('new')
    void a
  })

  it('未归任何租户的反馈（平台级）不进入租户管理员视野', async () => {
    const { a, b } = await setupTenants()
    const userId = await mini.createWechatUser(`platform-feedback-${nextSeq()}`)
    await db.query(
      "INSERT INTO feedback (tenant_id, user_id, content, status) VALUES (NULL, ?, '提给平台的反馈内容', 'new')",
      [userId]
    )

    const listA = await request.authed('get', '/admin/feedback', a.token).expect(200)
    const listB = await request.authed('get', '/admin/feedback', b.token).expect(200)
    expect(listA.body.data.total).toBe(0)
    expect(listB.body.data.total).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
// 操作日志：审计不能跨租户
// ─────────────────────────────────────────────────────────────

describe('P1 · 操作日志：租户只能看到本租户的审计记录', () => {
  it('A 的建档日志只出现在 A 的日志列表里', async () => {
    const { a, b, tplA, tplB } = await setupTenants()
    const projA = await createProject(a.token, 'A 的项目', tplA)
    const projB = await createProject(b.token, 'B 的项目', tplB)

    const listA = await request
      .authed('get', '/admin/operation-logs?action=project.create', a.token)
      .expect(200)
    expect(listA.body.data.list.map((l) => l.projectId)).toEqual([projA])

    const listB = await request
      .authed('get', '/admin/operation-logs?action=project.create', b.token)
      .expect(200)
    expect(listB.body.data.list.map((l) => l.projectId)).toEqual([projB])

    // 直接按对方的项目 id 筛也不给
    const probe = await request
      .authed('get', `/admin/operation-logs?projectId=${projA}`, b.token)
      .expect(200)
    expect(probe.body.data.total).toBe(0)
  })

  it('后台账号的增删改日志同样按租户隔离', async () => {
    const { a, b } = await setupTenants()

    const created = await request
      .authed('post', '/admin/admin-users', a.token)
      .send({ username: `audit_a_${nextSeq()}`, password: 'Test123456', role: 'admin' })
    expect(created.status).toBe(200)

    const listA = await request
      .authed('get', '/admin/operation-logs?action=admin_user.create', a.token)
      .expect(200)
    expect(listA.body.data.list).toHaveLength(1)

    const listB = await request
      .authed('get', '/admin/operation-logs?action=admin_user.create', b.token)
      .expect(200)
    expect(listB.body.data.list).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────
// 管理员消息与导出任务
// ─────────────────────────────────────────────────────────────

describe('P1 · 管理员消息与导出任务：接收人与租户双重隔离', () => {
  it('每个管理员只看到自己的消息，且只看到本租户的消息', async () => {
    const { a, b, tenantB } = await setupTenants()
    await adminNotificationModel.create({
      tenantId: 1,
      adminUserId: a.admin.id,
      type: 'project',
      title: 'A 的消息',
      content: 'A 的内容',
    })
    await adminNotificationModel.create({
      tenantId: tenantB,
      adminUserId: b.admin.id,
      type: 'project',
      title: 'B 的消息',
      content: 'B 的内容',
    })

    const listA = await request.authed('get', '/admin/notifications', a.token).expect(200)
    expect(listA.body.data.list.map((m) => m.title)).toEqual(['A 的消息'])

    const listB = await request.authed('get', '/admin/notifications', b.token).expect(200)
    expect(listB.body.data.list.map((m) => m.title)).toEqual(['B 的消息'])
  })

  it('项目提醒只发给本项目所属租户的 owner 与创建者', async () => {
    const { a, b, tplA, tenantB } = await setupTenants()
    const projA = await createProject(a.token, 'A 的项目', tplA)

    await adminNotificationService.notifyProjectAdmin({
      projectId: projA,
      title: '项目提醒',
      content: '测试内容',
    })

    const rows = await db.query('SELECT tenant_id, admin_user_id FROM admin_notification WHERE ref_id = ?', [projA])
    expect(rows.length).toBeGreaterThan(0)
    // 每一条都必须落在租户 A
    expect(rows.every((r) => Number(r.tenant_id) === 1)).toBe(true)
    // 租户 B 的 owner 一条都不该收到
    expect(rows.some((r) => Number(r.admin_user_id) === b.admin.id)).toBe(false)
    void tenantB
  })

  it('导出任务只能看到、下载自己发起的', async () => {
    const { a, b, tenantB } = await setupTenants()
    const taskA = await adminNotificationModel.createExportTask({
      tenantId: 1,
      createdBy: a.admin.id,
      filters: {},
    })
    await adminNotificationModel.createExportTask({
      tenantId: tenantB,
      createdBy: b.admin.id,
      filters: {},
    })
    // 把任务置成成功，否则下载会被「尚未完成」拦在权限判断之后
    await db.query("UPDATE export_task SET status = 'success', file_url = 'exports/missing.xlsx' WHERE id = ?", [taskA])

    const listA = await request.authed('get', '/admin/exports', a.token).expect(200)
    expect(listA.body.data.list.map((t) => t.id)).toEqual([taskA])

    const listB = await request.authed('get', '/admin/exports', b.token).expect(200)
    expect(listB.body.data.list.map((t) => t.id)).not.toContain(taskA)

    const download = await request.authed('get', `/admin/exports/${taskA}/download`, b.token)
    expect(download.status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────
// 后台账号与登录
// ─────────────────────────────────────────────────────────────

describe('P1 · 后台账号：用户名按租户唯一，账号管理不越界', () => {
  it('两家公司可以使用同一个用户名', async () => {
    const { a, b } = await setupTenants()

    const createdA = await request
      .authed('post', '/admin/admin-users', a.token)
      .send({ username: 'admin', password: 'Test123456', role: 'admin' })
    const createdB = await request
      .authed('post', '/admin/admin-users', b.token)
      .send({ username: 'admin', password: 'Test123456', role: 'admin' })

    expect(createdA.status).toBe(200)
    expect(createdB.status).toBe(200)

    const listA = await request.authed('get', '/admin/admin-users?keyword=admin', a.token).expect(200)
    const listB = await request.authed('get', '/admin/admin-users?keyword=admin', b.token).expect(200)
    expect(listA.body.data.list).toHaveLength(1)
    expect(listB.body.data.list).toHaveLength(1)
    expect(listA.body.data.list[0].id).not.toBe(listB.body.data.list[0].id)
  })

  it('B 不能重置或禁用 A 的账号', async () => {
    const { a, b } = await setupTenants()

    const created = await request
      .authed('post', '/admin/admin-users', a.token)
      .send({ username: `a_staff_${nextSeq()}`, password: 'Test123456', role: 'admin' })
    const targetId = created.body.data.id

    const reset = await request
      .authed('put', `/admin/admin-users/${targetId}/password`, b.token)
      .send({ newPassword: 'Hacked123456' })
    expect(reset.status).toBe(403)

    const disable = await request
      .authed('put', `/admin/admin-users/${targetId}/status`, b.token)
      .send({ status: 'disabled' })
    expect(disable.status).toBe(403)

    const row = await db.queryOne('SELECT status FROM admin_user WHERE id = ?', [targetId])
    expect(row.status).toBe('active')
  })

  it('同名账号登录：不带租户标识返回 400，带 tenantCode 才进对家公司', async () => {
    const { a, b, tenantB } = await setupTenants()

    await request
      .authed('post', '/admin/admin-users', a.token)
      .send({ username: 'boss', password: 'Test123456', role: 'admin' })
    await request
      .authed('post', '/admin/admin-users', b.token)
      .send({ username: 'boss', password: 'Test123456', role: 'admin' })

    // 不猜：宁可直接报错，也不能把人登进别人的公司
    const ambiguous = await loginWithTenant('boss', 'Test123456')
    expect(ambiguous.status).toBe(400)
    expect(ambiguous.body.message).toContain('多个租户')

    const inA = await loginWithTenant('boss', 'Test123456', 'default')
    expect(inA.status).toBe(200)
    expect(inA.body.data.admin.tenantId).toBe(1)

    const codeB = await db.queryOne('SELECT code FROM tenant WHERE id = ?', [tenantB])
    const inB = await loginWithTenant('boss', 'Test123456', codeB.code)
    expect(inB.status).toBe(200)
    expect(inB.body.data.admin.tenantId).toBe(tenantB)
  })

  it('tenantCode 与账号归属不符时退化为「账号或密码错误」', async () => {
    const { a } = await setupTenants()

    await request
      .authed('post', '/admin/admin-users', a.token)
      .send({ username: 'solo', password: 'Test123456', role: 'admin' })

    const tenantB = await fixtures.createTenant({ name: '无关租户', code: `unrelated-${nextSeq()}` })
    const codeB = await db.queryOne('SELECT code FROM tenant WHERE id = ?', [tenantB])
    const res = await loginWithTenant('solo', 'Test123456', codeB.code)

    // 不暴露「这个用户名在别的租户存在」
    expect(res.status).toBe(401)
    expect(res.body.message).toBe('账号或密码错误')
  })
})

/** 带 tenantCode 的登录（helpers/auth.login 不支持这个字段） */
async function loginWithTenant(username, password, tenantCode) {
  const { captchaId, answer } = await auth.fetchCaptcha()
  const res = await request.post('/admin/auth/login').send({
    username,
    password,
    captchaId,
    captchaAnswer: answer,
    ...(tenantCode ? { tenantCode } : {}),
  })
  return { status: res.status, body: res.body, token: res.body.data && res.body.data.token }
}

// ─────────────────────────────────────────────────────────────
// 平台账号：默认拒绝
// ─────────────────────────────────────────────────────────────

describe('P1 · 平台账号：默认看不到任何租户业务数据', () => {
  it('dataScope 对无授权的平台账号返回 1 = 0（不是 1 = 1）', () => {
    const scope = dataScope.buildFilter({
      type: 'admin',
      id: 999,
      role: 'platform',
      tenantId: null,
      grantedTenantId: null,
    })
    expect(scope.clause).toBe('1 = 0')
    expect(scope.params).toEqual([])
    expect(scope.tenantId).toBeNull()

    const logScope = dataScope.buildOperationLogFilter({
      type: 'admin',
      id: 999,
      role: 'platform',
      tenantId: null,
      grantedTenantId: null,
    })
    expect(logScope.clause).toBe('1 = 0')
  })

  it('平台账号可以登录，但所有租户业务接口一律 403', async () => {
    await setupTenants()
    const platform = await auth.createAndLogin({
      username: `platform_${nextSeq()}`,
      role: 'platform',
      tenantId: null,
    })

    // 认证自身的接口可用：平台运营也要能改自己的密码、看自己的资料
    await request.authed('get', '/admin/auth/profile', platform.token).expect(200)

    for (const url of [
      '/admin/projects',
      '/admin/stage-templates',
      '/admin/sys-configs',
      '/admin/contents',
      '/admin/feedback',
      '/admin/operation-logs',
      '/admin/exports',
      '/admin/notifications',
      '/admin/admin-users',
    ]) {
      const res = await request.authed('get', url, platform.token)
      expect(res.status).toBe(403)
      expect(res.body.message).toContain('平台账号')
    }

    const create = await request.authed('post', '/admin/projects', platform.token).send({
      name: '平台建的项目',
      address: '某地',
      contractAmount: '1.00',
      startDate: '2026-01-01',
      planEndDate: '2026-02-01',
    })
    expect(create.status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────
// 租户状态：停用与到期
// ─────────────────────────────────────────────────────────────

describe('P1 · 租户停用与到期：后台登录与已有 token 都失效', () => {
  it('停用后不能登录', async () => {
    const tenantId = await fixtures.createTenant({ name: '停用租户', status: 'suspended' })
    const admin = await auth.createAdmin({
      username: `suspended_${nextSeq()}`,
      role: 'owner',
      tenantId,
    })

    const res = await auth.login(admin.username, admin.plainPassword)
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('租户已停用')
  })

  it('已登录的 token 在租户被停用后的下一次请求即被拒绝', async () => {
    const tenantId = await fixtures.createTenant({ name: '待停用租户', code: `suspend-${nextSeq()}` })
    const admin = await auth.createAndLogin({
      username: `will_suspend_${nextSeq()}`,
      role: 'owner',
      tenantId,
    })

    await request.authed('get', '/admin/projects', admin.token).expect(200)

    await db.query("UPDATE tenant SET status = 'suspended' WHERE id = ?", [tenantId])

    const res = await request.authed('get', '/admin/projects', admin.token)
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('租户已停用')
  })

  it('到期的租户同样不能登录', async () => {
    const tenantId = await fixtures.createTenant({ name: '过期租户', code: `expired-${nextSeq()}` })
    await db.query('UPDATE tenant SET expires_at = ? WHERE id = ?', ['2020-01-01 00:00:00', tenantId])

    const admin = await auth.createAdmin({
      username: `expired_${nextSeq()}`,
      role: 'owner',
      tenantId,
    })

    const res = await auth.login(admin.username, admin.plainPassword)
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('到期')
  })
})

// ─────────────────────────────────────────────────────────────
// C 端：一个微信账号可同时属于多个租户
// ─────────────────────────────────────────────────────────────

describe('P1 · C 端跨租户：项目分组与消息筛选', () => {
  it('同一个人在两个租户里的项目都会出现，按租户汇总且可筛选', async () => {
    const { a, b, tplA, tplB, tenantB } = await setupTenants()
    const projA = await createProject(a.token, 'A 的项目', tplA)
    const projB = await createProject(b.token, 'B 的项目', tplB)

    const user = await mini.login(`tenancy-c-end-${nextSeq()}`)
    await mini.addMember({ projectId: projA, userId: user.userId, role: 'foreman' })
    await mini.addMember({ projectId: projB, userId: user.userId, role: 'foreman' })

    const all = await request.authed('get', '/projects', user.token).expect(200)
    const items = all.body.data.groups.flatMap((g) => g.items)
    expect(items.map((p) => p.id).sort()).toEqual([projA, projB].sort())
    expect(items.find((p) => p.id === projA).tenantId).toBe(1)
    expect(items.find((p) => p.id === projB).tenantId).toBe(tenantB)
    expect(all.body.data.tenants.map((t) => t.id).sort()).toEqual([1, tenantB].sort())

    const onlyB = await request.authed('get', `/projects?tenantId=${tenantB}`, user.token).expect(200)
    const bItems = onlyB.body.data.groups.flatMap((g) => g.items)
    expect(bItems.map((p) => p.id)).toEqual([projB])
    expect(onlyB.body.data.tenants.map((t) => t.id)).toEqual([tenantB])
  })

  it('消息按租户筛选，但未读红点仍是全局口径', async () => {
    const { tenantB } = await setupTenants()
    const user = await mini.login(`tenancy-notify-${nextSeq()}`)

    await db.query(
      "INSERT INTO notification (tenant_id, user_id, type, title, content) VALUES (1, ?, 'system', 'A 公司消息', '内容')",
      [user.userId]
    )
    await db.query(
      "INSERT INTO notification (tenant_id, user_id, type, title, content) VALUES (?, ?, 'system', 'B 公司消息', '内容')",
      [tenantB, user.userId]
    )
    // 平台级消息：不属于任何项目，但属于用户自己，按租户筛选时也要能看到
    await db.query(
      "INSERT INTO notification (tenant_id, user_id, type, title, content) VALUES (NULL, ?, 'system', '平台消息', '内容')",
      [user.userId]
    )

    const all = await request.authed('get', '/notifications', user.token).expect(200)
    expect(all.body.data.total).toBe(3)

    const onlyB = await request.authed('get', `/notifications?tenantId=${tenantB}`, user.token).expect(200)
    expect(onlyB.body.data.list.map((n) => n.title).sort()).toEqual(['B 公司消息', '平台消息'].sort())

    // 红点回答「我有多少条没看」，与筛选无关 —— 三条都未读
    expect(onlyB.body.data.unread).toBe(3)
  })
})
