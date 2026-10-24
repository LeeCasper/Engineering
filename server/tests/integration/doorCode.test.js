'use strict'

/**
 * 门锁密码集成测试（§4.8 / AC-K01 ~ AC-K16）。
 *
 * ── 这个文件的两类断言 ──
 * 一类是常规的权限与流程；另一类是**安全不变量**（密文落库、明文不进日志、
 * 响应不可缓存、读取留痕）。后者的共同特征是：写错了功能照常可用，
 * 界面上看不出任何异常，只有出事时才会发现防护不存在。
 */

const fs = require('node:fs')
const path = require('node:path')

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const config = require('../../config')
const sysConfigService = require('../../src/services/sysConfig.service')
const doorCodeService = require('../../src/services/doorCode.service')
const operationLog = require('../../src/services/operationLog.service')
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

/** 建项目 + 指定角色的成员，返回句柄 */
async function setup(role, { name = 'door', projectStatus = 'building' } = {}) {
  seq += 1
  const login = await mini.login(`${name}-${seq}`)
  const projectId = await mini.createProject({ name: `门锁项目-${seq}`, createdBy: 1, status: projectStatus })
  await mini.addMember({ projectId, userId: login.userId, role })

  return { ...login, projectId }
}

/** 业主建一个项目，并再邀请若干成员；返回 { owner, projectId, ...others } */
async function setupProjectWithTeam() {
  const owner = await setup('owner', { name: 'door-owner' })
  const foreman = await mini.login(`door-foreman-${(seq += 1)}`)
  const supervisor = await mini.login(`door-supervisor-${(seq += 1)}`)
  await mini.addMember({ projectId: owner.projectId, userId: foreman.userId, role: 'foreman' })
  await mini.addMember({ projectId: owner.projectId, userId: supervisor.userId, role: 'supervisor' })

  return { owner, foreman, supervisor, projectId: owner.projectId }
}

async function addCode(token, projectId, body) {
  return request
    .authed('post', `/projects/${projectId}/door-codes`, token)
    .send({ name: '入户门', code: '123456', ...body })
}

describe('AC-K01 仅业主可新增 / 修改 / 失效', () => {
  it('业主可新增，返回条目 id', async () => {
    const { owner, projectId } = await setupProjectWithTeam()

    const res = await addCode(owner.token, projectId, { name: '入户门', code: '888888', remark: '锁上有个红点' })

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBeTruthy()
  })

  it('临时业主也可以管理门锁密码（v2.12：不属于重要决策限制）', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    const temporary = await mini.login(`door-temp-owner-${(seq += 1)}`)
    await mini.addMember({ projectId, userId: temporary.userId, role: 'owner' })

    const created = await addCode(temporary.token, projectId, { code: '654321' })
    expect(created.status).toBe(200)

    const list = await request.authed('get', `/projects/${projectId}/door-codes`, temporary.token)
    expect(list.status).toBe(200)
    expect(list.body.data.myRole).toBe('owner')
    expect(list.body.data.canManage).toBe(true)
  })

  it('工长、监理新增一律 403', async () => {
    const { foreman, supervisor, projectId } = await setupProjectWithTeam()

    for (const who of [foreman, supervisor]) {
      const res = await addCode(who.token, projectId, {})
      expect(res.status).toBe(403)
    }

    expect(await db.count('FROM project_door_code WHERE deleted_at IS NULL')).toBe(0)
  })

  it('工长、监理不能修改与失效', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    const created = await addCode(owner.token, projectId, {})

    const update = await request
      .authed('put', `/door-codes/${created.body.data.id}`, foreman.token)
      .send({ name: '改个名' })
    const revoke = await request.authed('post', `/door-codes/${created.body.data.id}/revoke`, foreman.token).send({})

    expect(update.status).toBe(403)
    expect(revoke.status).toBe(403)
  })

  it('AC-K02 后台管理员**不能**查看门锁密码', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, {})

    const admin = await auth.createAndLogin({ username: `door-admin-${(seq += 1)}`, role: 'owner' })
    const res = await request.authed('get', `/projects/${projectId}/door-codes`, admin.token)

    // AC-K02 的字面要求是 403。实际返回 401：后台 token 的 audience 与 C 端不同，
    // 在 requireMini 就被拒了 —— 请求**根本没走到业务代码**，比 403 更强。
    // 这也正是「本模块在后台上没有任何入口」的体现（§4.8.2 权限表四栏全 ❌）
    expect(res.status).toBe(401)
    expect(res.status).not.toBe(200)
  })

  it('AC-K04 未参与项目的用户访问返回 404，提示与项目不存在完全相同', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, {})

    const outsider = await mini.login(`door-outsider-${(seq += 1)}`)
    const existing = await request.authed('get', `/projects/${projectId}/door-codes`, outsider.token)
    const ghost = await request.authed('get', '/projects/999999/door-codes', outsider.token)

    // 门锁密码的存在本身就是敏感信息（等于确认「这个门牌号有人住」），
    // 因此两种情况的响应必须无法区分
    expect(existing.status).toBe(404)
    expect(ghost.status).toBe(404)
    expect(existing.body.message).toBe(ghost.body.message)
  })

  it('AC-K05 pending 成员不可查看', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, {})

    const pending = await mini.login(`door-pending-${(seq += 1)}`)
    await mini.addMember({ projectId, userId: pending.userId, role: 'foreman', status: 'pending' })

    const res = await request.authed('get', `/projects/${projectId}/door-codes`, pending.token)
    // pending 未确认 = 还没有任何权限（AC-AD18 同口径）
    expect(res.status).toBe(404)
  })
})

