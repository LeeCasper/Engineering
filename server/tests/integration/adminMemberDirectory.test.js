'use strict'

/**
 * 管理端「成员」tab 的跨项目成员目录。
 *
 * 这个接口把 project_member 聚合到了租户 / 项目管理员可见的全部项目上，
 * 因此测试重点不是分页本身，而是：
 * 1. 数据权限必须复用 dataScope —— 否则能搜到未授权项目的成员手机号；
 * 2. 已移除成员不出现在目录里，pending 仍然出现（管理员要知道邀请发没发出去）；
 * 3. 角色计数忽略角色筛选，但跟随关键词与项目范围；
 * 4. 手机号只返回脱敏值。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const datetime = require('../../src/utils/datetime')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
const auth = require('./helpers/auth')
const fixtures = require('./helpers/fixtures')

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
})

const TODAY = datetime.formatDate()
const YESTERDAY = datetime.now().subtract(1, 'day').format('YYYY-MM-DD')
const TOMORROW = datetime.now().add(1, 'day').format('YYYY-MM-DD')

function projectPayload(name, overrides = {}) {
  return {
    name,
    address: '上海市浦东新区世纪大道 100 号',
    contractAmount: '200000.00',
    startDate: YESTERDAY,
    planEndDate: TOMORROW,
    ...overrides,
  }
}

async function ownerLogin(username = 'directory-owner') {
  return auth.createAndLogin({ username, role: 'owner' })
}

async function createProject(token, templateId, name, overrides = {}) {
  const res = await request
    .authed('post', '/admin/projects', token)
    .send({ ...projectPayload(name, overrides), templateId })
  if (res.status !== 200) throw new Error(`创建项目失败：${res.status} ${res.text}`)
  return res.body.data.id
}

async function createUser(openid, { nickname = null, phone = null } = {}) {
  const result = await db.query('INSERT INTO user (openid, nickname, phone) VALUES (?, ?, ?)', [
    openid,
    nickname,
    phone,
  ])
  return result.insertId
}

async function addMember(projectId, userId, role, status = 'active', ownerType = null, isPrimary = 0) {
  await db.query(
    `INSERT INTO project_member
       (project_id, user_id, role, status, is_primary, owner_type, confirmed_at, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      userId,
      role,
      status,
      isPrimary ? 1 : 0,
      ownerType,
      status === 'active' ? datetime.format() : null,
      status === 'active' ? datetime.format() : null,
    ]
  )
}

async function getDirectory(token, query = '') {
  return request.authed('get', `/admin/members?${query}`, token)
}

describe('管理端跨项目成员目录', () => {
  it('空目录返回分页结构与全零角色计数', async () => {
    const { token } = await ownerLogin()
    const res = await getDirectory(token, 'page=1&pageSize=20')

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
      roleCounts: { all: 0, foreman: 0, supervisor: 0, owner: 0 },
    })
  })

  it('聚合可见项目的成员：排除已移除、保留待确认、返回项目归属与脱敏手机号', async () => {
    const { token } = await ownerLogin()
    const templateId = await fixtures.createTemplate()
    const projectA = await createProject(token, templateId, '阳光花园 · 演示项目')
    const projectB = await createProject(token, templateId, '江南里 · 住宅整装')

    const primaryForeman = await createUser('dir-foreman-primary', {
      nickname: '李师傅',
      phone: '13800138000',
    })
    const foreman = await createUser('dir-foreman', { nickname: '王师傅' })
    const supervisor = await createUser('dir-supervisor', { nickname: '王监理' })
    const primaryOwner = await createUser('dir-owner-primary', { nickname: '张先生' })
    const pendingOwner = await createUser('dir-owner-pending', { nickname: '陈女士' })
    const removed = await createUser('dir-owner-removed', { nickname: '已移除业主' })

    await addMember(projectA, foreman, 'foreman', 'active')
    await addMember(projectA, primaryForeman, 'foreman', 'active', null, 1)
    await addMember(projectA, supervisor, 'supervisor', 'active')
    await addMember(projectA, pendingOwner, 'owner', 'pending', 'temporary')
    await addMember(projectB, primaryOwner, 'owner', 'active', 'primary', 1)
    await addMember(projectB, removed, 'owner', 'removed')

    const res = await getDirectory(token, 'page=1&pageSize=50')
    const data = res.body.data

    expect(data.total).toBe(5)
    expect(data.roleCounts).toEqual({ all: 5, foreman: 2, supervisor: 1, owner: 2 })
    // 主工长 → 工长 → 监理 → 主业主 → 待确认业主
    expect(data.list.map((m) => m.nickname)).toEqual([
      '李师傅',
      '王师傅',
      '王监理',
      '张先生',
      '陈女士',
    ])
    expect(data.list[0]).toMatchObject({
      projectId: projectA,
      projectName: '阳光花园 · 演示项目',
      projectStatus: 'pending',
      role: 'foreman',
      roleLabel: '工长',
      isPrimaryForeman: true,
      status: 'active',
      statusLabel: '已加入',
      phoneMasked: '138****8000',
    })
    // 完整手机号绝不能出现在响应里
    expect(JSON.stringify(data)).not.toContain('13800138000')
    // 待确认成员仍在目录中（管理员要看到邀请状态）
    expect(data.list[4]).toMatchObject({
      status: 'pending',
      statusLabel: '待确认',
      projectId: projectA,
    })
    expect(data.list.some((m) => m.nickname === '已移除业主')).toBe(false)
  })

  it('归档项目的成员仍出现在目录，并带项目状态供前端标记只读', async () => {
    const { token } = await ownerLogin()
    const templateId = await fixtures.createTemplate()
    const projectId = await createProject(token, templateId, '已归档项目')
    await db.query(
      `UPDATE project SET status = 'archived', archived_at = ? WHERE id = ?`,
      [datetime.format(), projectId]
    )

    const user = await createUser('dir-archived-member', { nickname: '归档项目业主' })
    await addMember(projectId, user, 'owner', 'active', 'primary', 1)

    const res = await getDirectory(token, 'page=1&pageSize=20')
    expect(res.body.data.list).toHaveLength(1)
    expect(res.body.data.list[0]).toMatchObject({
      nickname: '归档项目业主',
      projectStatus: 'archived',
    })
  })

  it('关键词搜索覆盖姓名、手机号、项目名与角色词', async () => {
    const { token } = await ownerLogin()
    const templateId = await fixtures.createTemplate()
    const sunny = await createProject(token, templateId, '阳光花园')
    const riverside = await createProject(token, templateId, '江南里')

    const li = await createUser('dir-kw-li', { nickname: '李师傅', phone: '13900001111' })
    const wang = await createUser('dir-kw-wang', { nickname: '王监理', phone: '13700002222' })
    const chen = await createUser('dir-kw-chen', { nickname: '陈女士' })
    await addMember(sunny, li, 'foreman', 'active')
    await addMember(sunny, wang, 'supervisor', 'active')
    await addMember(riverside, chen, 'owner', 'active', 'primary', 1)

    const byName = await getDirectory(token, 'keyword=李')
    expect(byName.body.data.list.map((m) => m.nickname)).toEqual(['李师傅'])

    const byPhone = await getDirectory(token, 'keyword=13700002222')
    expect(byPhone.body.data.list.map((m) => m.nickname)).toEqual(['王监理'])

    const byProject = await getDirectory(token, 'keyword=江南里')
    expect(byProject.body.data.list.map((m) => m.nickname)).toEqual(['陈女士'])

    const byRole = await getDirectory(token, 'keyword=监理')
    expect(byRole.body.data.list.map((m) => m.nickname)).toEqual(['王监理'])

    // LIKE 通配符按字面匹配，一个 % 不能把全表捞出来
    const wildcard = await getDirectory(token, 'keyword=%')
    expect(wildcard.body.data.total).toBe(0)
  })

  it('角色筛选只影响列表，计数仍然给出全部角色', async () => {
    const { token } = await ownerLogin()
    const templateId = await fixtures.createTemplate()
    const projectId = await createProject(token, templateId, '角色筛选项目')

    const foreman = await createUser('dir-role-foreman', { nickname: '工长甲' })
    const supervisor = await createUser('dir-role-supervisor', { nickname: '监理乙' })
    const owner = await createUser('dir-role-owner', { nickname: '业主丙' })
    await addMember(projectId, foreman, 'foreman', 'active')
    await addMember(projectId, supervisor, 'supervisor', 'active')
    await addMember(projectId, owner, 'owner', 'active', 'primary', 1)

    const res = await getDirectory(token, 'role=foreman')
    expect(res.body.data.total).toBe(1)
    expect(res.body.data.list.map((m) => m.nickname)).toEqual(['工长甲'])
    expect(res.body.data.roleCounts).toEqual({
      all: 3,
      foreman: 1,
      supervisor: 1,
      owner: 1,
    })
  })

  it('项目管理员只能看到自己创建或被授权项目的成员', async () => {
    const owner = await ownerLogin('directory-scope-owner')
    const templateId = await fixtures.createTemplate()
    const adminA = await auth.createAndLogin({ username: 'directory-pm-a', role: 'admin' })
    const adminB = await auth.createAndLogin({ username: 'directory-pm-b', role: 'admin' })

    const projectA = await createProject(adminA.token, templateId, 'A 自己创建')
    const projectB = await createProject(adminB.token, templateId, 'B 授权给 A')
    const projectC = await createProject(adminB.token, templateId, 'C 未授权')
    await fixtures.grantProjectScope(adminA.admin.id, projectB, owner.admin.id)

    const memberA = await createUser('dir-scope-a', { nickname: 'A 项目成员' })
    const memberB = await createUser('dir-scope-b', { nickname: 'B 项目成员' })
    const memberC = await createUser('dir-scope-c', { nickname: 'C 项目成员' })
    await addMember(projectA, memberA, 'foreman', 'active')
    await addMember(projectB, memberB, 'owner', 'active', 'primary', 1)
    await addMember(projectC, memberC, 'owner', 'active', 'primary', 1)

    const listA = await getDirectory(adminA.token, 'page=1&pageSize=50')
    expect(listA.body.data.total).toBe(2)
    expect(listA.body.data.list.map((m) => m.nickname).sort()).toEqual([
      'A 项目成员',
      'B 项目成员',
    ])

    // 直接指定未授权项目 id 也不能绕过 scope
    const unauthorized = await getDirectory(adminA.token, `projectId=${projectC}`)
    expect(unauthorized.body.data.total).toBe(0)
    expect(unauthorized.body.data.roleCounts.all).toBe(0)

    const ownerList = await getDirectory(owner.token, 'page=1&pageSize=50')
    expect(ownerList.body.data.total).toBe(3)
  })

  it('成员目录不跨租户', async () => {
    const owner1 = await ownerLogin('directory-tenant-1')
    const template1 = await fixtures.createTemplate()
    const project1 = await createProject(owner1.token, template1, '租户1项目')
    const user1 = await createUser('dir-tenant-user-1', { nickname: '租户1成员' })
    await addMember(project1, user1, 'foreman', 'active')

    const tenant2 = await fixtures.createTenant({ name: '成员目录租户2' })
    const owner2 = await auth.createAndLogin({
      username: 'directory-tenant-2',
      role: 'owner',
      tenantId: tenant2,
    })
    const template2 = await fixtures.createTemplate({ tenantId: tenant2, createdBy: owner2.admin.id })
    const project2 = await createProject(owner2.token, template2, '租户2项目')
    const user2 = await createUser('dir-tenant-user-2', { nickname: '租户2成员' })
    await addMember(project2, user2, 'foreman', 'active')

    expect((await getDirectory(owner1.token)).body.data.list.map((m) => m.nickname)).toEqual([
      '租户1成员',
    ])
    expect((await getDirectory(owner2.token)).body.data.list.map((m) => m.nickname)).toEqual([
      '租户2成员',
    ])
  })

  it('跨项目目录按 AC-AD45 强制分页', async () => {
    const { token } = await ownerLogin()
    const templateId = await fixtures.createTemplate()
    const projectId = await createProject(token, templateId, '分页项目')

    for (let i = 1; i <= 3; i += 1) {
      const userId = await createUser(`dir-page-${i}`, { nickname: `成员${i}` })
      await addMember(projectId, userId, 'foreman', 'active')
    }

    const first = await getDirectory(token, 'page=1&pageSize=1')
    expect(first.body.data).toMatchObject({ total: 3, page: 1, pageSize: 1, totalPages: 3 })
    expect(first.body.data.list).toHaveLength(1)

    const second = await getDirectory(token, 'page=2&pageSize=1')
    expect(second.body.data.list).toHaveLength(1)
    expect(second.body.data.list[0].id).not.toBe(first.body.data.list[0].id)

    // 超过上限被钳制到 50，而不是报错
    const capped = await getDirectory(token, 'page=1&pageSize=200')
    expect(capped.body.data.pageSize).toBe(50)
  })

  it('项目范围筛选与角色计数跟随同一项目', async () => {
    const { token } = await ownerLogin()
    const templateId = await fixtures.createTemplate()
    const projectA = await createProject(token, templateId, '范围项目 A')
    const projectB = await createProject(token, templateId, '范围项目 B')

    const memberA1 = await createUser('dir-scope-1', { nickname: 'A 工长' })
    const memberA2 = await createUser('dir-scope-2', { nickname: 'A 业主' })
    const memberB1 = await createUser('dir-scope-3', { nickname: 'B 监理' })
    await addMember(projectA, memberA1, 'foreman', 'active')
    await addMember(projectA, memberA2, 'owner', 'active', 'primary', 1)
    await addMember(projectB, memberB1, 'supervisor', 'active')

    const res = await getDirectory(token, `projectId=${projectA}`)
    expect(res.body.data.total).toBe(2)
    expect(res.body.data.roleCounts).toEqual({ all: 2, foreman: 1, supervisor: 0, owner: 1 })
  })
})
