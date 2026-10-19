'use strict'

/**
 * B 端阶段模板管理集成测试（B-3.x / AC-AD28~35、62~64）。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
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

async function admin(role = 'owner', username = 'tpladmin') {
  return auth.createAndLogin({ username, role })
}

/** 一个合法的模板结构：2 个阶段，每个 2 个工序 */
function validStructure() {
  return [
    {
      name: '开工准备',
      planDays: 2,
      items: [{ name: '现场交底' }, { name: '成品保护' }],
    },
    {
      name: '水电工程',
      planDays: 10,
      items: [
        { name: '强电布线', checklist: ['强弱电分管分槽，间距 ≥ 30cm', '线管固定牢固，无松动'] },
        { name: '水路改造' },
      ],
    },
  ]
}

describe('AC-AD28 模板列表', () => {
  it('展示模板名、阶段数、工序数、是否默认、创建时间与引用项目数', async () => {
    const { token } = await admin()
    await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '我的模板', stages: validStructure() })

    const res = await request.authed('get', '/admin/stage-templates', token)
    expect(res.status).toBe(200)

    const item = res.body.data.list[0]
    expect(item.name).toBe('我的模板')
    expect(item.stageCount).toBe(2)
    expect(item.itemCount).toBe(4)
    expect(item.isDefault).toBe(false)
    expect(item.referencingProjectCount).toBe(0)
    expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('引用项目数随之变化（AC-AD35 的展示依据）', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '被引用的模板', stages: validStructure() })
    const templateId = created.body.data.id

    const project = await request
      .authed('post', '/admin/projects', token)
      .send({
        name: '项目',
        address: '上海市某路 1 号',
        contractAmount: '100000.00',
        startDate: '2026-01-01',
        planEndDate: '2026-06-01',
        templateId,
      })
    expect(project.status).toBe(200)

    const res = await request.authed('get', '/admin/stage-templates', token)
    expect(res.body.data.list[0].referencingProjectCount).toBe(1)
  })

  it('支持按关键字搜索与只看默认模板', async () => {
    const { token } = await admin()
    await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '家装标准流程', stages: validStructure(), isDefault: true })
    await request.authed('post', '/admin/stage-templates', token).send({ name: '工装流程', stages: validStructure() })

    const byKeyword = await request.authed('get', '/admin/stage-templates?keyword=工装', token)
    expect(byKeyword.body.data.list.map((t) => t.name)).toEqual(['工装流程'])

    const onlyDefault = await request.authed('get', '/admin/stage-templates?onlyDefault=true', token)
    expect(onlyDefault.body.data.list).toHaveLength(1)
    expect(onlyDefault.body.data.list[0].name).toBe('家装标准流程')
  })

  it('强制分页（AC-AD45）', async () => {
    const { token } = await admin()
    for (let i = 0; i < 3; i += 1) {
      await request
        .authed('post', '/admin/stage-templates', token)
        .send({ name: `模板${i}`, stages: validStructure() })
    }
    const res = await request.authed('get', '/admin/stage-templates?pageSize=2', token)
    expect(res.body.data.list).toHaveLength(2)
    expect(res.body.data.total).toBe(3)
    expect(res.body.data.totalPages).toBe(2)
  })
})

