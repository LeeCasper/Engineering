'use strict'

/**
 * 后台账号管理的编辑 / 删除 / 改角色（B-1.3 / B-1.10 / AC-AD50）。
 *
 * AC-AD50 的原文是「项目管理员对**租户管理员**账号执行禁用、删除或改角色，
 * 一律返回 403」。禁用已有用例（adminAuth.test.js），本文件补上后两项，
 * 以及 B-1.3 里一直缺的「编辑」。
 *
 * 这些用例打真实 MySQL：软删除后的用户名释放依赖迁移 037 的生成列，
 * 用 mock 测不出来 —— 那正是这次改动最容易写错的地方。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const adminUserService = require('../../src/services/adminUser.service')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
const auth = require('./helpers/auth')

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
  for (const table of ['admin_user', 'admin_login_log', 'operation_log', 'admin_wechat_binding', 'project_admin_scope']) {
    await db.query(`TRUNCATE TABLE ${table}`)
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1')
})

/** 取某动作的操作日志，detail 统一解析成对象（JSON 列在驱动里可能是字符串） */
async function logsOf(action) {
  const rows = await db.query('SELECT * FROM operation_log WHERE action = ? ORDER BY id ASC', [action])
  return rows.map((row) => ({
    ...row,
    detail: typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail,
  }))
}

describe('编辑账号（PUT /admin/admin-users/:id）', () => {
  it('租户管理员可以修改用户名，并写入操作日志', async () => {
    const target = await auth.createAdmin({ username: 'old-name' })
    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })

    const res = await request.authed('put', `/admin/admin-users/${target.id}`, token).send({
      username: 'new-name',
    })

    expect(res.status).toBe(200)
    expect(res.body.data.username).toBe('new-name')

    const row = await db.queryOne('SELECT username FROM admin_user WHERE id = ?', [target.id])
    expect(row.username).toBe('new-name')

    const logs = await logsOf('admin_user.update')
    expect(logs).toHaveLength(1)
    expect(logs[0].target_type).toBe('admin_user')
    expect(Number(logs[0].target_id)).toBe(target.id)
    expect(logs[0].detail.before.username).toBe('old-name')
    expect(logs[0].detail.after.username).toBe('new-name')
  })

  it('改回原用户名视为成功，不报「已存在」', async () => {
    const target = await auth.createAdmin({ username: 'same-name' })
    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })

    const res = await request.authed('put', `/admin/admin-users/${target.id}`, token).send({
      username: 'same-name',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.username).toBe('same-name')
  })

  it('改成同租户内已存在的用户名返回 409', async () => {
    await auth.createAdmin({ username: 'taken' })
    const target = await auth.createAdmin({ username: 'mine' })
    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })

    const res = await request.authed('put', `/admin/admin-users/${target.id}`, token).send({
      username: 'taken',
    })
    expect(res.status).toBe(409)
  })

  it('用户名不合法返回 400，且不改库', async () => {
    const target = await auth.createAdmin({ username: 'legal' })
    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })

    const res = await request.authed('put', `/admin/admin-users/${target.id}`, token).send({
      username: '非法 用户名',
    })
    expect(res.status).toBe(400)

    const row = await db.queryOne('SELECT username FROM admin_user WHERE id = ?', [target.id])
    expect(row.username).toBe('legal')
  })

  it('项目管理员不能编辑账号（AC-AD50）', async () => {
    const owner = await auth.createAdmin({ username: 'owner-x', role: 'owner' })
    const { token } = await auth.createAndLogin({ username: 'pm-x', role: 'admin' })

    const res = await request.authed('put', `/admin/admin-users/${owner.id}`, token).send({
      username: 'hijacked',
    })
    expect(res.status).toBe(403)

    const row = await db.queryOne('SELECT username FROM admin_user WHERE id = ?', [owner.id])
    expect(row.username).toBe('owner-x')
  })

  it('项目管理员连自己创建的下属也不能编辑', async () => {
    const me = await auth.createAdmin({ username: 'pm-y', role: 'admin' })
    const sub = await auth.createAdmin({ username: 'sub-y', role: 'admin', createdBy: me.id })
    const { token } = await auth.login('pm-y', 'Test123456')

    const res = await request.authed('put', `/admin/admin-users/${sub.id}`, token).send({
      username: 'sub-renamed',
    })
    expect(res.status).toBe(403)
  })

  it('不能编辑自己', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'self-edit', role: 'owner' })

    const res = await request.authed('put', `/admin/admin-users/${admin.id}`, token).send({
      username: 'self-renamed',
    })
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('当前登录账号')
  })

  it('账号不存在返回 404', async () => {
    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })
    const res = await request.authed('put', '/admin/admin-users/999999', token).send({ username: 'ghost' })
    expect(res.status).toBe(404)
  })
})