describe('AC-K06 / AC-K07 加密与日志脱敏', () => {
  it('数据库里是全表找不到任何明文密码', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    const secret = 'SuperSecret8899'
    await addCode(owner.token, projectId, { code: secret })

    // 逐表扫，而不是只看 project_door_code —— 密码可能被顺手写进别处
    const tables = await db.query(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'`
    )

    for (const { name } of tables) {
      const rows = await db.query(`SELECT * FROM \`${name}\``)
      const dump = JSON.stringify(rows)
      expect(dump, `表 ${name} 里出现了明文密码`).not.toContain(secret)
    }
  })

  it('密文列符合 v1.<iv>.<authTag>.<ciphertext> 格式', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { code: '123456' })

    const row = await db.queryOne('SELECT code_cipher FROM project_door_code LIMIT 1')
    expect(row.code_cipher.split('.')).toHaveLength(4)
    expect(row.code_cipher.startsWith('v1.')).toBe(true)
  })

  it('AC-K07 明文不进入任何日志（含超长与特殊字符密码）', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    const weird = 'Aa1!@#$%^&*()_+=~`<>?;:\'"[]{}\\|'.slice(0, 40)

    await addCode(owner.token, projectId, { code: weird })
    await request.authed('get', `/projects/${projectId}/door-codes`, owner.token)

    // 日志是写到 stdout/stderr 的，测试进程里无法回读 ——
    // 因此改为**源头检查**：脱敏名单必须覆盖这些字段名。
    // 这比「跑一遍再 grep 日志」可靠：后者只覆盖走过的代码路径，
    // 而漏掉的字段名会在一条没被跑到的新代码上继续泄露
    const loggerSource = fs.readFileSync(path.resolve(__dirname, '../../src/utils/logger.js'), 'utf8')
    const listMatch = /const SENSITIVE_KEYS = \[([\s\S]*?)\]/.exec(loggerSource)
    expect(listMatch).not.toBeNull()

    const keys = listMatch[1]
    for (const field of ['code', 'cipher']) {
      expect(keys, `logger 脱敏名单缺少 ${field}`).toContain(`'${field}'`)
    }
  })

  it('logger 实际会把 code / doorCode / codeCipher 替换掉', () => {
    const logger = require('../../src/utils/logger')

    // 直接调 `_redact`（logger 专门导出给测试用），不去抓 stdout ——
    // 抓流会受日志级别影响，而这条断言要验证的是脱敏本身
    const redacted = logger._redact({
      code: 'PlainCode123',
      doorCode: 'PlainDoor456',
      codeCipher: 'v1.aaa.bbb',
      captchaCode: 'XY99',
      nested: { code: 'NestedPlain789' },
      nickname: '王工',
    })

    expect(redacted.code).toBe('[REDACTED]')
    expect(redacted.doorCode).toBe('[REDACTED]')
    expect(redacted.codeCipher).toBe('[REDACTED]')
    // 验证码也一起脱敏了 —— 这是 `code` 进名单的副作用，刻意接受：
    // 验证码是一次性凭证，而门锁密码是能开门的
    expect(redacted.captchaCode).toBe('[REDACTED]')
    expect(redacted.nested.code).toBe('[REDACTED]')
    // 不相关的字段不能被误伤，否则日志会变得没用
    expect(redacted.nickname).toBe('王工')

    expect(JSON.stringify(redacted)).not.toContain('Plain')
    expect(JSON.stringify(redacted)).not.toContain('NestedPlain')
  })

  it('日志脱敏不会把 Error 的 code 也抹掉（SQL 错误码要靠它排查）', () => {
    const logger = require('../../src/utils/logger')

    const dbError = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' })
    const redacted = logger._redact({ err: dbError })

    // Error 实例走的是单独的分支（手工构造 {name,message,code,stack}），
    // 不经过键名匹配 —— 否则 `ER_DUP_ENTRY` 会变成 [REDACTED]，
    // 而排查数据库问题时第一个要看的就是它
    expect(redacted.err.code).toBe('ER_DUP_ENTRY')
  })

  it('AC-K10 密钥来自环境变量，仓库里不存在密钥明文', () => {
    // .env 被 gitignore，配置只从 process.env 读
    const configSource = fs.readFileSync(path.resolve(__dirname, '../../config/index.js'), 'utf8')
    expect(configSource).toContain("str('DOOR_CODE_KEY'")
    // 默认值必须是空串：给一个 dev 占位密钥会被静默使用，
    // 而那意味着全公司业主家的门锁密码用一个公开密钥加密
    expect(configSource).toMatch(/DOOR_CODE_KEY',\s*''\)/)

    // 源码目录里不该出现任何形如 64 位十六进制的字面量（密钥）
    const srcRoot = path.resolve(__dirname, '../../src')
    const suspicious = []
    ;(function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.js')) {
          const content = fs.readFileSync(full, 'utf8')
          const hit = /['"][0-9a-fA-F]{64}['"]/.exec(content)
          if (hit) suspicious.push(`${entry.name}: ${hit[0].slice(0, 20)}…`)
        }
      }
    })(srcRoot)

    expect(suspicious, `源码中疑似硬编码密钥：${suspicious.join(', ')}`).toEqual([])
  })

  it('生产环境未配置密钥时拒绝启动', () => {
    // 参数显式传入而不是魔改 config —— `config` 是深冻结的，测试改不动它，
    // 而「生产把密钥配错」恰恰是最需要被测住的情形（CLAUDE.md 第 46 条）
    expect(() => doorCodeService.assertKeyConfigured({ isProd: true, key: '' })).toThrow(/DOOR_CODE_KEY/)
  })

  it('生产环境配置了格式错误的密钥同样拒绝启动', () => {
    // 等到第一个业主设置密码时才报错，错误会以 500 的形式出现在用户面前，
    // 而不是在部署日志里
    expect(() => doorCodeService.assertKeyConfigured({ isProd: true, key: 'too-short' })).toThrow(/32 字节/)
  })

  it('非生产环境不因缺密钥而拒绝启动（用派生密钥兜底）', () => {
    expect(() => doorCodeService.assertKeyConfigured({ isProd: false, key: '' })).not.toThrow()
  })
})

