'use strict'

/**
 * 管理端项目概览统计（工作台 / 状态筛选计数）。
 *
 * 重点不是数字本身，而是三件事：
 * 1. /stats 不能被 /:id 抢先匹配；
 * 2. 所有聚合都必须复用 dataScope，项目管理员不能看到未授权项目；
 * 3. 延期口径必须与列表卡片的 isOverdue 完全一致（按天、归档排除）。
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

async function ownerLogin() {
  return auth.createAndLogin({ username: 'stats-owner', role: 'owner' })
}

async function createProject(token, templateId, name, overrides = {}) {
  const res = await request
    .authed('post', '/admin/projects', token)
    .send({ ...projectPayload(name, overrides), templateId })
  if (res.status !== 200) throw new Error(`创建项目失败：${res.status} ${res.text}`)
  return res.body.data.id
}

async function setProject(id, fields) {
  const keys = Object.keys(fields)
  await db.query(
    `UPDATE project SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map((key) => fields[key]), id]
  )
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

async function addAcceptance(projectId, status, submitterId) {
  await db.query(
    `INSERT INTO acceptance (project_id, type, status, submitter_id)
     VALUES (?, 'stage', ?, ?)`,
    [projectId, status, submitterId]
  )
}

async function getStats(token) {
  return request.authed('get', '/admin/projects/stats', token)
}

describe('管理端项目统计', () => {
  it('GET /admin/projects/stats 不会被 /:id 捕获', async () => {
    const { token } = await ownerLogin()
    const res = await getStats(token)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({
      total: 0,
      statusCounts: { pending: 0, building: 0, finished: 0, archived: 0 },
      overdue: 0,
      pendingAcceptance: 0,
      pendingInvitations: 0,
    })
  })

  it('统计四种状态、待验收与待确认邀请（归档项目不计入待办）', async () => {
    const { token } = await ownerLogin()
    const templateId = await fixtures.createTemplate()
    const ids = [
      await createProject(token, templateId, '待开工项目'),
      await createProject(token, templateId, '施工中项目'),
      await createProject(token, templateId, '已完工项目'),
      await createProject(token, templateId, '已归档项目'),
    ]

    await setProject(ids[1], { status: 'building' })
    await setProject(ids[2], { status: 'finished', actual_end_date: TODAY })
    await setProject(ids[3], { status: 'archived', archived_at: datetime.format() })

    const submitterId = await createUser('stats-submitter')
    await addAcceptance(ids[0], 'pending_supervisor', submitterId)
    await addAcceptance(ids[1], 'pending_owner', submitterId)
    await addAcceptance(ids[2], 'pending_rectify', submitterId)
    await addAcceptance(ids[3], 'pending_owner', submitterId) // 归档项目，不计入

    const pendingOne = await createUser('stats-pending-1')
    const pendingTwo = await createUser('stats-pending-2')
    const removed = await createUser('stats-removed')
    const archivedPending = await createUser('stats-archived-pending')
    await addMember(ids[0], pendingOne, 'owner', 'pending')
    await addMember(ids[1], pendingTwo, 'foreman', 'pending')
    await addMember(ids[2], removed, 'owner', 'removed')
    await addMember(ids[3], archivedPending, 'owner', 'pending') // 归档项目，不计入

    const res = await getStats(token)
    expect(res.body.data).toMatchObject({
      total: 4,
      statusCounts: { pending: 1, building: 1, finished: 1, archived: 1 },
      overdue: 0,
      pendingAcceptance: 2,
      pendingInvitations: 2,
    })
  })

  it('延期口径与 isOverdue 一致：按天比较，归档排除，完工按实际竣工日冻结', async () => {
    const { token } = await ownerLogin()
    const templateId = await fixtures.createTemplate()
    const ids = []
    for (let i = 0; i < 5; i += 1) {
      ids.push(await createProject(token, templateId, `延期口径项目${i + 1}`))
    }

    // 1) 施工中，计划昨天 → 延期
    await setProject(ids[0], { status: 'building', plan_end_date: YESTERDAY })
    // 2) 施工中，计划今天 → 不延期
    await setProject(ids[1], { status: 'building', plan_end_date: TODAY })
    // 3) 已归档，计划昨天 → 排除
    await setProject(ids[2], {
      status: 'archived',
      plan_end_date: YESTERDAY,
      archived_at: datetime.format(),
    })
    // 4) 已完工，实际竣工日 <= 计划日 → 不延期
    await setProject(ids[3], {
      status: 'finished',
      plan_end_date: YESTERDAY,
      actual_end_date: YESTERDAY,
    })
    // 5) 已完工，实际竣工日 > 计划日 → 延期（判定冻结）
    await setProject(ids[4], {
      status: 'finished',
      plan_end_date: YESTERDAY,
      actual_end_date: TODAY,
    })

    const res = await getStats(token)
    expect(res.body.data.overdue).toBe(2)
    expect(res.body.data.total).toBe(5)
  })

  it('项目管理员只统计自己创建或被授权的项目', async () => {
    const owner = await ownerLogin()
    const templateId = await fixtures.createTemplate()
    const adminA = await auth.createAndLogin({ username: 'stats-pm-a', role: 'admin' })
    const adminB = await auth.createAndLogin({ username: 'stats-pm-b', role: 'admin' })

    const projectA = await createProject(adminA.token, templateId, 'A 自己创建')
    const projectB = await createProject(adminB.token, templateId, 'B 授权给 A')
    const projectC = await createProject(adminB.token, templateId, 'C 未授权')

    await fixtures.grantProjectScope(adminA.admin.id, projectB, owner.admin.id)

    const submitterId = await createUser('stats-scope-submitter')
    await addAcceptance(projectC, 'pending_owner', submitterId)
    const pendingUser = await createUser('stats-scope-pending')
    await addMember(projectC, pendingUser, 'owner', 'pending')

    const statsA = await getStats(adminA.token)
    expect(statsA.body.data.total).toBe(2)
    expect(statsA.body.data.statusCounts.pending).toBe(2)
    // 未授权项目的待验收 / 待确认邀请不能被算进 A 的概览
    expect(statsA.body.data.pendingAcceptance).toBe(0)
    expect(statsA.body.data.pendingInvitations).toBe(0)

    const statsOwner = await getStats(owner.token)
    expect(statsOwner.body.data.total).toBe(3)
    expect(statsOwner.body.data.pendingAcceptance).toBe(1)
    expect(statsOwner.body.data.pendingInvitations).toBe(1)

    // A 的列表里同样只有 A + B
    const listA = await request.authed('get', '/admin/projects?page=1&pageSize=50', adminA.token)
    expect(listA.body.data.list.map((p) => p.id).sort((a, b) => a - b)).toEqual(
      [projectA, projectB].sort((a, b) => a - b)
    )
  })

  it('统计不跨租户', async () => {
    const owner1 = await ownerLogin()
    const template1 = await fixtures.createTemplate()
    await createProject(owner1.token, template1, '租户1项目')

    const tenant2 = await fixtures.createTenant({ name: '统计租户2' })
    const owner2 = await auth.createAndLogin({
      username: 'stats-owner-2',
      role: 'owner',
      tenantId: tenant2,
    })
    const template2 = await fixtures.createTemplate({ tenantId: tenant2, createdBy: owner2.admin.id })
    await createProject(owner2.token, template2, '租户2项目')

    expect((await getStats(owner1.token)).body.data.total).toBe(1)
    expect((await getStats(owner2.token)).body.data.total).toBe(1)
  })

  it('列表返回主工长 / 主业主展示名，缺成员时回落到待分配', async () => {
    const { token } = await ownerLogin()
    const templateId = await fixtures.createTemplate()
    const projectId = await createProject(token, templateId, '展示名项目')

    const primaryForeman = await createUser('stats-name-foreman', { nickname: '王工长' })
    const otherForeman = await createUser('stats-name-foreman-2', { nickname: '李工长' })
    const primaryOwner = await createUser('stats-name-owner', { nickname: '张先生' })
    const temporaryOwner = await createUser('stats-name-owner-2', { nickname: '李女士' })
    await addMember(projectId, otherForeman, 'foreman', 'active', null, 0)
    await addMember(projectId, primaryForeman, 'foreman', 'active', null, 1)
    await addMember(projectId, temporaryOwner, 'owner', 'active', 'temporary', 0)
    await addMember(projectId, primaryOwner, 'owner', 'active', 'primary', 1)

    const list = await request.authed('get', '/admin/projects?page=1&pageSize=50', token)
    const item = list.body.data.list.find((p) => p.id === projectId)
    expect(item.foremanName).toBe('王工长')
    expect(item.ownerName).toBe('张先生')

    // 无昵称时用脱敏手机号，绝不回显完整号码
    const phoneOnlyProject = await createProject(token, templateId, '只有手机号项目')
    const phoneOwner = await createUser('stats-name-phone', { phone: '13800138000' })
    await addMember(phoneOnlyProject, phoneOwner, 'owner', 'active', 'primary', 1)
    const list2 = await request.authed('get', '/admin/projects?page=1&pageSize=50', token)
    const phoneItem = list2.body.data.list.find((p) => p.id === phoneOnlyProject)
    expect(phoneItem.ownerName).toBe('138****8000')

    const emptyProject = await createProject(token, templateId, '无成员项目')
    const list3 = await request.authed('get', '/admin/projects?page=1&pageSize=50', token)
    const emptyItem = list3.body.data.list.find((p) => p.id === emptyProject)
    expect(emptyItem.ownerName).toBe('待分配')
    expect(emptyItem.foremanName).toBe('待分配')
  })
})
