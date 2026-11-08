'use strict'

/**
 * C 端跨租户（M13 / P5）。
 *
 * ── 场景 ──
 * 一个微信账号可以同时给两家装修公司干活：在 A 公司当工长、在 B 公司当业主。
 * 这带来三件必须在**数据层**解决、不能靠前端分组糊过去的事：
 *
 *   1. 订阅授权按租户存 —— 同一个微信模板 ID 会被多个租户使用；
 *   2. 消息带租户，但未读红点仍是全局口径；
 *   3. 定时任务按**每个项目所属租户**的配置判定，而不是取全平台一份。
 *
 * 前两项在 P0 已改表，这个文件把它们钉死；第三项是 P5 新增的验证。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const datetime = require('../../src/utils/datetime')
const sysConfigService = require('../../src/services/sysConfig.service')
const notificationService = require('../../src/services/notification.service')
const notificationModel = require('../../src/models/notification.model')
const staleReportReminder = require('../../src/jobs/staleReportReminder')
const acceptanceTimeoutJob = require('../../src/jobs/acceptanceTimeout')
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

let seq = 0
function nextSeq() {
  seq += 1
  return seq
}

/**
 * 直接写一条配置并清掉进程内缓存（CLAUDE.md 第 17 条）。
 *
 * 订阅消息模板 ID 自 v2.6 起是**平台专属配置**：模板来自小程序主体，
 * 各租户共用同一个 ID。这里仍保留 tenantId 参数，是为了让调用点表达
 * 「这个租户要用模板」，但实际写入平台基础行。
 */
async function setConfig(tenantId, key, value) {
  const targetTenant = key.startsWith('subscribe_template_') ? null : tenantId
  await db.query(
    `INSERT INTO sys_config (tenant_id, config_key, config_value, scope)
     VALUES (?, ?, ?, 'global')
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), deleted_at = NULL`,
    [targetTenant, key, value]
  )
  sysConfigService.invalidate(targetTenant ?? undefined)
}

async function setupTwoTenantsWithProjects() {
  const n = nextSeq()
  const tenantB = await fixtures.createTenant({ name: `B 装修公司 ${n}`, code: `p5-b-${n}` })
  const projA = await mini.createProject({ tenantId: 1, name: `A 项目 ${n}` })
  const projB = await mini.createProject({ tenantId: tenantB, name: `B 项目 ${n}` })
  return { n, tenantB, projA, projB }
}

// ─────────────────────────────────────────────────────────────
// 订阅授权
// ─────────────────────────────────────────────────────────────

