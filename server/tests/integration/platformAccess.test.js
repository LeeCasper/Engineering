'use strict'

/**
 * 平台排障访问（M13 / P4）。
 *
 * ── 四条底线 ──
 * 1. 平台默认什么都看不到（无授权 → 403）；
 * 2. 授权由**租户**发起，且有时限；
 * 3. 窗口内只能读，写操作一律 403，而且**尝试写也要留痕**；
 * 4. 门锁密码永久排除 —— 这条靠的是「结构上没有入口」，不是查询条件。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const datetime = require('../../src/utils/datetime')
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

let seq = 0
function nextSeq() {
  seq += 1
  return seq
}

function futureHours(hours) {
  return datetime.format(datetime.now().add(hours, 'hour'))
}

async function setup({ withProject = true } = {}) {
  const n = nextSeq()
  const owner = await auth.createAndLogin({ username: `pa_owner_${n}`, role: 'owner', tenantId: 1 })
  const platform = await auth.createAndLogin({
    username: `pa_platform_${n}`,
    role: 'platform',
    tenantId: null,
  })

  let projectId = null
  if (withProject) {
    projectId = await mini.createProject({
      tenantId: 1,
      name: `排障项目 ${n}`,
      createdBy: owner.admin.id,
    })
  }

  return { n, owner, platform, projectId }
}

async function createGrant(ownerToken, body) {
  return request.authed('post', '/admin/platform-grants', ownerToken).send(body)
}

function platformGet(token, tenantId, url) {
  return request.authed('get', url, token).set('X-Tenant-Id', String(tenantId))
}

function platformCall(method, token, tenantId, url, body) {
  const req = request.authed(method, url, token).set('X-Tenant-Id', String(tenantId))
  return body === undefined ? req : req.send(body)
}

/** 建授权并返回响应体 */
async function grantFor(ownerToken, adminUserId, overrides = {}) {
  const res = await createGrant(ownerToken, {
    adminUserId,
    reason: '排查进度不同步',
    expiresAt: futureHours(2),
    ...overrides,
  })
  expect(res.status).toBe(200)
  return res.body.data
}

// ─────────────────────────────────────────────────────────────
// 默认拒绝
// ─────────────────────────────────────────────────────────────

describe('P4 · 平台默认看不到任何租户数据', () => {
  it('不带租户上下文 → 403；带了但没有授权 → 403', async () => {
    const { platform } = await setup()

    const noHeader = await request.authed('get', '/admin/projects', platform.token)
    expect(noHeader.status).toBe(403)
    expect(noHeader.body.message).toContain('临时访问窗口')

    const noGrant = await platformGet(platform.token, 1, '/admin/projects')
    expect(noGrant.status).toBe(403)
    expect(noGrant.body.message).toContain('未获得')
  })

  it('租户上下文不是正整数 → 400', async () => {
    const { platform } = await setup()
    const res = await platformGet(platform.token, 'abc', '/admin/projects')
    expect(res.status).toBe(400)
  })

  it('授权只对本租户有效，换个租户 id 依然拒绝', async () => {
    const { owner, platform } = await setup()
    await grantFor(owner.token, platform.admin.id)

    const tenantB = await fixtures.createTenant({ name: '另一家', code: `pa-b-${nextSeq()}` })
    const res = await platformGet(platform.token, tenantB, '/admin/projects')
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('未获得')
  })
})

// ─────────────────────────────────────────────────────────────
// 授予与访问
// ─────────────────────────────────────────────────────────────

describe('P4 · 租户授予窗口后，平台可读', () => {
  it('owner 授予 → 平台能看到本租户的项目；列表与详情都可用', async () => {
    const { owner, platform, projectId } = await setup()
    const grant = await grantFor(owner.token, platform.admin.id)

    expect(grant.status).toBe('active')
    expect(grant.adminUserId).toBe(platform.admin.id)
    expect(grant.adminUsername).toBe(platform.admin.username)

    const list = await platformGet(platform.token, 1, '/admin/projects').expect(200)
    expect(list.body.data.list.map((p) => p.id)).toContain(projectId)

    const detail = await platformGet(platform.token, 1, `/admin/projects/${projectId}`).expect(200)
    expect(detail.body.data.id).toBe(projectId)

    // 其他按租户取数的模块也应正常（而不是因为 tenantId 为 null 报 500 或读错）
    const templates = await platformGet(platform.token, 1, '/admin/stage-templates').expect(200)
    expect(Array.isArray(templates.body.data.list)).toBe(true)

    const configs = await platformGet(platform.token, 1, '/admin/sys-configs').expect(200)
    expect(configs.body.data.list.length).toBeGreaterThan(0)

    const users = await platformGet(platform.token, 1, '/admin/admin-users').expect(200)
    expect(users.body.data.list.some((u) => u.id === owner.admin.id)).toBe(true)
  })

  it('每一次访问都写审计日志，且租户 owner 能看见', async () => {
    const { owner, platform, projectId } = await setup()
    await grantFor(owner.token, platform.admin.id)

    await platformGet(platform.token, 1, '/admin/projects').expect(200)
    await platformGet(platform.token, 1, `/admin/projects/${projectId}`).expect(200)

    // 平台自己看日志（同一窗口内）
    const asPlatform = await platformGet(
      platform.token,
      1,
      '/admin/operation-logs?action=platform.access_tenant'
    ).expect(200)
    expect(asPlatform.body.data.total).toBeGreaterThanOrEqual(2)
    const first = asPlatform.body.data.list[0]
    expect(first.detail.after.method).toBe('GET')
    // 查询串被去掉：那里可能有业主姓名/手机号这类筛选关键字
    expect(first.detail.after.path).not.toContain('?')
    expect(first.projectId).toBeNull()

    // 租户 owner 同样能看到「平台来过」——这是留痕对客户的意义
    const asOwner = await request
      .authed('get', '/admin/operation-logs?action=platform.access_tenant', owner.token)
      .expect(200)
    expect(asOwner.body.data.total).toBe(asPlatform.body.data.total)

    const row = await db.queryOne(
      "SELECT tenant_id, operator_type, operator_id FROM operation_log WHERE action = 'platform.access_tenant' ORDER BY id ASC LIMIT 1"
    )
    expect(Number(row.tenant_id)).toBe(1)
    expect(row.operator_type).toBe('admin')
    expect(Number(row.operator_id)).toBe(platform.admin.id)
  })
})

