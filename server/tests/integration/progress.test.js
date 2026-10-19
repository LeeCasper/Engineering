'use strict'

/**
 * 完成度计算与变更集成测试（AC-P02~04、P14~19、AC-AD16、AC-AD23、AC-S09）。
 *
 * ── 与单测的分工 ──
 * `tests/unit/progress.test.js` 验的是算法本身（权重 1:1:2 → 65）。
 * 本文件验的是**算法接到了真实数据流上**：工序改进度之后，
 * 落库的阶段完成度、读接口返回的项目总进度、留痕记录，三者是否一致。
 * 算法对而汇总链路断掉，是这类功能最典型的失败方式。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const progressService = require('../../src/services/progress.service')
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

/**
 * 准备一个项目：管理员 + 模板 + 项目 + 一名已确认的工长。
 *
 * 模板固定为「1 个阶段 / 3 个工序」，方便按 AC-P14 的用例赋权重与完成度。
 */
async function setupProject({ stageWeight = null, itemWeights = [1, 1, 2] } = {}) {
  const adminLogin = await auth.createAndLogin({ username: 'admin', role: 'owner' })

  const templateId = await fixtures.createTemplate({
    name: '测试模板',
    stages: [
      {
        name: '水电工程',
        planDays: 10,
        weight: stageWeight,
        items: [
          { name: '强电布线', weight: itemWeights[0] },
          { name: '弱电布线', weight: itemWeights[1] },
          { name: '水路改造', weight: itemWeights[2] },
        ],
      },
    ],
  })

  const created = await request
    .authed('post', '/admin/projects', adminLogin.token)
    .send({
      name: '测试项目',
      address: '上海市某路 1 号',
      contractAmount: '200000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
      templateId,
    })

  const projectId = created.body.data.id

  // 工长（C 端用户）+ 成员关系
  const foreman = await mini.login(`code-foreman-${projectId}`)
  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, is_primary, confirmed_at, joined_at)
     VALUES (?, ?, 'foreman', 'active', 1, NOW(), NOW())`,
    [projectId, foreman.userId]
  )

  const detail = await request.authed('get', `/admin/projects/${projectId}`, adminLogin.token)
  const stage = detail.body.data.stages[0]

  return { adminLogin, templateId, projectId, foreman, stage, items: stage.items }
}

/** 直接调唯一写入口。M7 的汇报提交接口会调它，此处绕过汇报包装只验算法链路 */
function setProgress(projectId, itemId, userId, value) {
  return progressService.applyItemProgress({
    projectId,
    itemId,
    userId,
    progress: value,
  })
}

describe('AC-P14 / AC-P15 阶段完成度加权汇总', () => {
  it('AC-P14 文档用例：权重 1:1:2、完成度 40/60/80 → 阶段完成度 65%', async () => {
    const { projectId, foreman, items } = await setupProject({ itemWeights: [1, 1, 2] })

    await setProgress(projectId, items[0].id, foreman.userId, 40)
    await setProgress(projectId, items[1].id, foreman.userId, 60)
    const last = await setProgress(projectId, items[2].id, foreman.userId, 80)

    expect(last.stageProgress).toBe('65.00')

    // 库里的值与接口返回一致，而不是只有返回值对
    const stage = await db.queryOne('SELECT progress, status FROM project_stage WHERE project_id = ?', [projectId])
    expect(stage.progress).toBe('65.00')
  })

  it('AC-P15 未配置权重时按工序数等权', async () => {
    const { projectId, foreman, items } = await setupProject({ itemWeights: [null, null, null] })

    await setProgress(projectId, items[0].id, foreman.userId, 40)
    await setProgress(projectId, items[1].id, foreman.userId, 60)
    const last = await setProgress(projectId, items[2].id, foreman.userId, 80)

    // (40 + 60 + 80) ÷ 3 = 60
    expect(last.stageProgress).toBe('60.00')
  })

  it('AC-AD23 修改工序权重后，阶段完成度按新权重重算', async () => {
    const { adminLogin, projectId, foreman, items } = await setupProject({ itemWeights: [1, 1, 1] })

    await setProgress(projectId, items[0].id, foreman.userId, 40)
    await setProgress(projectId, items[1].id, foreman.userId, 60)
    await setProgress(projectId, items[2].id, foreman.userId, 80)

    const before = await db.queryOne('SELECT progress FROM project_stage WHERE project_id = ?', [projectId])
    expect(before.progress).toBe('60.00')

    // 把第 3 个工序的权重改成 2 → 与 AC-P14 同一组权重，结果应为 65
    const res = await request
      .authed('put', `/admin/projects/${projectId}/items/${items[2].id}`, adminLogin.token)
      .send({ weight: '2' })
    expect(res.status).toBe(200)

    const after = await db.queryOne('SELECT progress FROM project_stage WHERE project_id = ?', [projectId])
    expect(after.progress).toBe('65.00')
  })

  it('工序权重只接受正数（AC-AD23）', async () => {
    const { adminLogin, projectId, items } = await setupProject()

    for (const weight of ['0', '-1', 'abc']) {
      const res = await request
        .authed('put', `/admin/projects/${projectId}/items/${items[0].id}`, adminLogin.token)
        .send({ weight })
      expect(res.status).toBe(400)
    }
  })
})

describe('AC-P16 / AC-P17 项目总进度与同步更新', () => {
  it('AC-P16 项目总进度 = 各阶段按阶段权重加权平均', async () => {
    const adminLogin = await auth.createAndLogin({ username: 'admin', role: 'owner' })
    const templateId = await fixtures.createTemplate({
      name: '两阶段模板',
      stages: [
        { name: '阶段甲', planDays: 5, weight: 1, items: [{ name: '甲工序' }] },
        { name: '阶段乙', planDays: 5, weight: 3, items: [{ name: '乙工序' }] },
      ],
    })

    const created = await request.authed('post', '/admin/projects', adminLogin.token).send({
      name: '测试项目',
      address: '上海市某路 1 号',
      contractAmount: '200000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
      templateId,
    })
    const projectId = created.body.data.id

    const foreman = await mini.login('code-total')
    await db.query(
      `INSERT INTO project_member (project_id, user_id, role, status, is_primary, confirmed_at, joined_at)
       VALUES (?, ?, 'foreman', 'active', 1, NOW(), NOW())`,
      [projectId, foreman.userId]
    )

    const detail = await request.authed('get', `/admin/projects/${projectId}`, adminLogin.token)
    const [stageA, stageB] = detail.body.data.stages

    // 阶段甲满 100，阶段乙 0 → (100×1 + 0×3) ÷ 4 = 25
    await setProgress(projectId, stageA.items[0].id, foreman.userId, 100)

    const stagesRes = await request.authed('get', `/projects/${projectId}/stages`, foreman.token)
    expect(stagesRes.body.data.progress).toBe('25.00')

    // 阶段乙也满 → (100×1 + 100×3) ÷ 4 = 100
    await setProgress(projectId, stageB.items[0].id, foreman.userId, 100)
    const full = await request.authed('get', `/projects/${projectId}/stages`, foreman.token)
    expect(full.body.data.progress).toBe('100.00')
  })

  it('AC-P17 改进度后阶段完成度、项目总进度、列表页数值同步更新（无缓存脏数据）', async () => {
    // 用等权（三个工序各 1），让算式一眼可验证：100 ÷ 3 = 33.33
    const { adminLogin, projectId, foreman, items } = await setupProject({ itemWeights: [1, 1, 1] })

    const readAll = async () => {
      const viaStages = await request.authed('get', `/projects/${projectId}/stages`, foreman.token)
      const viaList = await request.authed('get', '/projects', foreman.token)
      const viaAdmin = await request.authed('get', `/admin/projects/${projectId}`, adminLogin.token)
      const fromDb = await db.queryOne('SELECT progress FROM project_stage WHERE project_id = ?', [projectId])

      return {
        stageFromApi: viaStages.body.data.stages[0].progress,
        stageFromDb: fromDb.progress,
        projectFromStages: viaStages.body.data.progress,
        projectFromList: viaList.body.data.groups[0].items[0].progress,
        projectFromAdmin: viaAdmin.body.data.progress,
      }
    }

    await setProgress(projectId, items[0].id, foreman.userId, 50)
    const first = await readAll()

    // 四个读取路径必须给出同一个数字。任何一处不一致都说明有缓存或冗余字段在作祟
    expect(first.stageFromApi).toBe(first.stageFromDb)
    expect(first.projectFromStages).toBe(first.stageFromApi)
    expect(first.projectFromList).toBe(first.stageFromApi)
    expect(first.projectFromAdmin).toBe(first.stageFromApi)

    // 再改一次，全部路径随之变化
    await setProgress(projectId, items[0].id, foreman.userId, 100)
    const second = await readAll()

    expect(second.stageFromApi).toBe('33.33') // (100×1 + 0 + 0) ÷ 3
    expect(second.stageFromApi).not.toBe(first.stageFromApi)
    expect(second.projectFromList).toBe(second.stageFromApi)
    expect(second.projectFromAdmin).toBe(second.stageFromApi)
  })

  it('完成度未变化时不写留痕、不产生多余记录', async () => {
    const { projectId, foreman, items } = await setupProject()

    await setProgress(projectId, items[0].id, foreman.userId, 50)
    const again = await setProgress(projectId, items[0].id, foreman.userId, 50)

    expect(again.changed).toBe(false)
    const logs = await db.count('FROM progress_log WHERE project_item_id = ?', [items[0].id])
    // AC-P18 说的是「每次**变更**均写入」；同值重复提交（前端重试、连点）
    // 不该在历史里刷出一串无意义的记录
    expect(logs).toBe(1)
  })
})

describe('AC-P02 / AC-P03 / AC-P04 阶段状态与工序清单', () => {
  it('AC-P02 阶段严格按 seq 顺序返回，状态由系统判定', async () => {
    const { foreman, projectId } = await setupProject()
    const res = await request.authed('get', `/projects/${projectId}/stages`, foreman.token)

    const seqs = res.body.data.stages.map((s) => s.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    // 没有手工设置状态的入口，status 只可能取这四个派生值之一
    for (const stage of res.body.data.stages) {
      expect(['not_started', 'in_progress', 'completed', 'accepted']).toContain(stage.status)
    }
  })

  it('AC-P03 阶段详情展示该阶段下全部工序，与后台配置完全一致', async () => {
    const { adminLogin, foreman, projectId } = await setupProject()

    const admin = await request.authed('get', `/admin/projects/${projectId}`, adminLogin.token)
    const client = await request.authed('get', `/projects/${projectId}/stages`, foreman.token)

    const adminItems = admin.body.data.stages[0].items.map((i) => i.name)
    const clientItems = client.body.data.stages[0].items.map((i) => i.name)
    expect(clientItems).toEqual(adminItems)
    expect(clientItems).toEqual(['强电布线', '弱电布线', '水路改造'])
  })

  it('AC-P04 完成度为 0 的工序显示「未开始」，首个有进度的阶段显示「进行中」', async () => {
    const { projectId, foreman, items } = await setupProject()

    const before = await request.authed('get', `/projects/${projectId}/stages`, foreman.token)
    expect(before.body.data.stages[0].status).toBe('not_started')
    expect(before.body.data.stages[0].items.every((i) => i.status === 'not_started')).toBe(true)

    await setProgress(projectId, items[0].id, foreman.userId, 40)

    const after = await request.authed('get', `/projects/${projectId}/stages`, foreman.token)
    expect(after.body.data.stages[0].status).toBe('in_progress')
    expect(after.body.data.stages[0].items[0].status).toBe('in_progress')
    expect(after.body.data.stages[0].items[1].status).toBe('not_started')
  })

  it('全部工序满 100 时阶段为「已完成」', async () => {
    const { projectId, foreman, items } = await setupProject({ itemWeights: [1, 1, 1] })

    for (const item of items) {
      await setProgress(projectId, item.id, foreman.userId, 100)
    }

    const res = await request.authed('get', `/projects/${projectId}/stages`, foreman.token)
    expect(res.body.data.stages[0].status).toBe('completed')
    expect(res.body.data.progress).toBe('100.00')
  })

  it('已验收的阶段即便完成度被下调，展示状态仍为「已验收」', async () => {
    const { projectId, foreman, items } = await setupProject({ itemWeights: [1, 1, 1] })
    for (const item of items) {
      await setProgress(projectId, item.id, foreman.userId, 100)
    }

    await db.query("UPDATE project_stage SET gate_status = 'accepted' WHERE project_id = ?", [projectId])

    // AC-P18 允许下调完成度，但阶段既然已经验收通过，就不该显示回「进行中」
    await setProgress(projectId, items[0].id, foreman.userId, 50)

    const res = await request.authed('get', `/projects/${projectId}/stages`, foreman.token)
    expect(res.body.data.stages[0].status).toBe('accepted')
    expect(res.body.data.stages[0].progress).not.toBe('100.00')
  })
})

describe('AC-P18 / AC-P19 变更留痕', () => {
  it('AC-P18 允许下调，每次变更都记录操作人、时间与变更前后值', async () => {
    const { projectId, foreman, items } = await setupProject()

    await setProgress(projectId, items[0].id, foreman.userId, 80)
    await setProgress(projectId, items[0].id, foreman.userId, 50) // 下调

    const logs = await db.query(
      'SELECT from_progress, to_progress, user_id, created_at FROM progress_log WHERE project_item_id = ? ORDER BY id',
      [items[0].id]
    )
    expect(logs).toHaveLength(2)
    expect(logs[0].from_progress).toBe('0.00')
    expect(logs[0].to_progress).toBe('80.00')
    expect(logs[1].from_progress).toBe('80.00')
    expect(logs[1].to_progress).toBe('50.00')
    expect(logs[1].user_id).toBe(foreman.userId)
    expect(logs[1].created_at).toBeTruthy()

    const item = await db.queryOne('SELECT progress FROM project_item WHERE id = ?', [items[0].id])
    expect(item.progress).toBe('50.00')
  })

  it('AC-P19 变更历史按时间倒序，含操作人昵称', async () => {
    const { projectId, foreman, items } = await setupProject()
    await db.query('UPDATE user SET nickname = ? WHERE id = ?', ['王工长', foreman.userId])

    await setProgress(projectId, items[0].id, foreman.userId, 20)
    await setProgress(projectId, items[0].id, foreman.userId, 60)

    const res = await request.authed(
      'get',
      `/projects/${projectId}/items/${items[0].id}/history`,
      foreman.token
    )

    expect(res.status).toBe(200)
    expect(res.body.data.currentProgress).toBe('60.00')
    // 倒序：最近的一次在最前
    expect(res.body.data.history[0].fromProgress).toBe('20.00')
    expect(res.body.data.history[0].toProgress).toBe('60.00')
    expect(res.body.data.history[0].operator).toBe('王工长')
    expect(res.body.data.history[1].fromProgress).toBe('0.00')
  })

  it('完成度不合法（非 5 的整数倍）被拒绝，且不留下任何痕迹', async () => {
    const { projectId, foreman, items } = await setupProject()

    await expect(setProgress(projectId, items[0].id, foreman.userId, 37)).rejects.toThrow(/5 的整数倍/)

    const item = await db.queryOne('SELECT progress FROM project_item WHERE id = ?', [items[0].id])
    expect(item.progress).toBe('0.00')
    expect(await db.count('FROM progress_log WHERE project_item_id = ?', [items[0].id])).toBe(0)
  })
})

describe('AC-P25 / 归属校验：谁能改进度、能改谁的', () => {
  it('非工长（业主、监理）改进度返回 403', async () => {
    const { projectId, items } = await setupProject()

    for (const [role, code] of [
      ['owner', 'code-owner-p25'],
      ['supervisor', 'code-supervisor-p25'],
    ]) {
      const outsider = await mini.login(code)
      await db.query(
        `INSERT INTO project_member (project_id, user_id, role, status, confirmed_at, joined_at)
         VALUES (?, ?, ?, 'active', NOW(), NOW())`,
        [projectId, outsider.userId, role]
      )

      await expect(setProgress(projectId, items[0].id, outsider.userId, 50)).rejects.toThrow(/仅该项目的工长/)
    }
  })

  it('未确认（pending）的工长也不能改进度（AC-AD18）', async () => {
    const { projectId, items } = await setupProject()
    const pending = await mini.login('code-pending-foreman')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status) VALUES (?, ?, 'foreman', 'pending')",
      [projectId, pending.userId]
    )

    await expect(setProgress(projectId, items[0].id, pending.userId, 50)).rejects.toThrow(/仅该项目的工长/)
  })

  it('不能用 A 项目的接口改 B 项目的工序', async () => {
    const { projectId, foreman, items } = await setupProject()

    const adminLogin = await auth.createAndLogin({ username: 'admin2', role: 'owner' })
    // 建档需要一个模板（不指定时会去找默认模板，而这里没有默认模板）
    const otherTemplateId = await fixtures.createTemplate({ name: '另一个模板' })
    const other = await request.authed('post', '/admin/projects', adminLogin.token).send({
      name: '另一个项目',
      address: '北京市某路 2 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
      templateId: otherTemplateId,
    })
    expect(other.status).toBe(200)

    // 拿 B 项目的工序 id，冒充 A 项目来改
    const otherItem = await db.queryOne(
      `SELECT i.id FROM project_item i
        JOIN project_stage s ON s.id = i.project_stage_id
       WHERE s.project_id = ? LIMIT 1`,
      [other.body.data.id]
    )

    await expect(setProgress(projectId, otherItem.id, foreman.userId, 50)).rejects.toThrow(/工序不存在/)
  })
})

describe('AC-S09 门禁强度对进度汇报的影响', () => {
  async function setGateStrength(value) {
    await db.query(
      `INSERT INTO sys_config (tenant_id, config_key, config_value, scope, description)
       VALUES (1, 'gate_strength', ?, 'global', 'test')
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
      [value]
    )
    sysConfigService.invalidate()
  }

  it('标准档（默认）：锁定阶段可正常汇报，但返回醒目提示', async () => {
    const { projectId, foreman, items } = await setupProject()
    await db.query("UPDATE project_stage SET gate_status = 'locked' WHERE project_id = ?", [projectId])
    await setGateStrength('standard')

    const result = await setProgress(projectId, items[0].id, foreman.userId, 50)

    // §4.7.3 的理由：卡汇报没有收益只有副作用 —— 一旦进度时间轴失真，
    // 本产品最核心的价值（进度透明、纠纷留证）就被摧毁了
    expect(result.changed).toBe(true)
    expect(result.warning.code).toBe('stage_locked')
    expect(result.warning.gateStrength).toBe('standard')
  })

  it('严格档：锁定阶段提交返回 409', async () => {
    const { projectId, foreman, items } = await setupProject()
    await db.query("UPDATE project_stage SET gate_status = 'locked' WHERE project_id = ?", [projectId])
    await setGateStrength('strict')

    await expect(setProgress(projectId, items[0].id, foreman.userId, 50)).rejects.toThrow(/未结清/)
  })

  it('宽松档：锁定阶段放行且仍给提示', async () => {
    const { projectId, foreman, items } = await setupProject()
    await db.query("UPDATE project_stage SET gate_status = 'locked' WHERE project_id = ?", [projectId])
    await setGateStrength('loose')

    const result = await setProgress(projectId, items[0].id, foreman.userId, 50)
    expect(result.changed).toBe(true)
    expect(result.warning.gateStrength).toBe('loose')
  })

  it('未锁定阶段不产生提示', async () => {
    const { projectId, foreman, items } = await setupProject()
    const result = await setProgress(projectId, items[0].id, foreman.userId, 50)
    expect(result.warning).toBeNull()
  })
})

