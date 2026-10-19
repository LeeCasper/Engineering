'use strict'

/**
 * C 端消息中心集成测试（C-5.3 / AC-U06 ~ AC-U10）。
 *
 * 消息由 `notificationService.notify` 写入，而不是直接 INSERT ——
 * 这样测的是**真实的写读闭环**：写侧用的 type 枚举与读侧能筛出来的
 * 必须是同一套。手工造数据会让这两侧各自「自洽」，而它们之间的
 * 不一致（例如枚举串号）恰恰是本项目踩过的坑（CLAUDE.md 第 31 条）。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
const notificationService = require('../../src/services/notification.service')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')
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

let codeSeq = 0
/** 建一个已登录的 C 端用户，返回 { token, userId } */
async function setupUser(prefix = 'notif') {
  codeSeq += 1
  const login = await mini.login(`${prefix}-${codeSeq}`)
  return { token: login.token, userId: login.userId }
}

/** 通过真实写侧路径造消息 */
async function seedMessages(userId, { projectId = null } = {}) {
  const base = { userId, projectId, refType: 'report', refId: 123 }

  await notificationService.notify({ ...base, type: 'acceptance', title: '验收单待处理', content: '有一条验收单等你确认' })
  await notificationService.notify({ ...base, type: 'progress', title: '新进度汇报', content: '工长提交了水电改造' })
  await notificationService.notify({ ...base, type: 'payment', title: '付款提醒', content: '第二期款到期' })
  await notificationService.notify({ ...base, type: 'comment', title: '有人回复了你', content: '业主：这里要改' })
  await notificationService.notify({ ...base, type: 'system', title: '系统通知', content: '维护公告' })
}

describe('AC-U06 消息中心覆盖四类消息，分类筛选准确', () => {
  it('四类消息各自可被准确筛出，互不混入', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    const expectations = {
      acceptance: '验收单待处理',
      progress: '新进度汇报',
      payment: '付款提醒',
      comment: '有人回复了你',
      system: '系统通知',
    }

    for (const [type, title] of Object.entries(expectations)) {
      const res = await request.authed('get', `/notifications?type=${type}`, token)

      expect(res.status).toBe(200)
      expect(res.body.data.list).toHaveLength(1)
      expect(res.body.data.list[0].type).toBe(type)
      expect(res.body.data.list[0].title).toBe(title)
      expect(res.body.data.total).toBe(1)
    }
  })

  it('不传 type 时返回全部消息（含 system）', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    const res = await request.authed('get', '/notifications', token)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(5)
    expect(new Set(res.body.data.list.map((n) => n.type)).size).toBe(5)
  })

  it('未知的分类名返回 400，而不是「查不到所以列表为空」', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    const res = await request.authed('get', '/notifications?type=notexist', token)

    // 放行的话 type 是 ENUM 列，MySQL 对越界值不报错、只是匹配不到任何行，
    // 用户会以为「这一类消息没有」，而实际是分类名写错了
    expect(res.status).toBe(400)
  })

  it('分页生效且列表按时间倒序（最新的在最前）', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    const first = await request.authed('get', '/notifications?pageSize=2&page=1', token)
    const second = await request.authed('get', '/notifications?pageSize=2&page=2', token)

    expect(first.body.data.list).toHaveLength(2)
    expect(first.body.data.total).toBe(5)
    expect(first.body.data.totalPages).toBe(3)
    expect(second.body.data.list).toHaveLength(2)

    const ids = [...first.body.data.list, ...second.body.data.list].map((n) => n.id)
    expect(ids).toEqual([...ids].sort((a, b) => b - a))
  })

  it('只返回本人的消息，看不到别人的', async () => {
    const a = await setupUser('a')
    const b = await setupUser('b')
    await seedMessages(a.userId, {})

    await notificationService.notify({ userId: b.userId, type: 'system', title: 'B 的消息' })

    const res = await request.authed('get', '/notifications', a.token)
    expect(res.body.data.total).toBe(5)
    expect(res.body.data.list.some((n) => n.title === 'B 的消息')).toBe(false)
  })
})