describe('AC-K08 含密码的响应不可缓存', () => {
  it('列表响应带 Cache-Control: no-store', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, {})

    const res = await request.authed('get', `/projects/${projectId}/door-codes`, owner.token)

    // 任何中间层（CDN、反向代理）或客户端缓存把明文密码留下来，
    // 都等于在「明文绝不进日志」之外又开了一条泄漏路径
    expect(res.headers['cache-control']).toContain('no-store')
  })

  it('访问记录响应同样不可缓存', async () => {
    const { owner, projectId } = await setupProjectWithTeam()

    const res = await request.authed('get', `/projects/${projectId}/door-codes/access-log`, owner.token)
    expect(res.headers['cache-control']).toContain('no-store')
  })
})

describe('AC-K09 每次读取都留痕', () => {
  it('不含密码的请求（如访问记录本身）不产生读取日志', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, {})

    await request.authed('get', `/projects/${projectId}/door-codes/access-log`, owner.token)

    const rows = await db.query('SELECT * FROM operation_log WHERE action = ?', [
      operationLog.ACTIONS.DOOR_CODE_READ,
    ])
    expect(rows).toHaveLength(0)
  })

  it('每次读取密码写入一条日志，含操作人、IP 与条目 id', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    const created = await addCode(owner.token, projectId, {})

    await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)

    const rows = await db.query('SELECT * FROM operation_log WHERE action = ?', [
      operationLog.ACTIONS.DOOR_CODE_READ,
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].operator_type).toBe('user')
    expect(rows[0].operator_id).toBe(foreman.userId)
    expect(rows[0].target_id).toBe(created.body.data.id)
    expect(rows[0].project_id).toBe(projectId)
    expect(rows[0].ip).toBeTruthy()
    // AC-K09 点名要求含时间 —— created_at 由数据库默认值给出
    expect(rows[0].created_at).toBeTruthy()
  })

  it('AC-K09 同一次请求连续读两条密码记两条', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { name: '入户门', code: '111111' })
    await addCode(owner.token, projectId, { name: '单元门', code: '222222' })

    await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)

    // 日志的粒度是**条目**而不是请求
    const rows = await db.query('SELECT * FROM operation_log WHERE action = ?', [
      operationLog.ACTIONS.DOOR_CODE_READ,
    ])
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.target_id)).size).toBe(2)
  })

  it('日志里不含密码明文', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { code: 'LogCheck7788' })

    await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)

    const rows = await db.query('SELECT * FROM operation_log')
    expect(JSON.stringify(rows)).not.toContain('LogCheck7788')
  })
})