describe('P5 · 订阅授权按租户隔离', () => {
  it('同一用户、同一个模板 ID，在两个租户的授权互不覆盖', async () => {
    const { n, tenantB, projA, projB } = await setupTwoTenantsWithProjects()

    // 刻意让两个租户用**同一个微信模板 ID** —— 这正是
    // 唯一键必须包含 tenant_id 的原因
    await setConfig(1, 'subscribe_template_progress', 'wx-tpl-shared')
    await setConfig(tenantB, 'subscribe_template_progress', 'wx-tpl-shared')

    const user = await mini.login(`p5-sub-${n}`)
    await mini.addMember({ projectId: projA, userId: user.userId, role: 'foreman' })
    await mini.addMember({ projectId: projB, userId: user.userId, role: 'foreman' })

    // 不指定租户 → 400（绝不猜）
    const ambiguous = await mini
      .authed('post', '/notifications/subscriptions', user.token)
      .send({ type: 'progress', status: 'accepted' })
    expect(ambiguous.status).toBe(400)
    expect(ambiguous.body.message).toContain('多个租户')

    // A 同意、B 拒绝
    await mini
      .authed('post', '/notifications/subscriptions', user.token)
      .send({ type: 'progress', tenantId: 1, status: 'accepted' })
      .expect(200)
    await mini
      .authed('post', '/notifications/subscriptions', user.token)
      .send({ type: 'progress', tenantId: tenantB, status: 'rejected' })
      .expect(200)

    const rows = await db.query(
      'SELECT tenant_id, template_id, status FROM user_subscription WHERE user_id = ? ORDER BY tenant_id',
      [user.userId]
    )
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.template_id === 'wx-tpl-shared')).toBe(true)
    expect(rows.find((r) => Number(r.tenant_id) === 1).status).toBe('accepted')
    expect(rows.find((r) => Number(r.tenant_id) === Number(tenantB)).status).toBe('rejected')

    // 列表按租户读，互不影响
    const listA = await mini
      .authed('get', '/notifications/subscriptions?tenantId=1', user.token)
      .expect(200)
    const listB = await mini
      .authed('get', `/notifications/subscriptions?tenantId=${tenantB}`, user.token)
      .expect(200)
    expect(listA.body.data.list.find((i) => i.type === 'progress').status).toBe('accepted')
    expect(listB.body.data.list.find((i) => i.type === 'progress').status).toBe('rejected')

    // 授权动作的审计日志必须落在对应租户名下
    const logA = await db.queryOne(
      "SELECT tenant_id FROM operation_log WHERE action = 'subscription.record' AND tenant_id = 1"
    )
    expect(logA).toBeTruthy()
  })

  it('推送判定按租户读取订阅：A 同意不会被 B 的拒覆盖', async () => {
    const { n, tenantB, projA, projB } = await setupTwoTenantsWithProjects()
    await setConfig(1, 'subscribe_template_progress', 'wx-tpl-shared')
    await setConfig(tenantB, 'subscribe_template_progress', 'wx-tpl-shared')

    const user = await mini.login(`p5-push-${n}`)
    await mini.addMember({ projectId: projA, userId: user.userId, role: 'foreman' })
    await mini.addMember({ projectId: projB, userId: user.userId, role: 'foreman' })
    await mini
      .authed('post', '/notifications/subscriptions', user.token)
      .send({ type: 'progress', tenantId: 1, status: 'accepted' })
      .expect(200)
    await mini
      .authed('post', '/notifications/subscriptions', user.token)
      .send({ type: 'progress', tenantId: tenantB, status: 'rejected' })
      .expect(200)

    // 测试环境 WX_MOCK=true，不会真的调用微信接口：
    // accepted → mock（走到了发送这一步，被 mock 通道拦下）；
    // rejected → not_subscribed。
    // 若查询漏了 tenant_id，两条会命中同一行，结果必然有一条是错的
    const pushA = await notificationService.tryPushSubscribeMessage({
      userId: user.userId,
      type: 'progress',
      tenantId: 1,
    })
    expect(pushA.reason).toBe('mock')

    const pushB = await notificationService.tryPushSubscribeMessage({
      userId: user.userId,
      type: 'progress',
      tenantId: tenantB,
    })
    expect(pushB.reason).toBe('not_subscribed')
  })

  it('推送报文按模板映射组装，模板 ID 与 data 一起下发', async () => {
    const { n, projA } = await setupTwoTenantsWithProjects()
    await setConfig(1, 'subscribe_template_progress', 'wx-tpl-payload')

    const user = await mini.login(`p5-payload-${n}`)
    await mini.addMember({ projectId: projA, userId: user.userId, role: 'foreman' })
    await mini
      .authed('post', '/notifications/subscriptions', user.token)
      .send({ type: 'progress', tenantId: 1, status: 'accepted' })
      .expect(200)

    // 测试环境不能真的打微信接口，替换发送函数只捕获报文。
    // 这里验证的是 notification.service 的组装逻辑，而不是 wx.service 的内部实现。
    const wx = require('../../src/services/wx.service')
    const original = wx.sendSubscribeMessage
    let captured = null
    wx.sendSubscribeMessage = async (payload) => {
      captured = payload
      return { ok: true }
    }

    try {
      const result = await notificationService.tryPushSubscribeMessage({
        userId: user.userId,
        type: 'progress',
        tenantId: 1,
        projectId: projA,
        title: '进度已更新',
        content: '今天完成了水电验收',
        refId: 99,
      })
      expect(result.pushed).toBe(true)
    } finally {
      wx.sendSubscribeMessage = original
    }

    // 默认映射（sysConfig.SUBSCRIBE_FIELD_DEFAULTS.progress）：
    // thing1=项目名、thing2=标题、time3=发送时间
    const openid = (await db.queryOne('SELECT openid FROM user WHERE id = ?', [user.userId])).openid
    expect(captured.templateId).toBe('wx-tpl-payload')
    expect(captured.openid).toBe(openid)
    expect(captured.data.thing1.value).toBe(`A 项目 ${n}`)
    expect(captured.data.thing2.value).toBe('进度已更新')
    expect(captured.data.time3.value).toMatch(/^\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}$/)
  })

  it('只属于一个租户时可以省略 tenantId；不属于任何租户则明确报错', async () => {
    const { n, projA } = await setupTwoTenantsWithProjects()
    await setConfig(1, 'subscribe_template_progress', 'wx-tpl-solo')

    const solo = await mini.login(`p5-solo-${n}`)
    await mini.addMember({ projectId: projA, userId: solo.userId, role: 'foreman' })

    await mini
      .authed('post', '/notifications/subscriptions', solo.token)
      .send({ type: 'progress', status: 'accepted' })
      .expect(200)
    const list = await mini.authed('get', '/notifications/subscriptions', solo.token).expect(200)
    expect(list.body.data.list.find((i) => i.type === 'progress').status).toBe('accepted')

    const nobody = await mini.login(`p5-nobody-${n}`)
    const rejectedList = await mini.authed('get', '/notifications/subscriptions', nobody.token)
    expect(rejectedList.status).toBe(400)
    expect(rejectedList.body.message).toContain('不属于任何租户')

    const rejectedRecord = await mini
      .authed('post', '/notifications/subscriptions', nobody.token)
      .send({ type: 'progress', status: 'accepted' })
    expect(rejectedRecord.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────
// 消息
// ─────────────────────────────────────────────────────────────

describe('P5 · 消息带租户，红点仍是全局口径', () => {
  it('两个租户的消息互不串，平台级消息在按租户筛选时仍可见', async () => {
    const { n, tenantB, projA, projB } = await setupTwoTenantsWithProjects()
    const user = await mini.login(`p5-msg-${n}`)

    await notificationService.notify({
      userId: user.userId,
      projectId: projA,
      type: 'progress',
      title: 'A 公司的汇报提醒',
    })
    await notificationService.notify({
      userId: user.userId,
      projectId: projB,
      type: 'acceptance',
      title: 'B 公司的验收提醒',
    })
    // 与项目无关的系统通知 → tenant_id 为 NULL
    await notificationService.notify({
      userId: user.userId,
      type: 'system',
      title: '平台级系统通知',
    })

    const rows = await db.query(
      'SELECT tenant_id, title FROM notification WHERE user_id = ? ORDER BY id',
      [user.userId]
    )
    expect(rows.map((r) => (r.tenant_id === null ? null : Number(r.tenant_id)))).toEqual([
      1,
      Number(tenantB),
      null,
    ])

    const all = await mini.authed('get', '/notifications', user.token).expect(200)
    expect(all.body.data.total).toBe(3)

    const onlyA = await mini
      .authed('get', '/notifications?tenantId=1', user.token)
      .expect(200)
    expect(onlyA.body.data.list.map((m) => m.title).sort()).toEqual(
      ['A 公司的汇报提醒', '平台级系统通知'].sort()
    )

    const onlyB = await mini
      .authed('get', `/notifications?tenantId=${tenantB}`, user.token)
      .expect(200)
    expect(onlyB.body.data.list.map((m) => m.title).sort()).toEqual(
      ['B 公司的验收提醒', '平台级系统通知'].sort()
    )

    // 红点回答「我有多少条没看」，与筛选无关
    expect(onlyA.body.data.unread).toBe(3)

    await mini.authed('post', '/notifications/read', user.token).send({}).expect(200)
    const after = await mini.authed('get', '/notifications?tenantId=1', user.token).expect(200)
    expect(after.body.data.unread).toBe(0)
  })

  it('不是成员时，猜中另一个租户的项目 id 也只能得到 404', async () => {
    const { n, projA, projB } = await setupTwoTenantsWithProjects()
    const user = await mini.login(`p5-outsider-${n}`)
    await mini.addMember({ projectId: projA, userId: user.userId, role: 'foreman' })

    const other = await mini.authed('get', `/projects/${projB}`, user.token)
    const missing = await mini.authed('get', '/projects/99999999', user.token)
    expect(other.status).toBe(404)
    expect(other.body.message).toBe(missing.body.message)
  })
})

// ─────────────────────────────────────────────────────────────
// 提醒去重键
// ─────────────────────────────────────────────────────────────

describe('P5 · 提醒去重键按项目隔离', () => {
  it('释放去重占用时不会误删另一个项目的同键提醒', async () => {
    const claim = {
      type: 'stale_report',
      refType: 'project',
      refId: 12345,
      targetUserId: 7,
      channel: 'inapp',
    }

    expect(await notificationModel.claimReminder({ projectId: 100, ...claim })).toBe(true)
    // 同一秒锚点、同一个业主，但属于另一个项目 —— 是两条独立的提醒
    expect(await notificationModel.claimReminder({ projectId: 200, ...claim })).toBe(true)

    await notificationModel.releaseReminderClaim({ projectId: 100, ...claim })

    const rows = await db.query('SELECT project_id FROM reminder_log ORDER BY project_id')
    expect(rows.map((r) => Number(r.project_id))).toEqual([200])
  })
})

// ─────────────────────────────────────────────────────────────
// 定时任务按租户取配置
// ─────────────────────────────────────────────────────────────

describe('P5 · 定时任务按每个项目所属租户的配置判定', () => {
  it('未汇报提醒：A 租户 1 天、B 租户 5 天，只提醒 A', async () => {
    const n = nextSeq()
    const tenantB = await fixtures.createTenant({ name: `提醒 B ${n}`, code: `p5-job-b-${n}` })
    const projA = await mini.createProject({ tenantId: 1, name: `提醒 A 项目 ${n}` })
    const projB = await mini.createProject({ tenantId: tenantB, name: `提醒 B 项目 ${n}` })

    // 两个项目都静默了 3 天
    const threeDaysAgo = datetime.format(datetime.now().subtract(3, 'day'))
    await db.query('UPDATE project SET created_at = ? WHERE id IN (?, ?)', [threeDaysAgo, projA, projB])

    const ownerA = await mini.login(`p5-stale-owner-a-${n}`)
    const ownerB = await mini.login(`p5-stale-owner-b-${n}`)
    await mini.addMember({ projectId: projA, userId: ownerA.userId, role: 'owner' })
    await mini.addMember({ projectId: projB, userId: ownerB.userId, role: 'owner' })

    await setConfig(1, 'stale_report_days', '1')
    await setConfig(tenantB, 'stale_report_days', '5')

    const result = await staleReportReminder.runOnce()
    expect(result.reminded).toBe(1)

    const notificationA = await db.queryOne(
      "SELECT tenant_id, title FROM notification WHERE user_id = ? AND type = 'progress'",
      [ownerA.userId]
    )
    expect(notificationA).toBeTruthy()
    expect(Number(notificationA.tenant_id)).toBe(1)

    expect(await db.count('FROM notification WHERE user_id = ?', [ownerB.userId])).toBe(0)
  })

  it('停用租户的项目不再产生任何定时提醒', async () => {
    const n = nextSeq()
    const projectId = await mini.createProject({ tenantId: 1, name: `停用项目 ${n}` })

    const owner = await mini.login(`p5-suspended-owner-${n}`)
    const supervisor = await mini.login(`p5-suspended-sup-${n}`)
    await mini.addMember({ projectId, userId: owner.userId, role: 'owner' })
    await mini.addMember({ projectId, userId: supervisor.userId, role: 'supervisor' })

    const threeDaysAgo = datetime.format(datetime.now().subtract(3, 'day'))
    await db.query('UPDATE project SET created_at = ? WHERE id = ?', [threeDaysAgo, projectId])
    await db.query(
      `INSERT INTO acceptance
         (project_id, status, current_step, submitter_id, step_entered_at, resubmit_count)
       VALUES (?, 'pending_supervisor', 'supervisor', ?, ?, 0)`,
      [projectId, supervisor.userId, datetime.format(datetime.now().subtract(10, 'hour'))]
    )

    await setConfig(1, 'stale_report_days', '1')
    await setConfig(1, 'acceptance_timeout_hours', '5')

    // 租户停用后 C 端只读，用户即使收到提醒也处理不了 —— 不该继续催办
    await db.query("UPDATE tenant SET status = 'suspended' WHERE id = 1")

    expect((await staleReportReminder.runOnce()).reminded).toBe(0)
    expect((await acceptanceTimeoutJob.runOnce()).reminded).toBe(0)
    expect(await db.count('FROM notification', [])).toBe(0)
  })

  it('验收超时提醒：A 租户 5 小时、B 租户 48 小时，只提醒 A 的监理', async () => {
    const n = nextSeq()
    const tenantB = await fixtures.createTenant({ name: `超时 B ${n}`, code: `p5-timeout-b-${n}` })
    const projA = await mini.createProject({ tenantId: 1, name: `超时 A 项目 ${n}` })
    const projB = await mini.createProject({ tenantId: tenantB, name: `超时 B 项目 ${n}` })

    const supervisorA = await mini.login(`p5-sup-a-${n}`)
    const supervisorB = await mini.login(`p5-sup-b-${n}`)
    await mini.addMember({ projectId: projA, userId: supervisorA.userId, role: 'supervisor' })
    await mini.addMember({ projectId: projB, userId: supervisorB.userId, role: 'supervisor' })

    const tenHoursAgo = datetime.format(datetime.now().subtract(10, 'hour'))
    for (const projectId of [projA, projB]) {
      await db.query(
        `INSERT INTO acceptance
           (project_id, status, current_step, submitter_id, step_entered_at, resubmit_count)
         VALUES (?, 'pending_supervisor', 'supervisor', ?, ?, 0)`,
        [projectId, supervisorA.userId, tenHoursAgo]
      )
    }

    await setConfig(1, 'acceptance_timeout_hours', '5')
    await setConfig(tenantB, 'acceptance_timeout_hours', '48')

    const result = await acceptanceTimeoutJob.runOnce()
    expect(result.reminded).toBe(1)

    const notificationA = await db.queryOne(
      "SELECT tenant_id, title FROM notification WHERE user_id = ? AND type = 'acceptance' AND title LIKE '%等待超过%'",
      [supervisorA.userId]
    )
    expect(notificationA).toBeTruthy()
    expect(Number(notificationA.tenant_id)).toBe(1)

    expect(
      await db.count(
        "FROM notification WHERE user_id = ? AND type = 'acceptance' AND title LIKE '%等待超过%'",
        [supervisorB.userId]
      )
    ).toBe(0)
  })
})