describe('修改角色（PUT /admin/admin-users/:id/role）', () => {
  it('租户管理员可以把项目管理员提升为租户管理员，并立即生效', async () => {
    const target = await auth.createAdmin({ username: 'promoted', role: 'admin' })
    // 提升前先登录：token 里不带角色，提升后同一个 token 应该马上按新角色放行
    const targetToken = await auth.login('promoted', 'Test123456')

    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })
    const res = await request.authed('put', `/admin/admin-users/${target.id}/role`, token).send({
      role: 'owner',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.role).toBe('owner')

    // 新角色立刻生效：owner 才能创建账号
    const created = await request
      .authed('post', '/admin/admin-users', targetToken.token)
      .send({ username: 'built-by-promoted', password: 'Pass123456', role: 'admin' })
    expect(created.status).toBe(200)

    const logs = await logsOf('admin_user.role')
    expect(logs).toHaveLength(1)
    expect(logs[0].detail.before.role).toBe('admin')
    expect(logs[0].detail.after.role).toBe('owner')
  })

  it('可以把租户管理员降级为项目管理员（还有其他租户管理员时）', async () => {
    const another = await auth.createAdmin({ username: 'another-owner', role: 'owner' })
    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })

    const res = await request.authed('put', `/admin/admin-users/${another.id}/role`, token).send({
      role: 'admin',
    })
    expect(res.status).toBe(200)

    const row = await db.queryOne('SELECT role FROM admin_user WHERE id = ?', [another.id])
    expect(row.role).toBe('admin')
  })

  it('不能降级最后一个租户管理员', async () => {
    const lonely = await auth.createAdmin({ username: 'lonely-owner', role: 'owner' })

    // 接口层「改自己」会先被拦下，这里直接打 service，验证最后一名保护本身。
    // 运营侧的批量脚本 / 后续新增的入口都会经过同一个 service 方法
    await expect(
      adminUserService.updateRole({ id: 999999, role: 'owner', tenantId: 1 }, lonely.id, 'admin')
    ).rejects.toThrow('不能降级最后一个租户管理员')
  })

  it('项目管理员不能改任何人的角色（AC-AD50）', async () => {
    const owner = await auth.createAdmin({ username: 'owner-z', role: 'owner' })
    const { token } = await auth.createAndLogin({ username: 'pm-z', role: 'admin' })

    const res = await request.authed('put', `/admin/admin-users/${owner.id}/role`, token).send({
      role: 'admin',
    })
    expect(res.status).toBe(403)

    const row = await db.queryOne('SELECT role FROM admin_user WHERE id = ?', [owner.id])
    expect(row.role).toBe('owner')
  })

  it('不能修改自己的角色', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'self-role', role: 'owner' })
    const res = await request.authed('put', `/admin/admin-users/${admin.id}/role`, token).send({
      role: 'admin',
    })
    expect(res.status).toBe(403)
  })

  it('角色未变化返回 409', async () => {
    const target = await auth.createAdmin({ username: 'already-admin', role: 'admin' })
    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })

    const res = await request.authed('put', `/admin/admin-users/${target.id}/role`, token).send({
      role: 'admin',
    })
    expect(res.status).toBe(409)
  })
})

