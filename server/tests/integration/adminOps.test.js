'use strict'

/**
 * 补齐项的集成测试：批量操作、导出、管理员消息、结算单 PDF。
 *
 * 覆盖 AC-AD60 / AC-AD61 / AC-P23 的管理员侧 / AC-L24。
 */

const fs = require('node:fs')

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const config = require('../../config')
const sysConfigService = require('../../src/services/sysConfig.service')
const adminNotification = require('../../src/services/adminNotification.service')
const exportService = require('../../src/services/export.service')
const projectBatch = require('../../src/services/projectBatch.service')
const settlementPdf = require('../../src/services/settlementPdf.service')
const staleReportReminder = require('../../src/jobs/staleReportReminder')
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

/** 建 N 个项目，返回 { token, admin, projectIds } */
async function setupProjects(count = 3, { username = 'super' } = {}) {
  const login = await auth.createAndLogin({ username, role: 'owner' })
  const templateId = await fixtures.createTemplate({ name: `模板-${username}` })

  const projectIds = []
  for (let i = 0; i < count; i += 1) {
    const res = await request.authed('post', '/admin/projects', login.token).send({
      name: `项目${i}`,
      address: `上海市某路 ${i} 号`,
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
      templateId,
    })
    projectIds.push(res.body.data.id)
  }

  return { ...login, projectIds, templateId }
}

describe('AC-AD60 批量操作', () => {
  it('批量归档对选中项全部生效', async () => {
    const { token, projectIds } = await setupProjects(3)

    const res = await request
      .authed('post', '/admin/projects/batch/archive', token)
      .send({ projectIds, confirm: true })

    expect(res.status).toBe(200)
    expect(res.body.data.successCount).toBe(3)
    expect(res.body.data.failureCount).toBe(0)

    const rows = await db.query('SELECT status FROM project WHERE id IN (?)', [projectIds])
    expect(rows.every((r) => r.status === 'archived')).toBe(true)
  })

  it('AC-AD60 部分失败时明确列出失败项与原因，**不静默跳过**', async () => {
    const { token, projectIds } = await setupProjects(2)

    // 其中一个先归档，批量时它必然失败
    await db.query("UPDATE project SET status = 'archived', archived_at = NOW() WHERE id = ?", [projectIds[0]])

    const res = await request
      .authed('post', '/admin/projects/batch/archive', token)
      .send({ projectIds: [...projectIds, 999999], confirm: true })

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(3)
    expect(res.body.data.successCount).toBe(1)
    expect(res.body.data.failureCount).toBe(2)

    // 失败项逐一给出 id 与原因 —— 这正是 AC-AD60 的原话
    const failures = res.body.data.failures
    expect(failures.map((f) => f.projectId).sort()).toEqual([projectIds[0], 999999].sort())
    for (const failure of failures) {
      expect(typeof failure.reason).toBe('string')
      expect(failure.reason.length).toBeGreaterThan(0)
    }
  })

  it('一条失败不影响其他条（不做整体回滚）', async () => {
    const { token, projectIds } = await setupProjects(3)
    await db.query("UPDATE project SET status = 'archived', archived_at = NOW() WHERE id = ?", [projectIds[1]])

    await request.authed('post', '/admin/projects/batch/archive', token).send({ projectIds, confirm: true })

    // 若做成「一条失败就整体回滚」，另外两条会保持原状 ——
    // 那样用户只会觉得「点了没反应」
    const rows = await db.query('SELECT id, status FROM project WHERE id IN (?)', [projectIds])
    expect(rows.every((r) => r.status === 'archived')).toBe(true)
  })

  it('批量归档需要二次确认，与单个归档同门槛', async () => {
    const { token, projectIds } = await setupProjects(2)

    const res = await request.authed('post', '/admin/projects/batch/archive', token).send({ projectIds })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('二次确认')
  })

  it('批量归档遵守数据权限：无权项目计入失败项', async () => {
    const superUser = await setupProjects(1)
    const otherLogin = await auth.createAndLogin({ username: 'pm-batch', role: 'admin' })

    const res = await request
      .authed('post', '/admin/projects/batch/archive', otherLogin.token)
      .send({ projectIds: superUser.projectIds, confirm: true })

    expect(res.body.data.successCount).toBe(0)
    expect(res.body.data.failures[0].reason).toContain('无权')
  })

  it('批量分配工长', async () => {
    const { token, projectIds } = await setupProjects(2)

    const res = await request
      .authed('post', '/admin/projects/batch/assign', token)
      .send({ projectIds, phone: '13900001111' })

    expect(res.status).toBe(200)
    expect(res.body.data.successCount).toBe(2)

    const members = await db.query(
      "SELECT project_id, role, status FROM project_member WHERE role = 'foreman' ORDER BY project_id"
    )
    expect(members).toHaveLength(2)
    // 首个工长自动成为主工长（Q11 的规则同样适用于批量分配）
    const primaries = await db.query(
      "SELECT project_id FROM project_member WHERE is_primary = 1 AND role = 'foreman' ORDER BY project_id"
    )
    expect(primaries).toHaveLength(2)
  })

  it('超过批量上限时拒绝', async () => {
    const { token } = await setupProjects(1)
    const tooMany = Array.from({ length: 101 }, (_, i) => i + 1)

    const res = await request
      .authed('post', '/admin/projects/batch/archive', token)
      .send({ projectIds: tooMany, confirm: true })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('100')
  })

  it('空数组被拒绝', async () => {
    const { token } = await setupProjects(1)
    const res = await request.authed('post', '/admin/projects/batch/archive', token).send({ projectIds: [], confirm: true })
    expect(res.status).toBe(400)
  })
})

