'use strict'

/**
 * 基建层集成测试。
 *
 * 覆盖 M1 交付的请求管线本身：响应结构（§7.2）、错误处理不泄露内部信息
 * （AC-AD46）、requestId 回传、限流生效、健康检查、数据库与缓存的真实连通。
 *
 * 这些断言看起来「测的是框架」，但它们是后面 149 条 AC 的基础 ——
 * 响应体结构一旦跑偏，前端所有接口适配都要重写。
 */

// describe / it / expect / beforeAll 由 vitest 全局注入（见 vitest.config.mjs 的 globals）
const config = require('../../config')
const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const { prepareDatabase } = require('./helpers/db')
const request = require('./helpers/request')

beforeAll(() => {
  prepareDatabase()
})

afterAll(async () => {
  await db.close()
  await cache.close()
})

describe('基建 · 运行环境隔离', () => {
  it('测试跑在独立库上，不会碰开发库', () => {
    // 这条断言是对「集成测试会 DROP DATABASE」这一事实的保险：
    // 一旦 NODE_ENV 没设对，测试会清空 renovation_dev
    expect(config.env).toBe('test')
    expect(config.db.database).toBe('renovation_test')
    expect(config.db.database).not.toBe('renovation_dev')
  })

  it('测试用内存缓存，不依赖 Redis 也能跑', () => {
    expect(config.cache.driver).toBe('memory')
  })
})

describe('基建 · 存活与就绪探针', () => {
  it('GET /health 返回 200 与统一响应体', async () => {
    const res = await request.raw('get', '/health').expect(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.status).toBe('ok')
  })

  it('GET /api/v1/health 真实探测 MySQL 与缓存', async () => {
    const res = await request.get('/health').expect(200)
    expect(res.body.data.checks.database).toBe(true)
    expect(res.body.data.checks.cache).toBe(true)
  })
})

describe('基建 · 响应结构（§7.2）', () => {
  it('成功响应恒为 { code: 0, message, data }', async () => {
    const res = await request.get('/health')
    expect(Object.keys(res.body).sort()).toEqual(['code', 'data', 'message'])
    expect(res.body.code).toBe(0)
    expect(res.body.message).toBe('success')
  })

  it('响应头带 X-Request-Id，便于与日志串联', async () => {
    const res = await request.get('/health')
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  })

  it('上游传入的合法 X-Request-Id 被透传（全链路串联）', async () => {
    const inbound = 'trace-abc-123456'
    const res = await request.get('/health').set('X-Request-Id', inbound)
    expect(res.headers['x-request-id']).toBe(inbound)
  })

  it('非法 X-Request-Id 被忽略并重新生成，防止污染日志', async () => {
    // 用空格与非法字符构造（不能带 \n：HTTP 库在发送前就会拒收含换行的头，
    // 那样测的是 superagent 而不是我们的过滤逻辑）
    const res = await request.get('/health').set('X-Request-Id', 'bad id!! with spaces <script>')
    expect(res.headers['x-request-id']).not.toContain('bad id')
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  })
})

