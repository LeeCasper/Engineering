'use strict'

/**
 * 操作日志集成测试（B-1.9 / AC-AD09）。
 *
 * ── 为什么写入侧要测这么细 ──
 * AC-AD09 要求「**所有**增删改操作写入 operation_log」。审计日志最危险的形态
 * 不是写错，而是**漏写**：界面上看起来一切正常，日志列表里也有一堆记录，
 * 只有等到需要追责时才会发现「那次改动没留下痕迹」。
 * 因此这里对每个写接口都断言「对应的 action 出现了一次」。
 *
 * ── 为什么数据权限要单独测 id 串号 ──
 * C 端 `user.id` 与后台 `admin_user.id` 是两套自增空间，撞车是常态而非巧合。
 * 权限条件若只写 `operator_id = 我`，项目管理员就会看到**另一个人的**操作记录。
 * 这类错误的特征是「多看到几条」，不会报错、也不容易被注意到。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
const operationLog = require('../../src/services/operationLog.service')
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

/** 建模板 + 建档，返回 { token, admin, templateId, projectId } */
async function setupProject({ username = 'super', createdBy = null } = {}) {
  const login = await auth.createAndLogin({ username, role: 'owner' })
  const templateId = await fixtures.createTemplate({ name: `模板-${username}` })

  const res = await request.authed('post', '/admin/projects', login.token).send({
    name: `日志项目-${username}`,
    address: '上海市某路 1 号',
    contractAmount: '100000.00',
    startDate: '2026-01-01',
    planEndDate: '2026-06-01',
    templateId,
  })

  const projectId = res.body.data.id
  if (createdBy !== null) {
    await db.query('UPDATE project SET created_by = ? WHERE id = ?', [createdBy, projectId])
  }

  return { ...login, templateId, projectId }
}

/** 查某个 action 的日志行（按 id 倒序） */
async function logsOf(action) {
  return db.query('SELECT * FROM operation_log WHERE action = ? ORDER BY id ASC', [action])
}

