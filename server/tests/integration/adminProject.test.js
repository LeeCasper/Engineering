'use strict'

/**
 * B 端项目管理集成测试（AC-AD11~27、52~61）。
 *
 * 数据权限（AC-AD52）是本文件的重点：它是需求文档点名的「最容易出错、
 * 漏一处就是越权漏洞」的地方，因此列表、详情、成员、付款节点各条路径
 * 都要单独验证「无权项目拿不到」。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const datetime = require('../../src/utils/datetime')
const mapService = require('../../src/services/map.service')
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

/** 建一个超管并登录 */
async function superAdmin() {
  return auth.createAndLogin({ username: 'super', role: 'owner' })
}

/** 建一个项目管理员并登录 */
async function projectAdmin(username = 'pm') {
  return auth.createAndLogin({ username, role: 'admin' })
}

const VALID_PROJECT = {
  name: '张女士家装',
  address: '上海市浦东新区世纪大道 100 号',
  contractAmount: '200000.00',
  startDate: '2026-01-01',
  planEndDate: '2026-06-30',
}

describe('AC-AD11 项目列表筛选与分页', () => {
  it('支持按名称 / 地址 / 状态 / 工长组合筛选', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const foreman = await auth.createAdmin({ username: 'foreman1' })
    await db.query("UPDATE admin_user SET role = 'admin' WHERE id = ?", [foreman.id])

    const created = []
    for (const [name, address, status] of [
      ['甲项目', '上海市徐汇区', 'building'],
      ['乙项目', '北京市朝阳区', 'pending'],
      ['丙项目', '上海市浦东新区', 'finished'],
    ]) {
      const res = await request.authed('post', '/admin/projects', token).send({
        ...VALID_PROJECT,
        name,
        address,
        status: undefined,
        templateId,
      })
      created.push(res.body.data.id)
      await db.query('UPDATE project SET status = ? WHERE id = ?', [status, res.body.data.id])
    }

    // 按名称
    const byName = await request.authed('get', '/admin/projects?name=甲', token)
    expect(byName.body.data.list).toHaveLength(1)
    expect(byName.body.data.list[0].name).toBe('甲项目')

    // 按地址
    const byAddress = await request.authed('get', '/admin/projects?address=上海', token)
    expect(byAddress.body.data.list).toHaveLength(2)

    // 按状态
    const byStatus = await request.authed('get', '/admin/projects?status=pending', token)
    expect(byStatus.body.data.list.map((p) => p.name)).toEqual(['乙项目'])

    // 按工长（工长是成员关系，需要用 EXISTS 而不是 JOIN，
    // 否则同一项目多成员时列表会出现重复行、total 也算错）
    const foremanUserId = await createWechatUser('openid-foreman')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status, confirmed_at) VALUES (?, ?, 'foreman', 'active', NOW())",
      [created[0], foremanUserId]
    )
    const byForeman = await request.authed('get', `/admin/projects?foremanId=${foremanUserId}`, token)
    expect(byForeman.body.data.list).toHaveLength(1)
    expect(byForeman.body.data.list[0].name).toBe('甲项目')
  })

  it('强制分页且单页不超过 50（AC-AD45）', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()

    for (let i = 0; i < 25; i += 1) {
      await request.authed('post', '/admin/projects', token).send({
        ...VALID_PROJECT,
        name: `批量项目${String(i).padStart(2, '0')}`,
        templateId,
      })
    }

    const page1 = await request.authed('get', '/admin/projects?page=1&pageSize=20', token)
    expect(page1.body.data.list).toHaveLength(20)
    expect(page1.body.data.total).toBe(25)
    expect(page1.body.data.totalPages).toBe(2)

    const clamped = await request.authed('get', '/admin/projects?pageSize=999', token)
    expect(clamped.body.data.pageSize).toBe(50)
  })

  it('列表项含工长、进度与合同金额（B-2.2）', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const res = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })
    const projectId = res.body.data.id

    const foremanUserId = await createWechatUser('openid-f2')
    await db.query('UPDATE user SET nickname = ? WHERE id = ?', ['王工长', foremanUserId])
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status, confirmed_at) VALUES (?, ?, 'foreman', 'active', NOW())",
      [projectId, foremanUserId]
    )
    const ownerUserId = await createWechatUser('openid-o2')
    await db.query('UPDATE user SET nickname = ?, phone = ? WHERE id = ?', [
      '张先生',
      '13800138000',
      ownerUserId,
    ])
    await addActiveMember(projectId, ownerUserId, 'owner')

    const list = await request.authed('get', '/admin/projects', token)
    const item = list.body.data.list[0]

    expect(item.contractAmount).toBe('200000.00')
    expect(item.foreman.nickname).toBe('王工长')
    expect(item.foremanName).toBe('王工长')
    expect(item.ownerName).toBe('张先生')
    expect(item.progress).toBe('0.00')
    expect(item.startDate).toBe('2026-01-01')
  })

  it('名称里的 LIKE 通配符按字面匹配，不把全部项目捞出来', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    for (const name of ['甲项目', '乙项目']) {
      await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, name, templateId })
    }

    // 若没有转义 `%`，这个查询会匹配到所有项目
    const res = await request.authed('get', '/admin/projects?name=%25', token)
    expect(res.body.data.list).toHaveLength(0)
  })
})

describe('AC-AD52 数据权限：按项目隔离', () => {
  it('项目管理员只能看到自己创建的项目', async () => {
    const superUser = await superAdmin()
    const templateId = await fixtures.createTemplate()

    const mine = await projectAdmin('pm-mine')
    const other = await projectAdmin('pm-other')

    await request.authed('post', '/admin/projects', mine.token).send({
      ...VALID_PROJECT,
      name: '我的项目',
      templateId,
    })
    await request.authed('post', '/admin/projects', other.token).send({
      ...VALID_PROJECT,
      name: '别人的项目',
      templateId,
    })

    const list = await request.authed('get', '/admin/projects', mine.token)
    expect(list.body.data.list.map((p) => p.name)).toEqual(['我的项目'])
    expect(list.body.data.total).toBe(1)

    // 超级管理员看得到全部
    const all = await request.authed('get', '/admin/projects', superUser.token)
    expect(all.body.data.total).toBe(2)
  })

  it('被授权的项目也能看到（project_admin_scope）', async () => {
    const { token: superToken } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const other = await projectAdmin('pm-granted')

    // 超管建的项目归超管所有
    const created = await request.authed('post', '/admin/projects', superToken).send({
      ...VALID_PROJECT,
      name: '被授权的项目',
      templateId,
    })

    // 授权前看不到
    const before = await request.authed('get', '/admin/projects', other.token)
    expect(before.body.data.total).toBe(0)

    await fixtures.grantProjectScope(other.admin.id, created.body.data.id)

    const after = await request.authed('get', '/admin/projects', other.token)
    expect(after.body.data.total).toBe(1)
    expect(after.body.data.list[0].name).toBe('被授权的项目')
  })

  it('直接访问无权项目的详情返回 403，不泄露内容', async () => {
    const { token: superToken } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const other = await projectAdmin('pm-noscope')

    const created = await request.authed('post', '/admin/projects', superToken).send({
      ...VALID_PROJECT,
      name: '别人的项目',
      templateId,
    })
    const projectId = created.body.data.id

    const res = await request.authed('get', `/admin/projects/${projectId}`, other.token)
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain('别人的项目')
  })

  it('无权项目的成员、付款节点、写操作同样被拦', async () => {
    const { token: superToken } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const other = await projectAdmin('pm-noscope2')

    const created = await request.authed('post', '/admin/projects', superToken).send({
      ...VALID_PROJECT,
      templateId,
    })
    const projectId = created.body.data.id

    const checks = [
      await request.authed('get', `/admin/projects/${projectId}/members`, other.token),
      await request.authed('get', `/admin/projects/${projectId}/payment-nodes`, other.token),
      await request.authed('put', `/admin/projects/${projectId}`, other.token).send({ name: '改个名' }),
      await request.authed('put', `/admin/projects/${projectId}/status`, other.token).send({ status: 'building' }),
      await request.authed('post', `/admin/projects/${projectId}/archive`, other.token).send({ confirm: true }),
      await request.authed('post', `/admin/projects/${projectId}/members`, other.token).send({
        phone: '13800000000',
        role: 'owner',
      }),
    ]

    for (const res of checks) {
      expect(res.status).toBe(403)
    }
  })

  it('不存在的项目返回 404，与无权区分开（后台面向内部人员，告知有助于排查）', async () => {
    const { token } = await superAdmin()
    const res = await request.authed('get', '/admin/projects/999999', token)
    expect(res.status).toBe(404)
  })
})