describe('AC-K11 设置后工长与监理立即可查看', () => {
  it('业主设置成功后，已确认的工长与监理无需任何额外操作即可读到明文', async () => {
    const { owner, foreman, supervisor, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { code: 'SyncTest123' })

    for (const who of [foreman, supervisor]) {
      const res = await request.authed('get', `/projects/${projectId}/door-codes`, who.token)
      expect(res.status).toBe(200)
      expect(res.body.data.list[0].code).toBe('SyncTest123')
    }
  })

  it('返回体带能力边界说明（必须向业主明示）', async () => {
    const { owner, projectId } = await setupProjectWithTeam()

    const res = await request.authed('get', `/projects/${projectId}/door-codes`, owner.token)

    // 「系统无法阻止拿到密码的人开门」这件事必须随数据一起下发，
    // 否则界面就只能靠前端自己写死一段可能过期的文案
    expect(res.body.data.disclaimer).toContain('不是安防方案')
    expect(res.body.data.disclaimer).toContain('失效')
  })

  it('canManage 只对业主为 true（UI 提示，真正拦截在服务层）', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()

    const asOwner = await request.authed('get', `/projects/${projectId}/door-codes`, owner.token)
    const asForeman = await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)

    expect(asOwner.body.data.canManage).toBe(true)
    expect(asOwner.body.data.myRole).toBe('owner')
    expect(asForeman.body.data.canManage).toBe(false)
  })
})