describe('AC-AD09 写入侧：所有增删改都留痕', () => {
  it('建档写入 PROJECT_CREATE，含操作人、IP、目标对象与 after 内容', async () => {
    const { token, admin, projectId } = await setupProject()

    // 建档接口本身不返回日志，直接查库
    const rows = await logsOf(operationLog.ACTIONS.PROJECT_CREATE)

    expect(rows).toHaveLength(1)
    expect(rows[0].operator_type).toBe('admin')
    expect(rows[0].operator_id).toBe(admin.id)
    expect(rows[0].target_type).toBe('project')
    expect(rows[0].target_id).toBe(projectId)
    expect(rows[0].project_id).toBe(projectId)
    // AC-AD09 点名要求记 IP
    expect(rows[0].ip).toBeTruthy()
    // requestId 是「客户端报的那个错」与「服务端那一行日志」之间的唯一纽带
    expect(rows[0].request_id).toBeTruthy()

    const detail = typeof rows[0].detail === 'string' ? JSON.parse(rows[0].detail) : rows[0].detail
    expect(detail.after.contractAmount).toBe('100000.00')
    // 建档没有 before（新增）
    expect(detail.before).toBeUndefined()
    void token
  })

  it('编辑项目写入 PROJECT_UPDATE，before/after 只含被改动的字段', async () => {
    const { token, projectId } = await setupProject()

    await request.authed('put', `/admin/projects/${projectId}`, token).send({ name: '改过的名字' })

    const rows = await logsOf(operationLog.ACTIONS.PROJECT_UPDATE)
    expect(rows).toHaveLength(1)

    const detail = typeof rows[0].detail === 'string' ? JSON.parse(rows[0].detail) : rows[0].detail
    expect(detail.before.name).toBe('日志项目-super')
    expect(detail.after.name).toBe('改过的名字')
    // 只传了 name，diff 里就不该出现地址 —— 否则每次编辑的日志都被
    // 无关字段淹没，真正改了哪一项看不出来
    expect(detail.before.address).toBeUndefined()
  })

  it('状态流转写入 PROJECT_STATUS，含流转前后状态', async () => {
    const { token, projectId } = await setupProject()

    // 流转到「施工中」要求人员配齐（AC-AD58）：至少 1 名工长（其中有 1 名主工长）+ 至少 1 名业主
    const foremanId = await mini.createWechatUser('oplog-status-foreman')
    const ownerId = await mini.createWechatUser('oplog-status-owner')
    await mini.addMember({ projectId, userId: foremanId, role: 'foreman' })
    await mini.addMember({ projectId, userId: ownerId, role: 'owner' })
    await db.query('UPDATE project_member SET is_primary = 1 WHERE project_id = ? AND user_id = ?', [
      projectId,
      foremanId,
    ])

    const res = await request
      .authed('put', `/admin/projects/${projectId}/status`, token)
      .send({ status: 'building' })
    expect(res.status).toBe(200)

    const rows = await logsOf(operationLog.ACTIONS.PROJECT_STATUS)
    expect(rows).toHaveLength(1)

    const detail = typeof rows[0].detail === 'string' ? JSON.parse(rows[0].detail) : rows[0].detail
    expect(detail.before.status).toBe('pending')
    expect(detail.after.status).toBe('building')
    // AC-AD55 专门要求「反向流转需二次确认并写入操作日志」，
    // 正向流转也要记，因此 reverse 标记要能区分两者
    expect(detail.reverse).toBe(false)
  })

  it('归档与恢复各自留痕', async () => {
    const { token, projectId } = await setupProject()

    await request.authed('post', `/admin/projects/${projectId}/archive`, token).send({ confirm: true })
    expect(await logsOf(operationLog.ACTIONS.PROJECT_ARCHIVE)).toHaveLength(1)

    await request.authed('put', `/admin/projects/${projectId}/status`, token).send({
      status: 'finished',
      confirmReverse: true,
    })

    const statusLogs = await logsOf(operationLog.ACTIONS.PROJECT_STATUS)
    const reverse = statusLogs
      .map((r) => (typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail))
      .find((d) => d.reverse === true)
    expect(reverse).toBeDefined()
    expect(reverse.before.status).toBe('archived')
    expect(reverse.after.status).toBe('finished')
  })

  it('软删除与恢复留痕', async () => {
    const { token, projectId } = await setupProject()

    await request.authed('del', `/admin/projects/${projectId}`, token).send({ confirm: true })
    expect(await logsOf(operationLog.ACTIONS.PROJECT_DELETE)).toHaveLength(1)

    await request.authed('post', `/admin/projects/${projectId}/restore`, token).send({})
    expect(await logsOf(operationLog.ACTIONS.PROJECT_RESTORE)).toHaveLength(1)
  })

  it('成员邀请、改指主工长、移除各自留痕', async () => {
    const { token, projectId } = await setupProject()

    const first = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800000001', role: 'foreman' })
    const second = await request
      .authed('post', `/admin/projects/${projectId}/members`, token)
      .send({ phone: '13800000002', role: 'foreman' })

    const inviteLogs = await logsOf(operationLog.ACTIONS.MEMBER_INVITE)
    expect(inviteLogs).toHaveLength(2)

    // 手机号是受保护的个人信息（AC-U02 连接口都要掩码），
    // 审计日志的可见范围比接口宽得多，因此只留掩码
    const detail = typeof inviteLogs[0].detail === 'string' ? JSON.parse(inviteLogs[0].detail) : inviteLogs[0].detail
    expect(JSON.stringify(detail)).not.toContain('13800000001')
    expect(detail.after.phoneMasked).toContain('****')

    // 首个工长自动成为主工长，第二个不是
    expect(detail.after.isPrimaryForeman).toBe(true)

    // 把第二名工长设为主工长
    const secondMemberId = second.body.data.memberId
    await db.query("UPDATE project_member SET status = 'active', confirmed_at = NOW() WHERE id = ?", [secondMemberId])
    await request.authed('put', `/admin/projects/${projectId}/members/${secondMemberId}/primary`, token).send({})

    const primaryLogs = await logsOf(operationLog.ACTIONS.MEMBER_SET_PRIMARY)
    expect(primaryLogs).toHaveLength(1)
    const primaryDetail =
      typeof primaryLogs[0].detail === 'string' ? JSON.parse(primaryLogs[0].detail) : primaryLogs[0].detail
    // 「原来是谁」必须记得下来 —— setPrimary 先清零再置位，清零之后就查不出来了
    expect(primaryDetail.before.primaryMemberId).toBe(first.body.data.memberId)
    expect(primaryDetail.after.primaryMemberId).toBe(secondMemberId)

    // 移除一名非主工长
    await request.authed('del', `/admin/projects/${projectId}/members/${first.body.data.memberId}`, token).send({})
    expect(await logsOf(operationLog.ACTIONS.MEMBER_REMOVE)).toHaveLength(1)
  })

  it('模板的增删改复制与设默认各自留痕', async () => {
    const { token, templateId } = await setupProject()

    const created = await request.authed('post', '/admin/stage-templates', token).send({
      name: '新模板',
      stages: [{ name: '阶段一', planDays: 3, items: [{ name: '工序一' }] }],
    })
    expect(await logsOf(operationLog.ACTIONS.TEMPLATE_CREATE)).toHaveLength(1)

    const newId = created.body.data.id
    await request
      .authed('put', `/admin/stage-templates/${newId}`, token)
      .send({ name: '改名后的模板' })
    expect(await logsOf(operationLog.ACTIONS.TEMPLATE_UPDATE)).toHaveLength(1)

    await request.authed('post', `/admin/stage-templates/${newId}/duplicate`, token).send({ name: '副本' })
    const dupLogs = await logsOf(operationLog.ACTIONS.TEMPLATE_DUPLICATE)
    expect(dupLogs).toHaveLength(1)
    const dupDetail = typeof dupLogs[0].detail === 'string' ? JSON.parse(dupLogs[0].detail) : dupLogs[0].detail
    // 副本与源模板相互独立（AC-AD34），事后要回答「抄自哪一份」只能靠这条
    expect(dupDetail.after.sourceTemplateId).toBe(newId)

    await request.authed('put', `/admin/stage-templates/${newId}/default`, token).send({})
    const defaultLogs = await logsOf(operationLog.ACTIONS.TEMPLATE_SET_DEFAULT)
    expect(defaultLogs).toHaveLength(1)
    const defaultDetail =
      typeof defaultLogs[0].detail === 'string' ? JSON.parse(defaultLogs[0].detail) : defaultLogs[0].detail
    expect(defaultDetail.after.defaultTemplateId).toBe(newId)

    void templateId
  })

  it('账号的创建、禁用、重置密码与授权范围各自留痕，且日志里没有明文密码', async () => {
    const { token } = await setupProject()
    const secret = 'Secret12345'

    const created = await request
      .authed('post', '/admin/admin-users', token)
      .send({ username: 'sub-admin', password: secret, role: 'admin' })

    const createLogs = await logsOf(operationLog.ACTIONS.ADMIN_USER_CREATE)
    expect(createLogs).toHaveLength(1)
    // AC-AD04 要求「代码、日志、接口响应中均无明文密码」。
    // operation_log 的可见范围比创建接口宽，因此这里必须一起锁住
    expect(JSON.stringify(createLogs[0])).not.toContain(secret)

    const targetId = created.body.data.id

    await request.authed('put', `/admin/admin-users/${targetId}/status`, token).send({ status: 'disabled' })
    const statusLogs = await logsOf(operationLog.ACTIONS.ADMIN_USER_STATUS)
    expect(statusLogs).toHaveLength(1)
    const statusDetail =
      typeof statusLogs[0].detail === 'string' ? JSON.parse(statusLogs[0].detail) : statusLogs[0].detail
    expect(statusDetail.before.status).toBe('active')
    expect(statusDetail.after.status).toBe('disabled')

    const resetSecret = 'Another12345'
    await request.authed('put', `/admin/admin-users/${targetId}/password`, token).send({ newPassword: resetSecret })
    const pwdLogs = await logsOf(operationLog.ACTIONS.ADMIN_USER_PASSWORD)
    expect(pwdLogs).toHaveLength(1)
    expect(JSON.stringify(pwdLogs[0])).not.toContain(resetSecret)
    // 重置密码会自增 token_version，原 token 立即失效（AC-AD08）——
    // 这是本操作最容易被误解的副作用，日志里要能回答「我的登录怎么突然掉了」
    const pwdDetail = typeof pwdLogs[0].detail === 'string' ? JSON.parse(pwdLogs[0].detail) : pwdLogs[0].detail
    expect(pwdDetail.after.tokenVersionBumped).toBe(true)

    const { projectId } = await setupProject({ username: 'other-super' })
    await request.authed('post', `/admin/admin-users/${targetId}/projects`, token).send({ projectIds: [projectId] })

    const grantLogs = await logsOf(operationLog.ACTIONS.ADMIN_USER_GRANT)
    expect(grantLogs).toHaveLength(1)
    const grantDetail = typeof grantLogs[0].detail === 'string' ? JSON.parse(grantLogs[0].detail) : grantLogs[0].detail
    expect(grantDetail.before.grantedProjectIds).toEqual([])
    expect(grantDetail.after.grantedProjectIds).toEqual([projectId])
  })

  it('C 端记账操作同样写日志，操作人类型是 user', async () => {
    const { projectId } = await setupProject()
    const foreman = await mini.login('oplog-foreman')
    await mini.addMember({ projectId, userId: foreman.userId, role: 'foreman' })

    const stage = await db.queryOne('SELECT id FROM project_stage WHERE project_id = ? ORDER BY seq LIMIT 1', [
      projectId,
    ])

    const res = await request.authed('post', `/projects/${projectId}/ledger`, foreman.token).send({
      type: 'expense',
      category: 'material',
      amount: '1200.00',
      occurredAt: '2026-03-01',
      stageId: stage.id,
      remark: '水泥',
    })

    expect(res.status).toBe(200)

    const rows = await logsOf(operationLog.ACTIONS.LEDGER_CREATE)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].operator_type).toBe('user')
    expect(rows[0].operator_id).toBe(foreman.userId)
  })
})