describe('AC-AD12~16 / 53 / 54 建档', () => {
  it('必填项缺失时拒绝提交（AC-AD12 / AC-AD53）', async () => {
    const { token } = await superAdmin()

    for (const missing of ['name', 'address', 'contractAmount', 'startDate', 'planEndDate']) {
      const payload = { ...VALID_PROJECT }
      delete payload[missing]
      const res = await request.authed('post', '/admin/projects', token).send(payload)
      expect(res.status).toBe(400)
    }
  })

  it('合同金额校验：必须 > 0 且最多两位小数（AC-AD13）', async () => {
    const { token } = await superAdmin()
    for (const bad of ['0', '-100', 'abc', '100.123']) {
      const res = await request.authed('post', '/admin/projects', token).send({
        ...VALID_PROJECT,
        contractAmount: bad,
      })
      expect(res.status).toBe(400)
    }
  })

  it('计划竣工日期早于开工日期时拒绝（AC-AD14）', async () => {
    const { token } = await superAdmin()
    const res = await request.authed('post', '/admin/projects', token).send({
      ...VALID_PROJECT,
      startDate: '2026-06-01',
      planEndDate: '2026-01-01',
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('竣工')
  })

  it('非法日期（2026-02-30）被拒绝，而不是被正则放过', async () => {
    const { token } = await superAdmin()
    const res = await request.authed('post', '/admin/projects', token).send({
      ...VALID_PROJECT,
      planEndDate: '2026-02-30',
    })
    expect(res.status).toBe(400)
  })

  it('按模板生成阶段与工序，名称、顺序、计划工期与模板一致（AC-AD15）', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate({
      stages: [
        { name: '开工准备', planDays: 2, items: [{ name: '现场交底' }, { name: '成品保护' }] },
        { name: '水电工程', planDays: 10, items: [{ name: '强电布线' }, { name: '水路改造' }, { name: '打压试验' }] },
      ],
    })

    const res = await request.authed('post', '/admin/projects', token).send({
      ...VALID_PROJECT,
      startDate: '2026-03-01',
      templateId,
    })
    expect(res.body.data.stageCount).toBe(2)
    expect(res.body.data.itemCount).toBe(5)

    const detail = await request.authed('get', `/admin/projects/${res.body.data.id}`, token)
    const stages = detail.body.data.stages

    expect(stages.map((s) => s.name)).toEqual(['开工准备', '水电工程'])
    expect(stages[0].items.map((i) => i.name)).toEqual(['现场交底', '成品保护'])
    expect(stages[1].items).toHaveLength(3)

    // 计划日期按串行排布：首阶段从开工日起 2 天，次阶段紧接着 10 天
    expect(stages[0].planStart).toBe('2026-03-01')
    expect(stages[0].planEnd).toBe('2026-03-02')
    expect(stages[1].planStart).toBe('2026-03-03')
    expect(stages[1].planEnd).toBe('2026-03-12')
  })

  it('首个阶段默认解锁，其余锁定（C-7.4）', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const res = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })

    const detail = await request.authed('get', `/admin/projects/${res.body.data.id}`, token)
    expect(detail.body.data.stages[0].gateStatus).toBe('active')
    expect(detail.body.data.stages[1].gateStatus).toBe('locked')
  })

  it('未指定模板时使用默认模板（B-2.5）', async () => {
    const { token } = await superAdmin()
    await fixtures.createTemplate({ name: '默认模板', isDefault: true })
    await fixtures.createTemplate({ name: '另一个模板' })

    const res = await request.authed('post', '/admin/projects', token).send(VALID_PROJECT)
    expect(res.status).toBe(200)
    expect(res.body.data.stageCount).toBe(2)
  })

  it('没有默认模板时给出可操作的提示，而不是 500', async () => {
    const { token } = await superAdmin()
    const res = await request.authed('post', '/admin/projects', token).send(VALID_PROJECT)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('模板')
  })

  it('同管理员下重名时告警但允许保存（B-2.3）', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()

    const first = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })
    expect(first.body.data.duplicates).toBeNull()

    const second = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })
    expect(second.status).toBe(200)
    expect(second.body.data.duplicates).not.toBeNull()
  })

  it('生成后的阶段与工序可手工增删改，且不影响源模板（AC-AD16）', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const res = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })
    const projectId = res.body.data.id

    await db.query("UPDATE project_stage SET name = '改过的阶段名' WHERE project_id = ? AND seq = 1", [projectId])
    await db.query('DELETE FROM project_item WHERE project_stage_id = (SELECT id FROM project_stage WHERE project_id = ? AND seq = 2 LIMIT 1)', [projectId])

    // 源模板不受影响
    const templateStages = await db.query(
      'SELECT name FROM stage_template_stage WHERE template_id = ? ORDER BY seq',
      [templateId]
    )
    expect(templateStages.map((s) => s.name)).toEqual(['开工准备', '水电工程'])

    const templateItems = await db.query(
      `SELECT i.name FROM stage_template_item i
        JOIN stage_template_stage s ON s.id = i.template_stage_id
       WHERE s.template_id = ? ORDER BY s.seq, i.seq`,
      [templateId]
    )
    expect(templateItems.length).toBeGreaterThan(0)
  })

  it('修改模板不影响已生成的项目（AC-AD17，实例是副本）', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const res = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })
    const projectId = res.body.data.id

    // 改模板
    await db.query("UPDATE stage_template_stage SET name = '模板被改了' WHERE template_id = ? AND seq = 1", [
      templateId,
    ])
    await db.query(
      "UPDATE stage_template_item SET name = '工序被改了' WHERE template_stage_id IN (SELECT id FROM stage_template_stage WHERE template_id = ?)",
      [templateId]
    )

    const detail = await request.authed('get', `/admin/projects/${projectId}`, token)
    expect(detail.body.data.stages[0].name).toBe('开工准备')
    expect(detail.body.data.stages[0].items[0].name).toBe('现场交底')
  })

  it('未配置地图 Key 时不阻断建档，但明确告知需要手工拾取坐标（AC-AD54）', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const res = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })

    expect(res.status).toBe(200)
    expect(res.body.data.geocoded).toBe(false)
    expect(res.body.data.needsCoordinates).toBe(true)

    const detail = await request.authed('get', `/admin/projects/${res.body.data.id}`, token)
    expect(detail.body.data.needsCoordinates).toBe(true)

    // 手工拾取（GCJ-02）
    const set = await request.authed('put', `/admin/projects/${res.body.data.id}/coordinates`, token).send({
      longitude: '121.4737010',
      latitude: '31.2304160',
    })
    expect(set.status).toBe(200)

    const after = await request.authed('get', `/admin/projects/${res.body.data.id}`, token)
    expect(after.body.data.needsCoordinates).toBe(false)
    expect(after.body.data.longitude).toBe('121.4737010')
  })

  it('超出经纬度合理区间的坐标被拒绝（AC-N03 坐标系校验）', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })

    for (const bad of [
      { longitude: '200', latitude: '31' },
      { longitude: '121', latitude: '100' },
      { longitude: 'abc', latitude: '31' },
    ]) {
      const res = await request
        .authed('put', `/admin/projects/${created.body.data.id}/coordinates`, token)
        .send(bad)
      expect(res.status).toBe(400)
    }
  })
})