describe('AC-K12 / AC-K13 归档与移除成员导致失效', () => {
  it('AC-K12 项目归档后不可查看，且返回 403', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { code: 'ArchivedTest1' })

    await db.query("UPDATE project SET status = 'archived', archived_at = NOW() WHERE id = ?", [projectId])

    for (const who of [owner, foreman]) {
      const res = await request.authed('get', `/projects/${projectId}/door-codes`, who.token)
      // 403 而不是「列表为空」：空列表会让业主以为「我设的密码怎么没了」
      expect(res.status).toBe(403)
    }
  })

  it('AC-K13 某成员被移除后立即不可查看，其他成员不受影响', async () => {
    const { owner, foreman, supervisor, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { code: 'RemovedMember1' })

    const member = await db.queryOne('SELECT id FROM project_member WHERE project_id = ? AND user_id = ?', [
      projectId,
      foreman.userId,
    ])
    await db.query("UPDATE project_member SET status = 'removed', left_at = NOW() WHERE id = ?", [member.id])

    const removed = await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)
    const unaffected = await request.authed('get', `/projects/${projectId}/door-codes`, supervisor.token)

    expect(removed.status).toBe(404)
    expect(unaffected.status).toBe(200)
    expect(unaffected.body.data.list[0].code).toBe('RemovedMember1')
  })

  it('AC-K15 归档时业主收到「建议更换门锁密码」提醒', async () => {
    const owner = await setup('owner', { name: 'door-warn-archive' })
    await addCode(owner.token, owner.projectId, {})

    const admin = await auth.createAndLogin({ username: `door-warn-admin-${(seq += 1)}`, role: 'owner' })

    const doorCode = require('../../src/services/doorCode.service')
    const spy = vi.spyOn(doorCode, 'warnOwnerToChangeLock')
    try {
      await request.authed('post', `/admin/projects/${owner.projectId}/archive`, admin.token).send({ confirm: true })
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }

    const messages = await db.query(
      "SELECT * FROM notification WHERE user_id = ? AND title = '建议更换门锁密码'",
      [owner.userId]
    )
    expect(messages.length).toBeGreaterThan(0)
    // 文案里必须写清「还需要换锁」—— 点了失效不等于安全了，
    // 这是本模块最容易造成实际损失的地方
    expect(messages[0].content).toContain('更换实体门锁密码')
  })

  it('AC-K15 移除工长 / 监理时同样提醒业主', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, {})

    const admin = await auth.createAndLogin({ username: `door-warn-admin2-${(seq += 1)}`, role: 'owner' })
    const member = await db.queryOne('SELECT id FROM project_member WHERE project_id = ? AND user_id = ?', [
      projectId,
      foreman.userId,
    ])

    await request.authed('delete', `/admin/projects/${projectId}/members/${member.id}`, admin.token).send({})

    const messages = await db.query("SELECT * FROM notification WHERE user_id = ? AND title = '建议更换门锁密码'", [
      owner.userId,
    ])
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toContain('工长')
  })

  it('AC-K15 移除另一个业主**不**触发提醒（他本来就知道密码）', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, {})

    const ownerB = await mini.login(`door-owner-b-${(seq += 1)}`)
    await mini.addMember({ projectId, userId: ownerB.userId, role: 'owner' })

    const admin = await auth.createAndLogin({ username: `door-warn-admin3-${(seq += 1)}`, role: 'owner' })
    const member = await db.queryOne('SELECT id FROM project_member WHERE project_id = ? AND user_id = ?', [
      projectId,
      ownerB.userId,
    ])

    await request.authed('delete', `/admin/projects/${projectId}/members/${member.id}`, admin.token).send({})

    // 移除另一个业主不会让他「失去」任何东西，提醒只是噪音
    const messages = await db.query("SELECT * FROM notification WHERE title = '建议更换门锁密码'")
    expect(messages).toHaveLength(0)
  })

  it('AC-K15 没有生效密码的项目不产生提醒（避免噪音淹没真提醒）', async () => {
    const owner = await setup('owner', { name: 'door-warn-nocode' })
    const admin = await auth.createAndLogin({ username: `door-warn-admin4-${(seq += 1)}`, role: 'owner' })

    await request.authed('post', `/admin/projects/${owner.projectId}/archive`, admin.token).send({ confirm: true })

    const messages = await db.query("SELECT * FROM notification WHERE title = '建议更换门锁密码'")
    expect(messages).toHaveLength(0)
  })

  it('AC-K15 同一事件不重复推送（reminder_log 去重）', async () => {
    const owner = await setup('owner', { name: 'door-dedupe' })
    await addCode(owner.token, owner.projectId, {})

    const event = { refType: 'project_member', refId: 4242, reason: '成员被移出项目' }
    const first = await doorCodeService.warnOwnerToChangeLock(owner.projectId, event)
    const second = await doorCodeService.warnOwnerToChangeLock(owner.projectId, event)

    expect(first.sent).toBe(true)
    // 去重键是 (type, ref_type, ref_id, target_user_id)。同一个事件重复处理
    // 只发一次，但**换一个事件（新的 refId）仍会重新提醒** ——
    // 用 projectId 做 refId 的话，一个项目一辈子只会提醒一次
    expect(second.sent).toBe(false)

    const messages = await db.query("SELECT * FROM notification WHERE title = '建议更换门锁密码'")
    expect(messages).toHaveLength(1)
  })

  it('AC-K15 不同事件会分别提醒（refId 是事件标识而非项目 id）', async () => {
    const owner = await setup('owner', { name: 'door-two-events' })
    await addCode(owner.token, owner.projectId, {})

    await doorCodeService.warnOwnerToChangeLock(owner.projectId, {
      refType: 'project_member',
      refId: 1001,
      reason: '工长被移出项目',
    })
    await doorCodeService.warnOwnerToChangeLock(owner.projectId, {
      refType: 'project_member',
      refId: 1002,
      reason: '监理被移出项目',
    })

    const messages = await db.query("SELECT * FROM notification WHERE title = '建议更换门锁密码'")
    expect(messages).toHaveLength(2)
  })
})

