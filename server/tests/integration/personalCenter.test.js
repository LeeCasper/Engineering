'use strict'

/**
 * C 端个人中心集成测试（C-5.1 ~ C-5.9 / AC-U01 ~ AC-U05、AC-U11 ~ AC-U20）。
 *
 * ── 这个模块的测试重点与别处不同 ──
 * 个人中心的功能大多是「读」，逻辑很浅，因此真正需要守住的是**边界**：
 * 谁看不到什么（监理看不到账目与专属入口）、什么时候不能完整回显手机号、
 * 注销之后什么被抹掉而什么必须留下。功能写错很容易被发现，
 * 边界写错则会在很久之后以「怎么这个人还能看到」的形式暴露。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
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

/**
 * 给项目补一个「阶段 + 工序」。
 *
 * `mini.createProject` 只插 project 行（绕过建档接口），因此没有阶段工序树。
 * 而汇报、验收都挂在工序上，测统计时必须先有树。
 */
async function addStageAndItem(projectId, name = '工序一') {
  const stageId = await mini.createStage({ projectId })
  const result = await db.query('INSERT INTO project_item (project_stage_id, name, seq) VALUES (?, ?, 1)', [
    stageId,
    name,
  ])
  return { stageId, itemId: result.insertId }
}

/** 建一个项目 + 一个指定角色的用户（active 成员），返回常用句柄 */
async function setupMember(role, { userName = 'member', withTree = false } = {}) {
  seq += 1
  const login = await mini.login(`${userName}-${seq}`)
  const projectId = await mini.createProject({ name: `个人中心项目-${seq}`, createdBy: 1 })
  await mini.addMember({ projectId, userId: login.userId, role })

  const tree = withTree ? await addStageAndItem(projectId) : null
  return { ...login, projectId, tree }
}

describe('AC-U01 / AC-U02 个人资料与手机号脱敏', () => {
  it('资料含头像、昵称、脱敏手机号', async () => {
    const login = await mini.login(`profile-${(seq += 1)}`)
    await db.query("UPDATE user SET nickname = '张工', avatar = 'https://x/a.png', phone = '13800001111' WHERE id = ?", [
      login.userId,
    ])

    const res = await request.authed('get', '/auth/profile', login.token)

    expect(res.status).toBe(200)
    expect(res.body.data.nickname).toBe('张工')
    expect(res.body.data.avatar).toBe('https://x/a.png')
    // AC-U02：中间 4 位掩码
    expect(res.body.data.phoneMasked).toBe('138****1111')
  })

  it('AC-U02 接口任何位置都不出现完整手机号', async () => {
    const login = await mini.login(`profile-mask-${(seq += 1)}`)
    await db.query("UPDATE user SET phone = '13800002222' WHERE id = ?", [login.userId])

    const res = await request.authed('get', '/auth/profile', login.token)

    // 逐字断言整个响应体里没有完整号码 —— 只查 phoneMasked 字段的话，
    // 将来某个字段顺手带上 phone 就漏过去了
    expect(JSON.stringify(res.body)).not.toContain('13800002222')
  })

  it('AC-U01 传 projectId 时返回该项目内的角色', async () => {
    const { token, projectId } = await setupMember('foreman')

    const res = await request.authed('get', `/auth/profile?projectId=${projectId}`, token)

    expect(res.body.data.projectId).toBe(projectId)
    expect(res.body.data.role).toBe('foreman')
    expect(res.body.data.roleLabel).toBe('工长')
  })

  it('AC-U01 主工长与普通工长在资料里可区分', async () => {
    const first = await setupMember('foreman', { userName: 'primary' })
    const second = await setupMember('foreman', { userName: 'plain' })

    // 夹具直接插成员行，不会走「首个工长自动成为主工长」那段服务逻辑，
    // 因此显式置位。两个项目里他各是不同的身份，正好验证按项目判定
    await db.query('UPDATE project_member SET is_primary = 1 WHERE project_id = ? AND user_id = ?', [
      first.projectId,
      first.userId,
    ])
    await db.query('UPDATE project_member SET is_primary = 1 WHERE project_id = ? AND user_id = ?', [
      second.projectId,
      second.userId,
    ])
    // 再把人 B 加成项目 A 的第二名工长（非主工长）
    await mini.addMember({ projectId: first.projectId, userId: second.userId, role: 'foreman' })

    const inA = await request.authed('get', `/auth/profile?projectId=${first.projectId}`, second.token)
    const inB = await request.authed('get', `/auth/profile?projectId=${second.projectId}`, second.token)

    // AC-U05：同一个人在不同项目里角色元素不同，界面按**当前项目**渲染
    expect(inA.body.data.isPrimaryForeman).toBe(false)
    expect(inB.body.data.isPrimaryForeman).toBe(true)
  })

  it('AC-U05 同一账号在不同项目中担任不同角色，各项目返回各自的角色', async () => {
    const login = await mini.login(`multi-role-${(seq += 1)}`)

    const p1 = await mini.createProject({ name: '业主项目', createdBy: 1 })
    const p2 = await mini.createProject({ name: '工长项目', createdBy: 1 })
    await mini.addMember({ projectId: p1, userId: login.userId, role: 'owner' })
    await mini.addMember({ projectId: p2, userId: login.userId, role: 'foreman' })

    const asOwner = await request.authed('get', `/auth/profile?projectId=${p1}`, login.token)
    const asForeman = await request.authed('get', `/auth/profile?projectId=${p2}`, login.token)

    expect(asOwner.body.data.role).toBe('owner')
    expect(asForeman.body.data.role).toBe('foreman')
  })

  it('传了不是自己项目的 id 时角色为 null，而不是报错泄露项目是否存在（AC-P26）', async () => {
    const login = await mini.login(`outsider-${(seq += 1)}`)
    const otherProject = await mini.createProject({ name: '别人的项目', createdBy: 1 })

    const existing = await request.authed('get', `/auth/profile?projectId=${otherProject}`, login.token)
    const ghost = await request.authed('get', '/auth/profile?projectId=999999', login.token)

    // 两者的响应必须无法区分 —— 否则拿 id 遍历就能探出哪些项目真实存在
    expect(existing.status).toBe(200)
    expect(ghost.status).toBe(200)
    expect(existing.body.data.role).toBeNull()
    expect(ghost.body.data.role).toBeNull()
  })
})