describe('AC-AD16 项目内的增删改不影响源模板', () => {
  it('新增、改名、删除工序后，源模板保持不变', async () => {
    const { adminLogin, templateId, projectId, stage } = await setupProject()

    const snapshot = async () =>
      db.query(
        `SELECT s.name AS stage_name, i.name AS item_name, i.seq
           FROM stage_template_stage s
           LEFT JOIN stage_template_item i ON i.template_stage_id = s.id
          WHERE s.template_id = ?
          ORDER BY s.seq, i.seq`,
        [templateId]
      )
    const before = await snapshot()

    await request
      .authed('post', `/admin/projects/${projectId}/stages/${stage.id}/items`, adminLogin.token)
      .send({ name: '新增的工序' })
    await request
      .authed('put', `/admin/projects/${projectId}/items/${stage.items[0].id}`, adminLogin.token)
      .send({ name: '改过名的工序' })
    await request
      .authed('delete', `/admin/projects/${projectId}/items/${stage.items[1].id}`, adminLogin.token)

    expect(await snapshot()).toEqual(before)
  })

  it('新增阶段与删除阶段同样不影响模板', async () => {
    const { adminLogin, templateId, projectId } = await setupProject()

    const stageCount = () =>
      db.count('FROM stage_template_stage WHERE template_id = ? AND deleted_at IS NULL', [templateId])

    expect(await stageCount()).toBe(1)

    const added = await request
      .authed('post', `/admin/projects/${projectId}/stages`, adminLogin.token)
      .send({ name: '新增的阶段', planStart: '2026-02-01', planEnd: '2026-02-05' })
    expect(added.status).toBe(200)
    expect(added.body.data.gateStatus).toBe('locked') // 新阶段默认锁定，解锁由上一阶段结清触发

    await request
      .authed('delete', `/admin/projects/${projectId}/stages/${added.body.data.id}`, adminLogin.token)

    expect(await stageCount()).toBe(1)
  })

  it('新增工序后阶段完成度按新的工序数重算', async () => {
    const { adminLogin, projectId, foreman, stage, items } = await setupProject({ itemWeights: [null, null, null] })

    await setProgress(projectId, items[0].id, foreman.userId, 100)
    await setProgress(projectId, items[1].id, foreman.userId, 100)
    await setProgress(projectId, items[2].id, foreman.userId, 100)

    const before = await db.queryOne('SELECT progress FROM project_stage WHERE project_id = ?', [projectId])
    expect(before.progress).toBe('100.00')

    // 加一个 0 进度的工序，等权平均的分母变成 4 → 75
    await request
      .authed('post', `/admin/projects/${projectId}/stages/${stage.id}/items`, adminLogin.token)
      .send({ name: '新工序' })

    const after = await db.queryOne('SELECT progress FROM project_stage WHERE project_id = ?', [projectId])
    expect(after.progress).toBe('75.00')
  })
})