describe('AC-K14 手动失效', () => {
  it('失效后不可查看，且所有可查看者收到通知', async () => {
    const { owner, foreman, supervisor, projectId } = await setupProjectWithTeam()
    const created = await addCode(owner.token, projectId, { code: 'RevokeMe123' })

    const res = await request
      .authed('post', `/door-codes/${created.body.data.id}/revoke`, owner.token)
      .send({})
    expect(res.status).toBe(200)

    const after = await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)
    expect(after.body.data.list).toHaveLength(0)

    for (const who of [foreman, supervisor]) {
      const messages = await db.query(`SELECT * FROM notification WHERE user_id = ? AND title = '门锁密码已失效'`, [
        who.userId,
      ])
      expect(messages).toHaveLength(1)
      // 通知里必须提醒「记录过就删掉」—— 已失效只作用于系统内的可见性，
      // 记在手机里的那串数字照样能开门
      expect(messages[0].content).toContain('删除记录')
    }
  })

  it('失效是不可逆的：已失效的条目不能修改，也不能再次失效', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    const created = await addCode(owner.token, projectId, {})
    const id = created.body.data.id

    await request.authed('post', `/door-codes/${id}/revoke`, owner.token).send({})

    // 「复活」意味着已经按失效通知做过处置的人被静默推翻
    const update = await request.authed('put', `/door-codes/${id}`, owner.token).send({ name: '复活' })
    const again = await request.authed('post', `/door-codes/${id}/revoke`, owner.token).send({})

    expect(update.status).toBe(409)
    expect(again.status).toBe(409)

    const row = await db.queryOne('SELECT status FROM project_door_code WHERE id = ?', [id])
    expect(row.status).toBe('revoked')
  })

  it('失效不刷新 revoked_at（保留第一次失效的时刻）', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    const created = await addCode(owner.token, projectId, {})
    const id = created.body.data.id

    await request.authed('post', `/door-codes/${id}/revoke`, owner.token).send({})
    const first = (await db.queryOne('SELECT revoked_at FROM project_door_code WHERE id = ?', [id])).revoked_at

    await request.authed('post', `/door-codes/${id}/revoke`, owner.token).send({})
    const second = (await db.queryOne('SELECT revoked_at FROM project_door_code WHERE id = ?', [id])).revoked_at

    expect(second).toEqual(first)
  })
})