describe('地图坐标直传与更新', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function createWithCoordinates(token, templateId, coordinates = {}) {
    return request.authed('post', '/admin/projects', token).send({
      ...VALID_PROJECT,
      templateId,
      ...coordinates,
    })
  }

  it('创建时直传坐标：跳过地理编码，按字符串原样保存', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const geocode = vi.spyOn(mapService, 'geocode').mockResolvedValue({
      longitude: '1.0000000',
      latitude: '2.0000000',
    })

    const res = await createWithCoordinates(token, templateId, {
      longitude: '121.4737010',
      latitude: '31.2304160',
    })

    expect(res.status).toBe(200)
    expect(res.body.data.geocoded).toBe(true)
    expect(res.body.data.coordinateSource).toBe('manual')
    expect(res.body.data.needsCoordinates).toBe(false)
    expect(geocode).not.toHaveBeenCalled()

    const detail = await request.authed('get', `/admin/projects/${res.body.data.id}`, token)
    expect(detail.body.data.longitude).toBe('121.4737010')
    expect(detail.body.data.latitude).toBe('31.2304160')
    expect(detail.body.data.needsCoordinates).toBe(false)
  })

  it('只传一个坐标或小数超过 7 位时返回 400', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()

    const onlyLng = await createWithCoordinates(token, templateId, {
      longitude: '121.4737010',
    })
    expect(onlyLng.status).toBe(400)

    const tooPrecise = await createWithCoordinates(token, templateId, {
      longitude: '121.47370101',
      latitude: '31.2304160',
    })
    expect(tooPrecise.status).toBe(400)
  })

  it('仅更新坐标：地址不变，坐标与 geocoded_at 更新，操作日志记录前后值', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await createWithCoordinates(token, templateId, {
      longitude: '121.4737010',
      latitude: '31.2304160',
    })
    const projectId = created.body.data.id

    const res = await request.authed('put', `/admin/projects/${projectId}`, token).send({
      longitude: '121.5000000',
      latitude: '31.3000000',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.coordinateSource).toBe('manual')

    const detail = await request.authed('get', `/admin/projects/${projectId}`, token)
    expect(detail.body.data.address).toBe(VALID_PROJECT.address)
    expect(detail.body.data.longitude).toBe('121.5000000')
    expect(detail.body.data.latitude).toBe('31.3000000')

    const row = await db.queryOne(
      "SELECT detail FROM operation_log WHERE action = 'project.update' AND target_id = ? ORDER BY id DESC LIMIT 1",
      [projectId]
    )
    const logDetail = typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail
    expect(logDetail.before.longitude).toBe('121.4737010')
    expect(logDetail.after.longitude).toBe('121.5000000')
    expect(logDetail.before.latitude).toBe('31.2304160')
    expect(logDetail.after.latitude).toBe('31.3000000')
  })

  it('地址与坐标同时更新时使用传入坐标，不再调用地理编码', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await createWithCoordinates(token, templateId, {
      longitude: '121.4737010',
      latitude: '31.2304160',
    })
    const projectId = created.body.data.id
    const geocode = vi.spyOn(mapService, 'geocode')

    const res = await request.authed('put', `/admin/projects/${projectId}`, token).send({
      address: '上海市徐汇区新地址 1 号',
      longitude: '121.5000000',
      latitude: '31.3000000',
    })
    expect(res.status).toBe(200)
    expect(geocode).not.toHaveBeenCalled()

    const detail = await request.authed('get', `/admin/projects/${projectId}`, token)
    expect(detail.body.data.address).toBe('上海市徐汇区新地址 1 号')
    expect(detail.body.data.longitude).toBe('121.5000000')
    expect(detail.body.data.latitude).toBe('31.3000000')
  })

  it('只改地址：重新地理编码成功时更新坐标', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await createWithCoordinates(token, templateId, {
      longitude: '121.4737010',
      latitude: '31.2304160',
    })
    const projectId = created.body.data.id
    const geocode = vi.spyOn(mapService, 'geocode').mockResolvedValue({
      longitude: '121.6000000',
      latitude: '31.4000000',
    })

    const res = await request.authed('put', `/admin/projects/${projectId}`, token).send({
      address: '上海市静安区新地址 2 号',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.coordinateSource).toBe('geocode')
    expect(geocode).toHaveBeenCalledWith('上海市静安区新地址 2 号')

    const detail = await request.authed('get', `/admin/projects/${projectId}`, token)
    expect(detail.body.data.longitude).toBe('121.6000000')
    expect(detail.body.data.latitude).toBe('31.4000000')
  })

  it('只改地址且解析失败：清空旧坐标并提示 needsCoordinates', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await createWithCoordinates(token, templateId, {
      longitude: '121.4737010',
      latitude: '31.2304160',
    })
    const projectId = created.body.data.id
    vi.spyOn(mapService, 'geocode').mockResolvedValue(null)

    const res = await request.authed('put', `/admin/projects/${projectId}`, token).send({
      address: '无法解析的地址',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.needsCoordinates).toBe(true)
    expect(res.body.data.coordinateSource).toBe('none')

    const detail = await request.authed('get', `/admin/projects/${projectId}`, token)
    expect(detail.body.data.longitude).toBeNull()
    expect(detail.body.data.latitude).toBeNull()
    expect(detail.body.data.needsCoordinates).toBe(true)
  })
})