describe('AC-AD61 导出', () => {
  it('小数据量同步返回 xlsx，内容与筛选条件一致', async () => {
    const { token, projectIds } = await setupProjects(3)
    await db.query('UPDATE project SET name = ? WHERE id = ?', ['特殊项目名', projectIds[0]])

    // 二进制响应要用 request.binary（supertest 对 xlsx 不做解析，
    // res.text 已被 UTF-8 解码过、字节会损坏）
    const res = await request.binary('get', '/admin/projects/export?name=特殊', { token })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')
    expect(res.headers['content-disposition']).toContain('attachment')

    // xlsx 本质是 zip，文件头是 PK
    expect(res.buffer.subarray(0, 2).toString()).toBe('PK')
    expect(res.buffer.length).toBeGreaterThan(1000)
  })

  it('导出内容**不含**被筛选掉的项目（AC-AD61 的核心要求）', async () => {
    const { token, projectIds } = await setupProjects(2)
    await db.query('UPDATE project SET name = ? WHERE id = ?', ['导出目标项目', projectIds[0]])
    await db.query('UPDATE project SET name = ? WHERE id = ?', ['不该出现的项目', projectIds[1]])

    // 用导出器自己的取数函数验证「筛选条件真的生效了」——
    // xlsx 是压缩的，直接在里面搜字符串不可靠
    const rows = await projectBatch.fetchExportRows(
      { id: 1, type: 'admin', role: 'owner', tenantId: 1 },
      { name: '导出目标' },
      { limit: 100 }
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('导出目标项目')

    // 接口层面确认导出成功（内容校验由上面的取数完成）
    const res = await request.binary('get', '/admin/projects/export?name=导出目标', { token })
    expect(res.status).toBe(200)
    expect(res.buffer.subarray(0, 2).toString()).toBe('PK')
  })

  it('勾选导出只包含选中的项目', async () => {
    const { token, admin, projectIds } = await setupProjects(3)
    const picked = [projectIds[0], projectIds[2]]
    const operator = { id: admin.id, type: 'admin', role: 'owner', tenantId: 1 }

    const plan = await projectBatch.planExport(operator, { ids: picked })
    expect(plan.total).toBe(2)

    const rows = await projectBatch.fetchExportRows(operator, { ids: picked }, { limit: 100 })
    expect(rows.map((row) => row.id).sort((a, b) => a - b)).toEqual(
      [...picked].sort((a, b) => a - b)
    )

    const res = await request.binary('get', `/admin/projects/export?ids=${picked.join(',')}`, { token })
    expect(res.status).toBe(200)
    expect(res.buffer.subarray(0, 2).toString()).toBe('PK')
  })

  it('后台导出遵守数据权限：只导出自己可见的项目', async () => {
    const superUser = await setupProjects(3)
    const pm = await auth.createAndLogin({ username: 'pm-export', role: 'admin' })

    const superPlan = await projectBatch.planExport(
      { id: superUser.admin.id, type: 'admin', role: 'owner', tenantId: 1 },
      {}
    )
    const pmPlan = await projectBatch.planExport({ id: pm.admin.id, type: 'admin', role: 'admin', tenantId: 1 }, {})

    expect(superPlan.total).toBe(3)
    expect(pmPlan.total).toBe(0)
  })

  it('筛选后无数据时拒绝导出，而不是给一个只有表头的空文件', async () => {
    const { token } = await setupProjects(1)
    const res = await request.authed('get', '/admin/projects/export?name=不存在的项目名', token)

    expect(res.status).toBe(409)
    expect(res.body.message).toContain('没有可导出')
  })

  it('异步导出：落任务、发消息、可下载，且只能下载自己的', async () => {
    const superUser = await setupProjects(1)
    const operator = { id: superUser.admin.id, type: 'admin', role: 'owner', tenantId: 1 }

    // 直接调服务层走异步路径（同步改异步的阈值是 2000 行，测试里造不了那么多）
    const taskId = await require('../../src/models/adminNotification.model').createExportTask({
      tenantId: 1,
      createdBy: operator.id,
      filters: {},
    })

    await exportService.runTask(taskId, operator, {}, { username: superUser.admin.username })

    const task = await db.queryOne('SELECT status, row_count, file_url FROM export_task WHERE id = ?', [taskId])
    expect(task.status).toBe('success')
    expect(task.row_count).toBe(1)
    expect(task.file_url).toContain('/uploads/exports/')

    // 生成的文件真的存在且是 xlsx
    const key = task.file_url.split('/uploads/')[1]
    const buffer = fs.readFileSync(require('node:path').join(config.upload.dir, key))
    expect(buffer.subarray(0, 2).toString()).toBe('PK')

    // 完成后给发起人发了消息
    const notification = await db.queryOne(
      "SELECT title, ref_type, ref_id FROM admin_notification WHERE ref_type = 'export_task'"
    )
    expect(notification).toBeTruthy()
    expect(notification.ref_id).toBe(taskId)
    expect(notification.title).toContain('完成')

    // 下载：本人可以
    const mine = await request.binary('get', `/admin/exports/${taskId}/download`, { token: superUser.token })
    expect(mine.status).toBe(200)
    expect(mine.headers['content-type']).toContain('spreadsheetml')
    expect(mine.buffer.subarray(0, 2).toString()).toBe('PK')

    // 别人不行 —— 导出含合同金额，按 §5.1 不该被同后台的其他人取走
    const other = await auth.createAndLogin({ username: 'pm-peek', role: 'admin' })
    const peek = await request.authed('get', `/admin/exports/${taskId}/download`, other.token)
    expect(peek.status).toBe(404)
    expect(peek.body.message).toBe('导出任务不存在')
  })

  it('导出失败时记录原因并通知发起人', async () => {
    const superUser = await setupProjects(1)
    const operator = { id: superUser.admin.id, type: 'admin', role: 'owner', tenantId: 1 }

    const model = require('../../src/models/adminNotification.model')
    const taskId = await model.createExportTask({ tenantId: 1, createdBy: operator.id, filters: {} })

    // 打桩在落盘这一步，走完真实的失败路径
    const storage = require('../../src/storage')
    const original = storage.saveGenerated
    storage.saveGenerated = async () => {
      throw new Error('模拟的磁盘写入失败')
    }

    try {
      await expect(exportService.runTask(taskId, operator, {}, {})).rejects.toThrow('模拟的磁盘写入失败')
    } finally {
      storage.saveGenerated = original
    }

    const task = await db.queryOne('SELECT status, error FROM export_task WHERE id = ?', [taskId])
    expect(task.status).toBe('failed')
    expect(task.error).toContain('模拟的磁盘写入失败')

    const notification = await db.queryOne("SELECT title FROM admin_notification WHERE ref_type = 'export_task'")
    expect(notification.title).toContain('失败')
  })

  it('冷启动清理滞留任务：进程重启后不会永远停在「生成中」', async () => {
    const superUser = await setupProjects(1)

    // 造一个「11 分钟前开始、至今 running」的任务
    const id = await require('../../src/models/adminNotification.model').createExportTask({
      tenantId: 1,
      createdBy: superUser.admin.id,
      filters: {},
    })
    await db.query(
      "UPDATE export_task SET status = 'running', started_at = NOW() - INTERVAL 11 MINUTE WHERE id = ?",
      [id]
    )

    const cleaned = await exportService.sweepStaleTasks()
    expect(cleaned).toBe(1)

    const task = await db.queryOne('SELECT status, error FROM export_task WHERE id = ?', [id])
    expect(task.status).toBe('failed')
    expect(task.error).toContain('重启')
  })

  it('刚启动不久的任务不会被误清', async () => {
    const superUser = await setupProjects(1)
    const id = await require('../../src/models/adminNotification.model').createExportTask({
      tenantId: 1,
      createdBy: superUser.admin.id,
      filters: {},
    })
    await db.query("UPDATE export_task SET status = 'running', started_at = NOW() WHERE id = ?", [id])

    expect(await exportService.sweepStaleTasks()).toBe(0)
  })
})

describe('管理员消息通道（AC-P23 的管理员侧）', () => {
  it('列表与未读数', async () => {
    const { token, admin } = await setupProjects(1)

    await adminNotification.notify({
      tenantId: 1,
      adminUserId: admin.id,
      type: adminNotification.TYPES.PROJECT,
      title: '测试消息一',
    })
    await adminNotification.notify({
      tenantId: 1,
      adminUserId: admin.id,
      type: adminNotification.TYPES.EXPORT,
      title: '测试消息二',
    })

    const res = await request.authed('get', '/admin/notifications', token)
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(2)
    expect(res.body.data.unread).toBe(2)
    expect(res.body.data.list[0].title).toBe('测试消息二')
  })

  it('标记已读：传 ids 只标指定项，不传则全部', async () => {
    const { token, admin } = await setupProjects(1)

    const first = await adminNotification.notify({
      tenantId: 1,
      adminUserId: admin.id,
      type: 'system',
      title: 'A',
    })
    await adminNotification.notify({ tenantId: 1, adminUserId: admin.id, type: 'system', title: 'B' })

    const partial = await request
      .authed('post', '/admin/notifications/read', token)
      .send({ ids: [first.id] })
    expect(partial.body.data.unread).toBe(1)

    const all = await request.authed('post', '/admin/notifications/read', token).send({})
    expect(all.body.data.unread).toBe(0)
  })

  it('只能把自己的消息标为已读（id 可被枚举）', async () => {
    const mine = await auth.createAndLogin({ username: 'admin-a', role: 'owner' })
    const other = await auth.createAndLogin({ username: 'admin-b', role: 'owner' })

    await adminNotification.notify({ tenantId: 1, adminUserId: mine.admin.id, type: 'system', title: '别人的消息' })

    // 用 B 的 token 去标 A 的消息（消息 id 是自增主键，可被枚举）
    const target = await db.queryOne('SELECT id FROM admin_notification WHERE admin_user_id = ?', [mine.admin.id])
    await request.authed('post', '/admin/notifications/read', other.token).send({ ids: [target.id] })

    const mineList = await request.authed('get', '/admin/notifications', mine.token)
    expect(mineList.body.data.unread).toBe(1)
  })

  it('未登录访问消息接口返回 401', async () => {
    expect((await request.get('/admin/notifications')).status).toBe(401)
    expect((await request.post('/admin/notifications/read')).status).toBe(401)
  })

  it('AC-P23 的管理员侧：项目创建者收到未汇报提醒', async () => {
    const { admin, projectIds } = await setupProjects(1)

    // 把项目改成施工中、建档时间推到 10 天前，且没有任何汇报
    const datetime = require('../../src/utils/datetime')
    await db.query("UPDATE project SET status = 'building', created_at = ? WHERE id = ?", [
      datetime.now().subtract(10, 'day').format('YYYY-MM-DD HH:mm:ss'),
      projectIds[0],
    ])

    const result = await staleReportReminder.runOnce()
    expect(result.scanned).toBe(1)

    // AC-P23 原文是「向管理员与业主各推送一次」。业主侧没有成员时不会发，
    // 但管理员这条必须到 —— 它走的是独立通道（迁移 012）
    const rows = await db.query(
      "SELECT title, ref_type, ref_id FROM admin_notification WHERE admin_user_id = ? AND ref_type = 'project'",
      [admin.id]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toContain('没有进度汇报')
    expect(rows[0].ref_id).toBe(projectIds[0])
  })

  it('管理员侧与 C 端消息互不干扰（两套主体）', async () => {
    const { admin } = await setupProjects(1)
    const cUser = await mini.login('code-cross')

    await adminNotification.notify({ tenantId: 1, adminUserId: admin.id, type: 'system', title: '给管理员' })
    await require('../../src/services/notification.service').notify({
      userId: cUser.userId,
      type: 'system',
      title: '给 C 端用户',
    })

    const adminRows = await db.query('SELECT title FROM admin_notification')
    const userRows = await db.query('SELECT title FROM notification')

    expect(adminRows.map((r) => r.title)).toEqual(['给管理员'])
    expect(userRows.map((r) => r.title)).toEqual(['给 C 端用户'])
  })
})

describe('AC-L24 结算单 PDF', () => {
  async function setupConfirmedReconciliation() {
    const admin = await auth.createAndLogin({ username: 'admin', role: 'owner' })
    const templateId = await fixtures.createTemplate({
      name: '模板',
      stages: [{ name: '水电工程', planDays: 10, items: [{ name: '强电布线' }] }],
    })

    const created = await request.authed('post', '/admin/projects', admin.token).send({
      name: '结算项目',
      address: '上海市浦东新区世纪大道 100 号',
      contractAmount: '200000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
      templateId,
    })
    const projectId = created.body.data.id

    const detail = await request.authed('get', `/admin/projects/${projectId}`, admin.token)
    const stageId = detail.body.data.stages[0].id

    await request.authed('put', `/admin/projects/${projectId}/payment-nodes`, admin.token).send({
      nodes: [{ name: '水电款', amount: '60000.00', triggerType: 'manual' }],
    })
    const node = await db.queryOne('SELECT id FROM payment_node WHERE project_id = ?', [projectId])
    await db.query("UPDATE payment_node SET status = 'unlocked' WHERE id = ?", [node.id])

    const foreman = await mini.login('code-foreman-pdf')
    const owner = await mini.login('code-owner-pdf')
    for (const [user, role] of [
      [foreman, 'foreman'],
      [owner, 'owner'],
    ]) {
      await db.query(
        `INSERT INTO project_member (project_id, user_id, role, status, is_primary, owner_type, confirmed_at, joined_at)
         VALUES (?, ?, ?, 'active', ?, ?, NOW(), NOW())`,
        [projectId, user.userId, role, role === 'foreman' ? 1 : 0, role === 'owner' ? 'primary' : null]
      )
    }

    // 直接写库造两条流水（走接口是 multipart，这里不关心那部分）
    await db.query(
      `INSERT INTO ledger (project_id, project_stage_id, type, category, amount, occurred_at, remark, created_by)
       VALUES (?, ?, 'expense', 'material', 1234.56, '2026-03-01', '材料', ?),
              (?, ?, 'income', NULL, 60000.00, '2026-03-05', '水电款', ?)`,
      [projectId, stageId, foreman.userId, projectId, stageId, foreman.userId]
    )

    const reconciliation = await mini
      .authed('post', `/projects/${projectId}/reconciliations`, foreman.token)
      .send({ periodStart: '2026-03-01', periodEnd: '2026-03-31' })

    const confirmed = await mini.authed(
      'post',
      `/reconciliations/${reconciliation.body.data.id}/confirm`,
      owner.token
    )

    return { projectId, owner, foreman, reconciliationId: reconciliation.body.data.id, confirmed }
  }

  it('确认对账后自动生成结算单 PDF', async () => {
    const { reconciliationId } = await setupConfirmedReconciliation()

    const row = await db.queryOne('SELECT settlement_pdf_url FROM reconciliation WHERE id = ?', [reconciliationId])
    expect(row.settlement_pdf_url).toContain('/uploads/settlements/')

    const key = row.settlement_pdf_url.split('/uploads/')[1]
    const fullPath = require('node:path').join(config.upload.dir, key)
    expect(fs.existsSync(fullPath)).toBe(true)

    const pdf = fs.readFileSync(fullPath)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    // 内嵌字体是中文可读的前提
    expect(/FontFile[23]/.test(pdf.toString('latin1'))).toBe(true)
  })

  it('详情里返回带签名的临时下载链接，双方均可下载', async () => {
    const { reconciliationId, owner, foreman } = await setupConfirmedReconciliation()

    const asOwner = await mini.authed('get', `/reconciliations/${reconciliationId}`, owner.token)
    const signedPath = asOwner.body.data.settlementPdfSignedPath
    expect(signedPath).toContain('expires=')
    expect(signedPath).toContain('sig=')

    // 免登录下载（AC-L24 要求双方均可下载，链接要能转发）
    const download = await request.raw('get', signedPath)
    expect(download.status).toBe(200)
    expect(download.headers['content-type']).toContain('application/pdf')

    // 工长侧同样能拿到链接
    const asForeman = await mini.authed('get', `/reconciliations/${reconciliationId}`, foreman.token)
    expect(asForeman.body.data.settlementPdfSignedPath).toBeTruthy()
  })

  it('签名错误或过期时下载被拒绝', async () => {
    const { reconciliationId } = await setupConfirmedReconciliation()
    const signedUrl = require('../../src/utils/signedUrl')

    const tampered = signedUrl.buildPath({
      resource: 'reconciliation-settlement',
      id: reconciliationId,
      path: `/api/v1/reconciliations/${reconciliationId}/settlement.pdf`,
    })
    expect((await request.raw('get', tampered.replace(/sig=[0-9a-f]+/, `sig=${'a'.repeat(64)}`))).status).toBe(403)

    const expired = signedUrl.buildPath({
      resource: 'reconciliation-settlement',
      id: reconciliationId,
      path: `/api/v1/reconciliations/${reconciliationId}/settlement.pdf`,
      ttlSeconds: -10,
    })
    expect((await request.raw('get', expired)).status).toBe(403)
  })

  it('结算单不能跨单据复用签名', async () => {
    const { reconciliationId } = await setupConfirmedReconciliation()
    const signedUrl = require('../../src/utils/signedUrl')

    const { expires, signature } = signedUrl.sign({
      resource: 'reconciliation-settlement',
      id: reconciliationId + 1,
    })
    const res = await request.raw(
      'get',
      `/api/v1/reconciliations/${reconciliationId}/settlement.pdf?expires=${expires}&sig=${signature}`
    )
    expect(res.status).toBe(403)
  })

  it('PDF 生成失败不阻断对账确认（同 AC-A19 的口径）', async () => {
    const storage = require('../../src/storage')
    const original = storage.saveGenerated
    storage.saveGenerated = async () => {
      throw new Error('模拟的磁盘写入失败')
    }

    try {
      const { confirmed } = await setupConfirmedReconciliation()
      // 关键：对账**确实确认了**，PDF 失败没有把它拖住
      expect(confirmed.status).toBe(200)
      expect(confirmed.body.data.status).toBe('confirmed')
    } finally {
      storage.saveGenerated = original
    }
  })

  it('字体缺失时 PDF 生成直接报错', () => {
    expect(() => settlementPdf.checkFontAvailable('/nonexistent/font.ttc')).toThrow(/字体文件不存在/)
    expect(settlementPdf.checkFontAvailable(config.acceptancePdf.fontPath)).toBe(true)
  })

  it('合计口径与明细一致：红冲取负', () => {
    const details = [
      { type: 'income', amount: '60000.00', is_reversal: 0 },
      { type: 'expense', amount: '1234.56', is_reversal: 0 },
      { type: 'expense', amount: '1234.56', is_reversal: 1 },
    ]

    const totals = settlementPdf.computeTotals(details)
    expect(totals.income).toBe('60000.00')
    // 一正一负相抵
    expect(totals.expense).toBe('0.00')
  })
})