describe('AC-AD09 读取侧：查询与筛选', () => {
  it('超管可查询到全部日志', async () => {
    const first = await setupProject({ username: 'super-a' })
    const second = await setupProject({ username: 'super-b' })

    const res = await request.authed('get', '/admin/operation-logs', first.token)

    expect(res.status).toBe(200)
    expect(res.body.data.list.some((r) => r.projectId === second.projectId)).toBe(true)
  })

  it('日志按时间倒序返回，含操作人名称与项目名', async () => {
    const { token, projectId, admin } = await setupProject()
    await request.authed('put', `/admin/projects/${projectId}`, token).send({ name: '新名字' })

    const res = await request.authed('get', `/admin/operation-logs?projectId=${projectId}`, token)

    const list = res.body.data.list
    expect(list.length).toBeGreaterThanOrEqual(2)
    expect(list[0].action).toBe(operationLog.ACTIONS.PROJECT_UPDATE)
    expect(list[0].module).toBe('project')
    expect(list[0].operatorType).toBe('admin')
    expect(list[0].operatorName).toBe(admin.username)
    expect(list[0].projectName).toBe('新名字')
    // detail 必须是对象而不是字符串：JSON 列若按字符串返回，
    // 前端 detail.before 会永远是 undefined，看起来像「没有变更内容」
    expect(typeof list[0].detail).toBe('object')
    expect(list[0].detail.before.name).toBe('日志项目-super')
  })

  it('按模块筛选只返回该模块的动作', async () => {
    const { token, projectId } = await setupProject()
    await request.authed('put', `/admin/projects/${projectId}`, token).send({ name: 'x' })
    await request.post('/admin/stage-templates').set('Authorization', `Bearer ${token}`).send({
      name: '模板甲',
      stages: [{ name: '阶段', planDays: 1, items: [{ name: '工序' }] }],
    })

    const res = await request.authed('get', '/admin/operation-logs?module=stage_template', token)

    expect(res.body.data.total).toBe(1)
    expect(res.body.data.list[0].action).toBe(operationLog.ACTIONS.TEMPLATE_CREATE)
  })

  it('未知模块返回 400，而不是把用户输入拼进 LIKE 模式', async () => {
    const { token } = await setupProject()

    const res = await request.authed('get', '/admin/operation-logs?module=%25', token)

    // 放行的话 `module=%` 会变成一次全表扫描 —— 不算越权，
    // 但把一个「按模块筛选」的接口变成了「无上限扫审计表」的入口
    expect(res.status).toBe(400)
  })

  it('按精确动作筛选', async () => {
    const { token, projectId } = await setupProject()
    await request.authed('put', `/admin/projects/${projectId}`, token).send({ name: 'x' })

    const hit = await request.authed('get', `/admin/operation-logs?action=project.update`, token)
    const miss = await request.authed('get', `/admin/operation-logs?action=project.updte`, token)

    expect(hit.body.data.total).toBe(1)
    expect(miss.body.data.total).toBe(0)
  })

  it('日期区间含 to 当天（左闭右闭的自然日语义）', async () => {
    const { token } = await setupProject()

    const today = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

    const incl = await request.authed('get', `/admin/operation-logs?from=${todayStr}&to=${todayStr}`, token)
    // to 当天的记录必须在内。写成 `<= to 00:00:00` 的话这里会是 0 条，
    // 而用户只会觉得「今天的操作怎么都没记上」
    expect(incl.body.data.total).toBeGreaterThan(0)

    const before = await request.authed('get', `/admin/operation-logs?to=2020-01-01`, token)
    expect(before.body.data.total).toBe(0)
  })

  it('非法日期格式返回 400', async () => {
    const { token } = await setupProject()

    const res = await request.authed('get', '/admin/operation-logs?from=2026/01/01', token)
    expect(res.status).toBe(400)
  })

  it('列表强制分页', async () => {
    const { token, projectId } = await setupProject()
    // 至少造出两条日志，否则 totalPages 恒为 1，分页断言等于没测
    await request.authed('put', `/admin/projects/${projectId}`, token).send({ name: '分页项目' })

    const res = await request.authed('get', '/admin/operation-logs?pageSize=1&page=1', token)

    expect(res.body.data.list).toHaveLength(1)
    expect(res.body.data.pageSize).toBe(1)
    expect(res.body.data.total).toBe(2)
    expect(res.body.data.totalPages).toBe(2)
  })

  it('筛选接口返回模块与动作清单供下拉使用', async () => {
    const { token } = await setupProject()

    const res = await request.authed('get', '/admin/operation-logs/filters', token)

    expect(res.status).toBe(200)
    const ledger = res.body.data.modules.find((m) => m.module === 'ledger')
    expect(ledger.label).toBe('记账')
    expect(ledger.actions).toContain('ledger.create')
  })
})