// ─────────────────────────────────────────────────────────────
// 只读
// ─────────────────────────────────────────────────────────────

describe('P4 · 窗口内只能读：写操作一律 403', () => {
  it('建档、改配置、删项目都被拒绝，数据不变', async () => {
    const { owner, platform, projectId } = await setup()
    await grantFor(owner.token, platform.admin.id)

    const create = await platformCall('post', platform.token, 1, '/admin/projects', {
      name: '平台偷偷建的项目',
      address: '某地',
      contractAmount: '100.00',
      startDate: '2026-01-01',
      planEndDate: '2026-02-01',
    })
    expect(create.status).toBe(403)
    expect(create.body.message).toContain('仅可查看')

    const config = await platformCall('put', platform.token, 1, '/admin/sys-configs/stale_report_days', {
      value: 30,
    })
    expect(config.status).toBe(403)

    const remove = await platformCall('delete', platform.token, 1, `/admin/projects/${projectId}`, {
      confirm: true,
    })
    expect(remove.status).toBe(403)

    const template = await platformCall('post', platform.token, 1, '/admin/stage-templates', {
      name: '平台模板',
      stages: [{ name: '开工', planDays: 1, items: [{ name: '交底' }] }],
    })
    expect(template.status).toBe(403)

    // 数据确实没变
    const project = await db.queryOne('SELECT deleted_at FROM project WHERE id = ?', [projectId])
    expect(project.deleted_at).toBeNull()

    const projectCount = await db.count('FROM project WHERE tenant_id = 1 AND deleted_at IS NULL')
    expect(projectCount).toBe(1)

    const configRow = await db.queryOne(
      "SELECT config_value FROM sys_config WHERE tenant_id = 1 AND config_key = 'stale_report_days'"
    )
    expect(configRow).toBeNull()
    void owner
  })

  it('尝试写本身也要留痕（method 记录在访问日志里）', async () => {
    const { owner, platform } = await setup()
    await grantFor(owner.token, platform.admin.id)

    await platformCall('post', platform.token, 1, '/admin/projects', {
      name: 'x',
      address: 'y',
      contractAmount: '1.00',
      startDate: '2026-01-01',
      planEndDate: '2026-02-01',
    })
    await platformCall('delete', platform.token, 1, '/admin/projects/1', { confirm: true })

    const rows = await db.query(
      `SELECT detail FROM operation_log
        WHERE action = 'platform.access_tenant' AND tenant_id = 1`
    )
    const methods = rows.map((r) => {
      const detail = typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail
      return detail.after.method
    })
    expect(methods).toContain('POST')
    expect(methods).toContain('DELETE')
  })
})

// ─────────────────────────────────────────────────────────────
// 授权管理
// ─────────────────────────────────────────────────────────────