describe('AC-AD64 结构约束：至少 1 阶段、每阶段至少 1 工序', () => {
  it('没有阶段时拒绝', async () => {
    const { token } = await admin()
    const res = await request.authed('post', '/admin/stage-templates', token).send({ name: '空模板', stages: [] })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('至少')
  })

  it('阶段下没有工序时拒绝', async () => {
    const { token } = await admin()
    const res = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '空阶段', stages: [{ name: '开工准备', planDays: 2, items: [] }] })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('工序')
  })

  it('编辑时把工序删空同样被拒绝', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '模板', stages: validStructure() })

    const res = await request
      .authed('put', `/admin/stage-templates/${created.body.data.id}`, token)
      .send({ stages: [{ name: '只剩一个阶段', planDays: 3, items: [] }] })
    expect(res.status).toBe(400)
  })

  it('阶段名称或计划工期缺失时拒绝（AC-AD30）', async () => {
    const { token } = await admin()
    for (const bad of [
      [{ planDays: 2, items: [{ name: 'A' }] }],
      [{ name: '  ', planDays: 2, items: [{ name: 'A' }] }],
      [{ name: '阶段', items: [{ name: 'A' }] }],
    ]) {
      const res = await request.authed('post', '/admin/stage-templates', token).send({ name: '模板', stages: bad })
      expect(res.status).toBe(400)
    }
  })

  it('计划工期只接受正整数（AC-AD30）', async () => {
    const { token } = await admin()
    for (const planDays of [0, -1, 1.5, 'abc']) {
      const res = await request
        .authed('post', '/admin/stage-templates', token)
        .send({ name: '模板', stages: [{ name: '阶段', planDays, items: [{ name: '工序' }] }] })
      expect(res.status).toBe(400)
    }

    const ok = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '模板', stages: [{ name: '阶段', planDays: 1, items: [{ name: '工序' }] }] })
    expect(ok.status).toBe(200)
  })

  it('工序名称为空时拒绝（AC-AD31）', async () => {
    const { token } = await admin()
    const res = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '模板', stages: [{ name: '阶段', planDays: 1, items: [{ name: '   ' }] }] })
    expect(res.status).toBe(400)
  })

  it('权重只接受正数，传 0 或负数被拒绝而不是静默忽略（AC-AD23）', async () => {
    const { token } = await admin()
    for (const weight of ['0', '-1']) {
      const res = await request
        .authed('post', '/admin/stage-templates', token)
        .send({ name: '模板', stages: [{ name: '阶段', planDays: 1, weight, items: [{ name: '工序' }] }] })
      expect(res.status).toBe(400)
      expect(res.body.message).toContain('正数')
    }

    const ok = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '模板', stages: [{ name: '阶段', planDays: 1, weight: '2', items: [{ name: '工序' }] }] })
    expect(ok.status).toBe(200)
    expect(ok.body.data.stages[0].weight).toBe('2.00')
  })
})

describe('AC-AD29 / AC-AD62 顺序持久化', () => {
  it('保存时的数组顺序即为 seq，重进页面保持一致', async () => {
    const { token } = await admin()
    const created = await request.authed('post', '/admin/stage-templates', token).send({
      name: '顺序模板',
      stages: [
        { name: '甲阶段', planDays: 1, items: [{ name: '甲工序' }, { name: '乙工序' }] },
        { name: '乙阶段', planDays: 2, items: [{ name: '丙工序' }] },
      ],
    })
    const templateId = created.body.data.id

    // 模拟拖拽后的整体提交：把两个阶段与甲阶段内的两个工序都调换顺序
    const reordered = await request.authed('put', `/admin/stage-templates/${templateId}`, token).send({
      stages: [
        { name: '乙阶段', planDays: 2, items: [{ name: '丙工序' }] },
        { name: '甲阶段', planDays: 1, items: [{ name: '乙工序' }, { name: '甲工序' }] },
      ],
    })
    expect(reordered.status).toBe(200)

    // 重新读取（模拟「重进页面」）
    const detail = await request.authed('get', `/admin/stage-templates/${templateId}`, token)
    expect(detail.body.data.stages.map((s) => s.name)).toEqual(['乙阶段', '甲阶段'])
    expect(detail.body.data.stages.map((s) => s.seq)).toEqual([1, 2])
    expect(detail.body.data.stages[1].items.map((i) => i.name)).toEqual(['乙工序', '甲工序'])
    expect(detail.body.data.stages[1].items.map((i) => i.seq)).toEqual([1, 2])

    // 数据库里的 seq 也确实是重写过的，而不是残留旧值
    const rows = await db.query(
      'SELECT name, seq FROM stage_template_stage WHERE template_id = ? ORDER BY seq',
      [templateId]
    )
    expect(rows.map((r) => r.name)).toEqual(['乙阶段', '甲阶段'])
  })

  it('整体替换后不会残留旧行（编辑十次不会攒十份数据）', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '模板', stages: validStructure() })
    const templateId = created.body.data.id

    for (let i = 0; i < 5; i += 1) {
      await request
        .authed('put', `/admin/stage-templates/${templateId}`, token)
        .send({ stages: [{ name: `第${i}版阶段`, planDays: 1, items: [{ name: '工序' }] }] })
    }

    const stageCount = await db.count('FROM stage_template_stage WHERE template_id = ?', [templateId])
    const itemCount = await db.count(
      'FROM stage_template_item i JOIN stage_template_stage s ON s.id = i.template_stage_id WHERE s.template_id = ?',
      [templateId]
    )
    // 模板的阶段工序没有任何东西引用（项目里是拷贝的副本），因此物理删除是安全的
    expect(stageCount).toBe(1)
    expect(itemCount).toBe(1)
  })

  it('只改名称时不传 stages，结构不被清空', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '旧名字', stages: validStructure() })
    const templateId = created.body.data.id

    const res = await request.authed('put', `/admin/stage-templates/${templateId}`, token).send({ name: '新名字' })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('新名字')
    // 重命名不该要求前端回传整个结构 —— 那样反而容易把结构改成前端持有的旧版本
    expect(res.body.data.stages).toHaveLength(2)
  })
})