describe('AC-U03 项目切换不串数据', () => {
  it('每个项目的数据只从各自的项目上下文取', async () => {
    const login = await mini.login(`switch-${(seq += 1)}`)
    const p1 = await mini.createProject({ name: '项目甲', createdBy: 1 })
    const p2 = await mini.createProject({ name: '项目乙', createdBy: 1 })
    await mini.addMember({ projectId: p1, userId: login.userId, role: 'foreman' })
    await mini.addMember({ projectId: p2, userId: login.userId, role: 'owner' })

    const d1 = await request.authed('get', `/projects/${p1}`, login.token)
    const d2 = await request.authed('get', `/projects/${p2}`, login.token)

    expect(d1.body.data.name).toBe('项目甲')
    expect(d1.body.data.myRole).toBe('foreman')
    expect(d2.body.data.name).toBe('项目乙')
    expect(d2.body.data.myRole).toBe('owner')
  })
})

describe('AC-U04 无项目时的引导', () => {
  it('没有项目时返回空列表与管理方联系方式，而不是报错', async () => {
    const login = await mini.login(`noproject-${(seq += 1)}`)
    await sysConfigService.update('support_contact', '客服微信 gongchengbao', {
      type: 'admin',
      id: 1,
      role: 'owner',
      tenantId: 1,
    })

    const res = await request.authed('get', '/projects?tenantId=1', login.token)

    expect(res.status).toBe(200)
    // 空列表而不是报错。C-1.5 要的是「引导页」，而引导页需要联系方式才能成立
    expect(res.body.data.total).toBe(0)
    expect(res.body.data.groups).toEqual([])
    expect(res.body.data.autoEnterProjectId).toBeNull()
    expect(res.body.data.supportContact).toBe('客服微信 gongchengbao')
  })

  it('有项目时不返回联系方式（引导页只在需要时出现）', async () => {
    const { token } = await setupMember('owner')

    const res = await request.authed('get', '/projects', token)
    expect(res.body.data.supportContact).toBeNull()
  })
})

describe('AC-U14 工长专属统计', () => {
  it('三项数值与进度、验收模块的数据一致', async () => {
    const { token, userId, projectId, tree } = await setupMember('foreman', { withTree: true })
    const { stageId, itemId } = tree

    // 两条本月汇报（一条是别人的，不该计入「我的」）
    const otherId = await mini.createWechatUser(`other-${(seq += 1)}`)
    for (const uid of [userId, userId, otherId]) {
      await db.query(
        `INSERT INTO progress_report (project_id, project_item_id, user_id, progress, content, client_request_id)
         VALUES (?, ?, ?, 50.00, '本月汇报', ?)`,
        [projectId, itemId, uid, `smoke-${Math.random()}`.slice(0, 60)]
      )
    }

    // 一张待整改、两张流转中
    for (const status of ['pending_rectify', 'pending_supervisor', 'pending_owner']) {
      await db.query(
        `INSERT INTO acceptance (project_id, project_stage_id, project_item_id, type, status, submitter_id)
         VALUES (?, ?, ?, 'stage', ?, ?)`,
        [projectId, stageId, itemId, status, userId]
      )
    }

    const res = await request.authed('get', `/projects/${projectId}/my-stats`, token)

    expect(res.status).toBe(200)
    // 本月汇报数只算我自己的（2 条），不算同事那条
    expect(res.body.data.monthReportCount).toBe(2)
    expect(res.body.data.pendingRectifyCount).toBe(1)
    expect(res.body.data.pendingAcceptanceCount).toBe(2)
  })

  it('只统计本月，上个月的汇报不计入', async () => {
    const { token, userId, projectId, tree } = await setupMember('foreman', { withTree: true })

    await db.query(
      `INSERT INTO progress_report (project_id, project_item_id, user_id, progress, content, client_request_id, created_at)
       VALUES (?, ?, ?, 50.00, '上个月', ?, DATE_SUB(NOW(), INTERVAL 40 DAY))`,
      [projectId, tree.itemId, userId, `old-${Math.random()}`.slice(0, 60)]
    )

    const res = await request.authed('get', `/projects/${projectId}/my-stats`, token)
    expect(res.body.data.monthReportCount).toBe(0)
  })

  it('非工长角色返回 403（C-5.5 是工长专属）', async () => {
    const owner = await setupMember('owner')
    const supervisor = await setupMember('supervisor')

    for (const who of [owner, supervisor]) {
      const res = await request.authed('get', `/projects/${who.projectId}/my-stats`, who.token)
      expect(res.status).toBe(403)
    }
  })

  it('非本项目成员得到 404（不泄露项目是否存在）', async () => {
    const outsider = await mini.login(`stats-outsider-${(seq += 1)}`)
    const { projectId } = await setupMember('foreman')

    const res = await request.authed('get', `/projects/${projectId}/my-stats`, outsider.token)
    expect(res.status).toBe(404)
  })
})

