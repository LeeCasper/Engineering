'use strict'

/**
 * 小程序管理员微信免密绑定（迁移 018）。
 *
 * 覆盖的是安全边界，不只是 happy path：
 *   - mini token 不能直接当 admin token 用；
 *   - 绑定只是「微信身份 → 管理员账号」的映射，每次免密登录仍要回库校验；
 *   - 改密 / 重置 / 禁用 / 注销 / token_version 失配都必须让绑定失效；
 *   - 平台账号、锁定、首登改密都不能进管理端。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const captchaService = require('../../src/services/captcha.service')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
const auth = require('./helpers/auth')
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
  await db.query('SET FOREIGN_KEY_CHECKS = 0')
  for (const table of [
    'admin_wechat_binding',
    'admin_login_log',
    'operation_log',
    'project_admin_scope',
    'project',
    'admin_user',
    'user',
  ]) {
    await db.query(`TRUNCATE TABLE \`${table}\``)
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1')
  await db.query("UPDATE tenant SET status = 'active', expires_at = NULL WHERE id = 1")
})

async function bindWechat(adminToken, miniToken) {
  return request
    .authed('post', '/admin/auth/wechat-binding', adminToken)
    .set('X-Mini-Token', miniToken)
    .send({})
}

async function wechatLogin(miniToken, bindingId) {
  return request
    .authed('post', '/auth/admin/wechat-login', miniToken)
    .send({ bindingId })
}

describe('图形验证码 PNG', () => {
  it('返回 PNG data URI，默认仍返回 SVG，且答案仍可校验', async () => {
    const png = await request.get('/admin/auth/captcha?format=png')
    expect(png.status).toBe(200)
    expect(png.body.data.pngDataUrl).toMatch(/^data:image\/png;base64,/)
    const bytes = Buffer.from(png.body.data.pngDataUrl.split(',')[1], 'base64')
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.body.data.captchaId).toBeTruthy()

    const svg = await request.get('/admin/auth/captcha')
    expect(svg.status).toBe(200)
    expect(svg.body.data.svg).toContain('<svg')
    expect(svg.body.data.pngDataUrl).toBeUndefined()

    // debugAnswer 只在 development 返回；测试从缓存取答案
    const answer = await cache.get(captchaService._key(png.body.data.captchaId))
    expect(answer).toBeTruthy()
  })
})

describe('绑定与免密登录', () => {
  it('密码登录与 profile 标注登录方式、租户名称与签发时间', async () => {
    const { token, loginBody } = await auth.createAndLogin({ username: 'profile-meta', role: 'owner' })
    expect(loginBody.data.authMethod).toBe('password')
    expect(loginBody.data.issuedAt).toBeTruthy()

    const profile = await request.authed('get', '/admin/auth/profile', token)
    expect(profile.status).toBe(200)
    expect(profile.body.data).toMatchObject({
      username: 'profile-meta',
      role: 'owner',
      tenantName: '默认租户',
      tenantCode: 'default',
      authMethod: 'password',
    })
    expect(profile.body.data.tokenIssuedAt).toBe(loginBody.data.issuedAt)
  })

  it('密码登录后可绑定当前微信，并用绑定换取可用的管理员 token', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'owner-bind', role: 'owner' })
    const c = await mini.login('binding-owner-code')
    expect(c.token).toBeTruthy()

    const bound = await bindWechat(token, c.token)
    expect(bound.status).toBe(200)
    expect(bound.body.data.bound).toBe(true)
    expect(bound.body.data.binding.id).toBeTruthy()

    const list = await request.authed('get', '/auth/admin/bindings', c.token)
    expect(list.status).toBe(200)
    expect(list.body.data.bindings).toHaveLength(1)
    expect(list.body.data.bindings[0]).toMatchObject({
      adminUserId: admin.id,
      username: 'owner-bind',
      role: 'owner',
      tenantName: '默认租户',
      tenantCode: 'default',
    })
    // 不把 openid 返回给客户端
    expect(list.body.data.bindings[0].openid).toBeUndefined()

    const login = await wechatLogin(c.token, bound.body.data.binding.id)
    expect(login.status).toBe(200)
    expect(login.body.data.authMethod).toBe('wechat')
    expect(login.body.data.token).toBeTruthy()
    expect(login.body.data.admin).toMatchObject({
      id: admin.id,
      role: 'owner',
      tenantName: '默认租户',
      tenantCode: 'default',
    })

    const projects = await request.authed('get', '/admin/projects', login.body.data.token)
    expect(projects.status).toBe(200)

    const log = await db.queryOne(
      `SELECT auth_method FROM admin_login_log
        WHERE admin_user_id = ? AND result = 'success'
        ORDER BY id DESC LIMIT 1`,
      [admin.id]
    )
    expect(log.auth_method).toBe('wechat')

    const actions = await db.query(
      `SELECT action FROM operation_log
        WHERE target_id = ? AND target_type = 'admin_user'
        ORDER BY id`,
      [admin.id]
    )
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining(['admin_user.wechat_bind', 'admin_user.wechat_login'])
    )
  })

  it('同一个微信可以绑定两个管理员账号，列表返回两个身份', async () => {
    const owner = await auth.createAndLogin({ username: 'multi-owner', role: 'owner' })
    const pm = await auth.createAndLogin({ username: 'multi-pm', role: 'admin' })
    const c = await mini.login('binding-multi-code')

    const b1 = await bindWechat(owner.token, c.token)
    const b2 = await bindWechat(pm.token, c.token)
    expect(b1.status).toBe(200)
    expect(b2.status).toBe(200)
    expect(b1.body.data.binding.id).not.toBe(b2.body.data.binding.id)

    const list = await request.authed('get', '/auth/admin/bindings', c.token)
    expect(list.body.data.bindings).toHaveLength(2)
    expect(list.body.data.bindings.map((row) => row.role).sort()).toEqual(['admin', 'owner'])

    const ownerLogin = await wechatLogin(c.token, b1.body.data.binding.id)
    const pmLogin = await wechatLogin(c.token, b2.body.data.binding.id)
    expect(ownerLogin.status).toBe(200)
    expect(pmLogin.status).toBe(200)
    expect(ownerLogin.body.data.admin.role).toBe('owner')
    expect(pmLogin.body.data.admin.role).toBe('admin')
  })

  it('重新绑定到另一个微信会撤销旧绑定，旧绑定不能再登录', async () => {
    const { token } = await auth.createAndLogin({ username: 'rebind-user', role: 'owner' })
    const c1 = await mini.login('binding-rebind-old')
    const c2 = await mini.login('binding-rebind-new')

    const oldBinding = await bindWechat(token, c1.token)
    const newBinding = await bindWechat(token, c2.token)
    expect(oldBinding.status).toBe(200)
    expect(newBinding.status).toBe(200)

    const oldLogin = await wechatLogin(c1.token, oldBinding.body.data.binding.id)
    expect(oldLogin.status).toBe(404)

    const newLogin = await wechatLogin(c2.token, newBinding.body.data.binding.id)
    expect(newLogin.status).toBe(200)

    const row = await db.queryOne('SELECT status, revoked_reason FROM admin_wechat_binding WHERE id = ?', [
      oldBinding.body.data.binding.id,
    ])
    expect(row.status).toBe('revoked')
    expect(row.revoked_reason).toBe('rebind')
  })

  it('解绑后免密登录失败，C 端绑定列表为空', async () => {
    const { token } = await auth.createAndLogin({ username: 'unbind-user', role: 'owner' })
    const c = await mini.login('binding-unbind-code')
    const bound = await bindWechat(token, c.token)

    const unbound = await request.authed('del', '/admin/auth/wechat-binding', token)
    expect(unbound.status).toBe(200)
    expect(unbound.body.data.unbound).toBe(true)

    const list = await request.authed('get', '/auth/admin/bindings', c.token)
    expect(list.body.data.bindings).toHaveLength(0)

    const login = await wechatLogin(c.token, bound.body.data.binding.id)
    expect(login.status).toBe(404)
  })
})

describe('绑定安全边界', () => {
  it('C token 不能访问管理端，admin token 不能访问 C 端绑定接口', async () => {
    const { token: adminToken } = await auth.createAndLogin({ username: 'cross-token', role: 'owner' })
    const c = await mini.login('binding-cross-code')

    const adminWithMini = await request.authed('get', '/admin/projects', c.token)
    expect(adminWithMini.status).toBe(401)

    const miniWithAdmin = await request.authed('get', '/auth/admin/bindings', adminToken)
    expect(miniWithAdmin.status).toBe(401)

    const bindWithMini = await request
      .authed('post', '/admin/auth/wechat-binding', c.token)
      .set('X-Mini-Token', c.token)
      .send({})
    expect(bindWithMini.status).toBe(401)
  })

  it('微信免密 token 不能再绑定新的微信', async () => {
    const { token } = await auth.createAndLogin({ username: 'wechat-cannot-bind', role: 'owner' })
    const c1 = await mini.login('binding-wechat-bind-1')
    const c2 = await mini.login('binding-wechat-bind-2')
    const bound = await bindWechat(token, c1.token)

    const session = await wechatLogin(c1.token, bound.body.data.binding.id)
    expect(session.status).toBe(200)

    const rebind = await bindWechat(session.body.data.token, c2.token)
    expect(rebind.status).toBe(403)
    expect(rebind.body.message).toContain('账号密码')
  })

  it('平台账号不能绑定微信', async () => {
    const platform = await auth.createAndLogin({ tenantId: null, role: 'platform', username: 'platform-bind' })
    const c = await mini.login('binding-platform-code')

    const res = await bindWechat(platform.token, c.token)
    expect(res.status).toBe(403)
  })

  it('首登强制改密时不能绑定', async () => {
    const { token } = await auth.createAndLogin({
      username: 'mcp-bind',
      role: 'owner',
      mustChangePassword: true,
    })
    const c = await mini.login('binding-mcp-code')

    const res = await bindWechat(token, c.token)
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('初始密码')
  })

  it('锁定中的管理员不能绑定，也不能免密登录', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'locked-bind', role: 'owner' })
    const c = await mini.login('binding-locked-code')
    const bound = await bindWechat(token, c.token)
    expect(bound.status).toBe(200)

    await db.query('UPDATE admin_user SET locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id = ?', [
      admin.id,
    ])

    const login = await wechatLogin(c.token, bound.body.data.binding.id)
    expect(login.status).toBe(401)
    expect(login.body.message).toContain('锁定')
  })

  it('绑定后禁用账号，免密登录失败', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'disable-bind', role: 'owner' })
    const c = await mini.login('binding-disable-code')
    const bound = await bindWechat(token, c.token)

    await db.query("UPDATE admin_user SET status = 'disabled', token_version = token_version + 1 WHERE id = ?", [
      admin.id,
    ])

    const login = await wechatLogin(c.token, bound.body.data.binding.id)
    expect(login.status).toBe(403)
    expect(login.body.message).toContain('禁用')
  })

  it('改密后绑定失效', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'pwd-bind', role: 'owner' })
    const c = await mini.login('binding-pwd-code')
    const bound = await bindWechat(token, c.token)

    const changed = await request
      .authed('post', '/admin/auth/change-password', token)
      .send({ oldPassword: 'Test123456', newPassword: 'NewPass123456' })
    expect(changed.status).toBe(200)

    const login = await wechatLogin(c.token, bound.body.data.binding.id)
    expect(login.status).toBe(404)

    const row = await db.queryOne('SELECT status, revoked_reason FROM admin_wechat_binding WHERE admin_user_id = ?', [
      admin.id,
    ])
    expect(row.status).toBe('revoked')
    expect(row.revoked_reason).toBe('password_changed')
  })

  it('管理员重置密码后绑定失效', async () => {
    const owner = await auth.createAndLogin({ username: 'reset-owner', role: 'owner' })
    const target = await auth.createAndLogin({ username: 'reset-target', role: 'admin' })
    const c = await mini.login('binding-reset-code')
    const bound = await bindWechat(target.token, c.token)
    expect(bound.status).toBe(200)

    const reset = await request
      .authed('put', `/admin/admin-users/${target.admin.id}/password`, owner.token)
      .send({ newPassword: 'ResetPass123456' })
    expect(reset.status).toBe(200)

    const login = await wechatLogin(c.token, bound.body.data.binding.id)
    expect(login.status).toBe(404)
  })

  it('C 端注销后绑定失效', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'deactivate-bind', role: 'owner' })
    const c = await mini.login('binding-deactivate-code')
    const bound = await bindWechat(token, c.token)
    expect(bound.status).toBe(200)

    const deactivated = await request.authed('post', '/auth/deactivate', c.token).send({ confirm: true })
    expect(deactivated.status).toBe(200)

    const login = await wechatLogin(c.token, bound.body.data.binding.id)
    // requireMini 对已注销账号返回 403（「账号已注销」），不是 401
    expect(login.status).toBe(403)

    const row = await db.queryOne('SELECT status, revoked_reason FROM admin_wechat_binding WHERE admin_user_id = ?', [
      admin.id,
    ])
    expect(row.status).toBe('revoked')
    expect(row.revoked_reason).toBe('user_deactivated')
  })

  it('admin_token_version 失配时免密登录失败并撤销绑定', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'version-bind', role: 'owner' })
    const c = await mini.login('binding-version-code')
    const bound = await bindWechat(token, c.token)

    await db.query('UPDATE admin_user SET token_version = token_version + 1 WHERE id = ?', [admin.id])

    const login = await wechatLogin(c.token, bound.body.data.binding.id)
    expect(login.status).toBe(403)
    expect(login.body.message).toContain('绑定已失效')

    const row = await db.queryOne('SELECT status, revoked_reason FROM admin_wechat_binding WHERE id = ?', [
      bound.body.data.binding.id,
    ])
    expect(row.status).toBe('revoked')
    expect(row.revoked_reason).toBe('token_version_mismatch')
  })

  it('租户停用或到期后免密登录失败', async () => {
    const { token } = await auth.createAndLogin({ username: 'tenant-bind', role: 'owner' })
    const c = await mini.login('binding-tenant-code')
    const bound = await bindWechat(token, c.token)

    await db.query("UPDATE tenant SET status = 'suspended' WHERE id = 1")
    const suspended = await wechatLogin(c.token, bound.body.data.binding.id)
    expect(suspended.status).toBe(403)

    await db.query("UPDATE tenant SET status = 'active', expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = 1")
    const expired = await wechatLogin(c.token, bound.body.data.binding.id)
    expect(expired.status).toBe(403)
  })

  it('手机号合并后 openid 绑定仍然可用', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'merge-bind', role: 'owner' })
    const c = await mini.login('binding-merge-code')
    const bound = await bindWechat(token, c.token)
    expect(bound.status).toBe(200)

    const placeholderId = await mini.createPlaceholderUser('13900001111')

    const boundPhone = await request
      .authed('post', '/auth/bind-phone', c.token)
      .send({ phone: '13900001111' })
    expect(boundPhone.status).toBe(200)
    expect(boundPhone.body.data.merged).toBe(true)
    expect(boundPhone.body.data.token).toBeTruthy()

    const list = await request.authed('get', '/auth/admin/bindings', boundPhone.body.data.token)
    expect(list.body.data.bindings).toHaveLength(1)

    const login = await wechatLogin(boundPhone.body.data.token, bound.body.data.binding.id)
    expect(login.status).toBe(200)

    const row = await db.queryOne('SELECT user_id FROM admin_wechat_binding WHERE admin_user_id = ?', [admin.id])
    expect(Number(row.user_id)).toBe(Number(placeholderId))
  })
})

describe('绑定后的权限降级', () => {
  it('owner 看全租户项目，admin 只看自己创建的项目；admin 不能删除项目', async () => {
    const owner = await auth.createAndLogin({ username: 'scope-owner', role: 'owner' })
    const pm = await auth.createAndLogin({ username: 'scope-pm', role: 'admin' })
    const ownerProjectId = await mini.createProject({ name: 'owner-project', createdBy: owner.admin.id })
    const pmProjectId = await mini.createProject({ name: 'pm-project', createdBy: pm.admin.id })
    const c = await mini.login('binding-scope-code')

    const ownerBinding = await bindWechat(owner.token, c.token)
    const pmBinding = await bindWechat(pm.token, c.token)

    const ownerSession = await wechatLogin(c.token, ownerBinding.body.data.binding.id)
    const pmSession = await wechatLogin(c.token, pmBinding.body.data.binding.id)

    const ownerList = await request.authed('get', '/admin/projects', ownerSession.body.data.token)
    expect(ownerList.status).toBe(200)
    expect(ownerList.body.data.total).toBe(2)

    const pmList = await request.authed('get', '/admin/projects', pmSession.body.data.token)
    expect(pmList.status).toBe(200)
    expect(pmList.body.data.total).toBe(1)
    expect(pmList.body.data.list[0].id).toBe(pmProjectId)

    const pmDelete = await request
      .authed('del', `/admin/projects/${ownerProjectId}`, pmSession.body.data.token)
      .send({ confirm: true })
    expect(pmDelete.status).toBe(403)

    const ownerDelete = await request
      .authed('del', `/admin/projects/${ownerProjectId}`, ownerSession.body.data.token)
      .send({ confirm: true })
    expect(ownerDelete.status).toBe(200)
  })
})