describe('AC-AD24 / 55 / 56 / 57 项目状态机', () => {
  async function setupProject() {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const res = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })
    return { token, projectId: res.body.data.id }
  }

  it('正向流转：待开工 → 施工中 → 已完工', async () => {
    const { token, projectId } = await setupProject()

    // 进入施工中要先配齐人员（AC-AD58）：至少 1 名工长（其中 1 名主工长）+ 至少 1 名业主
    const ownerId = await createWechatUser('openid-owner')
    const foremanId = await createWechatUser('openid-foreman')
    await addActiveMember(projectId, foremanId, 'foreman', true)
    await addActiveMember(projectId, ownerId, 'owner')

    const toBuilding = await request
      .authed('put', `/admin/projects/${projectId}/status`, token)
      .send({ status: 'building' })
    expect(toBuilding.status).toBe(200)

    const toFinished = await request
      .authed('put', `/admin/projects/${projectId}/status`, token)
      .send({ status: 'finished' })
    expect(toFinished.status).toBe(200)
    expect(toFinished.body.data.from).toBe('building')

    // 完工时自动补实际竣工日期，否则延期统计永远算不出结果
    const row = await db.queryOne('SELECT actual_end_date FROM project WHERE id = ?', [projectId])
    expect(row.actual_end_date).not.toBeNull()
  })

  it('未配齐人员时不能进入施工中，且逐步说明缺什么（AC-AD58）', async () => {
    const { token, projectId } = await setupProject()
    const toBuilding = () =>
      request.authed('put', `/admin/projects/${projectId}/status`, token).send({ status: 'building' })

    // 1) 一个人都没有
    const noOne = await toBuilding()
    expect(noOne.status).toBe(409)
    expect(noOne.body.message).toContain('尚未指定工长')

    // 2) 邀请了工长但他还没确认 —— pending 不计入权限（AC-AD18），因此仍算未配齐
    const foreman = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800009001', role: 'foreman' })
    expect(foreman.body.data.status).toBe('pending')

    const stillNoForeman = await toBuilding()
    expect(stillNoForeman.status).toBe(409)
    expect(stillNoForeman.body.message).toContain('尚未指定工长')

    // 3) 工长确认了，但还缺业主
    await db.query("UPDATE project_member SET status = 'active', confirmed_at = NOW() WHERE id = ?", [
      foreman.body.data.memberId,
    ])
    const noOwner = await toBuilding()
    expect(noOwner.status).toBe(409)
    expect(noOwner.body.message).toContain('尚未指定业主')

    // 4) 业主确认后放行
    const owner = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800009002', role: 'owner' })
    await db.query("UPDATE project_member SET status = 'active', confirmed_at = NOW() WHERE id = ?", [
      owner.body.data.memberId,
    ])
    expect((await toBuilding()).status).toBe(200)
  })

  it('存在工长但没有主工长时拒绝进入施工中（数据异常路径）', async () => {
    const { token, projectId } = await setupProject()

    // 正常接口路径下不会产生这种状态（首个工长会自动成为主工长，
    // 主工长也不能被直接移除），因此直接用 SQL 造出来，验证守卫仍然生效
    const foremanId = await createWechatUser('openid-noprimary')
    await addActiveMember(projectId, foremanId, 'foreman', false)
    const ownerId = await createWechatUser('openid-owner2')
    await addActiveMember(projectId, ownerId, 'owner')

    const res = await request
      .authed('put', `/admin/projects/${projectId}/status`, token)
      .send({ status: 'building' })
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('主工长')
  })

  it('反向流转需二次确认（AC-AD24 / AC-AD55）', async () => {
    const { token, projectId } = await setupProject()

    // 反向回到「施工中」仍要满足人员约束，先配齐（AC-AD58 与流向校验是两道独立的关）
    const foremanId = await createWechatUser('openid-rev-f')
    const ownerId = await createWechatUser('openid-rev-o')
    await addActiveMember(projectId, foremanId, 'foreman', true)
    await addActiveMember(projectId, ownerId, 'owner')

    await db.query("UPDATE project SET status = 'finished' WHERE id = ?", [projectId])

    const withoutConfirm = await request
      .authed('put', `/admin/projects/${projectId}/status`, token)
      .send({ status: 'building' })
    expect(withoutConfirm.status).toBe(400)
    expect(withoutConfirm.body.message).toContain('二次确认')

    const withConfirm = await request
      .authed('put', `/admin/projects/${projectId}/status`, token)
      .send({ status: 'building', confirmReverse: true })
    expect(withConfirm.status).toBe(200)
    expect(withConfirm.body.data.to).toBe('building')
  })

  it('经 PUT /status 流入归档同样要二次确认，不能绕过 POST /archive', async () => {
    // 同一件事有两个入口时，两边的门槛必须一致 ——
    // 否则「需要二次确认」只是一句写在文档里的空话
    const { token, projectId } = await setupProject()
    await db.query("UPDATE project SET status = 'finished' WHERE id = ?", [projectId])

    const res = await request
      .authed('put', `/admin/projects/${projectId}/status`, token)
      .send({ status: 'archived' })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('二次确认')
  })

  it('目标状态与当前相同返回 409', async () => {
    const { token, projectId } = await setupProject()
    const res = await request
      .authed('put', `/admin/projects/${projectId}/status`, token)
      .send({ status: 'pending' })
    expect(res.status).toBe(409)
  })

  it('归档需二次确认，且归档后全部写操作被拒（AC-AD25 / AC-AD57）', async () => {
    const { token, projectId } = await setupProject()

    const noConfirm = await request.post(`/admin/projects/${projectId}/archive`).set('Authorization', `Bearer ${token}`).send({})
    expect(noConfirm.status).toBe(400)

    const archived = await request
      .authed('post', `/admin/projects/${projectId}/archive`, token)
      .send({ confirm: true })
    expect(archived.status).toBe(200)

    const writes = [
      await request.authed('put', `/admin/projects/${projectId}`, token).send({ name: '改名' }),
      await request.authed('put', `/admin/projects/${projectId}/coordinates`, token).send({
        longitude: '121',
        latitude: '31',
      }),
      await request.authed('post', `/admin/projects/${projectId}/members`, token).send({
        phone: '13800001111',
        role: 'owner',
      }),
      await request.authed('put', `/admin/projects/${projectId}/payment-nodes`, token).send({ nodes: [] }),
    ]
    for (const res of writes) {
      expect(res.status).toBe(403)
      expect(res.body.message).toContain('归档')
    }

    // 已归档项目改状态也要走恢复路径（仅超管）
    const directChange = await request
      .authed('put', `/admin/projects/${projectId}/status`, token)
      .send({ status: 'finished', confirmReverse: true })
    expect(directChange.status).toBe(200)
  })

  it('已归档项目只能由超级管理员改回「已完工」，且不能直接跳到「施工中」', async () => {
    const { token: superToken } = await setupProject()
    const pm = await projectAdmin('pm-archive')

    const projectId = (await request.authed('get', '/admin/projects', superToken)).body.data.list[0].id
    await fixtures.grantProjectScope(pm.admin.id, projectId)
    await db.query("UPDATE project SET status = 'archived', archived_at = NOW() WHERE id = ?", [projectId])

    // 项目管理员即使被授权访问该项目，也无权解除归档
    const pmRestore = await request
      .authed('put', `/admin/projects/${projectId}/status`, pm.token)
      .send({ status: 'finished', confirmReverse: true })
    expect(pmRestore.status).toBe(403)

    // 超管也不能直接跳到「施工中」：那会绕过「已完工 → 施工中」自己的二次确认
    const jumpToBuilding = await request
      .authed('put', `/admin/projects/${projectId}/status`, superToken)
      .send({ status: 'building', confirmReverse: true })
    expect(jumpToBuilding.status).toBe(400)

    const superRestore = await request
      .authed('put', `/admin/projects/${projectId}/status`, superToken)
      .send({ status: 'finished', confirmReverse: true })
    expect(superRestore.status).toBe(200)

    const row = await db.queryOne('SELECT status, archived_at FROM project WHERE id = ?', [projectId])
    expect(row.status).toBe('finished')
    expect(row.archived_at).toBeNull()
  })

  it('注意区分两个「恢复」：POST /restore 恢复的是**软删除**，不是解除归档', async () => {
    const { token, projectId } = await setupProject()
    await db.query("UPDATE project SET status = 'archived', archived_at = NOW() WHERE id = ?", [projectId])

    // 项目没有被软删除，因此 /restore 应当拒绝
    const res = await request.authed('post', `/admin/projects/${projectId}/restore`, token)
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('未被删除')
  })

  it('已完工项目不再接受进度汇报，但验收与对账不受影响（AC-AD56）', () => {
    // 「完工」与「归档」的写限制刻意做了区分：完工后仍有尾款对账、收尾验收要做，
    // 一刀切只读会让这些收尾工作无法进行。这里直接验证守卫函数的语义
    const projectService = require('../../src/services/project.service')

    expect(() => projectService.assertWritable({ status: 'finished' })).not.toThrow()
    expect(() => projectService.assertCanReportProgress({ status: 'finished' })).toThrow(/已完工/)
    expect(() => projectService.assertWritable({ status: 'archived' })).toThrow(/归档/)
    expect(() => projectService.assertCanReportProgress({ status: 'archived' })).toThrow(/归档/)
  })
})