describe('AC-AD31 / AC-AD32 工序与默认验收项清单', () => {
  it('工序可增删改，验收项清单原样保存', async () => {
    const { token } = await admin()
    const created = await request.authed('post', '/admin/stage-templates', token).send({
      name: '带清单的模板',
      stages: [
        {
          name: '水电工程',
          planDays: 10,
          items: [
            { name: '强电布线', checklist: ['强弱电分管分槽，间距 ≥ 30cm', '线管固定牢固，无松动'] },
            { name: '水路改造' },
          ],
        },
      ],
    })

    const detail = await request.authed('get', `/admin/stage-templates/${created.body.data.id}`, token)
    expect(detail.body.data.stages[0].items[0].checklist).toEqual([
      '强弱电分管分槽，间距 ≥ 30cm',
      '线管固定牢固，无松动',
    ])
    expect(detail.body.data.stages[0].items[1].checklist).toEqual([])
  })

  it('清单里的空串被丢弃，不产生空验收项', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({
        name: '模板',
        stages: [{ name: '阶段', planDays: 1, items: [{ name: '工序', checklist: ['有效项', '  ', ''] }] }],
      })

    const detail = await request.authed('get', `/admin/stage-templates/${created.body.data.id}`, token)
    expect(detail.body.data.stages[0].items[0].checklist).toEqual(['有效项'])
  })

  it('AC-AD32 验收项清单随模板带入生成的项目工序', async () => {
    const { token } = await admin()
    const created = await request.authed('post', '/admin/stage-templates', token).send({
      name: '水电模板',
      stages: [
        {
          name: '水电工程',
          planDays: 10,
          items: [{ name: '强电布线', checklist: ['强弱电分管分槽，间距 ≥ 30cm', '开关插座位置与图纸一致'] }],
        },
      ],
    })

    const project = await request.authed('post', '/admin/projects', token).send({
      name: '项目',
      address: '上海市某路 1 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
      templateId: created.body.data.id,
    })

    // 清单落在 project_item.checklist 上，M8 生成验收单时从这里读。
    // 用接口返回的 projectId 而不是写死 1 —— 自增 id 不保证从 1 开始
    // （测试夹具用 DELETE 清表，不重置 AUTO_INCREMENT）
    const item = await db.queryOne(
      `SELECT i.checklist FROM project_item i
        JOIN project_stage s ON s.id = i.project_stage_id
       WHERE s.project_id = ? AND i.name = '强电布线'`,
      [project.body.data.id]
    )
    const checklist = typeof item.checklist === 'string' ? JSON.parse(item.checklist) : item.checklist
    expect(checklist.map((c) => c.name)).toEqual(['强弱电分管分槽，间距 ≥ 30cm', '开关插座位置与图纸一致'])
  })
})

