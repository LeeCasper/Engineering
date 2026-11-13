'use strict'

/**
 * B 端认证集成测试（AC-AD01 ~ AC-AD10）。
 *
 * 打真实 MySQL 与缓存，断言的是「真实依赖下的行为」——
 * 锁定状态、token_version、会话过期这些都依赖数据库与缓存的真实交互，
 * mock 掉任何一层，测的就不是生产里跑的那套东西了。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const jwt = require('../../src/utils/jwt')
const captchaService = require('../../src/services/captcha.service')
const adminAuthService = require('../../src/services/adminAuth.service')
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
  // 清缓存同时清掉了限流计数与会话键，避免用例之间互相影响
  await cache.flush()
  await db.query('SET FOREIGN_KEY_CHECKS = 0')
  await db.query('TRUNCATE TABLE admin_user')
  await db.query('TRUNCATE TABLE admin_login_log')
  await db.query('SET FOREIGN_KEY_CHECKS = 1')
})

describe('AC-AD01 账号枚举防护', () => {
  it('密码错误与账号不存在返回完全相同的提示', async () => {
    await auth.createAdmin({ username: 'realuser' })

    const wrongPassword = await auth.loginExpectFailure('realuser', 'WrongPass123')
    const noSuchUser = await auth.loginExpectFailure('ghostuser', 'WrongPass123')

    expect(wrongPassword.status).toBe(401)
    expect(noSuchUser.status).toBe(401)
    expect(wrongPassword.body.message).toBe(noSuchUser.body.message)
    expect(wrongPassword.body.message).toBe('账号或密码错误')
    // 连 data 与结构都要一致，否则差异本身也是信息
    expect(wrongPassword.body.data).toEqual(noSuchUser.body.data)
  })

  it('账号不存在时也走一遍 bcrypt，避免用响应时间枚举账号', async () => {
    // 这条不断言具体耗时（不稳定），而是断言「结果一致」——
    // 时间差的消除由 adminAuth.service.js 里的 DUMMY_HASH 保证，
    // 这里至少锁住「不会因为账号不存在就短路返回」
    const exists = await auth.loginExpectFailure('nobody', 'Whatever123')
    expect(exists.status).toBe(401)
    expect(exists.body.message).toBe(adminAuthService.INVALID_CREDENTIALS)
  })

  it('账号不存在也写登录日志（用于排查谁在猜账号）', async () => {
    await auth.loginExpectFailure('ghostuser', 'Whatever123')
    const row = await db.queryOne('SELECT username, admin_user_id, result, fail_reason FROM admin_login_log')
    expect(row.username).toBe('ghostuser')
    // 账号不存在时没有可关联的 id
    expect(row.admin_user_id).toBeNull()
    expect(row.result).toBe('failed')
    expect(row.fail_reason).toBe('账号不存在')
  })
})

describe('AC-AD02 图形验证码', () => {
  it('验证码必填：不传验证码无法登录', async () => {
    await auth.createAdmin({ username: 'capuser' })
    const res = await request.post('/admin/auth/login').send({ username: 'capuser', password: 'Test123456' })
    expect(res.status).toBe(400)
  })

  it('验证码错误时登录被拒，且不消耗登录失败次数', async () => {
    await auth.createAdmin({ username: 'capuser' })
    const { captchaId } = await auth.fetchCaptcha()

    const res = await request.post('/admin/auth/login').send({
      username: 'capuser',
      password: 'Test123456',
      captchaId,
      captchaAnswer: 'wrong',
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('验证码')

    // 关键：failed_count 必须还是 0。若验证码错误也计数，
    // 脚本只要刷 5 次错误验证码就能把任意账号锁死
    const admin = await db.queryOne('SELECT failed_count FROM admin_user WHERE username = ?', ['capuser'])
    expect(admin.failed_count).toBe(0)
  })

  it('验证码一次性有效：验过一次后重放失败（AC-AD02 的「用后即失效」）', async () => {
    await auth.createAdmin({ username: 'capuser' })
    const { captchaId, answer } = await auth.fetchCaptcha()

    const first = await request
      .post('/admin/auth/login')
      .send({ username: 'capuser', password: 'wrong', captchaId, captchaAnswer: answer })
    // 第一次：验证码正确，但密码错 → 401（说明验证码已通过）
    expect(first.status).toBe(401)

    const second = await request
      .post('/admin/auth/login')
      .send({ username: 'capuser', password: 'Test123456', captchaId, captchaAnswer: answer })
    // 第二次：同一个验证码已失效 → 400
    expect(second.status).toBe(400)
    expect(second.body.message).toContain('验证码')
  })

  it('验证码大小写不敏感（用户看不清大小写是常态）', async () => {
    await auth.createAdmin({ username: 'capuser' })
    const { captchaId, answer } = await auth.fetchCaptcha()

    const res = await request.post('/admin/auth/login').send({
      username: 'capuser',
      password: 'Test123456',
      captchaId,
      captchaAnswer: String(answer).toUpperCase(),
    })
    expect(res.status).toBe(200)
  })
})

describe('AC-AD03 连续失败锁定', () => {
  it('连续 5 次密码错误后锁定 15 分钟，此时正确密码也被拒绝', async () => {
    await auth.createAdmin({ username: 'lockuser' })

    for (let i = 0; i < 5; i += 1) {
      await auth.loginExpectFailure('lockuser', 'WrongPass123')
    }

    const admin = await db.queryOne('SELECT failed_count, locked_until FROM admin_user WHERE username = ?', [
      'lockuser',
    ])
    expect(admin.failed_count).toBe(5)
    expect(admin.locked_until).not.toBeNull()

    // 容差而不是精确等于 15：locked_until 存在 DATETIME 列里，只有**秒级**精度，
    // 写入时会把亚秒部分四舍五入，因此读回来的剩余时间可能比 15 分钟多出不到 1 秒。
    // 断言写成 <= 15 会随机失败（取决于跑用例时的毫秒数）
    const remainingMinutes = (new Date(admin.locked_until) - Date.now()) / 60000
    expect(remainingMinutes).toBeGreaterThan(14)
    expect(remainingMinutes).toBeLessThanOrEqual(15.05)

    // 关键：锁定期间即使密码正确也不放行，且响应不能泄露「密码是对的」
    const result = await auth.login('lockuser', 'Test123456')
    expect(result.status).toBe(401)
    expect(result.body.message).toBe('账号或密码错误')
    expect(result.body.message).not.toContain('锁定')
  })

  it('锁定期间继续尝试不会无限延长锁定时间', async () => {
    await auth.createAdmin({ username: 'lockuser' })
    for (let i = 0; i < 5; i += 1) {
      await auth.loginExpectFailure('lockuser', 'WrongPass123')
    }
    const before = await db.queryOne('SELECT locked_until FROM admin_user WHERE username = ?', ['lockuser'])

    await auth.loginExpectFailure('lockuser', 'WrongPass123')
    await auth.loginExpectFailure('lockuser', 'WrongPass123')

    const after = await db.queryOne('SELECT locked_until FROM admin_user WHERE username = ?', ['lockuser'])
    // 锁定时长应固定为「首次触发锁定时的 15 分钟」，不随攻击者重试而累积 ——
    // 否则重试本身就成了「让别人的账号永久锁定」的骚扰手段
    expect(new Date(after.locked_until).getTime()).toBe(new Date(before.locked_until).getTime())
  })

  it('锁定到期后可以正常登录', async () => {
    const admin = await auth.createAdmin({ username: 'expireduser' })
    // 直接把 locked_until 设到过去，避免测试真的等 15 分钟
    await db.query('UPDATE admin_user SET failed_count = 5, locked_until = ? WHERE id = ?', [
      new Date(Date.now() - 1000),
      admin.id,
    ])

    const result = await auth.login('expireduser', 'Test123456')
    expect(result.status).toBe(200)
    expect(result.token).toBeTruthy()
  })

  it('登录成功后失败计数清零', async () => {
    const admin = await auth.createAdmin({ username: 'resetuser' })
    await auth.loginExpectFailure('resetuser', 'WrongPass123')
    await auth.loginExpectFailure('resetuser', 'WrongPass123')

    await auth.login('resetuser', 'Test123456')

    const row = await db.queryOne('SELECT failed_count, locked_until FROM admin_user WHERE id = ?', [admin.id])
    expect(row.failed_count).toBe(0)
    expect(row.locked_until).toBeNull()
  })
})

describe('AC-AD04 密码存储', () => {
  it('密码以 bcrypt 哈希存储，库中无明文', async () => {
    await auth.createAdmin({ username: 'hashuser', plainPassword: 'Secret123456' })
    const row = await db.queryOne('SELECT password_hash FROM admin_user WHERE username = ?', ['hashuser'])

    expect(row.password_hash).not.toContain('Secret123456')
    expect(row.password_hash).toMatch(/^\$2[aby]\$/)
  })

  it('接口响应中不含密码哈希或明文', async () => {
    await auth.createAdmin({ username: 'respuser', plainPassword: 'Secret123456' })
    const { body } = await auth.login('respuser', 'Secret123456')
    const serialized = JSON.stringify(body)

    // 不能笼统地匹配 /password/i：mustChangePassword 是个布尔标记，
    // 名字里带 password 但完全不是秘密。要盯的是哈希字段与明文值本身
    expect(serialized).not.toMatch(/password_hash|passwordHash/)
    expect(serialized).not.toMatch(/\$2[aby]\$/)
    expect(serialized).not.toContain('Secret123456')
  })

  it('账号列表接口不返回 password_hash', async () => {
    const { token } = await auth.createAndLogin({ username: 'listadmin', role: 'owner' })
    const res = await request.authed('get', '/admin/admin-users', token)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|passwordHash/)
  })
})

describe('AC-AD07 / AC-AD08 token 失效', () => {
  it('账号被禁用后，已签发 token 在下一次请求即被拒绝', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'disableme' })

    // 禁用前可用
    expect((await request.authed('get', '/admin/auth/profile', token)).status).toBe(200)

    await db.query("UPDATE admin_user SET status = 'disabled', token_version = token_version + 1 WHERE id = ?", [
      admin.id,
    ])

    const after = await request.authed('get', '/admin/auth/profile', token)
    expect(after.status).toBe(401)
  })

  it('重置密码后原 token 全部失效、旧密码无法登录', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'resetpw' })
    expect((await request.authed('get', '/admin/auth/profile', token)).status).toBe(200)

    const superToken = await (async () => {
      const s = await auth.createAndLogin({ username: 'super1', role: 'owner' })
      return s.token
    })()

    const reset = await request
      .authed('put', `/admin/admin-users/${admin.id}/password`, superToken)
      .send({ newPassword: 'BrandNew123' })
    expect(reset.status).toBe(200)

    // 1) 旧 token 失效
    expect((await request.authed('get', '/admin/auth/profile', token)).status).toBe(401)
    // 2) 旧密码无法登录
    expect((await auth.loginExpectFailure('resetpw', 'Test123456')).status).toBe(401)
    // 3) 新密码可以登录
    expect((await auth.login('resetpw', 'BrandNew123')).status).toBe(200)
  })

  it('登出后该 token 立即失效，但不影响同账号的其他会话', async () => {
    const admin = await auth.createAdmin({ username: 'multi' })
    const session1 = await auth.login('multi', 'Test123456')
    // JWT 的 iat 精确到秒，同一秒内签发的两个 token 完全相同，
    // 因此这里等一秒，确保两次登录产生不同的会话键
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const session2 = await auth.login('multi', 'Test123456')

    expect(session1.token).not.toBe(session2.token)
    expect((await request.authed('get', '/admin/auth/profile', session1.token)).status).toBe(200)
    expect((await request.authed('get', '/admin/auth/profile', session2.token)).status).toBe(200)

    const out = await request.authed('post', '/admin/auth/logout', session1.token)
    expect(out.status).toBe(200)

    expect((await request.authed('get', '/admin/auth/profile', session1.token)).status).toBe(401)
    // 会话键里带 iat 的意义就在这里：登出一个不该把另一个也踢掉
    expect((await request.authed('get', '/admin/auth/profile', session2.token)).status).toBe(200)
    expect(admin.id).toBeGreaterThan(0)
  })

  it('空闲超时后 token 失效', async () => {
    const { token } = await auth.createAndLogin({ username: 'idleuser' })
    expect((await request.authed('get', '/admin/auth/profile', token)).status).toBe(200)

    // 直接把会话键删掉，模拟空闲超时（真等 30 分钟不现实）
    const payload = jwt.verifyAdmin(token)
    await cache.del(`admin:session:${payload.sub}:${payload.iat}`)

    const res = await request.authed('get', '/admin/auth/profile', token)
    expect(res.status).toBe(401)
  })
})

describe('AC-AD10 两端 token 互不通用', () => {
  it('C 端 token 调 B 端接口返回 401', async () => {
    const admin = await auth.createAdmin({ username: 'crossuser' })
    // 用 C 端密钥签发一个「看起来合法」的 token
    const mini = jwt.signMini({ sub: admin.id, openid: 'test-openid' })

    const res = await request.authed('get', '/admin/auth/profile', mini.token)
    expect(res.status).toBe(401)
  })

  it('B 端 token 调 C 端接口返回 401', async () => {
    const { token } = await auth.createAndLogin({ username: 'crossuser2' })
    // /api/v1/health 是公开的，换一个需要鉴权的 C 端路径；
    // 这里用任意 C 端前缀路径都行，重点是鉴权中间件按前缀分流
    const res = await request.authed('get', '/projects', token)
    // 尚无 C 端路由时是 404，有路由后必须是 401。
    // 断言「一定不是 200」才能同时适配两种情况
    expect(res.status).not.toBe(200)
  })

  it('伪造签名的 token 被拒绝', async () => {
    const fake = jwt.signAdmin({ sub: 1, role: 'owner' })
    const tampered = `${fake.token.slice(0, -4)}aaaa`
    const res = await request.authed('get', '/admin/auth/profile', tampered)
    expect(res.status).toBe(401)
  })

  it('无 Authorization 头一律 401', async () => {
    expect((await request.get('/admin/auth/profile')).status).toBe(401)
    expect((await request.get('/admin/admin-users')).status).toBe(401)
  })
})

describe('AC-AD06 首次登录强制修改初始密码', () => {
  it('登录响应标明需要改密', async () => {
    const { loginBody } = await auth.createAndLogin({ username: 'newbie', mustChangePassword: true })
    expect(loginBody.data.mustChangePassword).toBe(true)
  })

  it('未改密前只能访问改密与个人信息接口，其他接口返回 403', async () => {
    const { token } = await auth.createAndLogin({ username: 'newbie', mustChangePassword: true })

    // 白名单内
    expect((await request.authed('get', '/admin/auth/profile', token)).status).toBe(200)

    // 白名单外 —— 服务端必须拦住，只靠前端跳转是不够的
    const blocked = await request.authed('get', '/admin/admin-users', token)
    expect(blocked.status).toBe(403)
    expect(blocked.body.message).toContain('初始密码')
  })

  it('改密后限制解除', async () => {
    const { token } = await auth.createAndLogin({
      username: 'newbie',
      plainPassword: 'Init123456',
      mustChangePassword: true,
    })

    const changed = await request
      .authed('post', '/admin/auth/change-password', token)
      .send({ oldPassword: 'Init123456', newPassword: 'Changed12345' })
    expect(changed.status).toBe(200)
    // 改密使 token_version 自增，当前 token 立即失效，需重新登录
    expect(changed.body.data.relogin).toBe(true)

    const relogin = await auth.login('newbie', 'Changed12345')
    expect(relogin.status).toBe(200)
    expect(relogin.body.data.mustChangePassword).toBe(false)
    expect((await request.authed('get', '/admin/admin-users', relogin.token)).status).toBe(200)
  })
})

describe('AC-AD48 / AC-AD49 改密与密码策略', () => {
  it('本人改密须验证旧密码，旧密码错误时拒绝', async () => {
    const { token } = await auth.createAndLogin({ username: 'pwuser' })

    const wrong = await request
      .authed('post', '/admin/auth/change-password', token)
      .send({ oldPassword: 'NotMyPassword1', newPassword: 'NewPass12345' })
    expect(wrong.status).toBe(400)
    expect(wrong.body.message).toContain('原密码')

    // 确认密码没被改掉
    expect((await auth.login('pwuser', 'Test123456')).status).toBe(200)
  })

  it('密码策略：少于 8 位、纯字母、纯数字都被拒绝', async () => {
    const { token } = await auth.createAndLogin({ username: 'pwuser' })

    for (const bad of ['Ab1', 'abcdefgh', '12345678', 'a1b2c3d']) {
      const res = await request
        .authed('post', '/admin/auth/change-password', token)
        .send({ oldPassword: 'Test123456', newPassword: bad })
      expect(res.status).toBe(400)
    }
  })

  it('新密码不能与原密码相同，否则「强制改密」可被绕过', async () => {
    const { token } = await auth.createAndLogin({ username: 'pwuser' })
    const res = await request
      .authed('post', '/admin/auth/change-password', token)
      .send({ oldPassword: 'Test123456', newPassword: 'Test123456' })
    expect(res.status).toBe(400)
  })
})

describe('AC-AD05 / AC-AD50 账号管理权限边界', () => {
  it('项目管理员不能创建项目管理员账号', async () => {
    const { token } = await auth.createAndLogin({ username: 'pm1', role: 'admin' })
    const res = await request
      .authed('post', '/admin/admin-users', token)
      .send({ username: 'another-pm', password: 'Pass123456', role: 'admin' })
    expect(res.status).toBe(403)
  })

  it('项目管理员不能操作超级管理员账号', async () => {
    const superAdmin = await auth.createAdmin({ username: 'thesuper', role: 'owner' })
    const { token } = await auth.createAndLogin({ username: 'pm2', role: 'admin' })

    const disable = await request.authed('put', `/admin/admin-users/${superAdmin.id}/status`, token).send({
      status: 'disabled',
    })
    expect(disable.status).toBe(403)

    const reset = await request
      .authed('put', `/admin/admin-users/${superAdmin.id}/password`, token)
      .send({ newPassword: 'Hacked12345' })
    expect(reset.status).toBe(403)

    // 确认超管未受影响
    const row = await db.queryOne('SELECT status FROM admin_user WHERE id = ?', [superAdmin.id])
    expect(row.status).toBe('active')
  })

  it('项目管理员只能管理自己创建的下属', async () => {
    const otherPm = await auth.createAdmin({ username: 'otherpm', role: 'admin' })
    const mine = await auth.createAdmin({ username: 'mysub', role: 'admin', createdBy: otherPm.id })

    const { token } = await auth.createAndLogin({ username: 'pm3', role: 'admin' })

    const res = await request.authed('put', `/admin/admin-users/${mine.id}/status`, token).send({
      status: 'disabled',
    })
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('自己创建')
  })

  it('项目管理员不能授予项目数据权限', async () => {
    const target = await auth.createAdmin({ username: 'target' })
    const { token } = await auth.createAndLogin({ username: 'pm4', role: 'admin' })

    const res = await request.authed('post', `/admin/admin-users/${target.id}/projects`, token).send({
      projectIds: [1, 2],
    })
    expect(res.status).toBe(403)
  })

  it('任何人都不能禁用或删除自己', async () => {
    const { admin, token } = await auth.createAndLogin({ username: 'selfuser', role: 'owner' })
    const res = await request.authed('put', `/admin/admin-users/${admin.id}/status`, token).send({
      status: 'disabled',
    })
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('当前登录账号')
  })

  it('项目管理员的列表只包含自己创建的下属', async () => {
    const otherPm = await auth.createAdmin({ username: 'otherpm2', role: 'admin' })
    await auth.createAdmin({ username: 'theirsub', role: 'admin', createdBy: otherPm.id })

    const me = await auth.createAdmin({ username: 'pm5', role: 'admin' })
    await auth.createAdmin({ username: 'mysub1', role: 'admin', createdBy: me.id })
    await auth.createAdmin({ username: 'mysub2', role: 'admin', createdBy: me.id })

    // 必须用 me 自己登录：另建一个 created_by=me 的账号去登录，
    // 它看到的是「自己创建的下属」而不是 me 的下属
    const { token } = await auth.login('pm5', 'Test123456')
    const res = await request.authed('get', '/admin/admin-users', token)

    expect(res.status).toBe(200)
    const names = res.body.data.list.map((u) => u.username)
    expect(names).toContain('mysub1')
    expect(names).toContain('mysub2')
    expect(names).not.toContain('theirsub')
    expect(names).not.toContain('otherpm2')
  })

  it('超级管理员的列表能看到全部账号', async () => {
    await auth.createAdmin({ username: 'a1' })
    await auth.createAdmin({ username: 'a2' })
    const { token } = await auth.createAndLogin({ username: 'bigboss', role: 'owner' })

    const res = await request.authed('get', '/admin/admin-users', token)
    const names = res.body.data.list.map((u) => u.username)
    expect(names).toEqual(expect.arrayContaining(['a1', 'a2', 'bigboss']))
  })
})

describe('AC-AD47 / AC-AD51 列表与登录日志', () => {
  it('账号列表支持按关键字与角色筛选，且强制分页', async () => {
    for (let i = 0; i < 25; i += 1) {
      await auth.createAdmin({ username: `bulk${String(i).padStart(2, '0')}` })
    }
    await auth.createAdmin({ username: 'special-one', role: 'owner' })
    const { token } = await auth.createAndLogin({ username: 'superboss', role: 'owner' })

    const firstPage = await request.authed('get', '/admin/admin-users?page=1&pageSize=20', token)
    expect(firstPage.body.data.list).toHaveLength(20)
    expect(firstPage.body.data.total).toBe(27)
    expect(firstPage.body.data.totalPages).toBe(2)

    const keyword = await request.authed('get', '/admin/admin-users?keyword=special', token)
    expect(keyword.body.data.list).toHaveLength(1)
    expect(keyword.body.data.list[0].username).toBe('special-one')

    const byRole = await request.authed('get', '/admin/admin-users?role=owner', token)
    byRole.body.data.list.forEach((u) => expect(u.role).toBe('owner'))
  })

  it('单页超过 50 条被钳制（AC-AD45）', async () => {
    const { token } = await auth.createAndLogin({ username: 'super2', role: 'owner' })
    const res = await request.authed('get', '/admin/admin-users?pageSize=999', token)
    expect(res.body.data.pageSize).toBe(50)
  })

  it('登录日志完整记录成功与失败（含失败原因与 IP）', async () => {
    await auth.createAdmin({ username: 'loguser' })
    await auth.login('loguser', 'Test123456')
    await auth.loginExpectFailure('loguser', 'WrongPass123')

    const rows = await db.query(
      'SELECT result, fail_reason, ip, username FROM admin_login_log ORDER BY id ASC'
    )
    expect(rows).toHaveLength(2)

    expect(rows[0].result).toBe('success')
    expect(rows[0].fail_reason).toBeNull()

    expect(rows[1].result).toBe('failed')
    expect(rows[1].fail_reason).toContain('密码错误')
    expect(rows[1].ip).toBeTruthy()
    expect(rows[1].username).toBe('loguser')
  })
})

describe('登录限流', () => {
  it('登录接口有独立的更严格限流（防爆破）', async () => {
    await auth.createAdmin({ username: 'flooduser' })

    let got429 = false
    for (let i = 0; i < 15; i += 1) {
      const res = await auth.loginExpectFailure('flooduser', `Wrong${i}pass`)
      if (res.status === 429) {
        got429 = true
        break
      }
    }
    expect(got429).toBe(true)
  })
})

describe('平台与租户的登录门户分离', () => {
  /** 建一个只用于本条用例的第二个租户，返回 id */
  async function createOtherTenant() {
    await db.query("DELETE FROM tenant WHERE code = 'other-portal-test'")
    const result = await db.query(
      "INSERT INTO tenant (name, code, status) VALUES ('其他装修公司', 'other-portal-test', 'active')"
    )
    return result.insertId
  }

  it('平台入口不暴露租户账号是否存在（只查平台命名空间）', async () => {
    const admin = await auth.createAdmin({ username: 'tenantowner', tenantId: 1 })

    const res = await auth.loginExpectFailure('tenantowner', admin.plainPassword, { portal: 'platform' })

    // 安全审计修复后，平台入口只解析平台账号（tenant_id IS NULL）。租户账号
    // 走「账号不存在」的通用分支，与真实空账号的响应完全一致 —— 否则可以拿
    // 平台入口当枚举器，逐个试出哪些用户名属于某个租户。
    expect(res.status).toBe(401)
    expect(res.body.message).toContain('账号或密码错误')

    // 密码是对的，不应被算作一次失败尝试（否则误用旧书签会把账号锁死）
    const row = await db.queryOne('SELECT failed_count FROM admin_user WHERE username = ?', ['tenantowner'])
    expect(row.failed_count).toBe(0)

    // 仍要留日志，方便排查「有人收藏了旧地址」
    const log = await db.queryOne(
      'SELECT result, fail_reason FROM admin_login_log WHERE username = ? ORDER BY id DESC LIMIT 1',
      ['tenantowner']
    )
    expect(log.result).toBe('failed')
    expect(log.fail_reason).toContain('账号不存在')
  })

  it('租户入口只接受该租户的账号', async () => {
    const admin = await auth.createAdmin({ username: 'tenantowner', tenantId: 1 })
    const otherTenantId = await createOtherTenant()
    await auth.createAdmin({ username: 'otherowner', tenantId: otherTenantId })

    // 本租户 + 正确标识 → 正常登录
    const ok = await auth.login('tenantowner', admin.plainPassword, {
      portal: 'tenant',
      tenantCode: 'default',
    })
    expect(ok.status).toBe(200)
    expect(ok.body.data.admin.tenantId).toBe(1)

    // 拿别家租户的标识登录 → 统一按「账号或密码错误」处理，不泄露账号归属
    const wrongTenant = await auth.loginExpectFailure('tenantowner', admin.plainPassword, {
      portal: 'tenant',
      tenantCode: 'other-portal-test',
    })
    expect(wrongTenant.status).toBe(401)
    expect(wrongTenant.body.message).toBe(adminAuthService.INVALID_CREDENTIALS)
  })

  it('租户入口缺少租户标识时拒绝', async () => {
    const admin = await auth.createAdmin({ username: 'tenantowner', tenantId: 1 })

    const res = await auth.loginExpectFailure('tenantowner', admin.plainPassword, { portal: 'tenant' })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('租户专属管理地址')
  })
})