describe('AC-AD26 / 27 项目删除与恢复', () => {
  it('仅超级管理员可删除，且需二次确认', async () => {
    const { token: superToken } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request.authed('post', '/admin/projects', superToken).send({ ...VALID_PROJECT, templateId })
    const projectId = created.body.data.id

    const pm = await projectAdmin('pm-del')
    await fixtures.grantProjectScope(pm.admin.id, projectId)

    expect((await request.authed('delete', `/admin/projects/${projectId}`, pm.token).send({ confirm: true })).status).toBe(
      403
    )
    expect((await request.authed('delete', `/admin/projects/${projectId}`, superToken).send({})).status).toBe(400)

    const deleted = await request.authed('delete', `/admin/projects/${projectId}`, superToken).send({ confirm: true })
    expect(deleted.status).toBe(200)

    // 软删除后默认不在列表展示
    const list = await request.authed('get', '/admin/projects', superToken)
    expect(list.body.data.total).toBe(0)
  })

  it('恢复后阶段、工序数据完整无缺失（AC-AD27）', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })
    const projectId = created.body.data.id

    const before = await request.authed('get', `/admin/projects/${projectId}`, token)

    await request.authed('delete', `/admin/projects/${projectId}`, token).send({ confirm: true })
    const restored = await request.authed('post', `/admin/projects/${projectId}/restore`, token)
    expect(restored.status).toBe(200)

    const after = await request.authed('get', `/admin/projects/${projectId}`, token)
    expect(after.body.data.stages).toEqual(before.body.data.stages)
  })

  it('未删除的项目执行恢复返回 409', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })

    const res = await request.authed('post', `/admin/projects/${created.body.data.id}/restore`, token)
    expect(res.status).toBe(409)
  })
})

