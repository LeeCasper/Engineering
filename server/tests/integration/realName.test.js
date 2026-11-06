'use strict'

/**
 * C 端实名认证（V2.16）。
 *
 * 覆盖三件事：
 *   1. 合法 / 非法证件号的处理，证件号明文不落库；
 *   2. 被邀请后未认证不能确认邀请，认证后即可确认；
 *   3. 认证结果幂等，认证后的姓名不能从资料接口改掉。
 *
 * 注意：本地校验只验证证件号本身，不代表「姓名与证件号属于同一人」。
 * 用例断言的是接口行为，不是公安库核验结果。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
const auth = require('./helpers/auth')
const fixtures = require('./helpers/fixtures')
const mini = require('./helpers/mini')

const VALID_ID = '310101199001011234'
const VALID_ID_2 = '110101198811111358'

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

async function loginWithMember(code, { role = 'foreman', status = 'pending' } = {}) {
  const login = await mini.login(code)
  const projectId = await mini.createProject({ name: '实名认证测试项目' })
  const memberId = await mini.addMember({
    projectId,
    userId: login.userId,
    role,
    status,
  })
  return { ...login, projectId, memberId }
}

describe('实名认证状态与提交', () => {
  it('未认证用户读取状态：未被邀请时不强制', async () => {
    const login = await mini.login('code-real-name-free')
    const res = await mini.authed('get', '/auth/real-name', login.token)

    expect(res.status).toBe(200)
    expect(res.body.data.verified).toBe(false)
    expect(res.body.data.realNameStatus).toBe('none')
    expect(res.body.data.requiresRealNameAuth).toBe(false)
    expect(res.body.data.verificationLevel).toBe('basic')
  })

  it('提交合法姓名与证件号后变为已认证，且只返回脱敏证件号', async () => {
    const login = await mini.login('code-real-name-ok')

    const res = await mini
      .authed('post', '/auth/real-name/verify', login.token)
      .send({ realName: '张三', idCardNo: VALID_ID, consent: true })

    expect(res.status).toBe(200)
    expect(res.body.data.verified).toBe(true)
    expect(res.body.data.realName).toBe('张三')
    expect(res.body.data.idCardMask).toBe('310101********1234')
    expect(res.body.data.verifyMethod).toBe('local')
    expect(res.body.data.verificationLevel).toBe('basic')
    // 响应里绝不能出现完整证件号
    expect(JSON.stringify(res.body)).not.toContain(VALID_ID)

    const user = await db.queryOne(
      'SELECT real_name, real_name_status, id_card_mask, real_name_verified_at FROM user WHERE id = ?',
      [login.userId]
    )
    expect(user.real_name).toBe('张三')
    expect(user.real_name_status).toBe('verified')
    expect(user.id_card_mask).toBe('310101********1234')
    expect(user.real_name_verified_at).toBeTruthy()

    const attempts = await db.query(
      'SELECT name_masked, id_card_mask, status FROM identity_verification WHERE user_id = ?',
      [login.userId]
    )
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('passed')
    expect(attempts[0].name_masked).toBe('张*')
    expect(attempts[0].id_card_mask).toBe('310101********1234')
  })

  it('校验位错误时返回 400，状态保持未认证，并留下失败流水', async () => {
    const login = await mini.login('code-real-name-bad-id')

    const res = await mini
      .authed('post', '/auth/real-name/verify', login.token)
      .send({ realName: '李四', idCardNo: '310101199001011235', consent: true })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('校验位')

    const user = await db.queryOne('SELECT real_name_status FROM user WHERE id = ?', [login.userId])
    expect(user.real_name_status).toBe('none')

    const failed = await db.queryOne(
      'SELECT status, failure_code FROM identity_verification WHERE user_id = ?',
      [login.userId]
    )
    expect(failed.status).toBe('failed')
    expect(failed.failure_code).toBe('CHECKSUM')
  })

  it('未勾选同意时拒绝', async () => {
    const login = await mini.login('code-real-name-no-consent')
    const res = await mini
      .authed('post', '/auth/real-name/verify', login.token)
      .send({ realName: '王五', idCardNo: VALID_ID })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('同意')
  })

  it('重复提交幂等；换姓名返回 409', async () => {
    const login = await mini.login('code-real-name-repeat')
    const body = { realName: '赵六', idCardNo: VALID_ID, consent: true }

    expect((await mini.authed('post', '/auth/real-name/verify', login.token).send(body)).status).toBe(200)

    const again = await mini.authed('post', '/auth/real-name/verify', login.token).send(body)
    expect(again.status).toBe(200)
    expect(again.body.data.alreadyVerified).toBe(true)

    const renamed = await mini
      .authed('post', '/auth/real-name/verify', login.token)
      .send({ realName: '赵七', idCardNo: VALID_ID_2, consent: true })
    expect(renamed.status).toBe(409)
  })

  it('认证后不能通过资料接口修改姓名', async () => {
    const login = await mini.login('code-real-name-lock')
    await mini
      .authed('post', '/auth/real-name/verify', login.token)
      .send({ realName: '钱八', idCardNo: VALID_ID, consent: true })

    const res = await mini.authed('put', '/auth/profile', login.token).send({ realName: '钱九' })
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('不可修改')

    const cleared = await mini.authed('put', '/auth/profile', login.token).send({ realName: null })
    expect(cleared.status).toBe(409)

    const same = await mini.authed('put', '/auth/profile', login.token).send({ realName: '钱八' })
    expect(same.status).toBe(200)
  })
})

describe('被邀请后的实名门禁', () => {
  it('未认证时确认邀请返回 409；认证后可确认', async () => {
    const ctx = await loginWithMember('code-real-name-gate')

    const profile = await mini.authed('get', '/auth/profile', ctx.token)
    expect(profile.body.data.requiresRealNameAuth).toBe(true)
    // 兼容旧客户端的字段名
    expect(profile.body.data.requiresRealName).toBe(true)

    const blocked = await mini.authed('post', `/invitations/${ctx.memberId}/confirm`, ctx.token)
    expect(blocked.status).toBe(409)
    expect(blocked.body.message).toContain('实名认证')
    expect(blocked.body.data.requiresRealNameAuth).toBe(true)

    await mini
      .authed('post', '/auth/real-name/verify', ctx.token)
      .send({ realName: '孙十', idCardNo: VALID_ID, consent: true })

    const confirmed = await mini.authed('post', `/invitations/${ctx.memberId}/confirm`, ctx.token)
    expect(confirmed.status).toBe(200)

    const after = await mini.authed('get', '/auth/profile', ctx.token)
    expect(after.body.data.requiresRealNameAuth).toBe(false)
    expect(after.body.data.realNameVerified).toBe(true)
  })

  it('只填了真实姓名、未认证，仍然不能确认邀请（旧数据升级）', async () => {
    const ctx = await loginWithMember('code-real-name-legacy')
    await db.query('UPDATE user SET real_name = ? WHERE id = ?', ['旧数据用户', ctx.userId])

    const res = await mini.authed('post', `/invitations/${ctx.memberId}/confirm`, ctx.token)
    expect(res.status).toBe(409)
    expect(res.body.data.requiresRealNameAuth).toBe(true)
  })

  it('后台成员列表返回实名状态（不返回证件号）', async () => {
    const ctx = await loginWithMember('code-real-name-admin-view', { status: 'active' })
    await mini
      .authed('post', '/auth/real-name/verify', ctx.token)
      .send({ realName: '周十一', idCardNo: VALID_ID, consent: true })

    const admin = await auth.createAndLogin({ username: 'admin-real-name', role: 'owner' })
    const res = await request.authed(
      'get',
      `/admin/projects/${ctx.projectId}/members`,
      admin.token
    )
    expect(res.status).toBe(200)

    const member = res.body.data.members.find((item) => item.userId === ctx.userId)
    expect(member.realNameVerified).toBe(true)
    expect(member.realNameStatus).toBe('verified')
    // 后台只看状态，不把证件脱敏号下发给成员列表
    expect(JSON.stringify(member)).not.toContain('310101')
  })
})