describe('AC-U15 业主一键联系工长 / 监理', () => {
  it('返回工长与监理的完整号码，主工长排最前', async () => {
    const owner = await setupMember('owner')
    const foremanId = await mini.createWechatUser(`foreman-${(seq += 1)}`)
    const supervisorId = await mini.createWechatUser(`supervisor-${(seq += 1)}`)
    await db.query("UPDATE user SET nickname = '王工', phone = '13900001111' WHERE id = ?", [foremanId])
    await db.query("UPDATE user SET nickname = '李监理', phone = '13700002222' WHERE id = ?", [supervisorId])
    await mini.addMember({ projectId: owner.projectId, userId: foremanId, role: 'foreman' })
    await db.query('UPDATE project_member SET is_primary = 1 WHERE project_id = ? AND user_id = ?', [
      owner.projectId,
      foremanId,
    ])
    await mini.addMember({ projectId: owner.projectId, userId: supervisorId, role: 'supervisor' })

    const res = await request.authed('get', `/projects/${owner.projectId}/contacts`, owner.token)

    expect(res.status).toBe(200)
    expect(res.body.data.contacts).toHaveLength(2)
    // AC-U15：拨号需要完整号码，脱敏的号码拨不出去。可见范围由「仅业主可调」守住
    expect(res.body.data.contacts[0]).toMatchObject({
      role: 'foreman',
      name: '王工',
      phone: '13900001111',
      isPrimaryForeman: true,
    })
    expect(res.body.data.hasSupervisor).toBe(true)
  })

  it('AC-U15 项目未配置监理时 hasSupervisor 为 false', async () => {
    const owner = await setupMember('owner')
    const foremanId = await mini.createWechatUser(`solo-foreman-${(seq += 1)}`)
    await db.query("UPDATE user SET phone = '13900003333' WHERE id = ?", [foremanId])
    await mini.addMember({ projectId: owner.projectId, userId: foremanId, role: 'foreman' })

    const res = await request.authed('get', `/projects/${owner.projectId}/contacts`, owner.token)

    expect(res.body.data.hasSupervisor).toBe(false)
    expect(res.body.data.contacts.every((c) => c.role !== 'supervisor')).toBe(true)
  })

  it('非业主（工长 / 监理）不能查看联系人', async () => {
    const owner = await setupMember('owner')
    const foreman = await setupMember('foreman')
    await mini.addMember({ projectId: owner.projectId, userId: foreman.userId, role: 'foreman' })

    const res = await request.authed('get', `/projects/${owner.projectId}/contacts`, foreman.token)
    expect(res.status).toBe(403)
  })

  it('不返回其他业主的联系方式', async () => {
    const ownerA = await setupMember('owner')
    const ownerB = await mini.createWechatUser(`owner-b-${(seq += 1)}`)
    await db.query("UPDATE user SET phone = '13600009999' WHERE id = ?", [ownerB])
    await mini.addMember({ projectId: ownerA.projectId, userId: ownerB, role: 'owner' })

    const res = await request.authed('get', `/projects/${ownerA.projectId}/contacts`, ownerA.token)
    expect(JSON.stringify(res.body)).not.toContain('13600009999')
  })

  it('没有手机号的成员不出现在列表里（否则界面会有个拨不出去的按钮）', async () => {
    const owner = await setupMember('owner')
    const foremanId = await mini.createWechatUser(`nophone-${(seq += 1)}`)
    await mini.addMember({ projectId: owner.projectId, userId: foremanId, role: 'foreman' })

    const res = await request.authed('get', `/projects/${owner.projectId}/contacts`, owner.token)
    expect(res.body.data.contacts).toEqual([])
  })
})

