'use strict'

/**
 * C 端首屏聚合集成测试（BZGGCB-12）。
 *
 * 聚合接口的价值是「少发请求」，风险则全在**权限口径**上：一个把 9 个接口
 * 合成 1 个的实现，如果自己写 SQL，很容易在某一条分支上漏判角色。
 * 因此这里的断言重点不是字段齐全，而是：
 *   1. 每个数据集与对应细粒度接口返回同一份数据（同源 service）；
 *   2. 监理 / 非成员在聚合接口下拿不到任何原本就看不到的数据；
 *   3. 细粒度接口本身没有因为聚合而改变行为。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
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

/**
 * 一个项目 + 业主 / 工长 / 监理 / 局外人，带一个阶段与一道工序。
 * 首屏聚合覆盖的卡片数据大多允许为空，这里优先保证角色矩阵成立。
 */
async function setup() {
  seq += 1
  const owner = await mini.login(`overview-owner-${seq}`)
  const foreman = await mini.login(`overview-foreman-${seq}`)
  const supervisor = await mini.login(`overview-supervisor-${seq}`)
  const outsider = await mini.login(`overview-outsider-${seq}`)

  const projectId = await mini.createProject({
    name: `首屏聚合项目-${seq}`,
    createdBy: owner.userId,
  })
  await mini.addMember({ projectId, userId: owner.userId, role: 'owner' })
  await mini.addMember({ projectId, userId: foreman.userId, role: 'foreman' })
  await mini.addMember({ projectId, userId: supervisor.userId, role: 'supervisor' })

  const stageId = await mini.createStage({ projectId, name: '水电工程', seq: 1 })
  await db.query('INSERT INTO project_item (project_stage_id, name, seq) VALUES (?, ?, 1)', [
    stageId,
    '强电布线',
  ])

  return { projectId, stageId, owner, foreman, supervisor, outsider }
}

describe('GET /projects/:id/overview —— 项目详情首屏聚合', () => {
  it('业主一次取回详情、阶段、验收、汇报、账目与联系方式', async () => {
    const { projectId, owner } = await setup()

    const res = await request.authed('get', `/projects/${projectId}/overview`, owner.token)

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.project.id).toBe(projectId)
    expect(data.project.myRole).toBe('owner')
    // 阶段树随详情下发，不再单独请求 /stages
    expect(Array.isArray(data.stages)).toBe(true)
    expect(data.stages[0].name).toBe('水电工程')
    expect(data.acceptances).toBeTruthy()
    // 首屏只取最新一条汇报
    expect(data.reports.pageSize).toBe(1)
    expect(Array.isArray(data.reports.list)).toBe(true)
    expect(data.paymentNodes).toBeTruthy()
    expect(data.ledgerSummary).toBeTruthy()
    expect(data.contacts).toBeTruthy()
    expect(Array.isArray(data.visits.list)).toBe(true)
    expect(data.completionReport.available).toBe(false)
  })

  it('工长能拿到账目与付款节点，但拿不到业主专属的联系方式', async () => {
    const { projectId, foreman } = await setup()

    const res = await request.authed('get', `/projects/${projectId}/overview`, foreman.token)

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.project.myRole).toBe('foreman')
    expect(data.ledgerSummary).toBeTruthy()
    expect(data.paymentNodes).toBeTruthy()
    // 联系方式仅业主可见：聚合接口按原接口口径降级为 null，而不是裁字段
    expect(data.contacts).toBeNull()
  })

  it('监理能看到项目与验收，但账目、联系方式、竣工报告一律为 null', async () => {
    const { projectId, supervisor } = await setup()

    const res = await request.authed('get', `/projects/${projectId}/overview`, supervisor.token)

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.project.myRole).toBe('supervisor')
    expect(data.acceptances).toBeTruthy()
    expect(data.reports).toBeTruthy()
    expect(data.ledgerSummary).toBeNull()
    expect(data.paymentNodes).toBeNull()
    expect(data.contacts).toBeNull()
    expect(data.completionReport).toBeNull()
  })

  it('非参与成员返回 404，不泄露项目是否存在（AC-P26）', async () => {
    const { projectId, outsider } = await setup()

    const res = await request.authed('get', `/projects/${projectId}/overview`, outsider.token)

    expect(res.status).toBe(404)
  })

  it('未登录返回 401', async () => {
    const { projectId } = await setup()
    const res = await request.get(`/projects/${projectId}/overview`)
    expect(res.status).toBe(401)
  })

  it('阶段树与 /projects/:id/stages 同源，工长能看到 canReport', async () => {
    const { projectId, foreman } = await setup()

    const [overview, stages] = await Promise.all([
      request.authed('get', `/projects/${projectId}/overview`, foreman.token),
      request.authed('get', `/projects/${projectId}/stages`, foreman.token),
    ])

    expect(overview.status).toBe(200)
    // 详情接口自带的 stages 没有 canReport；聚合必须用进度接口的视图，
    // 否则工长的「汇报进度」入口会消失
    expect(overview.body.data.stages).toEqual(stages.body.data.stages)
    expect(overview.body.data.stages.every((stage) => typeof stage.canReport === 'boolean')).toBe(
      true
    )
    expect(overview.body.data.stages.some((stage) => stage.canReport)).toBe(true)
  })

  it('聚合结果与细粒度接口同源：业主的账目汇总数字一致', async () => {
    const { projectId, owner } = await setup()

    const [overview, summary] = await Promise.all([
      request.authed('get', `/projects/${projectId}/overview`, owner.token),
      request.authed('get', `/projects/${projectId}/ledger/summary`, owner.token),
    ])

    expect(overview.status).toBe(200)
    expect(summary.status).toBe(200)
    expect(overview.body.data.ledgerSummary).toEqual(summary.body.data)
  })
})

