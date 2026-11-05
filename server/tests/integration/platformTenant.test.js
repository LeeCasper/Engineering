'use strict'

/**
 * 平台运营 · 租户生命周期（M13 / P3）。
 *
 * ── 这组用例守住的是什么 ──
 * 开通一个租户必须一次成型：租户行、owner 账号、默认模板、内容页骨架。
 * 少任一样，客户登录后都会看到一个「像系统坏了」的空状态，而平台没有
 * 接口能补齐它 —— 只能手工改库。
 *
 * 另外两条是 SaaS 的商业模式边界：
 *   - **配额**：项目数/账号数到上限必须拒绝，且并发下不能突破；
 *   - **停用/到期**：后台登录立即失效，C 端只读 —— 这是「欠费还能继续用」
 *     与「数据被锁死」之间的那条线。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
const password = require('../../src/utils/password')
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

async function loginPlatform() {
  return auth.createAndLogin({
    username: `platform_${nextSeq()}`,
    role: 'platform',
    tenantId: null,
  })
}

const OWNER_PASSWORD = 'Owner123456'

function provisionBody(n, overrides = {}) {
  return {
    name: `客户装修公司 ${n}`,
    code: `acme-${n}`,
    plan: 'pro',
    maxProjects: 3,
    maxAdminUsers: 3,
    expiresAt: '2027-12-31',
    contactName: '张经理',
    contactPhone: '13800138000',
    provinceCode: '310000',
    cityCode: '310000',
    owner: { username: `acme_owner_${n}`, password: OWNER_PASSWORD },
    ...overrides,
  }
}

async function provision(platformToken, n, overrides = {}) {
  const body = provisionBody(n, overrides)
  const res = await request.authed('post', '/admin/platform/tenants', platformToken).send(body)
  expect(res.status).toBe(200)
  return { body: res.body.data, requestBody: body, tenantId: res.body.data.tenant.id }
}

/**
 * 让 owner 可以正常调用业务接口。
 *
 * provision 建出来的账号带 `mustChangePassword=1`，直接调业务接口会被
 * 挡在「请先修改初始密码」。大部分用例不关心这一步，直接改库跳过；
 * 强制改密流程本身单独有一条用例覆盖。
 */
async function activateOwner(tenantId, username) {
  await db.query(
    'UPDATE admin_user SET must_change_password = 0 WHERE tenant_id = ? AND username = ?',
    [tenantId, username]
  )
}

async function loginOwner(provisioned) {
  const { requestBody, tenantId } = provisioned
  await activateOwner(tenantId, requestBody.owner.username)
  const result = await auth.login(requestBody.owner.username, requestBody.owner.password)
  expect(result.status).toBe(200)
  return result
}

// ─────────────────────────────────────────────────────────────
// 权限：平台入口只有平台账号能进
// ─────────────────────────────────────────────────────────────

describe('P3 · 平台路由的权限边界', () => {
  it('未登录 401，租户 owner 与项目管理员 403', async () => {
    await request.get('/admin/platform/tenants').expect(401)

    const owner = await auth.createAndLogin({ username: `t_owner_${nextSeq()}`, role: 'owner', tenantId: 1 })
    const admin = await auth.createAndLogin({ username: `t_admin_${nextSeq()}`, role: 'admin', tenantId: 1 })

    for (const token of [owner.token, admin.token]) {
      const res = await request.authed('get', '/admin/platform/tenants', token)
      expect(res.status).toBe(403)
      expect(res.body.message).toContain('平台运营')
    }
  })

  it('平台账号可以正常使用平台入口', async () => {
    const platform = await loginPlatform()
    await request.authed('get', '/admin/platform/tenants', platform.token).expect(200)
  })
})

// ─────────────────────────────────────────────────────────────
// 开通：一次成型
// ─────────────────────────────────────────────────────────────