describe('AC-U16 监理的可见边界', () => {
  it('监理不能查看账目', async () => {
    const supervisor = await setupMember('supervisor')

    const res = await request.authed('get', `/projects/${supervisor.projectId}/ledger`, supervisor.token)

    // C-4 与 AC-L27：监理不展示记账 tab，接口层同样拒绝
    expect(res.status).toBe(403)
  })

  it('监理不能登记账目', async () => {
    const supervisor = await setupMember('supervisor')

    const res = await request
      .authed('post', `/projects/${supervisor.projectId}/ledger`, supervisor.token)
      .send({ type: 'expense', category: 'material', amount: '100.00', occurredAt: '2026-03-01', stageId: 1 })

    expect(res.status).toBe(403)
  })

  it('监理也不能看工长统计与联系人这两个专属入口', async () => {
    const supervisor = await setupMember('supervisor')

    const stats = await request.authed('get', `/projects/${supervisor.projectId}/my-stats`, supervisor.token)
    const contacts = await request.authed('get', `/projects/${supervisor.projectId}/contacts`, supervisor.token)

    expect(stats.status).toBe(403)
    expect(contacts.status).toBe(403)
  })
})

describe('AC-U11 ~ AC-U13 订阅消息授权', () => {
  /**
   * 订阅模板是按租户配置的，因此测试用户必须先成为某个租户的成员 ——
   * 不属于任何租户的用户本来就不该能配置订阅（他没有可订阅的消息）。
   */
  async function tenantUser(code) {
    const login = await mini.login(code)
    const projectId = await mini.createProject({ name: `订阅项目-${(seq += 1)}`, createdBy: 1 })
    await mini.addMember({ projectId, userId: login.userId, role: 'owner' })
    return login
  }

  async function configureTemplate(type, value) {
    await sysConfigService.update(`subscribe_template_${type}`, value, { type: 'admin', id: 1, role: 'owner', tenantId: 1 })
  }

  it('未配置模板 ID 的分类标记为不可申请', async () => {
    const login = await tenantUser(`sub-${(seq += 1)}`)

    const res = await request.authed('get', '/notifications/subscriptions', login.token)

    expect(res.status).toBe(200)
    // 五类都返回 —— 只显示「已开通的」会让运营以为系统只有三类消息
    expect(res.body.data.list).toHaveLength(5)
    expect(res.body.data.list.every((i) => i.available === false)).toBe(true)
    expect(res.body.data.availableCount).toBe(0)
    // 未配置时状态必须是 null 而不是 'rejected' ——
    // 后者会让用户以为自己拒绝过，而他根本没被问过
    expect(res.body.data.list.every((i) => i.status === null)).toBe(true)
  })

  it('AC-U13 授权后状态可查，并支持重新授权', async () => {
    const login = await tenantUser(`sub2-${(seq += 1)}`)
    await configureTemplate('acceptance', 'TPL-ACC-001')

    await request.authed('post', '/notifications/subscriptions', login.token).send({
      type: 'acceptance',
      status: 'accepted',
    })

    const first = await request.authed('get', '/notifications/subscriptions', login.token)
    const item = first.body.data.list.find((i) => i.type === 'acceptance')
    expect(item.status).toBe('accepted')
    expect(first.body.data.acceptedCount).toBe(1)

    // 重新授权（用户改主意）
    await request.authed('post', '/notifications/subscriptions', login.token).send({
      type: 'acceptance',
      status: 'rejected',
    })
    const second = await request.authed('get', '/notifications/subscriptions', login.token)
    expect(second.body.data.list.find((i) => i.type === 'acceptance').status).toBe('rejected')
  })

  it('AC-U12 用户勾选「不再询问」（ban）后不再提供申请入口', async () => {
    const login = await tenantUser(`sub3-${(seq += 1)}`)
    await configureTemplate('progress', 'TPL-PRG-001')

    await request.authed('post', '/notifications/subscriptions', login.token).send({
      type: 'progress',
      status: 'ban',
    })

    const res = await request.authed('get', '/notifications/subscriptions', login.token)
    const item = res.body.data.list.find((i) => i.type === 'progress')

    // ban 与一次性拒绝的区别就在于此：前者要隐藏入口，后者可以换个时机再问
    expect(item.status).toBe('ban')
    expect(item.canRequest).toBe(false)
  })

  it('一次性拒绝后仍可再次申请', async () => {
    const login = await tenantUser(`sub4-${(seq += 1)}`)
    await configureTemplate('payment', 'TPL-PAY-001')

    await request.authed('post', '/notifications/subscriptions', login.token).send({
      type: 'payment',
      status: 'rejected',
    })

    const res = await request.authed('get', '/notifications/subscriptions', login.token)
    expect(res.body.data.list.find((i) => i.type === 'payment').canRequest).toBe(true)
  })

  it('未配置模板时拒绝记录授权，而不是写进一行会被互相覆盖的空键', async () => {
    const login = await tenantUser(`sub5-${(seq += 1)}`)

    const res = await request
      .authed('post', '/notifications/subscriptions', login.token)
      .send({ type: 'comment', status: 'accepted' })

    // user_subscription 的唯一键是 (user_id, template_id)。放行的话，
    // 五个分类的 template_id 都是空串，会全部折到同一行互相覆盖 ——
    // 表现为「授权了两个模板，管理页只显示一个」
    expect(res.status).toBe(400)
    expect(await db.count('FROM user_subscription WHERE deleted_at IS NULL')).toBe(0)
  })

  it('未知的消息类型与非法状态被拒绝', async () => {
    const login = await tenantUser(`sub6-${(seq += 1)}`)
    await configureTemplate('acceptance', 'TPL-ACC-002')

    const badType = await request
      .authed('post', '/notifications/subscriptions', login.token)
      .send({ type: 'notexist', status: 'accepted' })
    const badStatus = await request
      .authed('post', '/notifications/subscriptions', login.token)
      .send({ type: 'acceptance', status: 'maybe' })

    expect(badType.status).toBe(400)
    expect(badStatus.status).toBe(400)
  })

  it('授权动作写入操作日志（用户明确同意的凭据）', async () => {
    const login = await tenantUser(`sub7-${(seq += 1)}`)
    await configureTemplate('acceptance', 'TPL-ACC-003')

    await request.authed('post', '/notifications/subscriptions', login.token).send({
      type: 'acceptance',
      status: 'accepted',
    })

    const rows = await db.query('SELECT * FROM operation_log WHERE action = ?', [
      operationLog.ACTIONS.SUBSCRIPTION_RECORD,
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].operator_type).toBe('user')
    expect(rows[0].operator_id).toBe(login.userId)
  })

  it('授权记录按人隔离', async () => {
    const a = await tenantUser(`subA-${(seq += 1)}`)
    const b = await tenantUser(`subB-${(seq += 1)}`)
    await configureTemplate('acceptance', 'TPL-ACC-004')

    await request.authed('post', '/notifications/subscriptions', a.token).send({
      type: 'acceptance',
      status: 'accepted',
    })

    const res = await request.authed('get', '/notifications/subscriptions', b.token)
    expect(res.body.data.list.find((i) => i.type === 'acceptance').status).toBeNull()
  })
})

