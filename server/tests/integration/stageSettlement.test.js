'use strict'

/**
 * 阶段结算与推进门禁（C-7.5 ~ C-7.9 / AC-S02 ~ AC-S08）。
 *
 * 这组用例针对的是一个曾经完全缺失的链路：验收通过后阶段停在 accepted，
 * 结算单没有生成、确认也不会把下一阶段解锁。断言的重点是
 * 「阶段已结清」与「下一阶段已激活」必须同时发生（AC-S08），
 * 以及异议 / 快照变化时不能把阶段推进到终态。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
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

async function setup() {
  const admin = await auth.createAndLogin({ username: 'admin', role: 'owner' })
  const templateId = await fixtures.createTemplate({
    name: '阶段结算模板',
    stages: [
      { name: '水电工程', planDays: 10, items: [{ name: '强电布线' }] },
      { name: '泥瓦工程', planDays: 10, items: [{ name: '防水施工' }] },
    ],
  })

  const created = await request.authed('post', '/admin/projects', admin.token).send({
    name: '阶段结算测试项目',
    address: '上海市浦东新区世纪大道 100 号',
    contractAmount: '200000.00',
    startDate: '2026-01-01',
    planEndDate: '2026-06-01',
    templateId,
  })
  const projectId = created.body.data.id

  const detail = await request.authed('get', `/admin/projects/${projectId}`, admin.token)
  const stages = detail.body.data.stages
  const stageId = stages[0].id
  const nextStageId = stages[1].id

  await request.authed('put', `/admin/projects/${projectId}/payment-nodes`, admin.token).send({
    nodes: [
      { name: '水电验收款', amount: '60000.00', triggerType: 'stage_acceptance', triggerStageId: stageId },
      { name: '泥瓦验收款', amount: '40000.00', triggerType: 'stage_acceptance', triggerStageId: nextStageId },
      { name: '尾款', amount: '100000.00', triggerType: 'manual' },
    ],
  })

  const foreman = await mini.login('code-stage-foreman')
  const secondForeman = await mini.login('code-stage-foreman-2')
  const owner = await mini.login('code-stage-owner')
  const supervisor = await mini.login('code-stage-supervisor')

  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, is_primary, confirmed_at, joined_at)
     VALUES (?, ?, 'foreman', 'active', 1, NOW(), NOW())`,
    [projectId, foreman.userId]
  )
  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, is_primary, confirmed_at, joined_at)
     VALUES (?, ?, 'foreman', 'active', 0, NOW(), NOW())`,
    [projectId, secondForeman.userId]
  )
  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, owner_type, confirmed_at, joined_at)
     VALUES (?, ?, 'owner', 'active', 'primary', NOW(), NOW())`,
    [projectId, owner.userId]
  )
  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, confirmed_at, joined_at)
     VALUES (?, ?, 'supervisor', 'active', NOW(), NOW())`,
    [projectId, supervisor.userId]
  )

  // 验收已通过：结算用例从 accepted 开始，不重复走完整验收状态机
  await db.query(
    "UPDATE project_stage SET gate_status = 'accepted', status = 'accepted', progress = 100 WHERE id = ?",
    [stageId]
  )

  return { admin, projectId, stageId, nextStageId, foreman, secondForeman, owner, supervisor }
}

async function addEntry(ctx, { type, amount, category = null, occurredAt = '2026-03-01', stageId = ctx.stageId }) {
  const result = await db.query(
    `INSERT INTO ledger (project_id, project_stage_id, type, category, amount, occurred_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ctx.projectId, stageId, type, category, amount, occurredAt, ctx.foreman.userId]
  )
  return result.insertId
}

async function addIncomeAndExpense(ctx) {
  await addEntry(ctx, { type: 'income', amount: '60000.00' })
  await addEntry(ctx, { type: 'expense', amount: '12000.00', category: 'material' })
}

function getSettlement(ctx, token = ctx.foreman.token) {
  return mini.authed('get', `/projects/${ctx.projectId}/stages/${ctx.stageId}/settlement`, token)
}

function submitSettlement(ctx, token = ctx.foreman.token) {
  return mini.authed(
    'post',
    `/projects/${ctx.projectId}/stages/${ctx.stageId}/settlement/submit`,
    token
  )
}

describe('AC-S02 / AC-S03 阶段结算单生成与金额口径', () => {
  it('验收通过后首次读取自动生成草稿，应收等于该阶段付款节点之和', async () => {
    const ctx = await setup()
    await addIncomeAndExpense(ctx)

    // 验收联动会生成草稿；这里先清掉，验证「不存在时自动生成」
    await db.query('DELETE FROM reconciliation')

    const res = await getSettlement(ctx)
    expect(res.status).toBe(200)
    const data = res.body.data

    expect(data.scopeType).toBe('stage')
    expect(data.status).toBe('draft')
    expect(data.statusLabel).toBe('待工长提交')
    expect(data.receivableAmount).toBe('60000.00')
    expect(data.incomeAmount).toBe('60000.00')
    expect(data.expenseAmount).toBe('12000.00')
    expect(data.balanceAmount).toBe('48000.00')
    expect(data.paymentNodes).toHaveLength(1)
    expect(data.paymentNodes[0].name).toBe('水电验收款')
    expect(data.details).toHaveLength(2)
  })

  it('流水红冲后结算金额按净额计算', async () => {
    const ctx = await setup()
    const originalId = await addEntry(ctx, { type: 'expense', amount: '1000.00', category: 'material' })
    await db.query(
      `INSERT INTO ledger
         (project_id, project_stage_id, type, category, amount, occurred_at, created_by, is_reversal, reversal_of_id)
       VALUES (?, ?, 'expense', 'material', '1000.00', '2026-03-02', ?, 1, ?)`,
      [ctx.projectId, ctx.stageId, ctx.foreman.userId, originalId]
    )

    const res = await getSettlement(ctx)
    expect(res.body.data.expenseAmount).toBe('0.00')
    expect(res.body.data.balanceAmount).toBe('0.00')
  })

  it('阶段还未验收通过时拒绝结算', async () => {
    const ctx = await setup()
    await db.query("UPDATE project_stage SET gate_status = 'active' WHERE id = ?", [ctx.stageId])

    const res = await getSettlement(ctx)
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('尚未验收通过')
  })

  it('按结算单 id 读取时返回阶段口径，而不是周期对账口径', async () => {
    const ctx = await setup()
    await addIncomeAndExpense(ctx)
    const submitted = await submitSettlement(ctx)

    const res = await mini.authed(
      'get',
      `/reconciliations/${submitted.body.data.id}`,
      ctx.owner.token
    )
    expect(res.status).toBe(200)
    expect(res.body.data.scopeType).toBe('stage')
    expect(res.body.data.stageName).toBe('水电工程')
    expect(res.body.data.receivableAmount).toBe('60000.00')
    expect(res.body.data.details).toHaveLength(2)
  })
})

describe('AC-S08 确认后阶段结清并解锁下一阶段', () => {
  it('主工长提交、主业主确认后，same transaction 内 settled + 下一阶段 active', async () => {
    const ctx = await setup()
    await addIncomeAndExpense(ctx)

    const draft = await getSettlement(ctx)
    expect(draft.body.data.status).toBe('draft')

    const submitted = await submitSettlement(ctx)
    expect(submitted.status).toBe(200)
    expect(submitted.body.data.status).toBe('pending')
    expect(submitted.body.data.submittedAt).toBeTruthy()

    const reconciliationId = submitted.body.data.id
    const confirmed = await mini.authed('post', `/reconciliations/${reconciliationId}/confirm`, ctx.owner.token)
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.data.status).toBe('confirmed')
    expect(confirmed.body.data.stageSettlement.nextStageId).toBe(ctx.nextStageId)
    expect(confirmed.body.data.stageSettlement.nextStageUnlocked).toBe(true)

    const current = await db.queryOne(
      'SELECT gate_status, settled_at, status FROM project_stage WHERE id = ?',
      [ctx.stageId]
    )
    const next = await db.queryOne(
      'SELECT gate_status, unlocked_at FROM project_stage WHERE id = ?',
      [ctx.nextStageId]
    )

    expect(current.gate_status).toBe('settled')
    expect(current.settled_at).toBeTruthy()
    // 展示状态仍是「已验收」，门禁才是单一事实来源
    expect(current.status).toBe('accepted')
    expect(next.gate_status).toBe('active')
    expect(next.unlocked_at).toBeTruthy()

    // 结算单确认后流水锁定（与周期对账同一套机制）
    const locked = await db.count('FROM ledger WHERE project_id = ? AND locked = 1', [ctx.projectId])
    expect(locked).toBe(2)

    // 已结清后再次读取仍返回同一张已确认单据
    const after = await getSettlement(ctx)
    expect(after.body.data.status).toBe('confirmed')
    expect(after.body.data.id).toBe(reconciliationId)
    // AC-S14：确认后生成阶段结算单 PDF，双方可通过签名链接下载
    expect(after.body.data.settlementPdfSignedPath).toBeTruthy()
  })

  it('没有下一阶段时只结清当前阶段，不报错', async () => {
    const ctx = await setup()
    await db.query('UPDATE project_stage SET deleted_at = NOW() WHERE id = ?', [ctx.nextStageId])
    await addIncomeAndExpense(ctx)

    const submitted = await submitSettlement(ctx)
    const confirmed = await mini.authed(
      'post',
      `/reconciliations/${submitted.body.data.id}/confirm`,
      ctx.owner.token
    )
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.data.stageSettlement.nextStageId).toBeNull()

    const current = await db.queryOne('SELECT gate_status FROM project_stage WHERE id = ?', [ctx.stageId])
    expect(current.gate_status).toBe('settled')
  })
})

describe('C-7.7 / C-7.8 / AC-S06 异议', () => {
  it('提异议后阶段进入 disputed、下一阶段保持 locked；重新提交后异议保留但可确认', async () => {
    const ctx = await setup()
    await addIncomeAndExpense(ctx)

    const submitted = await submitSettlement(ctx)
    const reconciliationId = submitted.body.data.id
    const disputedDetailId = submitted.body.data.details[0].id

    const dispute = await mini
      .authed('post', `/reconciliations/${reconciliationId}/dispute`, ctx.owner.token)
      .send({ detailId: disputedDetailId, remark: '这笔材料金额与发票不符' })
    expect(dispute.status).toBe(200)
    expect(dispute.body.data.status).toBe('disputed')

    const stage = await db.queryOne('SELECT gate_status FROM project_stage WHERE id = ?', [ctx.stageId])
    const next = await db.queryOne('SELECT gate_status FROM project_stage WHERE id = ?', [ctx.nextStageId])
    expect(stage.gate_status).toBe('disputed')
    expect(next.gate_status).toBe('locked')

    // 有未处理异议时不能确认
    const blocked = await mini.authed(
      'post',
      `/reconciliations/${reconciliationId}/confirm`,
      ctx.owner.token
    )
    expect(blocked.status).toBe(409)

    // 工长重新提交：阶段回到 accepted，异议说明保留
    const resubmitted = await submitSettlement(ctx)
    expect(resubmitted.status).toBe(200)
    const stageAfterSubmit = await db.queryOne(
      'SELECT gate_status FROM project_stage WHERE id = ?',
      [ctx.stageId]
    )
    expect(stageAfterSubmit.gate_status).toBe('accepted')

    const oldDispute = await db.queryOne(
      'SELECT dispute, dispute_remark, dispute_resolved_at FROM reconciliation_detail WHERE id = ?',
      [disputedDetailId]
    )
    expect(oldDispute.dispute).toBe(0)
    expect(oldDispute.dispute_remark).toBe('这笔材料金额与发票不符')
    expect(oldDispute.dispute_resolved_at).toBeTruthy()

    const confirmed = await mini.authed(
      'post',
      `/reconciliations/${reconciliationId}/confirm`,
      ctx.owner.token
    )
    expect(confirmed.status).toBe(200)
    // 重新提交后旧异议被标记为「已处理」，说明仍保留在记录里（AC-S07）
    expect(resubmitted.body.data.resolvedDisputeCount).toBe(1)
  })

  it('异议说明必填', async () => {
    const ctx = await setup()
    await addIncomeAndExpense(ctx)
    const submitted = await submitSettlement(ctx)
    const res = await mini
      .authed('post', `/reconciliations/${submitted.body.data.id}/dispute`, ctx.owner.token)
      .send({ detailId: submitted.body.data.details[0].id, remark: '   ' })
    expect(res.status).toBe(400)
  })
})

describe('提交后快照变化必须退回重提', () => {
  it('提交后新增流水，确认返回 409 且阶段不被推进', async () => {
    const ctx = await setup()
    await addIncomeAndExpense(ctx)
    const submitted = await submitSettlement(ctx)

    await addEntry(ctx, { type: 'expense', amount: '500.00', category: 'transport' })

    const confirmed = await mini.authed(
      'post',
      `/reconciliations/${submitted.body.data.id}/confirm`,
      ctx.owner.token
    )
    expect(confirmed.status).toBe(409)
    expect(confirmed.body.message).toContain('重新提交')

    const stage = await db.queryOne('SELECT gate_status FROM project_stage WHERE id = ?', [ctx.stageId])
    expect(stage.gate_status).toBe('accepted')
  })
})

describe('权限与周期对账的边界', () => {
  it('只有主工长能提交；业主与普通工长返回 403', async () => {
    const ctx = await setup()
    await getSettlement(ctx)

    expect((await submitSettlement(ctx, ctx.owner.token)).status).toBe(403)
    expect((await submitSettlement(ctx, ctx.secondForeman.token)).status).toBe(403)
    expect((await submitSettlement(ctx, ctx.foreman.token)).status).toBe(200)
  })

  it('监理不能查看阶段结算', async () => {
    const ctx = await setup()
    const res = await getSettlement(ctx, ctx.supervisor.token)
    expect(res.status).toBe(403)
  })

  it('临时业主不能确认阶段结算，主业主可以', async () => {
    const ctx = await setup()
    const temporary = await mini.login('code-stage-owner-temp')
    await mini.addMember({
      projectId: ctx.projectId,
      userId: temporary.userId,
      role: 'owner',
      ownerType: 'temporary',
    })
    const submitted = await submitSettlement(ctx)

    const denied = await mini.authed(
      'post',
      `/reconciliations/${submitted.body.data.id}/confirm`,
      temporary.token
    )
    expect(denied.status).toBe(403)

    const confirmed = await mini.authed(
      'post',
      `/reconciliations/${submitted.body.data.id}/confirm`,
      ctx.owner.token
    )
    expect(confirmed.status).toBe(200)
  })

  it('周期对账确认不会解锁阶段（防止把两种单据混为一谈）', async () => {
    const ctx = await setup()
    await addIncomeAndExpense(ctx)

    const period = await mini
      .authed('post', `/projects/${ctx.projectId}/reconciliations`, ctx.foreman.token)
      .send({ periodStart: '2026-03-01', periodEnd: '2026-03-31' })
    expect(period.status).toBe(200)

    const confirmed = await mini.authed(
      'post',
      `/reconciliations/${period.body.data.id}/confirm`,
      ctx.owner.token
    )
    expect(confirmed.status).toBe(200)

    const stage = await db.queryOne('SELECT gate_status FROM project_stage WHERE id = ?', [ctx.stageId])
    const next = await db.queryOne('SELECT gate_status FROM project_stage WHERE id = ?', [ctx.nextStageId])
    expect(stage.gate_status).toBe('accepted')
    expect(next.gate_status).toBe('locked')
  })
})