describe('AC-U07 红点数量等于未读消息数', () => {
  it('未读汇总的分类值与列表逐类核对一致', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    const res = await request.authed('get', '/notifications/unread-count', token)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(5)
    // 四类 + system 全部出现，且没有未读的分类补 0 而不是缺键 ——
    // 缺键与 0 在前端是两种渲染（undefined 角标 vs 不显示角标）
    expect(res.body.data.byType).toEqual({
      acceptance: 1,
      progress: 1,
      payment: 1,
      comment: 1,
      system: 1,
    })
  })

  it('没有未读时各分类均为 0 而不是缺键', async () => {
    const { token } = await setupUser()

    const res = await request.authed('get', '/notifications/unread-count', token)
    expect(res.body.data).toEqual({
      total: 0,
      byType: { acceptance: 0, progress: 0, payment: 0, comment: 0, system: 0 },
    })
  })

  it('读完之后红点归零', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    await request.authed('post', '/notifications/read', token).send({})

    const res = await request.authed('get', '/notifications/unread-count', token)
    expect(res.body.data.total).toBe(0)
  })

  it('列表返回的 unread 是**全局**未读数，不随分类筛选变化', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    // 若这里返回的是「当前筛选下的未读数」，用户切到「评论」分类时红点
    // 会从 5 变成 1，看起来像消息被吞了。红点回答的是「我有多少条没看」，
    // 与「我正在看哪一类」无关
    const all = await request.authed('get', '/notifications', token)
    const filtered = await request.authed('get', '/notifications?type=comment', token)

    expect(all.body.data.unread).toBe(5)
    expect(filtered.body.data.unread).toBe(5)
    expect(filtered.body.data.total).toBe(1)
  })
})

describe('AC-U08 点击消息可跳转至对应业务详情页', () => {
  it('返回跳转所需的 refType / refId / projectId', async () => {
    const { token, userId } = await setupUser()
    const projectId = await mini.createProject({ name: '跳转项目', createdBy: 1 })

    await notificationService.notify({
      userId,
      type: 'acceptance',
      title: '验收单待处理',
      projectId,
      refType: 'acceptance',
      refId: 456,
    })

    const res = await request.authed('get', '/notifications', token)
    const item = res.body.data.list[0]

    expect(item.refType).toBe('acceptance')
    expect(item.refId).toBe(456)
    expect(item.projectId).toBe(projectId)
  })

  it('按项目筛选只返回该项目的消息（消息中心按当前项目查看）', async () => {
    const { token, userId } = await setupUser()
    const p1 = await mini.createProject({ name: '项目一', createdBy: 1 })
    const p2 = await mini.createProject({ name: '项目二', createdBy: 1 })

    await notificationService.notify({ userId, type: 'progress', title: '项目一的消息', projectId: p1 })
    await notificationService.notify({ userId, type: 'progress', title: '项目二的消息', projectId: p2 })

    const res = await request.authed('get', `/notifications?projectId=${p1}`, token)

    expect(res.body.data.total).toBe(1)
    expect(res.body.data.list[0].title).toBe('项目一的消息')
  })
})