describe('AC-U17 内容页', () => {
  async function publish(key, { title = '测试页', content = '正文内容', version = '1.0' } = {}) {
    const admin = await auth.createAndLogin({ username: `content-admin-${(seq += 1)}` })
    const res = await request
      .authed('put', `/admin/contents/${key}`, admin.token)
      .send({ title, content, version, publish: true })
    return { admin, res }
  }

  it('AC-U17 发布后 C 端可正常打开', async () => {
    await publish('agreement', { title: '用户协议', content: '一、服务说明……', version: '2026-10-01' })

    // 不要求登录态：登录之前就要能读到
    const res = await request.get('/contents/agreement?tenantId=1')

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('用户协议')
    expect(res.body.data.content).toBe('一、服务说明……')
    expect(res.body.data.version).toBe('2026-10-01')
  })

  it('未发布时 C 端返回 404 而不是空白页', async () => {
    const { admin } = await publish('privacy')

    // 先存一版草稿（新键未发布）
    const draft = await auth.createAndLogin({ username: `content-admin-d-${(seq += 1)}` })
    expect(admin).toBeDefined()

    const save = await request
      .authed('put', '/admin/contents/about', draft.token)
      .send({ title: '关于我们', content: '草稿内容', publish: false })
    expect(save.status).toBe(200)

    const c = await request.get('/contents/about?tenantId=1')
    // 空内容会让小程序渲染出白屏，用户以为 App 坏了；
    // 404 让前端能退回「该页面暂不可用」
    expect(c.status).toBe(404)
  })

  it('后台能看到未发布的草稿', async () => {
    const admin = await auth.createAndLogin({ username: `content-admin-2-${(seq += 1)}` })
    await request
      .authed('put', '/admin/contents/about', admin.token)
      .send({ title: '关于我们', content: '草稿', publish: false })

    const res = await request.authed('get', '/admin/contents/about', admin.token)

    expect(res.status).toBe(200)
    expect(res.body.data.content).toBe('草稿')
    expect(res.body.data.publishedAt).toBeNull()
  })

  it('后台列表包含尚未创建过的页面，运营才知道有哪几页要维护', async () => {
    const admin = await auth.createAndLogin({ username: `content-admin-3-${(seq += 1)}` })

    const res = await request.authed('get', '/admin/contents', admin.token)

    expect(res.body.data.list.map((i) => i.pageKey).sort()).toEqual(['about', 'agreement', 'privacy'])
    expect(res.body.data.list.every((i) => i.exists === false)).toBe(true)
    // 隐私政策与用户协议是合规必需项，列表里要能标出来
    expect(res.body.data.list.find((i) => i.pageKey === 'privacy').required).toBe(true)
  })

  it('已发布的页面再次编辑不会重新变成未发布', async () => {
    await publish('privacy', { content: '第一版' })
    const before = await request.get('/contents/privacy?tenantId=1')

    const admin = await auth.createAndLogin({ username: `content-admin-4-${(seq += 1)}` })
    await request
      .authed('put', '/admin/contents/privacy', admin.token)
      .send({ title: '隐私政策', content: '第二版', publish: false })

    const after = await request.get('/contents/privacy?tenantId=1')
    // 一次错别字修正把隐私政策从 C 端整体下掉，而没人会立刻发现
    expect(after.status).toBe(200)
    expect(after.body.data.content).toBe('第二版')
    // 发布日期记录的是「这一版什么时候上线的」，不该被每次编辑刷新 ——
    // 否则「用户当时同意的是哪一版」就没有答案了
    expect(after.body.data.publishedAt).toEqual(before.body.data.publishedAt)
  })

  it('未知的页面 key 返回 404', async () => {
    const res = await request.get('/contents/notexist')
    expect(res.status).toBe(404)
  })

  it('内容修改写入操作日志，且不把正文抄进去', async () => {
    const admin = await auth.createAndLogin({ username: `content-admin-5-${(seq += 1)}` })
    const secret = '这是一段很长的隐私政策正文'.repeat(20)

    await request
      .authed('put', '/admin/contents/privacy', admin.token)
      .send({ title: '隐私政策', content: secret, version: '2.0', publish: true })

    const rows = await db.query('SELECT * FROM operation_log WHERE action = ?', [operationLog.ACTIONS.CONTENT_UPDATE])
    expect(rows).toHaveLength(1)

    const detail = typeof rows[0].detail === 'string' ? JSON.parse(rows[0].detail) : rows[0].detail
    expect(detail.after.version).toBe('2.0')
    expect(detail.after.contentLength).toBe(secret.length)
    // 正文动辄数千字，写进审计表会让它迅速膨胀
    expect(JSON.stringify(rows[0])).not.toContain('隐私政策正文')
  })

  it('后台内容接口需要登录，且 C 端 token 不可用', async () => {
    const anon = await request.get('/admin/contents')
    const login = await mini.login(`content-mini-${(seq += 1)}`)
    const cross = await request.authed('get', '/admin/contents', login.token)

    expect(anon.status).toBe(401)
    expect(cross.status).toBe(401)
  })
})