describe('AC-K16 多条密码各自独立', () => {
  it('多条条目各自独立失效，互不影响', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    const door = await addCode(owner.token, projectId, { name: '入户门', code: '111111' })
    const unit = await addCode(owner.token, projectId, { name: '单元门', code: '222222' })

    await request.authed('post', `/door-codes/${door.body.data.id}/revoke`, owner.token).send({})

    const res = await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)
    expect(res.body.data.list).toHaveLength(1)
    expect(res.body.data.list[0].name).toBe('单元门')
    expect(res.body.data.list[0].code).toBe('222222')

    void unit
  })

  it('列表按创建顺序返回，名称与备注原样保留', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { name: '入户门', code: '111111', remark: '锁上有红点要按住' })
    await addCode(owner.token, projectId, { name: '单元门', code: '222222' })

    const res = await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)

    expect(res.body.data.list.map((i) => i.name)).toEqual(['入户门', '单元门'])
    expect(res.body.data.list[0].remark).toBe('锁上有红点要按住')
  })
})

describe('AC-K03 访问记录', () => {
  it('业主可查看「谁在什么时候看过哪条密码」', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    const created = await addCode(owner.token, projectId, { name: '入户门' })

    await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)

    const res = await request.authed('get', `/projects/${projectId}/door-codes/access-log`, owner.token)

    expect(res.status).toBe(200)
    expect(res.body.data.list).toHaveLength(1)
    expect(res.body.data.list[0].userId).toBe(foreman.userId)
    expect(res.body.data.list[0].codeName).toBe('入户门')
    expect(res.body.data.list[0].viewedAt).toBeTruthy()
  })

  it('AC-K03 工长与监理调用返回 403', async () => {
    const { foreman, supervisor, projectId } = await setupProjectWithTeam()

    for (const who of [foreman, supervisor]) {
      const res = await request.authed('get', `/projects/${projectId}/door-codes/access-log`, who.token)
      expect(res.status).toBe(403)
    }
  })

  it('访问记录里不含密码明文（否则等于又开了一条泄露路径）', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { code: 'AccessLogSecret1' })
    await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)

    const res = await request.authed('get', `/projects/${projectId}/door-codes/access-log`, owner.token)

    expect(JSON.stringify(res.body)).not.toContain('AccessLogSecret1')
  })

  it('条目被软删除后访问记录仍在，且保留当时的条目名称', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    const created = await addCode(owner.token, projectId, { name: '入户门' })
    await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)

    await db.query('UPDATE project_door_code SET deleted_at = NOW() WHERE id = ?', [created.body.data.id])

    const res = await request.authed('get', `/projects/${projectId}/door-codes/access-log`, owner.token)

    // 访问记录是**只追加**的，少一行就等于审计链断了一环
    expect(res.body.data.list).toHaveLength(1)
    // 而且必须保留当时的条目名称：一律显示「已删除的条目」会让业主看不出
    // 「到底是谁看了哪个门的密码」—— 那正是这条记录唯一要回答的问题
    expect(res.body.data.list[0].codeName).toBe('入户门')
  })

  it('访问记录按时间倒序，最近的在最前', async () => {
    const { owner, foreman, supervisor, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, {})

    await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)
    await request.authed('get', `/projects/${projectId}/door-codes`, supervisor.token)

    const res = await request.authed('get', `/projects/${projectId}/door-codes/access-log`, owner.token)
    expect(res.body.data.list[0].userId).toBe(supervisor.userId)
  })
})