describe('AC-U09 单条已读与全部已读', () => {
  it('单条已读只影响该条，红点同步减少', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    const list = await request.authed('get', '/notifications', token)
    const target = list.body.data.list.find((n) => n.type === 'comment')

    const res = await request.authed('post', '/notifications/read', token).send({ ids: [target.id] })

    expect(res.status).toBe(200)
    expect(res.body.data.affected).toBe(1)
    // 响应里直接带最新未读数：AC-U09 要求「操作后红点同步更新」，
    // 让前端再查一次会在往返窗口里显示旧值
    expect(res.body.data.unread).toBe(4)
  })

  it('全部已读把本人所有未读一次清空', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    const res = await request.authed('post', '/notifications/read', token).send({})

    expect(res.body.data.affected).toBe(5)
    expect(res.body.data.unread).toBe(0)
  })

  it('重复标记同一条是幂等的：affected 为 0，不报错，read_at 不被刷新', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    const list = await request.authed('get', '/notifications', token)
    const id = list.body.data.list[0].id

    await request.authed('post', '/notifications/read', token).send({ ids: [id] })
    const firstReadAt = (await db.queryOne('SELECT read_at FROM notification WHERE id = ?', [id])).read_at

    const again = await request.authed('post', '/notifications/read', token).send({ ids: [id] })

    expect(again.status).toBe(200)
    // 「第一次读的时间」在验收争议里比「最后一次点的时刻」有意义，
    // 因此 is_read = 0 这个条件必须留在 UPDATE 的 WHERE 里
    expect(again.body.data.affected).toBe(0)
    expect((await db.queryOne('SELECT read_at FROM notification WHERE id = ?', [id])).read_at).toEqual(firstReadAt)
  })

  it('无法把别人的消息标记为已读', async () => {
    const a = await setupUser('a')
    const b = await setupUser('b')

    await notificationService.notify({ userId: b.userId, type: 'system', title: 'B 的消息' })
    const bList = await request.authed('get', '/notifications', b.token)
    const bNotificationId = bList.body.data.list[0].id

    const res = await request.authed('post', '/notifications/read', a.token).send({ ids: [bNotificationId] })

    // id 是自增主键、可被枚举。少了 user_id 条件，任何人都能把对方的红点清掉
    expect(res.status).toBe(200)
    expect(res.body.data.affected).toBe(0)

    const still = await db.queryOne('SELECT is_read FROM notification WHERE id = ?', [bNotificationId])
    expect(still.is_read).toBe(0)
  })

  it('全部已读不会波及他人的消息', async () => {
    const a = await setupUser('a')
    const b = await setupUser('b')

    await seedMessages(a.userId)
    await notificationService.notify({ userId: b.userId, type: 'system', title: 'B 的消息' })

    await request.authed('post', '/notifications/read', a.token).send({})

    const bUnread = await db.count('FROM notification WHERE user_id = ? AND is_read = 0', [b.userId])
    expect(bUnread).toBe(1)
  })

  it('unreadOnly 只返回未读', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)

    const list = await request.authed('get', '/notifications', token)
    const target = list.body.data.list.find((n) => n.type === 'payment')

    await request.authed('post', '/notifications/read', token).send({ ids: [target.id] })

    const res = await request.authed('get', '/notifications?unreadOnly=true', token)

    expect(res.body.data.total).toBe(4)
    expect(res.body.data.list.every((n) => n.isRead === false)).toBe(true)
  })

  it('unreadOnly=false 不会被当成只看未读', async () => {
    const { token, userId } = await setupUser()
    await seedMessages(userId)
    await request.authed('post', '/notifications/read', token).send({})

    // Boolean('false') === true —— 用 z.coerce.boolean() 就会踩这个坑
    const res = await request.authed('get', '/notifications?unreadOnly=false', token)
    expect(res.body.data.total).toBe(5)
  })
})

describe('AC-U10 新消息到达后红点在下拉刷新时正确更新', () => {
  it('刷新接口立即反映新到达的消息', async () => {
    const { token, userId } = await setupUser()

    const before = await request.authed('get', '/notifications/unread-count', token)
    expect(before.body.data.total).toBe(0)

    await notificationService.notify({ userId, type: 'acceptance', title: '新的验收单', projectId: null })

    const after = await request.authed('get', '/notifications/unread-count', token)
    expect(after.body.data.total).toBe(1)
    expect(after.body.data.byType.acceptance).toBe(1)
  })

  it('未授权订阅消息时站内消息仍然完整记入（AC-U12 的读取侧）', async () => {
    const { token, userId } = await setupUser()

    await notificationService.notify({
      userId,
      type: 'progress',
      title: '未授权也要能收到',
      content: '用户拒绝过订阅授权',
    })

    const res = await request.authed('get', '/notifications?type=progress', token)

    expect(res.body.data.total).toBe(1)
    expect(res.body.data.list[0].content).toBe('用户拒绝过订阅授权')
  })
})

describe('消息中心的鉴权', () => {
  it('未登录访问一律 401', async () => {
    const calls = [
      request.get('/notifications'),
      request.get('/notifications/unread-count'),
      request.post('/notifications/read').send({}),
    ]

    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401)
    }
  })

  it('后台 token 不能用于 C 端消息接口（AC-AD10）', async () => {
    const { createAndLogin } = require('./helpers/auth')
    const admin = await createAndLogin({ username: 'notif-admin' })

    const res = await request.authed('get', '/notifications', admin.token)
    expect(res.status).toBe(401)
  })
})