describe('AC-AD33 默认模板', () => {
  it('默认模板不可删除', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '默认模板', stages: validStructure(), isDefault: true })

    const res = await request.authed('delete', `/admin/stage-templates/${created.body.data.id}`, token)
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('默认模板不可删除')
  })

  it('全系统至多一个默认模板，设为默认会顶掉旧的', async () => {
    const { token } = await admin()
    const first = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '甲模板', stages: validStructure(), isDefault: true })
    const second = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '乙模板', stages: validStructure(), isDefault: true })

    // 新建时把 isDefault 置 true，服务层会先清掉旧的默认（唯一索引不允许并存）
    const list = await request.authed('get', '/admin/stage-templates', token)
    const defaults = list.body.data.list.filter((t) => t.isDefault)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].name).toBe('乙模板')
    // 甲模板被顶掉了
    const firstAfter = await request.authed('get', `/admin/stage-templates/${first.body.data.id}`, token)
    expect(firstAfter.body.data.isDefault).toBe(false)

    // 再改指回来
    const back = await request.authed('put', `/admin/stage-templates/${first.body.data.id}/default`, token)
    expect(back.status).toBe(200)

    const after = await request.authed('get', '/admin/stage-templates', token)
    expect(after.body.data.list.filter((t) => t.isDefault).map((t) => t.name)).toEqual(['甲模板'])

    const secondAfter = await request.authed('get', `/admin/stage-templates/${second.body.data.id}`, token)
    expect(secondAfter.body.data.isDefault).toBe(false)
  })

  it('数据库层兜底：绕过接口插入第二个默认模板会被唯一索引拦下（AC-AD33）', async () => {
    await db.query("INSERT INTO stage_template (tenant_id, name, is_default) VALUES (1, '默认甲', 1)")
    await expect(
      db.query("INSERT INTO stage_template (tenant_id, name, is_default) VALUES (1, '默认乙', 1)")
    ).rejects.toThrow(/Duplicate entry/)
  })

  it('已是默认模板时重复设置返回 409', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '默认模板', stages: validStructure(), isDefault: true })

    const res = await request.authed('put', `/admin/stage-templates/${created.body.data.id}/default`, token)
    expect(res.status).toBe(409)
  })

  it('新建项目未指定模板时使用默认模板（B-2.5）', async () => {
    const { token } = await admin()
    await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '默认模板', stages: validStructure(), isDefault: true })
    await request.authed('post', '/admin/stage-templates', token).send({ name: '非默认', stages: validStructure() })

    const res = await request.authed('post', '/admin/projects', token).send({
      name: '项目',
      address: '上海市某路 1 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.stageCount).toBe(2)
  })
})

describe('AC-AD34 模板复制', () => {
  it('副本与源模板内容一致', async () => {
    const { token } = await admin()
    const source = await request.authed('post', '/admin/stage-templates', token).send({
      name: '源模板',
      stages: [
        { name: '甲阶段', planDays: 3, weight: '2', items: [{ name: '甲工序', weight: '1', checklist: ['检查项一'] }] },
        { name: '乙阶段', planDays: 5, items: [{ name: '乙工序' }] },
      ],
    })

    const copy = await request
      .authed('post', `/admin/stage-templates/${source.body.data.id}/duplicate`, token)
      .send({ name: '副本模板' })

    expect(copy.status).toBe(200)
    expect(copy.body.data.name).toBe('副本模板')
    expect(copy.body.data.isDefault).toBe(false)

    // 结构逐项一致（id 除外）
    const strip = (stages) =>
      stages.map((s) => ({
        name: s.name,
        planDays: s.planDays,
        weight: s.weight,
        items: s.items.map((i) => ({ name: i.name, weight: i.weight, checklist: i.checklist })),
      }))
    expect(strip(copy.body.data.stages)).toEqual(strip(source.body.data.stages))
  })

  it('副本与源模板相互独立：改副本不影响源模板', async () => {
    const { token } = await admin()
    const source = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '源模板', stages: validStructure() })
    const copy = await request
      .authed('post', `/admin/stage-templates/${source.body.data.id}/duplicate`, token)
      .send({ name: '副本模板' })

    await request
      .authed('put', `/admin/stage-templates/${copy.body.data.id}`, token)
      .send({ stages: [{ name: '完全不同的阶段', planDays: 1, items: [{ name: '工序' }] }] })

    const sourceAfter = await request.authed('get', `/admin/stage-templates/${source.body.data.id}`, token)
    expect(sourceAfter.body.data.stages.map((s) => s.name)).toEqual(['开工准备', '水电工程'])

    // 反向：改源模板不影响副本
    await request
      .authed('put', `/admin/stage-templates/${source.body.data.id}`, token)
      .send({ stages: [{ name: '源改了', planDays: 1, items: [{ name: '工序' }] }] })

    const copyAfter = await request.authed('get', `/admin/stage-templates/${copy.body.data.id}`, token)
    expect(copyAfter.body.data.stages.map((s) => s.name)).toEqual(['完全不同的阶段'])
  })

  it('源模板不存在时返回 404', async () => {
    const { token } = await admin()
    const res = await request.authed('post', '/admin/stage-templates/999999/duplicate', token).send({ name: '副本' })
    expect(res.status).toBe(404)
  })
})