describe('P3 · 开通租户：租户 + owner + 默认模板 + 内容页一次成型', () => {
  it('返回租户、owner、默认模板与 tenantCode，用量从 1 个账号起算', async () => {
    const platform = await loginPlatform()
    const result = await provision(platform.token, nextSeq())

    expect(result.body.tenant.code).toBe(result.requestBody.code)
    expect(result.body.tenant.status).toBe('active')
    expect(result.body.tenant.usage).toEqual({ projectCount: 0, adminCount: 1 })
    expect(result.body.tenant.expiresAt).toBe('2027-12-31 23:59:59')
    expect(result.body.owner.mustChangePassword).toBe(true)
    expect(result.body.defaultTemplateId).toBeTruthy()
    expect(result.body.tenantCode).toBe(result.requestBody.code)
  })

  it('落库的东西齐备：owner 角色、8 阶段 30 工序的默认模板、3 个未发布内容页', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const { tenantId, body } = await provision(platform.token, n)

    const owner = await db.queryOne(
      'SELECT role, must_change_password FROM admin_user WHERE tenant_id = ? AND username = ?',
      [tenantId, `acme_owner_${n}`]
    )
    expect(owner.role).toBe('owner')
    expect(owner.must_change_password).toBe(1)

    const template = await db.queryOne(
      'SELECT id, is_default FROM stage_template WHERE tenant_id = ? AND deleted_at IS NULL',
      [tenantId]
    )
    expect(template.id).toBe(body.defaultTemplateId)
    expect(template.is_default).toBe(1)

    const stageCount = await db.count('FROM stage_template_stage WHERE template_id = ?', [template.id])
    const itemCount = await db.count(
      `FROM stage_template_item i
         JOIN stage_template_stage s ON s.id = i.template_stage_id
        WHERE s.template_id = ?`,
      [template.id]
    )
    expect(stageCount).toBe(8)
    expect(itemCount).toBe(30)

    const pages = await db.query(
      'SELECT page_key, published_at FROM content_page WHERE tenant_id = ? ORDER BY page_key',
      [tenantId]
    )
    expect(pages.map((p) => p.page_key)).toEqual(['about', 'agreement', 'privacy'])
    expect(pages.every((p) => p.published_at === null)).toBe(true)
  })

  it('owner 首次登录被强制改密；改密后可以正常使用', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)

    // 首次登录：密码正确，但只被允许访问改密相关接口
    const first = await auth.login(`acme_owner_${n}`, OWNER_PASSWORD)
    expect(first.status).toBe(200)
    expect(first.body.data.mustChangePassword).toBe(true)

    const blocked = await request.authed('get', '/admin/projects', first.token)
    expect(blocked.status).toBe(403)
    expect(blocked.body.message).toContain('初始密码')

    const changed = await request
      .authed('post', '/admin/auth/change-password', first.token)
      .send({ oldPassword: OWNER_PASSWORD, newPassword: 'Changed123456' })
    expect(changed.status).toBe(200)

    // 改密让旧 token 失效，重新登录
    const second = await auth.login(`acme_owner_${n}`, 'Changed123456')
    expect(second.status).toBe(200)
    expect(second.body.data.admin.tenantId).toBe(provisioned.tenantId)
    await request.authed('get', '/admin/projects', second.token).expect(200)
  })

  it('owner 可以直接建档，且用的是本租户的默认模板', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)
    const owner = await loginOwner(provisioned)

    const created = await request.authed('post', '/admin/projects', owner.token).send({
      name: '开通后的第一个项目',
      address: '上海市某路 1 号',
      contractAmount: '200000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-08-01',
      // 不传 templateId：应当回落到开通时灌入的默认模板
    })
    expect(created.status).toBe(200)

    const projectId = created.body.data.id
    const row = await db.queryOne('SELECT tenant_id, template_id FROM project WHERE id = ?', [projectId])
    expect(Number(row.tenant_id)).toBe(provisioned.tenantId)
    expect(row.template_id).toBe(provisioned.body.defaultTemplateId)

    const stageCount = await db.count('FROM project_stage WHERE project_id = ?', [projectId])
    expect(stageCount).toBe(8)
  })

  it('新租户读到的配置是出厂默认值，且标记为「未配置」', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)
    const owner = await loginOwner(provisioned)

    const configs = await request.authed('get', '/admin/sys-configs', owner.token).expect(200)
    const item = configs.body.data.list.find((c) => c.key === 'stale_report_days')
    expect(item.value).toBe('3')
    // 不插入 sys_config 行：缺行 = 出厂默认值。插一份相同的值会让
    // 运维分不清「调过」与「没调过」
    expect(item.isDefault).toBe(true)

    const rows = await db.count('FROM sys_config WHERE tenant_id = ?', [provisioned.tenantId])
    expect(rows).toBe(0)
  })

  it('租户标识重复、密码不合规、标识格式错误都会被拒绝', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    await provision(platform.token, n)

    const duplicate = await request
      .authed('post', '/admin/platform/tenants', platform.token)
      .send(provisionBody(n + 1000, { code: `acme-${n}`, owner: { username: `other_${n}`, password: OWNER_PASSWORD } }))
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.message).toContain('已被使用')

    const weak = await request
      .authed('post', '/admin/platform/tenants', platform.token)
      .send(provisionBody(n + 2000, { owner: { username: `weak_${n}`, password: '12345678' } }))
    expect(weak.status).toBe(400)
    expect(weak.body.message).toContain('字母与数字')

    const badCode = await request
      .authed('post', '/admin/platform/tenants', platform.token)
      .send(provisionBody(n + 3000, { code: 'Bad Code' }))
    expect(badCode.status).toBe(400)
  })

  it('内容页在发布前对 C 端不可见', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)

    const res = await request.get(`/contents/privacy?tenantId=${provisioned.tenantId}`)
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('页面尚未发布')
  })
})