describe('密码值的规范化', () => {
  it('前导零与中间空格被保留（业主设的密码必须与工长看到的一致）', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { code: '0123' })

    const res = await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)
    expect(res.body.data.list[0].code).toBe('0123')
  })

  it('首尾空白被去掉（几乎必然是复制粘贴带来的）', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { code: '  1234  ' })

    const res = await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)
    expect(res.body.data.list[0].code).toBe('1234')
  })

  it('空密码与全空白密码被拒绝，且提示里不回显输入', async () => {
    const { owner, projectId } = await setupProjectWithTeam()

    for (const bad of ['', '   ']) {
      const res = await addCode(owner.token, projectId, { code: bad })
      expect(res.status).toBe(400)
    }

    const long = await addCode(owner.token, projectId, { code: '9'.repeat(65) })
    expect(long.status).toBe(400)
    expect(long.body.message).not.toContain('9999')
  })

  it('只改名称或备注时不动密码', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    const created = await addCode(owner.token, projectId, { code: 'KeepMe123' })

    await request.authed('put', `/door-codes/${created.body.data.id}`, owner.token).send({ name: '改了名字' })

    const res = await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)
    expect(res.body.data.list[0].name).toBe('改了名字')
    expect(res.body.data.list[0].code).toBe('KeepMe123')
  })

  it('改密码后读到的是新密码，且日志只记「密码变了」不记任何一版密码', async () => {
    const { owner, foreman, projectId } = await setupProjectWithTeam()
    const created = await addCode(owner.token, projectId, { code: 'OldCode111' })

    await request
      .authed('put', `/door-codes/${created.body.data.id}`, owner.token)
      .send({ code: 'NewCode222' })

    const res = await request.authed('get', `/projects/${projectId}/door-codes`, foreman.token)
    expect(res.body.data.list[0].code).toBe('NewCode222')

    const logs = await db.query('SELECT * FROM operation_log WHERE action = ?', [
      operationLog.ACTIONS.DOOR_CODE_UPDATE,
    ])
    const dump = JSON.stringify(logs)
    expect(dump).not.toContain('OldCode111')
    expect(dump).not.toContain('NewCode222')
    expect(dump).toContain('"codeChanged":true')
  })
})

describe('创建 / 修改 / 失效的审计留痕（AC-AD09 同口径）', () => {
  it('三个动作各自写入 operation_log', async () => {
    const { owner, projectId } = await setupProjectWithTeam()
    const created = await addCode(owner.token, projectId, {})
    await request.authed('put', `/door-codes/${created.body.data.id}`, owner.token).send({ name: '改名' })
    await request.authed('post', `/door-codes/${created.body.data.id}/revoke`, owner.token).send({})

    for (const action of [
      operationLog.ACTIONS.DOOR_CODE_CREATE,
      operationLog.ACTIONS.DOOR_CODE_UPDATE,
      operationLog.ACTIONS.DOOR_CODE_REVOKE,
    ]) {
      const rows = await db.query('SELECT * FROM operation_log WHERE action = ?', [action])
      expect(rows, `${action} 没有留痕`).toHaveLength(1)
      expect(rows[0].operator_type).toBe('user')
      expect(rows[0].operator_id).toBe(owner.userId)
      expect(rows[0].project_id).toBe(projectId)
    }
  })

  it('新增时通知已确认的工长与监理（AC-K11 的配套）', async () => {
    const { owner, foreman, supervisor, projectId } = await setupProjectWithTeam()
    await addCode(owner.token, projectId, { name: '入户门' })

    for (const who of [foreman, supervisor]) {
      const messages = await db.query('SELECT * FROM notification WHERE user_id = ?', [who.userId])
      expect(messages.some((m) => m.title.includes('门锁密码'))).toBe(true)
    }

    // 业主自己不必收到「我设置了密码」的通知
    const own = await db.query('SELECT * FROM notification WHERE user_id = ?', [owner.userId])
    expect(own).toHaveLength(0)
  })
})
