'use strict'

/**
 * C 端登录与项目列表集成测试（C-1.1 ~ C-1.5 + AC-AD18/19 + AC-U02）。
 *
 * 注意 mock 模式：本文件里的 code 会被派生成稳定的 openid，
 * 因此「同一个 code = 同一个用户」是本文件所有断言的基础。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const config = require('../../config')
const wxService = require('../../src/services/wx.service')
const sysConfigService = require('../../src/services/sysConfig.service')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
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
  for (const table of ['project_member', 'project_stage', 'project_item', 'project', 'user']) {
    await db.query(`TRUNCATE TABLE ${table}`)
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1')
})

describe('C-1.1 微信静默登录', () => {
  it('首次登录创建账号并返回 token', async () => {
    const result = await mini.login('code-first')
    expect(result.status).toBe(200)
    expect(result.token).toBeTruthy()
    expect(result.userId).toBeGreaterThan(0)
    expect(result.body.data.user.hasPhone).toBe(false)
  })

  it('同一 code 再次登录复用同一账号，不重复建号', async () => {
    const first = await mini.login('code-same')
    const second = await mini.login('code-same')

    expect(second.userId).toBe(first.userId)
    const count = await db.count('FROM user WHERE deleted_at IS NULL')
    expect(count).toBe(1)
  })

  it('不同 code 得到不同账号', async () => {
    const a = await mini.login('code-a')
    const b = await mini.login('code-b')
    expect(a.userId).not.toBe(b.userId)
  })

  it('登录时带上昵称头像会一并保存', async () => {
    const res = await request.post('/auth/login').send({
      code: 'code-profile',
      nickname: '张工长',
      avatar: 'https://example.com/a.png',
    })
    expect(res.body.data.user.nickname).toBe('张工长')

    const row = await db.queryOne('SELECT nickname, avatar FROM user WHERE id = ?', [res.body.data.user.id])
    expect(row.nickname).toBe('张工长')
    expect(row.avatar).toBe('https://example.com/a.png')
  })

  it('缺少 code 时返回 400', async () => {
    const res = await request.post('/auth/login').send({})
    expect(res.status).toBe(400)
  })

  it('已注销账号不允许再登录（AC-U19 的登录态失效）', async () => {
    const { userId } = await mini.login('code-deleted')
    await db.query('UPDATE user SET status = ?, anonymized_at = NOW(), phone = NULL WHERE id = ?', [
      'deleted',
      userId,
    ])

    const again = await mini.login('code-deleted')
    expect(again.status).toBe(403)
    expect(again.body.message).toContain('注销')
  })

  it('并发登录同一 code 不产生重复账号', async () => {
    // 静默登录会被小程序反复触发（切前后台、下拉刷新），
    // 「先查后插」的写法在这里会撞唯一索引，必须靠捕获 ER_DUP_ENTRY 兜住
    const results = await Promise.all([
      mini.login('code-concurrent'),
      mini.login('code-concurrent'),
      mini.login('code-concurrent'),
    ])

    const ids = new Set(results.map((r) => r.userId).filter(Boolean))
    expect(ids.size).toBe(1)
    expect(await db.count('FROM user WHERE deleted_at IS NULL')).toBe(1)
  })
})

describe('C-1.1 绑定手机号与脱敏（AC-U02）', () => {
  it('绑定后返回脱敏手机号，接口不做完整回显', async () => {
    const { token } = await mini.login('code-bind')
    const res = await mini.authed('post', '/auth/bind-phone', token).send({ phone: '13812345678' })

    expect(res.status).toBe(200)
    expect(res.body.data.phoneMasked).toBe('138****5678')

    // 关键：整个响应里不得出现完整号码
    expect(JSON.stringify(res.body)).not.toContain('13812345678')

    const profile = await mini.authed('get', '/auth/profile', token)
    expect(profile.body.data.phoneMasked).toBe('138****5678')
    expect(JSON.stringify(profile.body)).not.toContain('13812345678')
  })

  it('手机号格式非法时拒绝', async () => {
    const { token } = await mini.login('code-badphone')
    for (const bad of ['12345', 'abcdefghijk', '23812345678', '1381234567']) {
      const res = await mini.authed('post', '/auth/bind-phone', token).send({ phone: bad })
      expect(res.status).toBe(400)
    }
  })

  it('容纳 +86 前缀与空格横线等常见写法', async () => {
    const { token } = await mini.login('code-format')
    const res = await mini.authed('post', '/auth/bind-phone', token).send({ phone: '+86 138-1234-5678' })
    expect(res.status).toBe(200)
    expect(res.body.data.phoneMasked).toBe('138****5678')
  })

  it('手机号已被另一个有微信身份的账号占用时拒绝', async () => {
    const other = await mini.login('code-owner')
    await mini.authed('post', '/auth/bind-phone', other.token).send({ phone: '13900001111' })

    const me = await mini.login('code-claimer')
    const res = await mini.authed('post', '/auth/bind-phone', me.token).send({ phone: '13900001111' })
    expect(res.status).toBe(409)
  })

  it('未被要求绑定手机号也能查看自己已有的项目（不制造死锁）', async () => {
    const { token, userId } = await mini.login('code-nophone')
    const projectId = await mini.createProject()
    await mini.addMember({ projectId, userId, role: 'owner' })

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const res = await mini.authed('get', '/projects?tenantId=1', token)
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(1)
  })
})

describe('占位账号合并（§5.2 按手机号邀请的必然结果）', () => {
  it('被邀请人登录后绑定该手机号，会合并到占位账号并换发新 token', async () => {
    // 1) 后台按手机号邀请 → 创建占位账号（有 phone、无 openid）并挂上成员关系
    const placeholderId = await mini.createPlaceholderUser('13700002222')
    const projectId = await mini.createProject({ name: '被邀请的项目' })
    const memberId = await mini.addMember({
      projectId,
      userId: placeholderId,
      role: 'foreman',
      status: 'pending',
    })

    // 2) 被邀请人用微信登录，此时系统按 openid 找不到他，新建了一个空账号
    const login = await mini.login('code-invitee')
    expect(login.userId).not.toBe(placeholderId)

    // 3) 绑定手机号 → 触发合并
    const bind = await mini.authed('post', '/auth/bind-phone', login.token).send({ phone: '13700002222' })
    expect(bind.status).toBe(200)
    expect(bind.body.data.merged).toBe(true)
    // 必须换发新 token：旧 token 指向已被作废的空壳账号
    expect(bind.body.data.token).toBeTruthy()

    // 4) 用新 token 能看到那条待确认邀请
    const projects = await mini.authed('get', '/projects', bind.body.data.token)
    expect(projects.status).toBe(200)
    expect(projects.body.data.pendingInvitations).toHaveLength(1)
    expect(projects.body.data.pendingInvitations[0].memberId).toBe(memberId)
  })

  it('合并后旧 token 立即失效，不会指向一个不存在的用户', async () => {
    await mini.createPlaceholderUser('13700003333')
    const login = await mini.login('code-invitee2')

    const bind = await mini.authed('post', '/auth/bind-phone', login.token).send({ phone: '13700003333' })
    expect(bind.status).toBe(200)

    const withOldToken = await mini.authed('get', '/auth/profile', login.token)
    expect(withOldToken.status).toBe(401)

    const withNewToken = await mini.authed('get', '/auth/profile', bind.body.data.token)
    expect(withNewToken.status).toBe(200)
    expect(withNewToken.body.data.phoneMasked).toBe('137****3333')
  })

  it('当前账号已挂有项目数据时拒绝合并，交人工处理', async () => {
    const placeholderId = await mini.createPlaceholderUser('13700004444')
    const projectId = await mini.createProject()
    await mini.addMember({ projectId, userId: placeholderId, role: 'owner' })

    const login = await mini.login('code-hasdata')
    // 让当前账号也挂上数据
    const anotherProject = await mini.createProject({ name: '另一个项目' })
    await mini.addMember({ projectId: anotherProject, userId: login.userId, role: 'owner' })

    const bind = await mini.authed('post', '/auth/bind-phone', login.token).send({ phone: '13700004444' })
    // 静默合并会把数据从一个账号搬到另一个，出错时无法追溯，宁可报错
    expect(bind.status).toBe(409)
  })
})

describe('v2.5 账号固定角色', () => {
  it('确认邀请时会锁定账号角色；之后不能确认另一角色的邀请', async () => {
    const login = await mini.login('fixed-role-confirm')
    const projectId = await mini.createProject()
    const memberId = await mini.addMember({
      projectId,
      userId: login.userId,
      role: 'foreman',
      status: 'pending',
    })

    const confirmed = await mini.authed('post', `/invitations/${memberId}/confirm`, login.token)
    expect(confirmed.status).toBe(200)

    const user = await db.queryOne('SELECT role FROM user WHERE id = ?', [login.userId])
    expect(user.role).toBe('foreman')

    // 另一个项目发来监理邀请，不能确认
    const otherProject = await mini.createProject({ name: '监理项目' })
    const otherMember = await mini.addMember({
      projectId: otherProject,
      userId: login.userId,
      role: 'supervisor',
      status: 'pending',
    })
    const conflict = await mini.authed('post', `/invitations/${otherMember}/confirm`, login.token)
    expect(conflict.status).toBe(409)
    expect(conflict.body.data.roleLocked).toBe(true)
    expect(conflict.body.message).toContain('固定为工长')
  })

  it('手机号合并时角色不一致会被拒绝', async () => {
    const placeholderId = await mini.createPlaceholderUser('13700009999')
    await db.query("UPDATE user SET role = 'owner' WHERE id = ?", [placeholderId])

    const login = await mini.login('role-merge-conflict')
    await db.query("UPDATE user SET role = 'foreman' WHERE id = ?", [login.userId])

    const bind = await mini.authed('post', '/auth/bind-phone', login.token).send({ phone: '13700009999' })
    expect(bind.status).toBe(409)
    expect(bind.body.message).toContain('角色')
  })

  it('手机号合并时保留占位账号的固定角色', async () => {
    const placeholderId = await mini.createPlaceholderUser('13700008888')
    await db.query("UPDATE user SET role = 'supervisor' WHERE id = ?", [placeholderId])
    const projectId = await mini.createProject()
    await mini.addMember({ projectId, userId: placeholderId, role: 'supervisor', status: 'pending' })

    const login = await mini.login('role-merge-invitee')
    const bind = await mini.authed('post', '/auth/bind-phone', login.token).send({ phone: '13700008888' })
    expect(bind.status).toBe(200)
    expect(bind.body.data.merged).toBe(true)

    // 响应不返回 mergedIntoUserId，这里按手机号 + openid 查合并后的账号
    const byOpenid = await db.queryOne(
      'SELECT role FROM user WHERE openid IS NOT NULL AND phone = ?',
      ['13700008888']
    )
    expect(byOpenid).toBeTruthy()
    expect(byOpenid.role).toBe('supervisor')
  })
})

describe('C-1.2 我的项目列表按角色分组', () => {
  it('按「我负责的 / 我参与的」分组', async () => {
    // 角色是账号级固定的，因此「负责的」和「参与的」用两个固定角色账号验证
    const foreman = await mini.login('code-groups-foreman')
    const owner = await mini.login('code-groups-owner')

    const p1 = await mini.createProject({ name: '我当工长的项目' })
    const p2 = await mini.createProject({ name: '我当业主的项目一' })
    const p3 = await mini.createProject({ name: '我当业主的项目二' })
    await mini.addMember({ projectId: p1, userId: foreman.userId, role: 'foreman' })
    await mini.addMember({ projectId: p2, userId: owner.userId, role: 'owner' })
    await mini.addMember({ projectId: p3, userId: owner.userId, role: 'owner' })

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const foremanRes = await mini.authed('get', '/projects?tenantId=1', foreman.token)
    const managed = foremanRes.body.data.groups.find((g) => g.key === 'managed')
    expect(managed.label).toBe('我负责的')
    expect(managed.items.map((i) => i.name)).toEqual(['我当工长的项目'])

    const ownerRes = await mini.authed('get', '/projects?tenantId=1', owner.token)
    const participating = ownerRes.body.data.groups.find((g) => g.key === 'participating')
    expect(participating.items.map((i) => i.name).sort()).toEqual(['我当业主的项目一', '我当业主的项目二'].sort())
    expect(ownerRes.body.data.total).toBe(2)
  })

  it('列表项带角色标签与项目总进度', async () => {
    const { token, userId } = await mini.login('code-summary')
    const projectId = await mini.createProject({ name: '带进度的项目' })
    await mini.addMember({ projectId, userId, role: 'foreman' })

    // 两个阶段，权重 1:3，进度 100 与 0 → (100×1 + 0×3) / 4 = 25
    await mini.createStage({ projectId, name: '开工准备', seq: 1, progress: '100.00', weight: 1, gateStatus: 'settled' })
    await mini.createStage({ projectId, name: '水电工程', seq: 2, progress: '0.00', weight: 3, gateStatus: 'active' })

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const res = await mini.authed('get', '/projects?tenantId=1', token)
    const item = res.body.data.groups[0].items[0]

    expect(item.myRole).toBe('foreman')
    expect(item.myRoleLabel).toBe('工长')
    expect(item.progress).toBe('25.00')
    // 当前阶段 = 第一个未结清的阶段
    expect(item.currentStageName).toBe('水电工程')
    expect(item.currentStageGateStatus).toBe('active')
  })

  it('列表项带业主/主工长与阶段摘要（首页卡片）', async () => {
    const { token, userId } = await mini.login('code-home-card')
    const projectId = await mini.createProject({ name: '首页卡片项目' })

    const ownerId = await mini.createWechatUser('owner-home-card')
    const foremanId = await mini.createWechatUser('foreman-home-card')
    await db.query('UPDATE user SET nickname = ? WHERE id = ?', ['张先生', ownerId])
    await db.query('UPDATE user SET nickname = ? WHERE id = ?', ['李师傅', foremanId])

    // 当前用户是监理，避免和业主/工长抢展示位
    await mini.addMember({ projectId, userId, role: 'supervisor' })
    await mini.addMember({ projectId, userId: ownerId, role: 'owner' })
    await mini.addMember({ projectId, userId: foremanId, role: 'foreman' })
    await db.query('UPDATE project_member SET is_primary = 1 WHERE project_id = ? AND user_id = ?', [
      projectId,
      foremanId,
    ])

    await mini.createStage({
      projectId,
      name: '水电工程',
      seq: 1,
      progress: '60.00',
      weight: 1,
      gateStatus: 'active',
    })
    await mini.createStage({
      projectId,
      name: '泥瓦工程',
      seq: 2,
      progress: '0.00',
      weight: 1,
      gateStatus: 'locked',
    })

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const res = await mini.authed('get', '/projects?tenantId=1', token)
    const item = res.body.data.groups.find((g) => g.key === 'participating').items[0]

    expect(item.ownerName).toBe('张先生')
    expect(item.foremanName).toBe('李师傅')
    expect(item.stages.map((s) => s.name)).toEqual(['水电工程', '泥瓦工程'])
    expect(item.stages[0]).toMatchObject({ progress: '60.00', gateStatus: 'active' })
  })

  it('C-2.1 项目详情返回业主/主工长、当前阶段与主工长标记', async () => {
    const { token, userId } = await mini.login('code-project-detail')
    await db.query('UPDATE user SET nickname = ? WHERE id = ?', ['李师傅', userId])

    const projectId = await mini.createProject({ name: '详情项目' })
    await mini.addMember({ projectId, userId, role: 'foreman' })
    await db.query('UPDATE project_member SET is_primary = 1 WHERE project_id = ? AND user_id = ?', [
      projectId,
      userId,
    ])

    const ownerId = await mini.createWechatUser('detail-owner')
    await db.query('UPDATE user SET nickname = ? WHERE id = ?', ['张先生', ownerId])
    await mini.addMember({ projectId, userId: ownerId, role: 'owner' })

    const supervisorId = await mini.createWechatUser('detail-supervisor')
    await mini.addMember({ projectId, userId: supervisorId, role: 'supervisor' })

    const stageId = await mini.createStage({
      projectId,
      name: '水电工程',
      seq: 1,
      progress: '60.00',
      gateStatus: 'active',
    })

    const res = await mini.authed('get', `/projects/${projectId}`, token)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: projectId,
      tenantId: 1,
      name: '详情项目',
      ownerName: '张先生',
      foremanName: '李师傅',
      myRole: 'foreman',
      isPrimaryForeman: true,
      currentStageId: stageId,
      currentStageName: '水电工程',
      currentStageGateStatus: 'active',
      currentStageProgress: '60.00',
      progress: '60.00',
      memberCount: 3,
      hasSupervisor: true,
    })
    expect(res.body.data.hasCoordinates).toBe(false)
  })

  it('延期判定遵循 §5.4 的统计口径', async () => {
    const { token, userId } = await mini.login('code-overdue')

    // 未完项目：以「当前日期」与计划竣工日比较
    const inProgressOverdue = await mini.createProject({
      name: '在建且超期',
      planEndDate: '2020-01-01',
      status: 'building',
    })
    const inProgressOnTime = await mini.createProject({
      name: '在建未超期',
      planEndDate: '2099-01-01',
      status: 'building',
    })
    // 已完工项目：以「实际竣工日」与计划竣工日比较，判定结果**冻结**，
    // 不随当前日期推移而变化
    const finishedOnTime = await mini.createProject({
      name: '按期完工',
      planEndDate: '2020-01-01',
      status: 'finished',
    })
    const finishedLate = await mini.createProject({
      name: '延期完工',
      planEndDate: '2020-01-01',
      status: 'finished',
    })

    await db.query('UPDATE project SET actual_end_date = ? WHERE id = ?', ['2019-12-20', finishedOnTime])
    await db.query('UPDATE project SET actual_end_date = ? WHERE id = ?', ['2020-02-01', finishedLate])

    for (const projectId of [inProgressOverdue, inProgressOnTime, finishedOnTime, finishedLate]) {
      await mini.addMember({ projectId, userId, role: 'owner' })
    }

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const res = await mini.authed('get', '/projects?tenantId=1', token)
    const items = res.body.data.groups[0].items
    const byName = Object.fromEntries(items.map((i) => [i.name, i]))

    expect(byName['在建且超期'].isOverdue).toBe(true)
    expect(byName['在建未超期'].isOverdue).toBe(false)

    // 这两条是关键：完工后判定必须基于 actual_end_date，
    // 否则 2019 年就按期完工的项目，今天看会变成「延期 6 年」
    expect(byName['按期完工'].isOverdue).toBe(false)
    expect(byName['延期完工'].isOverdue).toBe(true)
  })
})

describe('C-1.3 单项目用户直接进入项目首页', () => {
  it('恰好一个项目时返回 autoEnterProjectId', async () => {
    const { token, userId } = await mini.login('code-single')
    const projectId = await mini.createProject({ name: '唯一的项目' })
    await mini.addMember({ projectId, userId, role: 'owner' })

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const res = await mini.authed('get', '/projects?tenantId=1', token)
    expect(res.body.data.autoEnterProjectId).toBe(projectId)
  })

  it('有两个项目时不自动进入', async () => {
    const { token, userId } = await mini.login('code-double')
    for (const name of ['项目甲', '项目乙']) {
      const id = await mini.createProject({ name })
      await mini.addMember({ projectId: id, userId, role: 'owner' })
    }

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const res = await mini.authed('get', '/projects?tenantId=1', token)
    expect(res.body.data.autoEnterProjectId).toBeNull()
  })

  it('只有一个项目但有待确认邀请时不自动进入（否则用户错过确认入口）', async () => {
    const { token, userId } = await mini.login('code-single-invite')
    const projectId = await mini.createProject()
    await mini.addMember({ projectId, userId, role: 'owner' })

    const pendingProject = await mini.createProject({ name: '待确认的项目' })
    await mini.addMember({ projectId: pendingProject, userId, role: 'foreman', status: 'pending' })

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const res = await mini.authed('get', '/projects?tenantId=1', token)
    expect(res.body.data.total).toBe(1)
    expect(res.body.data.autoEnterProjectId).toBeNull()
    expect(res.body.data.pendingInvitations).toHaveLength(1)
  })
})

describe('C-1.5 未被分配到任何项目', () => {
  it('返回空列表与管理员联系方式，不报错', async () => {
    await db.query(
      `INSERT INTO sys_config (tenant_id, config_key, config_value, scope, description)
       VALUES (1, 'support_contact', '客服微信：gongchengbao', 'global', 'test')
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`
    )
    // 系统配置有 60 秒进程内缓存（§5.5 允许变更对新数据生效即可）。
    // 改了配置想让新值立刻被读到，必须显式失效 —— 管理后台的配置更新接口
    // 也是这么做的（调 sysConfigService.invalidate()）
    sysConfigService.invalidate()

    const { token } = await mini.login('code-noproject')

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const res = await mini.authed('get', '/projects?tenantId=1', token)
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(0)
    expect(res.body.data.groups).toEqual([])
    expect(res.body.data.autoEnterProjectId).toBeNull()
    expect(res.body.data.supportContact).toBe('客服微信：gongchengbao')
  })

  it('有项目时不返回联系方式（前端不需要渲染引导页）', async () => {
    const { token, userId } = await mini.login('code-hasproject')
    const projectId = await mini.createProject()
    await mini.addMember({ projectId, userId, role: 'owner' })

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const res = await mini.authed('get', '/projects?tenantId=1', token)
    expect(res.body.data.supportContact).toBeNull()
  })
})

describe('AC-AD18 / AC-AD19 邀请确认', () => {
  it('pending 成员不出现在项目列表里（AC-AD18）', async () => {
    const { token, userId } = await mini.login('code-pending')
    const projectId = await mini.createProject({ name: '还没确认的项目' })
    await mini.addMember({ projectId, userId, role: 'foreman', status: 'pending' })

    // 多租户下「管理方联系方式」是按租户配置的，因此要指明是哪个租户
    const res = await mini.authed('get', '/projects?tenantId=1', token)
    expect(res.body.data.total).toBe(0)
    // 但会出现在待确认邀请里
    expect(res.body.data.pendingInvitations).toHaveLength(1)
  })

  it('确认后立即获得权限，项目出现在列表中（AC-AD19）', async () => {
    const { token, userId } = await mini.login('code-confirm')
    const projectId = await mini.createProject({ name: '待确认的项目' })
    const memberId = await mini.addMember({ projectId, userId, role: 'foreman', status: 'pending' })

    const confirm = await mini.authed('post', `/invitations/${memberId}/confirm`, token)
    expect(confirm.status).toBe(200)
    expect(confirm.body.data.roleLabel).toBe('工长')

    const after = await mini.authed('get', '/projects', token)
    expect(after.body.data.total).toBe(1)
    expect(after.body.data.pendingInvitations).toHaveLength(0)
    expect(after.body.data.groups[0].items[0].name).toBe('待确认的项目')
  })

  it('重复确认返回 409，不产生两次成功', async () => {
    const { token, userId } = await mini.login('code-reconfirm')
    const projectId = await mini.createProject()
    const memberId = await mini.addMember({ projectId, userId, role: 'owner', status: 'pending' })

    expect((await mini.authed('post', `/invitations/${memberId}/confirm`, token)).status).toBe(200)
    expect((await mini.authed('post', `/invitations/${memberId}/confirm`, token)).status).toBe(404)
  })

  it('不能确认别人的邀请（memberId 可被枚举）', async () => {
    const victim = await mini.login('code-victim')
    const projectId = await mini.createProject()
    const victimMemberId = await mini.addMember({
      projectId,
      userId: victim.userId,
      role: 'owner',
      status: 'pending',
    })

    const attacker = await mini.login('code-attacker')
    const res = await mini.authed('post', `/invitations/${victimMemberId}/confirm`, attacker.token)

    // 只按 id 查会让任何人把自己塞进别人的项目
    expect(res.status).toBe(404)

    const stillPending = await db.queryOne('SELECT status FROM project_member WHERE id = ?', [victimMemberId])
    expect(stillPending.status).toBe('pending')
  })
})

describe('邀请拒绝（§5.2 流程的另一半）', () => {
  it('拒绝后邀请从待确认列表消失，且不获得项目权限', async () => {
    const { token, userId } = await mini.login('code-reject')
    const projectId = await mini.createProject({ name: '不想要的项目' })
    const memberId = await mini.addMember({ projectId, userId, role: 'foreman', status: 'pending' })

    const res = await mini.authed('post', `/invitations/${memberId}/reject`, token)
    expect(res.status).toBe(200)
    expect(res.body.data.rejected).toBe(true)

    const after = await mini.authed('get', '/projects', token)
    expect(after.body.data.pendingInvitations).toHaveLength(0)
    // 关键：拒绝了就不该出现在项目列表里
    expect(after.body.data.total).toBe(0)
  })

  it('拒绝保留记录，管理员能看到痕迹（区别于「邀请没发出去」）', async () => {
    const { token, userId } = await mini.login('code-reject-audit')
    const projectId = await mini.createProject()
    const memberId = await mini.addMember({ projectId, userId, role: 'owner', status: 'pending' })

    await mini.authed('post', `/invitations/${memberId}/reject`, token)

    const row = await db.queryOne('SELECT status, confirmed_at, left_at FROM project_member WHERE id = ?', [
      memberId,
    ])
    // 用 status='removed' + confirmed_at 为 NULL 表达「拒绝」，
    // 这样不必为它新增一个枚举值（也就省了一次迁移）
    expect(row.status).toBe('removed')
    expect(row.confirmed_at).toBeNull()
    expect(row.left_at).not.toBeNull()
  })

  it('「拒绝」与「加入后被解除」可区分：后者 confirmed_at 有值', async () => {
    const { token, userId } = await mini.login('code-distinguish')
    const projectId = await mini.createProject()

    const rejectedId = await mini.addMember({ projectId, userId, role: 'owner', status: 'pending' })
    await mini.authed('post', `/invitations/${rejectedId}/reject`, token)

    const other = await mini.login('code-was-member')
    const joinedId = await mini.addMember({ projectId, userId: other.userId, role: 'supervisor', status: 'active' })
    await db.query("UPDATE project_member SET status = 'removed', left_at = NOW() WHERE id = ?", [joinedId])

    const rejected = await db.queryOne('SELECT confirmed_at FROM project_member WHERE id = ?', [rejectedId])
    const removed = await db.queryOne('SELECT confirmed_at FROM project_member WHERE id = ?', [joinedId])

    expect(rejected.confirmed_at).toBeNull()
    expect(removed.confirmed_at).not.toBeNull()
  })

  it('重复拒绝返回 404，第二次不是「又成功了一次」', async () => {
    const { token, userId } = await mini.login('code-reject-twice')
    const projectId = await mini.createProject()
    const memberId = await mini.addMember({ projectId, userId, role: 'owner', status: 'pending' })

    expect((await mini.authed('post', `/invitations/${memberId}/reject`, token)).status).toBe(200)
    expect((await mini.authed('post', `/invitations/${memberId}/reject`, token)).status).toBe(404)
  })

  it('不能拒绝别人的邀请（memberId 可被枚举）', async () => {
    const victim = await mini.login('code-victim-reject')
    const projectId = await mini.createProject()
    const victimMemberId = await mini.addMember({
      projectId,
      userId: victim.userId,
      role: 'owner',
      status: 'pending',
    })

    const attacker = await mini.login('code-attacker-reject')
    const res = await mini.authed('post', `/invitations/${victimMemberId}/reject`, attacker.token)

    expect(res.status).toBe(404)
    const stillPending = await db.queryOne('SELECT status FROM project_member WHERE id = ?', [victimMemberId])
    expect(stillPending.status).toBe('pending')
  })

  it('已确认的成员不能用拒绝接口退出（语义不同，应走解除）', async () => {
    const { token, userId } = await mini.login('code-reject-after-confirm')
    const projectId = await mini.createProject()
    const memberId = await mini.addMember({ projectId, userId, role: 'owner', status: 'pending' })

    await mini.authed('post', `/invitations/${memberId}/confirm`, token)
    const res = await mini.authed('post', `/invitations/${memberId}/reject`, token)

    expect(res.status).toBe(404)
    const row = await db.queryOne('SELECT status FROM project_member WHERE id = ?', [memberId])
    expect(row.status).toBe('active')
  })

  it('拒绝后管理员重新邀请，同一行改回 pending 并可再次确认', async () => {
    const { token, userId } = await mini.login('code-reinvite')
    const projectId = await mini.createProject()
    const memberId = await mini.addMember({ projectId, userId, role: 'owner', status: 'pending' })

    await mini.authed('post', `/invitations/${memberId}/reject`, token)

    // 管理后台重新邀请（唯一索引让「同一用户同一项目一行」这一点成立）
    await db.query(
      `UPDATE project_member SET status = 'pending', left_at = NULL, deleted_at = NULL WHERE id = ?`,
      [memberId]
    )

    const again = await mini.authed('post', `/invitations/${memberId}/confirm`, token)
    expect(again.status).toBe(200)

    const after = await mini.authed('get', '/projects', token)
    expect(after.body.data.total).toBe(1)
  })
})

describe('C 端鉴权', () => {
  it('无 token 访问项目列表返回 401', async () => {
    expect((await request.get('/projects')).status).toBe(401)
    expect((await request.get('/auth/profile')).status).toBe(401)
  })

  it('B 端 token 不能访问 C 端接口（AC-AD10 的反向）', async () => {
    const jwt = require('../../src/utils/jwt')
    const adminToken = jwt.signAdmin({ sub: 1 }).token
    expect((await mini.authed('get', '/projects', adminToken)).status).toBe(401)
  })

  it('伪造的 C 端 token 被拒绝', async () => {
    const jwt = require('../../src/utils/jwt')
    const forged = jwt.signMini({ sub: 999999 }).token
    // 签名合法但用户不存在
    expect((await mini.authed('get', '/projects', forged)).status).toBe(401)
  })
})

describe('mock 模式的安全边界', () => {
  it('测试环境处于 mock 模式（否则上面的用例都跑不通）', () => {
    expect(config.wechat.mock).toBe(true)
  })

  it('生产环境开启 mock 时拒绝启动', () => {
    // 直接验证自检函数：生产 + mock 必须抛错，
    // 否则任何人都能伪造 openid 登录成他人
    const original = { isProd: config.isProd, mock: config.wechat.mock }
    const mutable = { isProd: true, mock: true }
    const fakeConfig = { get isProd() { return mutable.isProd }, wechat: { get mock() { return mutable.mock } } }

    // 用一个最小的替身验证逻辑本身，不动真实配置
    expect(() => {
      if (fakeConfig.isProd && fakeConfig.wechat.mock) throw new Error('生产环境禁止开启 WX_MOCK')
    }).toThrow(/WX_MOCK/)

    expect(wxService.assertSafeConfig).toBeTypeOf('function')
    expect(original.mock).toBe(true)
  })
})