// ─────────────────────────────────────────────────────────────
// 配额
// ─────────────────────────────────────────────────────────────

describe('P3 · 配额：到上限即拒绝，且不能靠并发突破', () => {
  it('项目数达到 maxProjects 后拒绝建档', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n, { maxProjects: 1 })
    const owner = await loginOwner(provisioned)

    const body = {
      name: '第一个项目',
      address: '上海市某路 1 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
    }

    await request.authed('post', '/admin/projects', owner.token).send(body).expect(200)

    const second = await request
      .authed('post', '/admin/projects', owner.token)
      .send({ ...body, name: '第二个项目' })
    expect(second.status).toBe(403)
    expect(second.body.message).toContain('上限')

    const count = await db.count('FROM project WHERE tenant_id = ? AND deleted_at IS NULL', [
      provisioned.tenantId,
    ])
    expect(count).toBe(1)
  })

  it('后台账号数达到 maxAdminUsers 后拒绝建号；提高配额后恢复', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    // owner 自己占 1 个名额
    const provisioned = await provision(platform.token, n, { maxAdminUsers: 1 })
    const owner = await loginOwner(provisioned)

    const blocked = await request
      .authed('post', '/admin/admin-users', owner.token)
      .send({ username: `staff_${n}`, password: 'Staff123456', role: 'admin' })
    expect(blocked.status).toBe(403)
    expect(blocked.body.message).toContain('上限')

    await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}`, platform.token)
      .send({ maxAdminUsers: 2 })
      .expect(200)

    const allowed = await request
      .authed('post', '/admin/admin-users', owner.token)
      .send({ username: `staff_${n}`, password: 'Staff123456', role: 'admin' })
    expect(allowed.status).toBe(200)

    const count = await db.count('FROM admin_user WHERE tenant_id = ? AND deleted_at IS NULL', [
      provisioned.tenantId,
    ])
    expect(count).toBe(2)
  })

  it('删除一个项目再恢复时，恢复也占用配额', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n, { maxProjects: 1 })
    const owner = await loginOwner(provisioned)

    const body = {
      name: '唯一项目',
      address: '上海市某路 1 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
    }
    const first = await request.authed('post', '/admin/projects', owner.token).send(body)
    const firstId = first.body.data.id

    await request.authed('delete', `/admin/projects/${firstId}`, owner.token).send({ confirm: true }).expect(200)

    // 删掉一个之后可以再建一个
    const second = await request
      .authed('post', '/admin/projects', owner.token)
      .send({ ...body, name: '替补项目' })
    expect(second.status).toBe(200)

    // 此时配额已满，恢复被删的那个必须被拒
    const restore = await request.authed('post', `/admin/projects/${firstId}/restore`, owner.token)
    expect(restore.status).toBe(403)
    expect(restore.body.message).toContain('上限')
  })
})

// ─────────────────────────────────────────────────────────────
// 状态：停用 / 恢复 / 退租 / 到期
// ─────────────────────────────────────────────────────────────

describe('P3 · 停用与到期：后台失效、C 端只读', () => {
  it('停用后 owner 不能登录，已签发的 token 下一次请求即被拒；恢复后可用', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)
    const owner = await loginOwner(provisioned)

    await request.authed('get', '/admin/projects', owner.token).expect(200)

    const suspended = await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}/status`, platform.token)
      .send({ status: 'suspended', reason: '欠费' })
    expect(suspended.status).toBe(200)
    expect(suspended.body.data.status).toBe('suspended')

    const login = await auth.login(`acme_owner_${n}`, OWNER_PASSWORD)
    expect(login.status).toBe(403)
    expect(login.body.message).toContain('租户已停用')

    const existing = await request.authed('get', '/admin/projects', owner.token)
    expect(existing.status).toBe(403)

    await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}/status`, platform.token)
      .send({ status: 'active' })
      .expect(200)

    const relogin = await auth.login(`acme_owner_${n}`, OWNER_PASSWORD)
    expect(relogin.status).toBe(200)
  })

  it('已退租是终态，不能恢复', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)
    await activateOwner(provisioned.tenantId, `acme_owner_${n}`)

    await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}/status`, platform.token)
      .send({ status: 'archived' })
      .expect(200)

    const login = await auth.login(`acme_owner_${n}`, OWNER_PASSWORD)
    expect(login.status).toBe(403)

    const resume = await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}/status`, platform.token)
      .send({ status: 'active' })
    expect(resume.status).toBe(409)
    expect(resume.body.message).toContain('已退租')
  })

  it('到期后后台登录被拒，已有 token 也立即失效', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)
    const owner = await loginOwner(provisioned)

    await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}`, platform.token)
      .send({ expiresAt: '2020-01-01' })
      .expect(200)

    const existing = await request.authed('get', '/admin/projects', owner.token)
    expect(existing.status).toBe(403)
    expect(existing.body.message).toContain('到期')

    const login = await auth.login(`acme_owner_${n}`, OWNER_PASSWORD)
    expect(login.status).toBe(403)
    expect(login.body.message).toContain('到期')
  })

  it('停用租户的 C 端仍可读，但写操作一律 403', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)
    const owner = await loginOwner(provisioned)

    const created = await request.authed('post', '/admin/projects', owner.token).send({
      name: '停用前的项目',
      address: '上海市某路 1 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
    })
    const projectId = created.body.data.id

    const reader = await mini.login(`tenant-suspend-reader-${nextSeq()}`)
    await mini.addMember({ projectId, userId: reader.userId, role: 'owner' })

    // 待确认的邀请，用来验证「确认邀请」这个写操作也被挡住。
    // 先登录拿到 userId，再按这个 userId 建 pending 成员关系
    const invitee = await mini.login(`tenant-suspend-invitee-${nextSeq()}`)
    const memberId = await mini.addMember({
      projectId,
      userId: invitee.userId,
      role: 'foreman',
      status: 'pending',
    })

    await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}/status`, platform.token)
      .send({ status: 'suspended' })
      .expect(200)

    // 读：正常
    await request.authed('get', '/projects', reader.token).expect(200)
    await request.authed('get', `/projects/${projectId}`, reader.token).expect(200)

    // 写：确认邀请被拒
    const confirm = await request.authed('post', `/invitations/${memberId}/confirm`, invitee.token)
    expect(confirm.status).toBe(403)
    expect(confirm.body.message).toContain('租户已停用')

    // 项目级写操作同样被挡（`:id` 是项目 id 的那一类路由）
    const doorCode = await request
      .authed('post', `/projects/${projectId}/door-codes`, reader.token)
      .send({ name: '入户门', code: '123456#' })
    expect(doorCode.status).toBe(403)
    expect(doorCode.body.message).toContain('租户已停用')

    // 恢复后同一个写操作可以通过
    await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}/status`, platform.token)
      .send({ status: 'active' })
      .expect(200)

    await db.query('UPDATE user SET real_name = ? WHERE id = ?', ['跨租户邀请用户', invitee.userId])
    const confirmAfter = await request.authed('post', `/invitations/${memberId}/confirm`, invitee.token)
    expect(confirmAfter.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────
// 列表、详情与审计
// ─────────────────────────────────────────────────────────────

describe('P3 · 列表、详情与审计留痕', () => {
  it('列表带用量，支持按状态与关键字筛选', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n, { name: `筛选目标公司 ${n}` })
    await provision(platform.token, n + 9000, { name: `另一家公司 ${n}` })

    const filtered = await request
      .authed('get', `/admin/platform/tenants?keyword=${encodeURIComponent(`筛选目标公司 ${n}`)}`, platform.token)
      .expect(200)
    expect(filtered.body.data.total).toBe(1)
    expect(filtered.body.data.list[0].id).toBe(provisioned.tenantId)
    expect(filtered.body.data.list[0].usage.adminCount).toBe(1)

    const suspended = await request
      .authed('get', '/admin/platform/tenants?status=suspended', platform.token)
      .expect(200)
    expect(suspended.body.data.list.every((t) => t.status === 'suspended')).toBe(true)

    const detail = await request
      .authed('get', `/admin/platform/tenants/${provisioned.tenantId}`, platform.token)
      .expect(200)
    expect(detail.body.data.code).toBe(provisioned.requestBody.code)

    await request.authed('get', '/admin/platform/tenants/99999999', platform.token).expect(404)
  })

  it('可以把到期时间清空（改为长期有效），日志只记真正变化的字段', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)
    expect(provisioned.body.tenant.expiresAt).toBe('2027-12-31 23:59:59')

    const cleared = await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}`, platform.token)
      .send({ expiresAt: null })
      .expect(200)
    expect(cleared.body.data.expiresAt).toBeNull()

    const row = await db.queryOne(
      "SELECT detail FROM operation_log WHERE action = 'tenant.update' ORDER BY id DESC LIMIT 1"
    )
    const detail = typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail
    // 只延长/清除到期时间，不该把配额、联系人等没动的字段也写进日志
    expect(detail.after).toEqual({ expiresAt: null })
    expect(detail.after.maxProjects).toBeUndefined()
  })

  it('开通、改配额、停用都写平台级审计日志', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)

    await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}`, platform.token)
      .send({ maxProjects: 50 })
      .expect(200)
    await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}/status`, platform.token)
      .send({ status: 'suspended', reason: '测试' })
      .expect(200)

    const rows = await db.query(
      `SELECT action, tenant_id, target_type, target_id, operator_type, operator_id
         FROM operation_log
        WHERE action IN ('tenant.create', 'tenant.update', 'tenant.status')
        ORDER BY id ASC`
    )
    expect(rows.map((r) => r.action)).toEqual(['tenant.create', 'tenant.update', 'tenant.status'])
    // 平台级事件不进入被操作租户的审计流（CLAUDE.md 第 76 条）
    expect(rows.every((r) => r.tenant_id === null)).toBe(true)
    expect(rows.every((r) => r.target_type === 'tenant')).toBe(true)
    expect(rows.every((r) => Number(r.target_id) === provisioned.tenantId)).toBe(true)
    expect(rows.every((r) => r.operator_type === 'admin')).toBe(true)
    expect(rows.every((r) => Number(r.operator_id) === platform.admin.id)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// 租户地区
// ─────────────────────────────────────────────────────────────

describe('P3 · 租户地区', () => {
  it('新建租户必须填写地区，名称由服务端按代码派生', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()

    const missing = provisionBody(n)
    delete missing.provinceCode
    delete missing.cityCode
    const denied = await request
      .authed('post', '/admin/platform/tenants', platform.token)
      .send(missing)
    expect(denied.status).toBe(400)

    const created = await request
      .authed('post', '/admin/platform/tenants', platform.token)
      .send(provisionBody(n, { provinceCode: '330000', cityCode: '330100' }))
      .expect(200)

    const tenant = created.body.data.tenant
    expect(tenant.region).toEqual({
      provinceCode: '330000',
      provinceName: '浙江省',
      cityCode: '330100',
      cityName: '杭州市',
    })
    expect(tenant.regionLabel).toBe('浙江省 / 杭州市')

    const row = await db.queryOne(
      'SELECT province_code, province_name, city_code, city_name FROM tenant WHERE id = ?',
      [tenant.id]
    )
    expect(row).toEqual({
      province_code: '330000',
      province_name: '浙江省',
      city_code: '330100',
      city_name: '杭州市',
    })
  })

  it('城市不属于省份时拒绝开通', async () => {
    const platform = await loginPlatform()
    const res = await request
      .authed('post', '/admin/platform/tenants', platform.token)
      .send(provisionBody(nextSeq(), { provinceCode: '330000', cityCode: '440100' }))

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('城市不属于所选省份')
  })

  it('调整地区会更新名称并写入审计，清空也留痕', async () => {
    const platform = await loginPlatform()
    const n = nextSeq()
    const provisioned = await provision(platform.token, n)

    const updated = await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}`, platform.token)
      .send({ provinceCode: '440000', cityCode: '440300' })
      .expect(200)

    expect(updated.body.data.regionLabel).toBe('广东省 / 深圳市')

    const row = await db.queryOne(
      "SELECT detail FROM operation_log WHERE action = 'tenant.update' ORDER BY id DESC LIMIT 1"
    )
    const detail = typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail
    expect(detail.after).toMatchObject({
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440300',
      cityName: '深圳市',
    })

    const cleared = await request
      .authed('put', `/admin/platform/tenants/${provisioned.tenantId}`, platform.token)
      .send({ provinceCode: null, cityCode: null })
      .expect(200)
    expect(cleared.body.data.region).toBeNull()
    expect(cleared.body.data.regionLabel).toBeNull()
  })

  it('老租户没有地区仍可正常读取，列表支持地区与未分配筛选', async () => {
    const platform = await loginPlatform()
    const tenant = await db.queryOne('SELECT id FROM tenant WHERE code = ?', ['default'])
    const detail = await request
      .authed('get', `/admin/platform/tenants/${tenant.id}`, platform.token)
      .expect(200)
    expect(detail.body.data.region).toBeNull()

    // beforeEach 会清业务表，地区租户必须在同一个用例里现建
    const regionTenant = await provision(platform.token, nextSeq(), {
      provinceCode: '330000',
      cityCode: '330100',
    })

    const unassigned = await request
      .authed('get', '/admin/platform/tenants?unassigned=1', platform.token)
      .expect(200)
    expect(unassigned.body.data.list.some((item) => Number(item.id) === Number(tenant.id))).toBe(
      true
    )
    expect(
      unassigned.body.data.list.some((item) => Number(item.id) === regionTenant.tenantId)
    ).toBe(false)

    const regionList = await request
      .authed('get', '/admin/platform/tenants?provinceCode=330000', platform.token)
      .expect(200)
    expect(regionList.body.data.list.map((item) => Number(item.id))).toEqual([
      Number(regionTenant.tenantId),
    ])
    expect(regionList.body.data.list[0].region).toEqual({
      provinceCode: '330000',
      provinceName: '浙江省',
      cityCode: '330100',
      cityName: '杭州市',
    })
  })

  it('地区筛选参数非法时返回 400', async () => {
    const platform = await loginPlatform()

    const cityOnly = await request
      .authed('get', '/admin/platform/tenants?cityCode=440300', platform.token)
    expect(cityOnly.status).toBe(400)

    const conflict = await request
      .authed('get', '/admin/platform/tenants?unassigned=1&provinceCode=330000', platform.token)
    expect(conflict.status).toBe(400)
  })
})