describe('基建 · 错误处理（AC-AD46）', () => {
  it('404 使用统一结构且 code 与 HTTP 状态码一致', async () => {
    const res = await request.get('/definitely-not-a-route').expect(404)
    expect(res.body.code).toBe(404)
    expect(res.body.message).toBe('接口不存在')
    expect(res.body).toHaveProperty('data')
  })

  it('404 提示不回显用户可控的请求路径（防反射型 XSS）', async () => {
    const payload = '<script>alert(1)</script>'
    const res = await request.get(`/${encodeURIComponent(payload)}`).expect(404)
    expect(res.body.message).not.toContain('<script>')
    expect(JSON.stringify(res.body)).not.toContain('script')
  })

  it('错误响应不含堆栈与框架内部信息', async () => {
    const res = await request.get('/definitely-not-a-route')
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toMatch(/at .*\(.*:\d+:\d+\)/) // 堆栈帧
    expect(serialized).not.toMatch(/node_modules/)
    expect(serialized).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i) // SQL
    expect(res.body).not.toHaveProperty('stack')
  })

  it('响应头不暴露技术栈', async () => {
    const res = await request.get('/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('基建 · 限流（§8.2）', () => {
  it('响应头暴露配额，前端可在 429 前克制', async () => {
    const res = await request.get('/health')
    expect(res.headers['x-ratelimit-limit']).toBeDefined()
    expect(Number(res.headers['x-ratelimit-remaining'])).toBeGreaterThanOrEqual(0)
  })

  it('IP 级限流达到阈值后返回 429，且结构与其他错误一致', async () => {
    // 用独立的 scope 计数不可避免地会影响后续用例，因此这里直接
    // 把计数器打满：上限是 60 × 5 = 300
    const limit = config.rateLimit.perMinute * 5
    let lastStatus = 200
    for (let i = 0; i <= limit; i += 1) {
      const res = await request.get('/health')
      lastStatus = res.status
      if (lastStatus === 429) {
        expect(res.body.code).toBe(429)
        expect(res.body.message).toContain('频繁')
        expect(res.headers['retry-after']).toBeDefined()
        break
      }
    }
    expect(lastStatus).toBe(429)
  })
})

describe('基建 · 数据层连接', () => {
  it('迁移已建出全部业务表', async () => {
    const rows = await db.query(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'`
    )
    const names = rows.map((r) => r.name)
    // 业务表数量。§6.1 原列 31 张，后续新增：
    //   project_door_code（v1.7 门锁密码，迁移 014）
    //   admin_notification、export_task（迁移 012）
    //   content_page、feedback（迁移 013，M11 补的两处 §6.3 漏项）
    //   report_media_staging（迁移 017，小程序逐文件上传的暂存）
    //   admin_wechat_binding（迁移 018，小程序管理员微信免密绑定）
    //   visit_media_staging（迁移 024，现场签到照片逐张暂存）
    //   esign_task、esign_identity、esign_event（迁移 026，可靠电子签名）
    //   project_completion_report（迁移 028，项目竣工总报告）
    // 这个数字每加一张表就要改一次，是刻意的 —— 它逼着改动者确认
    // 「新表是不是真的该建」，而不是随手加一张
    expect(names).toHaveLength(45)

    for (const expected of [
      'user',
      'admin_user',
      'project',
      'project_stage',
      'acceptance',
      'ledger',
      'visit_record',
      'content_page',
      'feedback',
      'project_door_code',
      'tenant',
      'platform_access_grant',
      'admin_wechat_binding',
      'visit_media_staging',
      'esign_task',
      'esign_identity',
      'esign_event',
      'project_completion_report',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('主业主迁移已建出 owner_type、生成列与唯一索引', async () => {
    const columns = await db.query(
      `SELECT column_name AS name, extra AS generation
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'project_member'
          AND column_name IN ('owner_type', 'primary_owner_key')`
    )
    expect(columns.map((c) => c.name).sort()).toEqual(['owner_type', 'primary_owner_key'])
    expect(columns.find((c) => c.name === 'primary_owner_key').generation).toContain('STORED GENERATED')

    const indexes = await db.query(
      `SELECT index_name AS name
         FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'project_member'
          AND index_name = 'uk_pm_primary_owner'`
    )
    expect(indexes).toHaveLength(1)
  })

  it('DECIMAL 以字符串返回（AC-L11 的前提）', async () => {
    await db.query(
      `INSERT INTO project (id, tenant_id, name, address, contract_amount, start_date, plan_end_date, created_by)
       VALUES (1, 1, '精度验证项目', '某地', 123456.78, '2026-01-01', '2026-06-01', 1)`
    )
    const row = await db.queryOne('SELECT contract_amount FROM project WHERE id = 1')
    // 关键：typeof 必须是 string。若连接层开了 decimalNumbers，
    // 这里会变成 number，AC-L11 的「无浮点运算」随即失效
    expect(typeof row.contract_amount).toBe('string')
    expect(row.contract_amount).toBe('123456.78')
  })

  it('DATETIME 以字符串返回，不经过 JS Date 的时区转换', async () => {
    const row = await db.queryOne('SELECT created_at FROM project WHERE id = 1')
    expect(typeof row.created_at).toBe('string')
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('BIGINT 以数字返回，自增主键不会变成字符串', async () => {
    // 这条锁死 bigNumberStrings=false。若有人改成 true，
    // 全项目的 id 比较（含前端 === 判断）会集体失效
    const row = await db.queryOne('SELECT id FROM project WHERE id = 1')
    expect(typeof row.id).toBe('number')
    expect(row.id).toBe(1)

    const counted = await db.count('FROM project WHERE deleted_at IS NULL')
    expect(typeof counted).toBe('number')
    expect(counted).toBe(1)
  })

  it('事务在异常时回滚', async () => {
    await expect(
      db.withTransaction(async (tx) => {
        await tx.query('INSERT INTO sys_config (tenant_id, config_key, config_value) VALUES (1, ?, ?)', ['tx_test', 'a'])
        throw new Error('故意失败')
      })
    ).rejects.toThrow('故意失败')

    const row = await db.queryOne('SELECT id FROM sys_config WHERE config_key = ?', ['tx_test'])
    expect(row).toBeNull()
  })

  it('事务正常提交', async () => {
    await db.withTransaction(async (tx) => {
      await tx.query('INSERT INTO sys_config (tenant_id, config_key, config_value) VALUES (1, ?, ?)', ['tx_ok', 'b'])
    })
    const row = await db.queryOne('SELECT config_value FROM sys_config WHERE config_key = ?', ['tx_ok'])
    expect(row.config_value).toBe('b')
  })
})

describe('基建 · 缓存抽象层', () => {
  it('set / get 往返对象', async () => {
    await cache.set('it:obj', { a: 1, list: [1, 2] }, 60)
    expect(await cache.get('it:obj')).toEqual({ a: 1, list: [1, 2] })
  })

  it('不存在的键返回 null 而非 undefined 或抛错', async () => {
    expect(await cache.get('it:missing')).toBeNull()
  })

  it('incrWithTtl 首次写入时设置过期时间', async () => {
    const first = await cache.incrWithTtl('it:counter', 60)
    const second = await cache.incrWithTtl('it:counter', 60)
    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(await cache.ttl('it:counter')).toBeGreaterThan(0)
  })

  it('setIfAbsent 用于「同一提醒只发一次」的抢占式去重', async () => {
    expect(await cache.setIfAbsent('it:once', 'v1', 60)).toBe(true)
    expect(await cache.setIfAbsent('it:once', 'v2', 60)).toBe(false)
    expect(await cache.get('it:once')).toBe('v1')
  })

  it('键带命名空间前缀，避免与同机其他项目串键', async () => {
    expect(config.cache.prefix).toBe('renovation:')
    // 前缀在门面层统一拼装，stripPrefix 是它的逆运算
    expect(cache.stripPrefix(`${config.cache.prefix}captcha:abc`)).toBe('captcha:abc')
    expect(cache.stripPrefix('captcha:abc')).toBe('captcha:abc')
  })

  it('支持业务里惯用的冒号分层键名（captcha:xxx、ratelimit:user:1:123）', async () => {
    await cache.set('captcha:login:abc', '9527', 60)
    await cache.set('ratelimit:user:1:123', 5, 60)
    expect(await cache.get('captcha:login:abc')).toBe('9527')
    expect(await cache.get('ratelimit:user:1:123')).toBe(5)
  })

  it('del 支持一次删除多个键', async () => {
    await cache.set('it:temp1', 'x', 60)
    await cache.set('it:temp2', 'y', 60)
    await cache.del(['it:temp1', 'it:temp2'])
    expect(await cache.get('it:temp1')).toBeNull()
    expect(await cache.get('it:temp2')).toBeNull()
  })
})