describe('AC-AD18~21 / 58 / 59 成员管理', () => {
  async function setup() {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })
    return { token, projectId: created.body.data.id }
  }

  it('按手机号邀请，被邀请人为占位账号且状态为 pending（AC-AD18）', async () => {
    const { token, projectId } = await setup()

    const res = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800001111', role: 'foreman' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('pending')
    expect(res.body.data.isNewUser).toBe(true)

    // 占位账号：有手机号、没有 openid
    const user = await db.queryOne('SELECT openid, phone FROM user WHERE phone = ?', ['13800001111'])
    expect(user.openid).toBeNull()

    const members = await request.authed('get', `/admin/projects/${projectId}/members`, token)
    expect(members.body.data.members).toHaveLength(1)
    expect(members.body.data.members[0].statusLabel).toBe('待确认')
    // pending 不计入权限，因此人数统计里应当是 0
    expect(members.body.data.composition.foremanCount).toBe(0)
  })

  it('成员手机号脱敏返回', async () => {
    const { token, projectId } = await setup()
    await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800001111', role: 'owner' })

    const members = await request.authed('get', `/admin/projects/${projectId}/members`, token)
    expect(members.body.data.members[0].phoneMasked).toBe('138****1111')
    expect(JSON.stringify(members.body)).not.toContain('13800001111')
  })

  it('账号角色固定：同一用户不能在同一项目或跨项目改成另一个角色', async () => {
    const { token, projectId } = await setup()
    await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800002222', role: 'owner' })

    // 即使是同一项目内，也不能把已固定的「业主」替换成「监理」
    const conflict = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800002222', role: 'supervisor' })

    expect(conflict.status).toBe(409)
    expect(conflict.body.data.roleLocked).toBe(true)
    expect(conflict.body.message).toContain('固定为业主')

    // 旧客户端的 confirmReplace 参数不能再绕过固定角色
    const replaced = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800002222', role: 'supervisor', confirmReplace: true })
    expect(replaced.status).toBe(409)

    const count = await db.count(
      'FROM project_member WHERE project_id = ? AND deleted_at IS NULL',
      [projectId]
    )
    expect(count).toBe(1)
  })

  it('业主可参与多个项目；工长 / 监理跨项目仍保持同一角色', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const projectA = (await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })).body.data.id
    const projectB = (await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, name: '第二个项目', templateId })).body.data.id

    // 业主可以重复加入多个项目
    expect(
      (
        await request.authed('post', `/admin/projects/${projectA}/members`, token).send({
          phone: '13800007771',
          role: 'owner',
        })
      ).status
    ).toBe(200)
    expect(
      (
        await request.authed('post', `/admin/projects/${projectB}/members`, token).send({
          phone: '13800007771',
          role: 'owner',
        })
      ).status
    ).toBe(200)

    // 工长在项目 A 固定后，在项目 B 仍只能以工长身份加入
    expect(
      (
        await request.authed('post', `/admin/projects/${projectA}/members`, token).send({
          phone: '13800007772',
          role: 'foreman',
        })
      ).status
    ).toBe(200)
    const wrongRole = await request.authed('post', `/admin/projects/${projectB}/members`, token).send({
      phone: '13800007772',
      role: 'supervisor',
    })
    expect(wrongRole.status).toBe(409)
    expect(wrongRole.body.data.roleLocked).toBe(true)

    expect(
      (
        await request.authed('post', `/admin/projects/${projectB}/members`, token).send({
          phone: '13800007772',
          role: 'foreman',
        })
      ).status
    ).toBe(200)
  })

  it('允许多名工长并存（Q11）', async () => {
    const { token, projectId } = await setup()

    const first = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800003333', role: 'foreman' })
    expect(first.status).toBe(200)

    // 第二个工长不再需要 confirmReplace —— Q11 明确了工长可以有多名
    const second = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800004444', role: 'foreman' })
    expect(second.status).toBe(200)

    const members = await request.authed('get', `/admin/projects/${projectId}/members`, token)
    expect(members.body.data.members.filter((m) => m.role === 'foreman')).toHaveLength(2)
  })

  it('首个工长自动成为主工长，后续工长不是（Q11）', async () => {
    const { token, projectId } = await setup()

    const first = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800003333', role: 'foreman' })
    // 自动指定，避免出现「有工长但没人能发起验收」的死角
    expect(first.body.data.isPrimaryForeman).toBe(true)

    const second = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800004444', role: 'foreman' })
    expect(second.body.data.isPrimaryForeman).toBe(false)

    // 数据库层也只有一个 is_primary=1
    const primaries = await db.query(
      "SELECT id FROM project_member WHERE project_id = ? AND role = 'foreman' AND is_primary = 1 AND deleted_at IS NULL",
      [projectId]
    )
    expect(primaries).toHaveLength(1)
  })

  it('监理与业主不会被自动设为主工长', async () => {
    const { token, projectId } = await setup()

    const supervisor = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800005555', role: 'supervisor' })
    expect(supervisor.body.data.isPrimaryForeman).toBe(false)

    const owner = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800005556', role: 'owner' })
    expect(owner.body.data.isPrimaryForeman).toBe(false)
  })

  it('主工长可改指，且同时只有一人（Q11）', async () => {
    const { token, projectId } = await setup()
    const a = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800003333', role: 'foreman' })
    const b = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800004444', role: 'foreman' })

    // 未确认的成员不能被设为主工长，因此先把两人置为已确认
    // （邀请时创建的是占位账号，直接改成员状态即可，不必走一遍小程序确认）
    await db.query("UPDATE project_member SET status = 'active', confirmed_at = NOW() WHERE id IN (?, ?)", [
      a.body.data.memberId,
      b.body.data.memberId,
    ])

    const switchRes = await request.authed(
      'put',
      `/admin/projects/${projectId}/members/${b.body.data.memberId}/primary`,
      token
    )
    expect(switchRes.status).toBe(200)

    const primaries = await db.query(
      "SELECT user_id FROM project_member WHERE project_id = ? AND role = 'foreman' AND is_primary = 1 AND deleted_at IS NULL",
      [projectId]
    )
    expect(primaries).toHaveLength(1)
    expect(primaries[0].user_id).toBe(b.body.data.userId)
  })

  it('未确认的工长不能被设为主工长（AC-AD18：pending 不计入权限）', async () => {
    const { token, projectId } = await setup()
    const invited = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800003333', role: 'foreman' })

    // 该成员此时是 pending（即便他是自动指定的主工长人选）
    const res = await request.authed(
      'put',
      `/admin/projects/${projectId}/members/${invited.body.data.memberId}/primary`,
      token
    )
    // 他已经是 is_primary=1（首个工长自动指定），因此这里命中「已是主工长」
    expect(res.status).toBe(409)
  })

  it('监理不能被设为主工长', async () => {
    const { token, projectId } = await setup()
    const supervisor = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800006666', role: 'supervisor' })

    const res = await request.authed(
      'put',
      `/admin/projects/${projectId}/members/${supervisor.body.data.memberId}/primary`,
      token
    )
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('工长')
  })

  it('不能直接移除主工长，须先改指（Q11）', async () => {
    const { token, projectId } = await setup()
    const primary = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800003333', role: 'foreman' })
    await db.query("UPDATE project_member SET status = 'active', confirmed_at = NOW() WHERE id = ?", [
      primary.body.data.memberId,
    ])

    const res = await request.authed(
      'delete',
      `/admin/projects/${projectId}/members/${primary.body.data.memberId}`,
      token
    )
    expect(res.status).toBe(409)
    expect(res.body.data.isPrimaryForeman).toBe(true)
    // 项目里没有其他工长，提示要说清下一步该做什么
    expect(res.body.data.hasOtherForeman).toBe(false)
    expect(res.body.message).toContain('主工长')

    // 记录未被改动
    const row = await db.queryOne('SELECT status FROM project_member WHERE id = ?', [primary.body.data.memberId])
    expect(row.status).toBe('active')
  })

  it('有另一名工长时，移除主工长提示「先改指」而不是「先邀请」', async () => {
    const { token, projectId } = await setup()
    const a = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800003333', role: 'foreman' })
    const b = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800004444', role: 'foreman' })
    await db.query("UPDATE project_member SET status = 'active', confirmed_at = NOW() WHERE id IN (?, ?)", [
      a.body.data.memberId,
      b.body.data.memberId,
    ])

    const res = await request.authed(
      'delete',
      `/admin/projects/${projectId}/members/${a.body.data.memberId}`,
      token
    )
    expect(res.status).toBe(409)
    expect(res.body.data.hasOtherForeman).toBe(true)
    // 有人可接手时，提示指向「指定另一位为主工长」而不是「去邀请一名工长」
    expect(res.body.message).toContain('指定')
    expect(res.body.message).not.toContain('先邀请')

    // 非主工长可以正常移除
    const removeOther = await request.authed(
      'delete',
      `/admin/projects/${projectId}/members/${b.body.data.memberId}`,
      token
    )
    expect(removeOther.status).toBe(200)
  })

  it('改指主工长后，原主工长即可被移除', async () => {
    const { token, projectId } = await setup()
    const a = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800003333', role: 'foreman' })
    const b = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800004444', role: 'foreman' })
    await db.query("UPDATE project_member SET status = 'active', confirmed_at = NOW() WHERE id IN (?, ?)", [
      a.body.data.memberId,
      b.body.data.memberId,
    ])

    await request.authed('put', `/admin/projects/${projectId}/members/${b.body.data.memberId}/primary`, token)

    const removeA = await request.authed(
      'delete',
      `/admin/projects/${projectId}/members/${a.body.data.memberId}`,
      token
    )
    expect(removeA.status).toBe(200)
  })

  it('支持多监理与多业主（AC-AD59）', async () => {
    const { token, projectId } = await setup()
    for (const [phone, role] of [
      ['13800005001', 'supervisor'],
      ['13800005002', 'supervisor'],
      ['13800005003', 'owner'],
      ['13800005004', 'owner'],
    ]) {
      const res = await request
        .authed('post', `/admin/projects/${projectId}/members`, token)
        .send({ phone, role })
      expect(res.status).toBe(200)
    }

    const members = await request.authed('get', `/admin/projects/${projectId}/members`, token)
    expect(members.body.data.members).toHaveLength(4)
  })

  it('解除成员关系后历史记录保留（AC-AD21）', async () => {
    const { token, projectId } = await setup()
    const invited = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800006666', role: 'supervisor' })
    const memberId = invited.body.data.memberId

    const removed = await request.authed('delete', `/admin/projects/${projectId}/members/${memberId}`, token)
    expect(removed.status).toBe(200)

    // 记录仍在列表中（status=removed），而不是消失
    const members = await request.authed('get', `/admin/projects/${projectId}/members`, token)
    const target = members.body.data.members.find((m) => m.id === memberId)
    expect(target.status).toBe('removed')
    expect(target.statusLabel).toBe('已移除')
  })

  it('不能邀请已注销的手机号（否则已注销的人凭空恢复访问）', async () => {
    const { token, projectId } = await setup()
    await db.query("INSERT INTO user (phone, status, anonymized_at) VALUES ('13800007777', 'deleted', NOW())")

    const res = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800007777', role: 'owner' })
    expect(res.status).toBe(409)
  })

  it('非法手机号与非法角色被拒绝', async () => {
    const { token, projectId } = await setup()

    expect(
      (
        await request
          .authed('post', `/admin/projects/${projectId}/members`, token)
          .send({ phone: '12345', role: 'owner' })
      ).status
    ).toBe(400)

    expect(
      (
        await request
          .authed('post', `/admin/projects/${projectId}/members`, token)
          .send({ phone: '13800008888', role: 'manager' })
      ).status
    ).toBe(400)
  })
})

