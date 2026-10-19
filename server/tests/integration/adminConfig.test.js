'use strict'

/**
 * B 端系统配置集成测试（B-5.5 / AC-AD65~67）。
 *
 * 配置是全系统唯一一处「一个人改、所有人受影响」的地方：
 * 改错一个阈值不会报错，只会让某个判定从此永远不成立或永远成立。
 * 因此这里重点测三件事：范围校验生效、变更留痕、以及改完**真的立刻生效**。
 */

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const sysConfigService = require('../../src/services/sysConfig.service')
const operationLog = require('../../src/services/operationLog.service')
const notificationService = require('../../src/services/notification.service')
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
  sysConfigService.invalidate()
})

async function setupSuper(username = 'config-super') {
  return auth.createAndLogin({ username, role: 'owner' })
}

describe('GET /admin/sys-configs 配置清单', () => {
  it('未落库时返回默认值并标记 isDefault，管理员看得到有哪些项可配', async () => {
    const { token } = await setupSuper()

    const res = await request.authed('get', '/admin/sys-configs', token)

    expect(res.status).toBe(200)
    const list = res.body.data.list
    // 刚部署完数据库是空的。若只返回库里的行，配置页会一片空白
    expect(list.length).toBeGreaterThanOrEqual(15)

    const images = list.find((i) => i.key === 'report_max_images')
    expect(images.value).toBe('9')
    expect(images.isDefault).toBe(true)
    expect(images.label).toBe('单次汇报照片上限')
    expect(images.unit).toBe('张')
  })

  it('尚未生效的配置项被显式标注，不谎报「保存成功」', async () => {
    const { token } = await setupSuper()

    const res = await request.authed('get', '/admin/sys-configs', token)
    const list = res.body.data.list

    // 签到、路线属于 V1.2，日志清理任务还没写。这些值改完不会立即生效 ——
    // 界面必须能如实说明，否则管理员会以为调好了而实际什么都没发生
    expect(list.find((i) => i.key === 'sign_in_distance_threshold').effective).toBe(false)
    expect(list.find((i) => i.key === 'route_max_points').effective).toBe(false)
    expect(list.find((i) => i.key === 'stale_report_days').effective).toBe(true)
  })

  it('项目管理员可以查看配置（写才需要超管）', async () => {
    const { token } = await auth.createAndLogin({ username: 'config-admin', role: 'admin' })

    const res = await request.authed('get', '/admin/sys-configs', token)
    expect(res.status).toBe(200)
  })
})