describe('AC-U18 意见反馈', () => {
  /** 反馈按「用户所属租户」归属；不属于任何租户就会落到平台，后台看不到 */
  async function feedbackUser(code) {
    const login = await mini.login(code)
    const projectId = await mini.createProject({ name: `反馈项目-${(seq += 1)}`, createdBy: 1 })
    await mini.addMember({ projectId, userId: login.userId, role: 'owner' })
    return login
  }

  it('提交文字反馈成功，并有明确返回', async () => {
    const login = await mini.login(`feedback-${(seq += 1)}`)

    const res = await request
      .authed('post', '/feedback', login.token)
      .field('content', '进度页的时间轴在 iOS 上不滚动')
      .field('contact', '微信 abc123')

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBeTruthy()

    const row = await db.queryOne('SELECT * FROM feedback WHERE id = ?', [res.body.data.id])
    expect(row.user_id).toBe(login.userId)
    expect(row.status).toBe('new')
    expect(row.contact).toBe('微信 abc123')
  })

  it('图片与文字一起提交', async () => {
    const login = await mini.login(`feedback-img-${(seq += 1)}`)
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

    const res = await request
      .authed('post', '/feedback', login.token)
      .field('content', '这个按钮点了没反应，截图如下')
      .attach('files', png, { filename: 'shot.png', contentType: 'image/png' })

    expect(res.status).toBe(200)

    const row = await db.queryOne('SELECT * FROM feedback WHERE id = ?', [res.body.data.id])
    const images = typeof row.images === 'string' ? JSON.parse(row.images) : row.images
    expect(images).toHaveLength(1)
    expect(images[0].url).toContain('/uploads/feedback/')
  })

  it('内容过短或过长被拒绝', async () => {
    const login = await mini.login(`feedback-bad-${(seq += 1)}`)

    const tooShort = await request.authed('post', '/feedback', login.token).field('content', '坏了')
    const tooLong = await request
      .authed('post', '/feedback', login.token)
      .field('content', 'x'.repeat(1001))

    expect(tooShort.status).toBe(400)
    expect(tooLong.status).toBe(400)
    expect(await db.count('FROM feedback WHERE deleted_at IS NULL')).toBe(0)
  })

  it('未登录不能提交', async () => {
    const res = await request.post('/feedback').field('content', '匿名反馈一段文字')
    expect(res.status).toBe(401)
  })

  it('后台可查询并按「待处理优先、先来先处理」排序', async () => {
    const login = await feedbackUser(`feedback-list-${(seq += 1)}`)
    for (const text of ['第一条反馈内容', '第二条反馈内容', '第三条反馈内容']) {
      await request.authed('post', '/feedback', login.token).field('content', text)
    }

    const admin = await auth.createAndLogin({ username: `fb-admin-${(seq += 1)}` })
    const res = await request.authed('get', '/admin/feedback?status=new', admin.token)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(3)
    // 待处理视图按正序：最老的那条最该先被看到，
    // 按倒序排会让它永远沉在最下面
    expect(res.body.data.list[0].content).toBe('第一条反馈内容')
    expect(res.body.data.list[0].statusLabel).toBe('待处理')
  })

  it('后台可置为处理中并写回执，且写入操作日志', async () => {
    const login = await feedbackUser(`feedback-handle-${(seq += 1)}`)
    const created = await request.authed('post', '/feedback', login.token).field('content', '需要处理的一段反馈')

    const admin = await auth.createAndLogin({ username: `fb-admin2-${(seq += 1)}` })
    const res = await request
      .authed('put', `/admin/feedback/${created.body.data.id}`, admin.token)
      .send({ status: 'processing', reply: '已转交开发排查' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('processing')
    expect(res.body.data.reply).toBe('已转交开发排查')

    const logs = await db.query('SELECT * FROM operation_log WHERE action = ?', [operationLog.ACTIONS.FEEDBACK_HANDLE])
    expect(logs).toHaveLength(1)
    const detail = typeof logs[0].detail === 'string' ? JSON.parse(logs[0].detail) : logs[0].detail
    expect(detail.before.status).toBe('new')
    expect(detail.after.status).toBe('processing')
  })

  it('已处理的反馈不能被改回未处理（否则待办数会在两边跳）', async () => {
    const login = await feedbackUser(`feedback-resolved-${(seq += 1)}`)
    const created = await request.authed('post', '/feedback', login.token).field('content', '一条会被处理完的反馈')

    const admin = await auth.createAndLogin({ username: `fb-admin3-${(seq += 1)}` })
    await request
      .authed('put', `/admin/feedback/${created.body.data.id}`, admin.token)
      .send({ status: 'resolved', reply: '已修复' })

    const again = await request
      .authed('put', `/admin/feedback/${created.body.data.id}`, admin.token)
      .send({ status: 'processing' })

    expect(again.status).toBe(409)
  })

  it('处理的反馈必须真的存在', async () => {
    const admin = await auth.createAndLogin({ username: `fb-admin4-${(seq += 1)}` })
    const res = await request.authed('put', '/admin/feedback/999999', admin.token).send({ status: 'processing' })
    expect(res.status).toBe(404)
  })
})

describe('AC-U19 / AC-U20 注销账号', () => {
  it('AC-U19 缺少二次确认时拒绝注销', async () => {
    const login = await mini.login(`deact-confirm-${(seq += 1)}`)

    const res = await request.authed('post', '/auth/deactivate', login.token).send({})

    expect(res.status).toBe(400)
    const still = await db.queryOne('SELECT anonymized_at FROM user WHERE id = ?', [login.userId])
    expect(still.anonymized_at).toBeNull()
  })

  it('AC-U19 注销后登录态失效、资料匿名化，但历史记录保留', async () => {
    const { token, userId, projectId, tree } = await setupMember('foreman', { withTree: true })

    // 造一条历史汇报，注销后必须还在
    await db.query(
      `INSERT INTO progress_report (project_id, project_item_id, user_id, progress, content, client_request_id)
       VALUES (?, ?, ?, 30.00, '注销前的汇报', ?)`,
      [projectId, tree.itemId, userId, `keep-${(seq += 1)}`]
    )

    const res = await request.authed('post', '/auth/deactivate', token).send({ confirm: true })
    expect(res.status).toBe(200)

    // 1. 旧 token 立即失效
    const after = await request.authed('get', '/auth/profile', token)
    expect(after.status).toBe(403)

    // 2. 资料匿名化，但不软删除这一行
    const row = await db.queryOne('SELECT * FROM user WHERE id = ?', [userId])
    expect(row.anonymized_at).not.toBeNull()
    expect(row.status).toBe('deleted')
    expect(row.nickname).toBe('已注销用户')
    expect(row.phone).toBeNull()
    expect(row.openid).toBeNull()
    // **关键**：不能设 deleted_at。大量查询带 `AND u.deleted_at IS NULL`，
    // 软删会让他的历史汇报、验收署名一起消失，看起来像这些活没人干过
    expect(row.deleted_at).toBeNull()

    // 3. 历史汇报仍在，且仍能查到作者行
    const report = await db.queryOne('SELECT * FROM progress_report WHERE user_id = ?', [userId])
    expect(report).not.toBeNull()

    const visible = await db.queryOne(
      'SELECT u.id FROM progress_report r JOIN user u ON u.id = r.user_id AND u.deleted_at IS NULL WHERE r.user_id = ?',
      [userId]
    )
    expect(visible).not.toBeNull()
  })

  it('AC-U19 注销时解除成员关系，不让项目挂着一个永远不会回应的人', async () => {
    const { token, userId, projectId } = await setupMember('foreman')

    await request.authed('post', '/auth/deactivate', token).send({ confirm: true })

    const member = await db.queryOne('SELECT * FROM project_member WHERE project_id = ? AND user_id = ?', [
      projectId,
      userId,
    ])
    // 仍是 removed 而不是删行：AC-U19 要求历史保留，
    // 而「曾是成员后离开」与「从未加入」是两件事
    expect(member.status).toBe('removed')
    expect(member.left_at).not.toBeNull()
    expect(member.is_primary).toBe(0)
  })

  it('AC-U19 主工长注销后给项目管理员发消息，提醒重新指定（不静默）', async () => {
    // 项目归属某个管理员，方便验证通知
    const admin = await auth.createAndLogin({ username: `deact-admin-${(seq += 1)}`, role: 'owner' })
    const login = await mini.login(`deact-primary-${(seq += 1)}`)
    const projectId = await mini.createProject({ name: '主工长注销项目', createdBy: admin.admin.id })
    await mini.addMember({ projectId, userId: login.userId, role: 'foreman' })
    await db.query('UPDATE project_member SET is_primary = 1 WHERE project_id = ? AND user_id = ?', [
      projectId,
      login.userId,
    ])

    await request.authed('post', '/auth/deactivate', login.token).send({ confirm: true })

    const messages = await db.query('SELECT * FROM admin_notification WHERE admin_user_id = ?', [admin.admin.id])
    expect(messages).toHaveLength(1)
    expect(messages[0].title).toContain('主工长')
    expect(messages[0].content).toContain('重新指定')
  })

  it('重复注销返回 409', async () => {
    const login = await mini.login(`deact-twice-${(seq += 1)}`)
    await request.authed('post', '/auth/deactivate', login.token).send({ confirm: true })

    // 旧 token 已被拒（403）—— 用直接调服务的方式验证「已注销」这个判断本身
    const miniAuthService = require('../../src/services/miniAuth.service')
    await expect(miniAuthService.deactivate(login.userId, { type: 'mini', id: login.userId })).rejects.toThrow(
      /已注销/
    )
  })

  it('AC-U20 注销后手机号可以重新注册，不撞唯一键', async () => {
    const phone = '13500007777'
    const login = await mini.login(`recycle-${(seq += 1)}`)
    await db.query('UPDATE user SET phone = ? WHERE id = ?', [phone, login.userId])

    await request.authed('post', '/auth/deactivate', login.token).send({ confirm: true })

    // 同一个人（新的 openid，模拟重新登录）绑定同一个手机号
    const again = await mini.login(`recycle-new-${(seq += 1)}`)
    const res = await request.authed('post', '/auth/bind-phone', again.token).send({ phone })

    expect(res.status).toBe(200)
    const fresh = await db.queryOne('SELECT id, phone FROM user WHERE phone = ? AND deleted_at IS NULL', [phone])
    expect(fresh.id).toBe(again.userId)
    expect(fresh.id).not.toBe(login.userId)
  })

  it('注销会清掉订阅授权记录', async () => {
    const login = await mini.login(`deact-sub-${(seq += 1)}`)
    await sysConfigService.update('subscribe_template_acceptance', 'TPL-X', { type: 'admin', id: 1, role: 'owner', tenantId: 1 })
    await request
      .authed('post', '/notifications/subscriptions', login.token)
      .send({ type: 'acceptance', status: 'accepted' })

    await request.authed('post', '/auth/deactivate', login.token).send({ confirm: true })

    // 留着会让「已授权人数」这类统计一直偏高
    expect(await db.count('FROM user_subscription WHERE user_id = ?', [login.userId])).toBe(0)
  })

  it('注销时反馈保留但与人脱钩', async () => {
    const login = await mini.login(`deact-feedback-${(seq += 1)}`)
    const created = await request
      .authed('post', '/feedback', login.token)
      .field('content', '注销之前提交的一段反馈')
      .field('contact', '13800000000')

    await request.authed('post', '/auth/deactivate', login.token).send({ confirm: true })

    const row = await db.queryOne('SELECT * FROM feedback WHERE id = ?', [created.body.data.id])
    // 反馈是运维了解问题的线索，本身不含个人信息；但 userId 与 contact 要脱钩
    expect(row).not.toBeNull()
    expect(row.user_id).toBeNull()
    expect(row.contact).toBeNull()
  })

  it('注销写入操作日志，且只记 userId 不记昵称', async () => {
    const login = await mini.login(`deact-log-${(seq += 1)}`)
    await db.query("UPDATE user SET nickname = '李工长' WHERE id = ?", [login.userId])

    await request.authed('post', '/auth/deactivate', login.token).send({ confirm: true })

    const rows = await db.query('SELECT * FROM operation_log WHERE action = ?', [
      operationLog.ACTIONS.ACCOUNT_DEACTIVATE,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].target_id).toBe(login.userId)
    // 注销的目的就是让记录不再指向一个具体的人。把昵称抄进日志
    // 等于把刚抹掉的个人信息换个地方又存了一份
    expect(JSON.stringify(rows[0])).not.toContain('李工长')
  })
})