describe('GET /projects/:id/ledger/overview —— 记账页首屏聚合', () => {
  it('业主一次取回项目、汇总、付款节点、阶段账目、支出构成与对账单', async () => {
    const { projectId, owner } = await setup()

    const res = await request.authed('get', `/projects/${projectId}/ledger/overview`, owner.token)

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.project.id).toBe(projectId)
    expect(data.ledgerAccess).toBe(true)
    expect(data.summary).toBeTruthy()
    expect(data.paymentNodes).toBeTruthy()
    expect(data.stageLedger).toBeTruthy()
    expect(data.breakdown).toBeTruthy()
    expect(Array.isArray(data.reconciliations.list)).toBe(true)
  })

  it('路径不会被 /:ledgerId 吃掉（overview 不是流水 id）', async () => {
    const { projectId, owner } = await setup()
    const res = await request.authed('get', `/projects/${projectId}/ledger/overview`, owner.token)
    // 被参数段匹配时会返回 404「流水不存在」
    expect(res.status).toBe(200)
  })

  it('监理返回 ledgerAccess=false，且不包含任何账目字段值', async () => {
    const { projectId, supervisor } = await setup()

    const res = await request.authed(
      'get',
      `/projects/${projectId}/ledger/overview`,
      supervisor.token
    )

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.project.myRole).toBe('supervisor')
    expect(data.ledgerAccess).toBe(false)
    expect(data.summary).toBeNull()
    expect(data.paymentNodes).toBeNull()
    expect(data.stageLedger).toBeNull()
    expect(data.breakdown).toBeNull()
    expect(data.reconciliations).toBeNull()
    // 兜底：响应里不出现任何金额字段（summary.contractAmount 等）
    expect(JSON.stringify(data)).not.toMatch(/contractAmount|totalIncome|balance/)
  })

  it('非参与成员返回 404', async () => {
    const { projectId, outsider } = await setup()
    const res = await request.authed(
      'get',
      `/projects/${projectId}/ledger/overview`,
      outsider.token
    )
    expect(res.status).toBe(404)
  })

  it('聚合与细粒度接口同源：汇总 / 付款节点 / 阶段账目逐项相等', async () => {
    const { projectId, foreman } = await setup()

    const [overview, summary, nodes, stageLedger, breakdown, recs] = await Promise.all([
      request.authed('get', `/projects/${projectId}/ledger/overview`, foreman.token),
      request.authed('get', `/projects/${projectId}/ledger/summary`, foreman.token),
      request.authed('get', `/projects/${projectId}/payment-nodes`, foreman.token),
      request.authed('get', `/projects/${projectId}/stages/ledger`, foreman.token),
      request.authed('get', `/projects/${projectId}/ledger/expense-breakdown`, foreman.token),
      request.authed('get', `/projects/${projectId}/reconciliations`, foreman.token),
    ])

    expect(overview.status).toBe(200)
    expect(overview.body.data.summary).toEqual(summary.body.data)
    expect(overview.body.data.paymentNodes).toEqual(nodes.body.data)
    expect(overview.body.data.stageLedger).toEqual(stageLedger.body.data)
    expect(overview.body.data.breakdown).toEqual(breakdown.body.data)
    expect(overview.body.data.reconciliations).toEqual(recs.body.data)
  })
})

describe('细粒度接口回归：聚合上线不改变原有行为', () => {
  it('项目详情的 8 个细粒度读接口对业主仍然可用', async () => {
    const { projectId, owner } = await setup()

    const paths = [
      `/projects/${projectId}`,
      `/projects/${projectId}/stages`,
      `/projects/${projectId}/acceptances`,
      `/projects/${projectId}/reports?page=1&pageSize=20`,
      `/projects/${projectId}/payment-nodes`,
      `/projects/${projectId}/ledger/summary`,
      `/projects/${projectId}/contacts`,
      `/projects/${projectId}/visits?page=1&pageSize=3`,
      `/projects/${projectId}/completion-report`,
    ]

    for (const path of paths) {
      const res = await request.authed('get', path, owner.token)
      expect(res.status, path).toBe(200)
    }
  })

  it('监理调用账目细粒度接口仍是 403（AC-L27）', async () => {
    const { projectId, supervisor } = await setup()

    for (const path of [
      `/projects/${projectId}/ledger/summary`,
      `/projects/${projectId}/payment-nodes`,
      `/projects/${projectId}/stages/ledger`,
    ]) {
      const res = await request.authed('get', path, supervisor.token)
      expect(res.status, path).toBe(403)
    }
  })
})