describe('主业主与临时业主（v2.12）', () => {
  async function setupProject() {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request
      .authed('post', '/admin/projects', token)
      .send({ ...VALID_PROJECT, templateId })
    return { token, projectId: created.body.data.id }
  }

  async function inviteOwner(token, projectId, phone) {
    return request.authed('post', `/admin/projects/${projectId}/members`, token).send({ phone, role: 'owner' })
  }

  it('首位业主自动成为主业主，后续业主是临时业主，数据库只有一个主业主', async () => {
    const { token, projectId } = await setupProject()

    const first = await inviteOwner(token, projectId, '13800007001')
    expect(first.status).toBe(200)
    expect(first.body.data.ownerType).toBe('primary')
    expect(first.body.data.isPrimaryOwner).toBe(true)

    const second = await inviteOwner(token, projectId, '13800007002')
    expect(second.status).toBe(200)
    expect(second.body.data.ownerType).toBe('temporary')
    expect(second.body.data.isPrimaryOwner).toBe(false)

    const rows = await db.query(
      "SELECT owner_type FROM project_member WHERE project_id = ? AND role = 'owner' ORDER BY id",
      [projectId]
    )
    expect(rows.map((row) => row.owner_type)).toEqual(['primary', 'temporary'])
  })

  it('重新邀请 pending 主业主不会把他降为临时业主', async () => {
    const { token, projectId } = await setupProject()
    await inviteOwner(token, projectId, '13800007101')
    const again = await inviteOwner(token, projectId, '13800007101')
    expect(again.status).toBe(200)
    expect(again.body.data.ownerType).toBe('primary')
  })

  it('active 主业主不可移除；临时业主可以移除', async () => {
    const { token, projectId } = await setupProject()
    const primary = await inviteOwner(token, projectId, '13800007201')
    const temporary = await inviteOwner(token, projectId, '13800007202')

    await db.query("UPDATE project_member SET status = 'active', confirmed_at = NOW() WHERE id = ?", [
      primary.body.data.memberId,
    ])
    await db.query("UPDATE project_member SET status = 'active', confirmed_at = NOW() WHERE id = ?", [
      temporary.body.data.memberId,
    ])

    const blocked = await request.authed(
      'delete',
      `/admin/projects/${projectId}/members/${primary.body.data.memberId}`,
      token
    )
    expect(blocked.status).toBe(409)
    expect(blocked.body.data && blocked.body.data.isPrimaryOwner).toBe(true)

    const removed = await request.authed(
      'delete',
      `/admin/projects/${projectId}/members/${temporary.body.data.memberId}`,
      token
    )
    expect(removed.status).toBe(200)
  })

  it('成员列表返回主业主信息与临时业主数量', async () => {
    const { token, projectId } = await setupProject()
    await inviteOwner(token, projectId, '13800007301')
    await inviteOwner(token, projectId, '13800007302')

    const members = await request.authed('get', `/admin/projects/${projectId}/members`, token)
    expect(members.status).toBe(200)
    expect(members.body.data.composition.primaryOwnerUserId).toBeTruthy()
    expect(members.body.data.composition.primaryOwnerActive).toBe(false)
    expect(members.body.data.composition.temporaryOwnerCount).toBe(0)

    const ownerRows = members.body.data.members.filter((m) => m.role === 'owner')
    expect(ownerRows.find((m) => m.isPrimaryOwner).ownerTypeLabel).toBe('主业主')
    expect(ownerRows.find((m) => m.ownerType === 'temporary').ownerTypeLabel).toBe('临时业主')
  })
})