describe('PUT /admin/sys-configs/:key 修改配置', () => {
  it('超管修改后清单与读取接口都返回新值', async () => {
    const { token } = await setupSuper()

    const res = await request.authed('put', '/admin/sys-configs/report_max_images', token).send({ value: '12' })

    // 12 会超出传输层上限（MAX_FILES=12，而还有视频额度），因此这里用 6 验证正常路径
    if (res.status === 200) throw new Error('期望 12 被拒绝，但它通过了')

    await request.authed('put', '/admin/sys-configs/report_max_images', token).send({ value: '6' })

    const list = await request.authed('get', '/admin/sys-configs', token)
    const item = list.body.data.list.find((i) => i.key === 'report_max_images')
    expect(item.value).toBe('6')
    expect(item.isDefault).toBe(false)
    expect(item.updatedBy).toBeTruthy()
  })

  it('AC-AD65 越界值被拒绝并说明区间', async () => {
    const { token } = await setupSuper()

    const cases = [
      ['report_max_images', '0'],
      ['report_max_images', '999'],
      ['report_max_images', '9.5'],
      ['big_expense_ratio', '1.5'],
      ['big_expense_ratio', '-0.2'],
      ['gate_strength', 'very_strict'],
      ['stale_report_days', 'abc'],
    ]

    for (const [key, value] of cases) {
      const res = await request.authed('put', `/admin/sys-configs/${key}`, token).send({ value })
      expect(res.status, `${key}=${value} 应被拒绝`).toBe(400)
      // 提示里要带区间，否则管理员只知道「错了」却不知道错在哪
      expect(res.body.message).toBeTruthy()
    }

    // 一个都不该写进库
    expect(await db.count('FROM sys_config WHERE deleted_at IS NULL')).toBe(0)
  })

  it('未知配置项返回 400', async () => {
    const { token } = await setupSuper()

    const res = await request.authed('put', '/admin/sys-configs/not_a_config', token).send({ value: '1' })
    expect(res.status).toBe(400)
  })

  it('AC-AD67 项目管理员修改系统配置返回 403', async () => {
    const { token } = await auth.createAndLogin({ username: 'config-admin-2', role: 'admin' })

    const res = await request.authed('put', '/admin/sys-configs/report_max_images', token).send({ value: '5' })

    expect(res.status).toBe(403)
    expect(await db.count('FROM sys_config WHERE deleted_at IS NULL')).toBe(0)
  })

  it('AC-AD09 / §5.5 变更留痕：写入操作日志，含变更前后值', async () => {
    const { token, admin } = await setupSuper()

    await request.authed('put', '/admin/sys-configs/stale_report_days', token).send({ value: '5' })

    const rows = await db.query('SELECT * FROM operation_log WHERE action = ?', [operationLog.ACTIONS.SYS_CONFIG_UPDATE])

    expect(rows).toHaveLength(1)
    expect(rows[0].operator_type).toBe('admin')
    expect(rows[0].operator_id).toBe(admin.id)
    expect(rows[0].target_type).toBe('sys_config')
    expect(rows[0].ip).toBeTruthy()

    const detail = typeof rows[0].detail === 'string' ? JSON.parse(rows[0].detail) : rows[0].detail
    // §5.5 配置规则：「所有配置项修改均写入 operation_log，含变更前后值」
    expect(detail.before).toEqual({ key: 'stale_report_days', value: '3' })
    expect(detail.after).toEqual({ key: 'stale_report_days', value: '5' })
  })

  it('值没变时不写库也不记日志', async () => {
    const { token } = await setupSuper()

    await request.authed('put', '/admin/sys-configs/stale_report_days', token).send({ value: '3' })

    // 日志里堆满「改了但改成了同一个值」会掩盖真正的变更
    expect(await db.count('FROM sys_config WHERE deleted_at IS NULL')).toBe(0)
    expect(await db.count('FROM operation_log WHERE action = ?', [operationLog.ACTIONS.SYS_CONFIG_UPDATE])).toBe(0)
  })

  it('修改后立即生效，不受 60 秒缓存影响', async () => {
    const { token } = await setupSuper()

    // 先读一次，把默认值灌进进程内缓存
    expect(await sysConfigService.getInt(1, 'stale_report_days')).toBe(3)

    await request.authed('put', '/admin/sys-configs/stale_report_days', token).send({ value: '7' })

    // 配置有 60 秒进程内缓存（读极频繁、改极少）。写库之后若忘了清缓存，
    // 管理员的预期是「保存完立刻生效」，实际却要等一分钟 ——
    // 那种延迟最容易被当成「改了没生效」，然后再改一遍
    expect(await sysConfigService.getInt(1, 'stale_report_days')).toBe(7)
  })

  it('订阅消息模板 ID 保存后能被消息服务读到（B-5.7）', async () => {
    const { token } = await setupSuper()

    await request
      .authed('put', '/admin/sys-configs/subscribe_template_progress', token)
      .send({ value: 'TPL-PROGRESS-001' })

    // 两处键名必须完全一致，否则配置能保存、推送时永远取不到值
    expect(await notificationService.resolveTemplateId(1, 'progress')).toBe('TPL-PROGRESS-001')
    // 没配过的那几类各自独立，取不到模板 ID（返回 null 表示只发站内信）
    expect(await notificationService.resolveTemplateId(1, 'acceptance')).toBeNull()
  })

  it('配置值统一以字符串入库（§6.2）', async () => {
    const { token } = await setupSuper()

    await request.authed('put', '/admin/sys-configs/big_expense_ratio', token).send({ value: 0.2 })

    const row = await db.queryOne("SELECT config_value FROM sys_config WHERE config_key = 'big_expense_ratio'")
    expect(row.config_value).toBe('0.2')
    expect(typeof row.config_value).toBe('string')
  })
})

describe('系统配置的鉴权', () => {
  it('未登录一律 401', async () => {
    const read = await request.get('/admin/sys-configs')
    const write = await request.put('/admin/sys-configs/stale_report_days').send({ value: '5' })

    expect(read.status).toBe(401)
    expect(write.status).toBe(401)
  })

  it('C 端 token 不能访问后台配置（AC-AD10）', async () => {
    const mini = require('./helpers/mini')
    const user = await mini.login('config-mini')

    const res = await request.authed('get', '/admin/sys-configs', user.token)
    expect(res.status).toBe(401)
  })
})