describe('P4 · 授权的授予、撤销与校验', () => {
  it('项目管理员不能授予；撤销售权按租户隔离', async () => {
    const { owner, platform } = await setup()
    const grant = await grantFor(owner.token, platform.admin.id)

    const projectAdmin = await auth.createAndLogin({
      username: `pa_admin_${nextSeq()}`,
      role: 'admin',
      tenantId: 1,
    })
    const denied = await createGrant(projectAdmin.token, {
      adminUserId: platform.admin.id,
      expiresAt: futureHours(1),
    })
    expect(denied.status).toBe(403)

    // 另一个租户的 owner 看不到、也撤销不了这条授权
    const tenantB = await fixtures.createTenant({ name: '旁观者', code: `pa-observer-${nextSeq()}` })
    const ownerB = await auth.createAndLogin({
      username: `pa_owner_b_${nextSeq()}`,
      role: 'owner',
      tenantId: tenantB,
    })

    const listB = await request.authed('get', '/admin/platform-grants', ownerB.token).expect(200)
    expect(listB.body.data.total).toBe(0)

    const revokeB = await request.authed('delete', `/admin/platform-grants/${grant.id}`, ownerB.token)
    expect(revokeB.status).toBe(404)

    // 本租户 owner 撤销成功
    const revoked = await request.authed('delete', `/admin/platform-grants/${grant.id}`, owner.token)
    expect(revoked.status).toBe(200)
    expect(revoked.body.data.status).toBe('revoked')

    const blocked = await platformGet(platform.token, 1, '/admin/projects')
    expect(blocked.status).toBe(403)
  })

  it('只能授权给有效的平台账号', async () => {
    const { owner } = await setup()
    const tenantAdmin = await auth.createAdmin({
      username: `pa_not_platform_${nextSeq()}`,
      role: 'owner',
      tenantId: 1,
    })

    const res = await createGrant(owner.token, {
      adminUserId: tenantAdmin.id,
      expiresAt: futureHours(1),
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('平台运营')
  })

  it('时限必须是未来且不超过 7 天；有效窗口不能重复开', async () => {
    const { owner, platform } = await setup()

    const past = await createGrant(owner.token, {
      adminUserId: platform.admin.id,
      expiresAt: '2020-01-01',
    })
    expect(past.status).toBe(400)

    const tooLong = await createGrant(owner.token, {
      adminUserId: platform.admin.id,
      expiresAt: futureHours(24 * 8),
    })
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.message).toContain('7 天')

    await grantFor(owner.token, platform.admin.id)
    const duplicate = await createGrant(owner.token, {
      adminUserId: platform.admin.id,
      expiresAt: futureHours(1),
    })
    expect(duplicate.status).toBe(409)
  })

  it('可以用平台用户名授予；过期后访问被拒', async () => {
    const { owner, platform } = await setup()

    const grant = await grantFor(owner.token, undefined, {
      adminUserId: undefined,
      adminUsername: platform.admin.username,
    })
    expect(grant.adminUserId).toBe(platform.admin.id)

    await db.query('UPDATE platform_access_grant SET expires_at = ? WHERE id = ?', [
      '2020-01-01 00:00:00',
      grant.id,
    ])

    const blocked = await platformGet(platform.token, 1, '/admin/projects')
    expect(blocked.status).toBe(403)

    const list = await request.authed('get', '/admin/platform-grants', owner.token).expect(200)
    const item = list.body.data.list.find((g) => g.id === grant.id)
    expect(item.status).toBe('expired')
  })

  it('租户停用后，平台即使持有窗口也进不去', async () => {
    const { owner, platform } = await setup()
    await grantFor(owner.token, platform.admin.id)

    await db.query("UPDATE tenant SET status = 'suspended' WHERE id = 1")

    const res = await platformGet(platform.token, 1, '/admin/projects')
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('租户已停用')
  })
})

// ─────────────────────────────────────────────────────────────
// 门锁密码：永久排除
// ─────────────────────────────────────────────────────────────

describe('P4 · 门锁密码对平台永久不可见', () => {
  it('持有效授权的平台也拿不到密码：后台无入口，C 端 token 被拒', async () => {
    const { owner, platform, projectId } = await setup()

    // 业主在 C 端设置门锁密码
    const homeowner = await mini.login(`pa-homeowner-${nextSeq()}`)
    await mini.addMember({ projectId, userId: homeowner.userId, role: 'owner' })
    const created = await request
      .authed('post', `/projects/${projectId}/door-codes`, homeowner.token)
      .send({ name: '入户门', code: '8888#' })
    expect(created.status).toBe(200)

    await grantFor(owner.token, platform.admin.id)

    // 后台项目详情里没有任何门锁密码字段
    const detail = await platformGet(platform.token, 1, `/admin/projects/${projectId}`).expect(200)
    expect(JSON.stringify(detail.body)).not.toContain('8888#')
    expect(detail.body.data.doorCodes).toBeUndefined()

    // 平台 token 打 C 端门锁接口：在 requireMini 就被拒绝
    const cEnd = await request.authed('get', `/projects/${projectId}/door-codes`, platform.token)
    expect(cEnd.status).toBe(401)

    // 工长读一次密码（会写 door_code.read 日志），平台即使能看日志也看不到明文
    const foreman = await mini.login(`pa-foreman-${nextSeq()}`)
    await mini.addMember({ projectId, userId: foreman.userId, role: 'foreman' })
    const read = await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token).expect(200)
    expect(read.body.data.list[0].code).toBe('8888#')

    const logs = await platformGet(
      platform.token,
      1,
      '/admin/operation-logs?action=door_code.read'
    ).expect(200)
    expect(logs.body.data.total).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(logs.body)).not.toContain('8888#')
  })
})