describe('阶段与工序的删除保护', () => {
  it('不能删掉某阶段的最后一个工序', async () => {
    const { adminLogin, projectId, stage, items } = await setupProject()

    // 先删到只剩一个
    await request.authed('delete', `/admin/projects/${projectId}/items/${items[1].id}`, adminLogin.token)
    await request.authed('delete', `/admin/projects/${projectId}/items/${items[2].id}`, adminLogin.token)

    const last = await request.authed('delete', `/admin/projects/${projectId}/items/${items[0].id}`, adminLogin.token)
    // 零个工序会让阶段完成度恒为 0，这个阶段就永远推进不到 100% 去触发验收，
    // 而界面上看不出任何异常
    expect(last.status).toBe(409)
    expect(last.body.message).toContain('至少')
    expect(await db.count('FROM project_item WHERE project_stage_id = ? AND deleted_at IS NULL', [stage.id])).toBe(1)
  })

  it('不能删掉项目的最后一个阶段', async () => {
    const { adminLogin, projectId, stage } = await setupProject()

    const res = await request.authed('delete', `/admin/projects/${projectId}/stages/${stage.id}`, adminLogin.token)
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('至少')
  })

  it('删除阶段会级联软删除其下工序', async () => {
    const { adminLogin, projectId, stage } = await setupProject()

    const extra = await request
      .authed('post', `/admin/projects/${projectId}/stages`, adminLogin.token)
      .send({ name: '临时阶段' })
    await request
      .authed('post', `/admin/projects/${projectId}/stages/${extra.body.data.id}/items`, adminLogin.token)
      .send({ name: '临时工序' })

    await request.authed('delete', `/admin/projects/${projectId}/stages/${extra.body.data.id}`, adminLogin.token)

    const remaining = await db.count('FROM project_item WHERE project_stage_id = ? AND deleted_at IS NULL', [
      extra.body.data.id,
    ])
    expect(remaining).toBe(0)
    // 原有阶段的工序不受影响
    expect(await db.count('FROM project_item WHERE project_stage_id = ? AND deleted_at IS NULL', [stage.id])).toBe(3)
  })

  it('归档项目的阶段工序不可改（AC-AD25）', async () => {
    const { adminLogin, projectId, stage } = await setupProject()
    await db.query("UPDATE project SET status = 'archived', archived_at = NOW() WHERE id = ?", [projectId])

    const res = await request
      .authed('post', `/admin/projects/${projectId}/stages/${stage.id}/items`, adminLogin.token)
      .send({ name: '不该被加进去的工序' })
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('归档')
  })
})

describe('C 端进度接口的可见性', () => {
  it('非参与成员访问阶段树返回 404，与「项目不存在」提示一致', async () => {
    const { projectId } = await setupProject()
    const outsider = await mini.login('code-outsider-m6')

    const notMine = await mini.authed('get', `/projects/${projectId}/stages`, outsider.token)
    const notExist = await mini.authed('get', '/projects/999999/stages', outsider.token)

    expect(notMine.status).toBe(404)
    expect(notMine.body.message).toBe(notExist.body.message)
  })

  it('非参与成员访问完成度历史返回 404', async () => {
    const { projectId, items } = await setupProject()
    const outsider = await mini.login('code-outsider-history')

    const res = await mini.authed(
      'get',
      `/projects/${projectId}/items/${items[0].id}/history`,
      outsider.token
    )
    expect(res.status).toBe(404)
  })

  it('阶段树返回 isPrimaryForeman，供前端控制验收入口（Q11）', async () => {
    const { projectId, foreman } = await setupProject()
    const res = await mini.authed('get', `/projects/${projectId}/stages`, foreman.token)
    expect(res.body.data.isPrimaryForeman).toBe(true)
  })
})