describe('AC-AD09 读取侧：项目管理员「仅本人相关」', () => {
  it('只看得到自己项目上的操作，看不到别人项目的', async () => {
    const superAdmin = await setupProject({ username: 'super-x' })
    const projectAdminLogin = await auth.createAndLogin({ username: 'proj-admin', role: 'admin' })

    const res = await request.authed('get', '/admin/operation-logs', projectAdminLogin.token)

    expect(res.status).toBe(200)
    const projectIds = res.body.data.list.map((r) => r.projectId).filter(Boolean)
    expect(projectIds).not.toContain(superAdmin.projectId)
  })

  it('自己项目上的操作（含他人所为）能看到', async () => {
    const { projectId } = await setupProject({ username: 'super-y' })
    const projectAdminLogin = await auth.createAndLogin({ username: 'proj-admin-2', role: 'admin' })

    // 把项目划给这位项目管理员
    await db.query('UPDATE project SET created_by = ? WHERE id = ?', [projectAdminLogin.admin.id, projectId])

    const res = await request.authed('get', '/admin/operation-logs', projectAdminLogin.token)

    // 「仅本人相关」不只有「我做的」——项目管理员要能审计本项目上发生的一切，
    // 包括超管当初的建档
    expect(res.body.data.list.some((r) => r.projectId === projectId)).toBe(true)
  })

  it('自己的后台操作（无项目归属）能看到', async () => {
    await setupProject({ username: 'super-z' })
    const projectAdminLogin = await auth.createAndLogin({ username: 'proj-admin-3', role: 'admin' })

    // 模板是全局资源、不归属任何项目，因此这条日志没有 project_id。
    // 若权限条件只写「我负责的项目上的操作」，这类记录就会凭空消失
    await request.authed('post', '/admin/stage-templates', projectAdminLogin.token).send({
      name: '项目管理员建的模板',
      stages: [{ name: '阶段', planDays: 1, items: [{ name: '工序' }] }],
    })

    const res = await request.authed('get', '/admin/operation-logs', projectAdminLogin.token)

    const log = res.body.data.list.find((r) => r.action === operationLog.ACTIONS.TEMPLATE_CREATE)
    expect(log).toBeDefined()
    expect(log.projectId).toBeNull()
    expect(log.operatorName).toBe('proj-admin-3')
  })

  it('C 端 user.id 与 admin_user.id 撞号时**不会**泄露对方的操作', async () => {
    const { projectId } = await setupProject({ username: 'super-w' })
    const projectAdminLogin = await auth.createAndLogin({ username: 'proj-admin-4', role: 'admin' })
    const myId = projectAdminLogin.admin.id

    // 模拟一个 id 恰好等于该管理员 id 的 C 端用户，在**别人**的项目上做了操作。
    // 这在生产环境是常态：两张表的自增空间相互独立
    await operationLog.record({
      operatorType: 'user',
      operatorId: myId,
      action: operationLog.ACTIONS.LEDGER_CREATE,
      targetType: 'ledger',
      targetId: 999,
      projectId,
      detail: { after: { amount: '8888.00' } },
    })

    const res = await request.authed('get', '/admin/operation-logs', projectAdminLogin.token)

    // 若权限条件写成 `operator_id = 我` 而不带 operator_type = 'admin'，
    // 这条属于**另一个人**的记录就会出现在他的列表里 —— 那才是数据串号
    expect(res.body.data.list.some((r) => r.targetId === 999)).toBe(false)
  })
})

describe('操作日志的鉴权', () => {
  it('未登录一律 401', async () => {
    const res = await request.get('/admin/operation-logs')
    expect(res.status).toBe(401)
  })

  it('C 端 token 不能访问后台日志（AC-AD10）', async () => {
    const user = await mini.login('oplog-mini')
    const res = await request.authed('get', '/admin/operation-logs', user.token)
    expect(res.status).toBe(401)
  })
})