describe('删除账号（DELETE /admin/admin-users/:id）', () => {
  it('软删除账号：列表消失、token 立即失效、日志落库', async () => {
    const victim = await auth.createAdmin({ username: 'victim' })
    const victimLogin = await auth.login('victim', 'Test123456')
    expect(victimLogin.status).toBe(200)

    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })
    const res = await request.authed('delete', `/admin/admin-users/${victim.id}`, token)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(victim.id)

    // 软删：行还在，deleted_at 有值
    const row = await db.queryOne('SELECT deleted_at, status FROM admin_user WHERE id = ?', [victim.id])
    expect(row).not.toBeNull()
    expect(row.deleted_at).not.toBeNull()
    expect(row.status).toBe('disabled')

    // 列表里不再出现
    const listed = await request.authed('get', '/admin/admin-users?page=1&pageSize=50', token)
    expect(listed.body.data.list.map((u) => u.username)).not.toContain('victim')

    // 已签发的 token 下一次请求即被拒（token_version 自增）
    const afterDelete = await request.authed('get', '/admin/admin-users', victimLogin.token)
    expect(afterDelete.status).toBe(401)

    const logs = await logsOf('admin_user.delete')
    expect(logs).toHaveLength(1)
    expect(Number(logs[0].target_id)).toBe(victim.id)
    expect(logs[0].detail.before.username).toBe('victim')
    expect(logs[0].detail.after.deleted).toBe(true)
  })

  it('删除后用户名可以重新使用（迁移 037 的生成列）', async () => {
    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })

    const first = await request
      .authed('post', '/admin/admin-users', token)
      .send({ username: 'recycled', password: 'Pass123456', role: 'admin' })
    expect(first.status).toBe(200)

    const removed = await request.authed('delete', `/admin/admin-users/${first.body.data.id}`, token)
    expect(removed.status).toBe(200)

    const again = await request
      .authed('post', '/admin/admin-users', token)
      .send({ username: 'recycled', password: 'Pass123456', role: 'admin' })
    expect(again.status).toBe(200)
    expect(again.body.data.username).toBe('recycled')
    expect(again.body.data.id).not.toBe(first.body.data.id)
  })

  it('删除账号会撤销小程序免密绑定', async () => {
    const target = await auth.createAdmin({ username: 'bound-admin' })
    await db.query(
      `INSERT INTO admin_wechat_binding (tenant_id, admin_user_id, user_id, openid, admin_token_version)
       VALUES (?, ?, ?, ?, ?)`,
      [1, target.id, 1, 'openid-of-bound', 1]
    )

    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })
    const res = await request.authed('delete', `/admin/admin-users/${target.id}`, token)
    expect(res.status).toBe(200)

    const binding = await db.queryOne('SELECT status, revoked_reason FROM admin_wechat_binding WHERE admin_user_id = ?', [
      target.id,
    ])
    expect(binding.status).toBe('revoked')
    expect(binding.revoked_reason).toBe('admin_deleted')
  })

  it('项目管理员不能删除租户管理员（AC-AD50）', async () => {
    const owner = await auth.createAdmin({ username: 'owner-del', role: 'owner' })
    const { token } = await auth.createAndLogin({ username: 'pm-del', role: 'admin' })

    const res = await request.authed('delete', `/admin/admin-users/${owner.id}`, token)
    expect(res.status).toBe(403)

    const row = await db.queryOne('SELECT deleted_at FROM admin_user WHERE id = ?', [owner.id])
    expect(row.deleted_at).toBeNull()
  })

  it('不能删除自己', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'self-del', role: 'owner' })
    const res = await request.authed('delete', `/admin/admin-users/${admin.id}`, token)
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('当前登录账号')
  })

  it('不能删除最后一个租户管理员', async () => {
    const lonely = await auth.createAdmin({ username: 'lonely-del', role: 'owner' })

    await expect(
      adminUserService.removeAccount({ id: 999999, role: 'owner', tenantId: 1 }, lonely.id)
    ).rejects.toThrow('不能删除最后一个租户管理员')

    const row = await db.queryOne('SELECT deleted_at FROM admin_user WHERE id = ?', [lonely.id])
    expect(row.deleted_at).toBeNull()
  })

  it('不能删除其他租户的账号', async () => {
    await db.query(
      `INSERT INTO tenant (id, name, code, status, plan, max_projects, max_admin_users)
       VALUES (2, '另一家租户', 'other', 'active', 'basic', 0, 0)`
    )
    const foreign = await auth.createAdmin({ username: 'foreign-admin', tenantId: 2 })
    const { token } = await auth.createAndLogin({ username: 'boss', role: 'owner' })

    const res = await request.authed('delete', `/admin/admin-users/${foreign.id}`, token)
    expect(res.status).toBe(403)

    const row = await db.queryOne('SELECT deleted_at FROM admin_user WHERE id = ?', [foreign.id])
    expect(row.deleted_at).toBeNull()
  })
})