describe('AC-AD35 引用保护', () => {
  it('已被项目引用的模板不可删除，且返回被引用的项目数', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '被引用的模板', stages: validStructure() })
    const templateId = created.body.data.id

    for (let i = 0; i < 2; i += 1) {
      await request.authed('post', '/admin/projects', token).send({
        name: `项目${i}`,
        address: '上海市某路 1 号',
        contractAmount: '100000.00',
        startDate: '2026-01-01',
        planEndDate: '2026-06-01',
        templateId,
      })
    }

    const res = await request.authed('delete', `/admin/stage-templates/${templateId}`, token)
    expect(res.status).toBe(409)
    expect(res.body.data.referencingProjectCount).toBe(2)
    expect(res.body.message).toContain('2 个项目')
  })

  it('未被引用的模板可以删除', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '没人用的模板', stages: validStructure() })

    const res = await request.authed('delete', `/admin/stage-templates/${created.body.data.id}`, token)
    expect(res.status).toBe(200)

    const list = await request.authed('get', '/admin/stage-templates', token)
    expect(list.body.data.total).toBe(0)
  })

  it('删除后详情返回 404，不会读到软删除的数据', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '模板', stages: validStructure() })
    await request.authed('delete', `/admin/stage-templates/${created.body.data.id}`, token)

    const res = await request.authed('get', `/admin/stage-templates/${created.body.data.id}`, token)
    expect(res.status).toBe(404)
  })
})

describe('AC-AD63 编辑被引用的模板时明确提示', () => {
  it('改结构后返回「不影响已生成的 N 个项目」', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '模板', stages: validStructure() })
    const templateId = created.body.data.id

    await request.authed('post', '/admin/projects', token).send({
      name: '项目',
      address: '上海市某路 1 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
      templateId,
    })

    const res = await request
      .authed('put', `/admin/stage-templates/${templateId}`, token)
      .send({ stages: [{ name: '改过的阶段', planDays: 1, items: [{ name: '改过的工序' }] }] })

    expect(res.status).toBe(200)
    expect(res.body.data.referencingProjectCount).toBe(1)
    expect(res.body.data.notice).toContain('不影响已生成的 1 个项目')

    // 详情页也带着这个数字，供编辑器顶部渲染提示
    const detail = await request.authed('get', `/admin/stage-templates/${templateId}`, token)
    expect(detail.body.data.referencingProjectCount).toBe(1)
    // 模板与项目实例之间没有引用关系，「不回溯」是天然成立的
    expect(detail.body.data.affectsExistingProjects).toBe(false)
  })

  it('未被引用时没有提示文案', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '模板', stages: validStructure() })

    const res = await request
      .authed('put', `/admin/stage-templates/${created.body.data.id}`, token)
      .send({ name: '改名' })
    expect(res.body.data.notice).toBeNull()
  })

  it('真正验证「改了模板，已生成的项目不变」（AC-AD17 的端到端版本）', async () => {
    const { token } = await admin()
    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: '模板', stages: validStructure() })
    const templateId = created.body.data.id

    const project = await request.authed('post', '/admin/projects', token).send({
      name: '项目',
      address: '上海市某路 1 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
      templateId,
    })

    const before = await request.authed('get', `/admin/projects/${project.body.data.id}`, token)

    await request
      .authed('put', `/admin/stage-templates/${templateId}`, token)
      .send({
        stages: [
          { name: '被彻底改掉的阶段', planDays: 99, items: [{ name: '被彻底改掉的工序' }] },
        ],
      })

    const after = await request.authed('get', `/admin/projects/${project.body.data.id}`, token)
    expect(after.body.data.stages.map((s) => s.name)).toEqual(before.body.data.stages.map((s) => s.name))
    expect(after.body.data.stages[0].items.map((i) => i.name)).toEqual(
      before.body.data.stages[0].items.map((i) => i.name)
    )
    expect(after.body.data.stages[0].planDays ?? after.body.data.stages[0].planEnd).toBe(
      before.body.data.stages[0].planEnd
    )
  })
})

describe('模板管理权限（§5.1）', () => {
  it('项目管理员同样可以管理模板（模板是全局资源，不做项目隔离）', async () => {
    const { token } = await admin('admin', 'pm-template')

    const created = await request
      .authed('post', '/admin/stage-templates', token)
      .send({ name: 'PM 建的模板', stages: validStructure() })
    expect(created.status).toBe(200)

    expect((await request.authed('get', '/admin/stage-templates', token)).body.data.total).toBe(1)
    expect((await request.authed('put', `/admin/stage-templates/${created.body.data.id}`, token).send({ name: '改个名' })).status).toBe(200)
    expect((await request.authed('delete', `/admin/stage-templates/${created.body.data.id}`, token)).status).toBe(200)
  })

  it('未登录访问一律 401', async () => {
    expect((await request.get('/admin/stage-templates')).status).toBe(401)
    expect((await request.post('/admin/stage-templates')).status).toBe(401)
  })
})