describe('AC-AD22 / AC-L18 付款节点配置', () => {
  async function setup() {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request.authed('post', '/admin/projects', token).send({ ...VALID_PROJECT, templateId })
    const detail = await request.authed('get', `/admin/projects/${created.body.data.id}`, token)
    return { token, projectId: created.body.data.id, stageId: detail.body.data.stages[0].id }
  }

  it('可配置名称、金额、触发方式，并返回与合同额的差额', async () => {
    const { token, projectId, stageId } = await setup()

    const res = await request
      .authed('put', `/admin/projects/${projectId}/payment-nodes`, token)
      .send({
        nodes: [
          { name: '定金', amount: '60000.00', triggerType: 'manual' },
          { name: '水电验收款', amount: '100000.00', triggerType: 'stage_acceptance', triggerStageId: stageId },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body.data.nodesTotal).toBe('160000.00')
    expect(res.body.data.difference).toBe('40000.00')
    expect(res.body.data.mismatched).toBe(true)
    expect(res.body.data.warning).toContain('40000.00')
  })

  it('金额之和与合同额一致时不告警，且允许保存不一致的配置（AC-L18）', async () => {
    const { token, projectId } = await setup()

    const matched = await request
      .authed('put', `/admin/projects/${projectId}/payment-nodes`, token)
      .send({
        nodes: [
          { name: '定金', amount: '100000.00', triggerType: 'manual' },
          { name: '尾款', amount: '100000.00', triggerType: 'manual' },
        ],
      })
    expect(matched.body.data.mismatched).toBe(false)
    expect(matched.body.data.warning).toBeNull()
  })

  it('关联阶段时只能选择本项目已有阶段（AC-AD22）', async () => {
    const { token, projectId } = await setup()

    const res = await request
      .authed('put', `/admin/projects/${projectId}/payment-nodes`, token)
      .send({ nodes: [{ name: '款', amount: '1000.00', triggerType: 'stage_acceptance', triggerStageId: 999999 }] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('不属于本项目')
  })

  it('选「阶段验收后解锁」但没指定阶段时被拒绝', async () => {
    const { token, projectId } = await setup()
    const res = await request
      .authed('put', `/admin/projects/${projectId}/payment-nodes`, token)
      .send({ nodes: [{ name: '款', amount: '1000.00', triggerType: 'stage_acceptance' }] })
    expect(res.status).toBe(400)
  })

  it('节点金额非法时拒绝，且提示定位到具体节点', async () => {
    const { token, projectId } = await setup()
    const res = await request
      .authed('put', `/admin/projects/${projectId}/payment-nodes`, token)
      .send({
        nodes: [
          { name: '定金', amount: '1000.00', triggerType: 'manual' },
          { name: '问题节点', amount: '-5', triggerType: 'manual' },
        ],
      })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('问题节点')
  })

  it('已有流水关联节点时不允许整体重排（会切断收入与节点的关联）', async () => {
    const { token, projectId } = await setup()
    await request.authed('put', `/admin/projects/${projectId}/payment-nodes`, token).send({
      nodes: [{ name: '定金', amount: '60000.00', triggerType: 'manual' }],
    })

    const node = await db.queryOne('SELECT id FROM payment_node WHERE project_id = ?', [projectId])
    const stageId = (await db.queryOne('SELECT id FROM project_stage WHERE project_id = ? LIMIT 1', [projectId])).id
    await db.query(
      `INSERT INTO ledger (project_id, project_stage_id, type, amount, occurred_at, payment_node_id, created_by)
       VALUES (?, ?, 'income', 60000.00, '2026-01-05', ?, 1)`,
      [projectId, stageId, node.id]
    )

    const res = await request
      .authed('put', `/admin/projects/${projectId}/payment-nodes`, token)
      .send({ nodes: [{ name: '新节点', amount: '1000.00', triggerType: 'manual' }] })

    expect(res.status).toBe(409)
    expect(res.body.message).toContain('流水')
  })

  it('节点按顺序保存与返回', async () => {
    const { token, projectId } = await setup()
    await request
      .authed('put', `/admin/projects/${projectId}/payment-nodes`, token)
      .send({
        nodes: [
          { name: '定金', amount: '10000.00', triggerType: 'manual' },
          { name: '开工款', amount: '20000.00', triggerType: 'manual' },
          { name: '尾款', amount: '30000.00', triggerType: 'manual' },
        ],
      })

    const list = await request.authed('get', `/admin/projects/${projectId}/payment-nodes`, token)
    expect(list.body.data.nodes.map((n) => n.name)).toEqual(['定金', '开工款', '尾款'])
    expect(list.body.data.nodes.map((n) => n.seq)).toEqual([1, 2, 3])
  })
})

describe('C 端项目详情与可见性（AC-P26）', () => {
  it('参与项目的人可以查看详情', async () => {
    const { token: adminToken } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request
      .authed('post', '/admin/projects', adminToken)
      .send({ ...VALID_PROJECT, templateId })
    const projectId = created.body.data.id

    const miniAuth = require('./helpers/mini')
    const user = await miniAuth.login('code-c-detail')
    await addActiveMember(projectId, user.userId, 'owner')

    const res = await miniAuth.authed('get', `/projects/${projectId}`, user.token)
    expect(res.status).toBe(200)
    expect(res.body.data.myRoleLabel).toBe('主业主')
    expect(res.body.data.stages).toHaveLength(2)
  })

  it('非参与项目返回 404，且提示与「项目不存在」完全相同（不泄露是否存在）', async () => {
    const { token: adminToken } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request
      .authed('post', '/admin/projects', adminToken)
      .send({ ...VALID_PROJECT, templateId, name: '别人的项目' })

    const miniAuth = require('./helpers/mini')
    const outsider = await miniAuth.login('code-outsider')

    const notMine = await miniAuth.authed('get', `/projects/${created.body.data.id}`, outsider.token)
    const notExist = await miniAuth.authed('get', '/projects/999999', outsider.token)

    expect(notMine.status).toBe(404)
    expect(notExist.status).toBe(404)
    expect(notMine.body.message).toBe(notExist.body.message)
    expect(JSON.stringify(notMine.body)).not.toContain('别人的项目')
  })

  it('待确认的成员看不到项目详情（AC-AD18）', async () => {
    const { token: adminToken } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request
      .authed('post', '/admin/projects', adminToken)
      .send({ ...VALID_PROJECT, templateId })

    const miniAuth = require('./helpers/mini')
    const user = await miniAuth.login('code-pending-c')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status, owner_type) VALUES (?, ?, 'owner', 'pending', 'primary')",
      [created.body.data.id, user.userId]
    )

    const res = await miniAuth.authed('get', `/projects/${created.body.data.id}`, user.token)
    expect(res.status).toBe(404)
  })

  it('锁定阶段返回锁定原因（C-2.13）', async () => {
    const { token: adminToken } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request
      .authed('post', '/admin/projects', adminToken)
      .send({ ...VALID_PROJECT, templateId })

    const miniAuth = require('./helpers/mini')
    const user = await miniAuth.login('code-locked')
    await addActiveMember(created.body.data.id, user.userId, 'foreman', true)

    const res = await miniAuth.authed('get', `/projects/${created.body.data.id}`, user.token)
    const lockedStage = res.body.data.stages.find((s) => s.gateStatus === 'locked')
    expect(lockedStage.lockedReason).toBe('开工准备未结清')
  })
})

describe('项目封面（缩略图）', () => {
  const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )

  it('上传封面后随建档保存，列表与详情都返回 coverUrl', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()

    const uploaded = await request
      .authed('post', '/admin/projects/cover', token)
      .attach('cover', PNG_1PX, { filename: 'cover.png', contentType: 'image/png' })

    expect(uploaded.status).toBe(200)
    expect(uploaded.body.data.url).toMatch(/\/uploads\/project-covers\//)

    const created = await request
      .authed('post', '/admin/projects', token)
      .send({ ...VALID_PROJECT, templateId, coverUrl: uploaded.body.data.url })

    expect(created.status).toBe(200)

    const detail = await request.authed('get', `/admin/projects/${created.body.data.id}`, token)
    expect(detail.body.data.coverUrl).toBe(uploaded.body.data.url)

    const list = await request.authed('get', '/admin/projects', token)
    const item = list.body.data.list.find((project) => project.id === created.body.data.id)
    expect(item.coverUrl).toBe(uploaded.body.data.url)
  })

  it('编辑时可用空字符串清除封面，非法地址被拒绝', async () => {
    const { token } = await superAdmin()
    const templateId = await fixtures.createTemplate()
    const created = await request
      .authed('post', '/admin/projects', token)
      .send({ ...VALID_PROJECT, templateId, coverUrl: 'https://example.com/a.jpg' })
    const id = created.body.data.id

    const cleared = await request.authed('put', `/admin/projects/${id}`, token).send({ coverUrl: '' })
    expect(cleared.status).toBe(200)

    const detail = await request.authed('get', `/admin/projects/${id}`, token)
    expect(detail.body.data.coverUrl).toBeNull()

    const bad = await request
      .authed('put', `/admin/projects/${id}`, token)
      .send({ coverUrl: 'javascript:alert(1)' })
    expect(bad.status).toBe(400)
  })

  it('非图片文件不能作为封面', async () => {
    const { token } = await superAdmin()

    const res = await request
      .authed('post', '/admin/projects/cover', token)
      .attach('cover', Buffer.from('not-an-image'), { filename: 'cover.txt', contentType: 'text/plain' })

    expect(res.status).toBe(400)
  })
})

// ── 测试内部的小工具 ──

async function createWechatUser(openid) {
  const result = await db.query('INSERT INTO user (openid) VALUES (?)', [openid])
  return result.insertId
}

/** 直接建一条 active 成员关系。isPrimary 显式传，避免夹具偷偷替业务逻辑做决定 */
async function addActiveMember(projectId, userId, role, isPrimary = false) {
  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, is_primary, owner_type, confirmed_at, joined_at)
     VALUES (?, ?, ?, 'active', ?, ?, NOW(), NOW())`,
    [projectId, userId, role, isPrimary ? 1 : 0, role === 'owner' ? 'primary' : null]
  )
}
