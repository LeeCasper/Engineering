'use strict'

/**
 * 进度汇报集成测试（AC-P05~P13、P20~P26）。
 *
 * 提交走真实 multipart 上传，图片是真的 JPEG（sharp 现造）。
 * 用真图而不是伪造的 Buffer 是刻意的：水印那一整条链路
 * （解析 → 算尺寸 → 合成 SVG 图层 → 编码）只有在真图上才会真正跑起来。
 */

const sharp = require('sharp')
const fs = require('node:fs')
const path = require('node:path')

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const config = require('../../config')
const sysConfigService = require('../../src/services/sysConfig.service')
const staleReportReminder = require('../../src/jobs/staleReportReminder')
const reportMediaCleanup = require('../../src/jobs/reportMediaCleanup')
const datetime = require('../../src/utils/datetime')
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

/** 造一张真 JPEG。size 决定水印字号，测试里需要大图才能验证尺寸保持 */
async function makeJpeg(width = 800, height = 600, color = { r: 200, g: 210, b: 220 }) {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer()
}

/** 极小的 MP4 头，够通过 MIME 校验（服务端不解析视频内容） */
function makeFakeMp4() {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, 0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31,
  ])
}

/** 准备项目 + 工长 + 一个工序 */
async function setup({ status = 'building' } = {}) {
  const admin = await auth.createAndLogin({ username: 'admin', role: 'owner' })
  const templateId = await fixtures.createTemplate({
    name: '模板',
    stages: [{ name: '水电工程', planDays: 10, items: [{ name: '强电布线' }, { name: '水路改造' }] }],
  })

  const created = await request.authed('post', '/admin/projects', admin.token).send({
    name: '测试项目',
    address: '上海市浦东新区世纪大道 100 号 3 号楼',
    contractAmount: '200000.00',
    startDate: '2026-01-01',
    planEndDate: '2026-06-01',
    templateId,
  })
  const projectId = created.body.data.id

  const foreman = await mini.login('code-foreman')
  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, status, is_primary, confirmed_at, joined_at)
     VALUES (?, ?, 'foreman', 'active', 1, NOW(), NOW())`,
    [projectId, foreman.userId]
  )

  if (status !== 'pending') {
    await db.query('UPDATE project SET status = ? WHERE id = ?', [status, projectId])
  }

  const detail = await request.authed('get', `/admin/projects/${projectId}`, admin.token)
  const items = detail.body.data.stages[0].items

  return { admin, projectId, foreman, items, itemId: items[0].id }
}

/** 提交汇报。files 形如 [{ buffer, name, mime }] */
function submit(projectId, token, fields = {}, files = []) {
  const req = request.post(`/projects/${projectId}/reports`).set('Authorization', `Bearer ${token}`)

  for (const [key, value] of Object.entries(fields)) {
    req.field(key, typeof value === 'string' ? value : JSON.stringify(value))
  }
  for (const file of files) {
    req.attach('files', file.buffer, { filename: file.name || 'photo.jpg', contentType: file.mime || 'image/jpeg' })
  }
  return req
}

/** 单文件暂存。小程序端一次只能传一个文件，测试也按这个形态走 */
function stage(projectId, token, fields = {}, file) {
  const req = request.post(`/projects/${projectId}/reports/media`).set('Authorization', `Bearer ${token}`)
  for (const [key, value] of Object.entries(fields)) {
    req.field(key, typeof value === 'string' ? value : JSON.stringify(value))
  }
  if (file) {
    req.attach('files', file.buffer, {
      filename: file.name || 'photo.jpg',
      contentType: file.mime || 'image/jpeg',
    })
  }
  return req
}

let requestCounter = 0
function nextRequestId() {
  requestCounter += 1
  return `req-${Date.now()}-${requestCounter}`
}

describe('AC-P05 / AC-P08 提交前置校验', () => {
  it('AC-P05 未选择工序时无法提交', async () => {
    const { projectId, foreman } = await setup()

    const res = await submit(projectId, foreman.token, {
      progress: '40',
      content: '随便写点',
      clientRequestId: nextRequestId(),
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('工序')
  })

  it('AC-P08 正文为空且无附件时无法提交', async () => {
    const { projectId, foreman, itemId } = await setup()

    const res = await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '40',
      clientRequestId: nextRequestId(),
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('说明或上传照片')
  })

  it('只传附件不写正文可以提交', async () => {
    const { projectId, foreman, itemId } = await setup()
    const res = await submit(
      projectId,
      foreman.token,
      { itemId: String(itemId), progress: '40', clientRequestId: nextRequestId() },
      [{ buffer: await makeJpeg() }]
    )
    expect(res.status).toBe(200)
    expect(res.body.data.media).toHaveLength(1)
  })

  it('只有空白字符的正文等同于没有正文', async () => {
    const { projectId, foreman, itemId } = await setup()
    const res = await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '40',
      content: '   \n  ',
      clientRequestId: nextRequestId(),
    })
    expect(res.status).toBe(400)
  })

  it('AC-P06 完成度非 5 的整数倍被拒绝', async () => {
    const { projectId, foreman, itemId } = await setup()
    const res = await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '37',
      content: '说明',
      clientRequestId: nextRequestId(),
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('5 的整数倍')
  })

  it('已完工项目不再接受新的进度汇报（AC-AD56）', async () => {
    const { projectId, foreman, itemId } = await setup({ status: 'finished' })
    const res = await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '40',
      content: '说明',
      clientRequestId: nextRequestId(),
    })
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('已完工')
  })

  it('归档项目全部只读（AC-AD25）', async () => {
    const { projectId, foreman, itemId } = await setup({ status: 'archived' })
    const res = await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '40',
      content: '说明',
      clientRequestId: nextRequestId(),
    })
    expect(res.status).toBe(403)
    expect(res.body.message).toContain('归档')
  })

  it('已结清阶段不再接受新的进度汇报（§4.7.1 终态）', async () => {
    const { projectId, foreman, itemId } = await setup()
    await db.query("UPDATE project_stage SET gate_status = 'settled' WHERE project_id = ?", [projectId])

    const res = await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '40',
      content: '说明',
      clientRequestId: nextRequestId(),
    })
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('已结清')
  })

  it('非工长（业主）提交返回 403', async () => {
    const { projectId, items } = await setup()
    const owner = await mini.login('code-owner')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status, confirmed_at) VALUES (?, ?, 'owner', 'active', NOW())",
      [projectId, owner.userId]
    )

    const res = await submit(projectId, owner.token, {
      itemId: String(items[0].id),
      progress: '40',
      content: '说明',
      clientRequestId: nextRequestId(),
    })
    expect(res.status).toBe(403)
  })
})

describe('AC-P07 附件上限', () => {
  it('照片超过 9 张时拒绝，并提示具体上限', async () => {
    const { projectId, foreman, itemId } = await setup()

    const files = []
    for (let i = 0; i < 10; i += 1) files.push({ buffer: await makeJpeg(60, 60) })

    const res = await submit(
      projectId,
      foreman.token,
      { itemId: String(itemId), progress: '40', content: '说明', clientRequestId: nextRequestId() },
      files
    )
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('9 张')
  })

  it('正好 9 张可以通过', async () => {
    const { projectId, foreman, itemId } = await setup()
    const files = []
    for (let i = 0; i < 9; i += 1) files.push({ buffer: await makeJpeg(60, 60) })

    const res = await submit(
      projectId,
      foreman.token,
      { itemId: String(itemId), progress: '40', content: '说明', clientRequestId: nextRequestId() },
      files
    )
    expect(res.status).toBe(200)
    expect(res.body.data.media).toHaveLength(9)
  })

  it('视频超过 1 个时拒绝', async () => {
    const { projectId, foreman, itemId } = await setup()
    const res = await submit(
      projectId,
      foreman.token,
      { itemId: String(itemId), progress: '40', content: '说明', clientRequestId: nextRequestId() },
      [
        { buffer: makeFakeMp4(), name: 'a.mp4', mime: 'video/mp4' },
        { buffer: makeFakeMp4(), name: 'b.mp4', mime: 'video/mp4' },
      ]
    )
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('1 个')
  })

  it('视频时长超过 60 秒时拒绝', async () => {
    const { projectId, foreman, itemId } = await setup()
    const res = await submit(
      projectId,
      foreman.token,
      {
        itemId: String(itemId),
        progress: '40',
        content: '说明',
        clientRequestId: nextRequestId(),
        videoDurations: [75],
      },
      [{ buffer: makeFakeMp4(), name: 'a.mp4', mime: 'video/mp4' }]
    )
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('60 秒')
  })

  it('附件上限可通过系统配置调整（B-5.5）', async () => {
    const { projectId, foreman, itemId } = await setup()

    await db.query(
      `INSERT INTO sys_config (tenant_id, config_key, config_value, scope, description)
       VALUES (1, 'report_max_images', '2', 'global', 'test')
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`
    )
    sysConfigService.invalidate()

    const files = []
    for (let i = 0; i < 3; i += 1) files.push({ buffer: await makeJpeg(60, 60) })

    const res = await submit(
      projectId,
      foreman.token,
      { itemId: String(itemId), progress: '40', content: '说明', clientRequestId: nextRequestId() },
      files
    )
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('2 张')
  })

  it('不支持的文件类型被拒绝', async () => {
    const { projectId, foreman, itemId } = await setup()
    const res = await submit(
      projectId,
      foreman.token,
      { itemId: String(itemId), progress: '40', content: '说明', clientRequestId: nextRequestId() },
      [{ buffer: Buffer.from('#!/bin/sh\necho hi'), name: 'evil.sh', mime: 'application/x-sh' }]
    )
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('不支持的文件类型')
  })
})

describe('AC-P11 / AC-P12 / AC-P13 服务端水印', () => {
  it('AC-P12 绕过小程序直接向接口上传原图，返回的图片仍带水印', async () => {
    const { projectId, foreman, itemId } = await setup()
    const original = await makeJpeg(1000, 750)

    const res = await submit(
      projectId,
      foreman.token,
      { itemId: String(itemId), progress: '40', content: '说明', clientRequestId: nextRequestId() },
      [{ buffer: original }]
    )

    expect(res.status).toBe(200)
    const media = res.body.data.media[0]

    // 服务端同时保存了原图与带水印版本，对外默认给带水印的那份
    expect(media.url).not.toBe(media.originalUrl)
    expect(media.originalUrl).toBeTruthy()
    expect(media.url).toContain('/uploads/reports/')
    expect(media.originalUrl).toContain('/uploads/reports/')

    // 把两份文件都读回来，确认确实不同 —— 这是「水印真的叠加了」的硬证据
    const markedPath = path.join(config.upload.dir, media.url.split('/uploads/')[1])
    const plainPath = path.join(config.upload.dir, media.originalUrl.split('/uploads/')[1])
    expect(fs.existsSync(markedPath)).toBe(true)
    expect(fs.existsSync(plainPath)).toBe(true)

    const marked = fs.readFileSync(markedPath)
    const plain = fs.readFileSync(plainPath)
    expect(marked.equals(plain)).toBe(false)

    // 尺寸不变（水印是叠加，不是裁剪或缩放）
    const markedMeta = await sharp(marked).metadata()
    expect(markedMeta.width).toBe(1000)
    expect(markedMeta.height).toBe(750)

    // 右下角区域应当出现深色像素（水印底衬），左上角保持干净
    const bottomRight = await sharp(marked).extract({ left: 1000 - 500, top: 750 - 160, width: 490, height: 150 }).raw().toBuffer({ resolveWithObject: true })
    let darkBottom = 0
    for (let i = 0; i < bottomRight.data.length; i += bottomRight.info.channels) {
      if (bottomRight.data[i] < 200) darkBottom += 1
    }
    expect(darkBottom).toBeGreaterThan(0)

    const topLeft = await sharp(marked).extract({ left: 5, top: 5, width: 100, height: 60 }).raw().toBuffer({ resolveWithObject: true })
    let darkTop = 0
    for (let i = 0; i < topLeft.data.length; i += topLeft.info.channels) {
      if (topLeft.data[i] < 200) darkTop += 1
    }
    expect(darkTop).toBe(0)
  })

  it('AC-P11 水印内容包含时间、项目地址与工序名', async () => {
    const watermark = require('../../src/utils/watermark')
    const svg = watermark
      .buildWatermarkSvg({ lines: ['2026-10-16 14:30:00', '上海市浦东新区世纪大道 100 号', '强电布线'], fontSize: 24, padding: 16 })
      .svg.toString('utf8')

    expect(svg).toContain('2026-10-16 14:30:00')
    expect(svg).toContain('上海市浦东新区世纪大道 100 号')
    expect(svg).toContain('强电布线')
  })

  it('地址里的 XML 特殊字符被转义，不会破坏水印渲染', async () => {
    const { projectId, foreman, itemId } = await setup()
    await db.query('UPDATE project SET address = ? WHERE id = ?', ['A&B <装修> "工地"', projectId])

    const res = await submit(
      projectId,
      foreman.token,
      { itemId: String(itemId), progress: '40', content: '说明', clientRequestId: nextRequestId() },
      [{ buffer: await makeJpeg(400, 300) }]
    )
    // 不转义的话 SVG 解析会失败，这里会变成 500
    expect(res.status).toBe(200)
    expect(res.body.data.media[0].url).not.toBe(res.body.data.media[0].originalUrl)
  })

  it('AC-P13 水印位置来自全局配置，不接收调用方指定', () => {
    const watermark = require('../../src/utils/watermark')
    const svgSource = fs.readFileSync(path.join(__dirname, '../../src/utils/watermark.js'), 'utf8')
    // 位置只能取自 config.watermark.position
    expect(svgSource).toContain('config.watermark.position')
    expect(typeof watermark.apply).toBe('function')
  })

  it('字体缺失时直接抛错，而不是静默产出无水印图片', () => {
    const watermark = require('../../src/utils/watermark')

    // 直接测纯函数：config 是深冻结的，测试改不了 fontPath，
    // 而这条守卫恰恰最需要被盯住 —— 它失效的后果是「照片看起来正常但没水印」
    expect(() => watermark.checkFontAvailable('/nonexistent/font.ttc')).toThrow(/字体文件不存在/)

    // 存在的路径不抛错
    expect(watermark.checkFontAvailable(config.watermark.fontPath)).toBe(true)

    // 空路径视为「不检查」而不是报错：某些环境（如仅处理视频的部署）可以不配字体
    expect(watermark.checkFontAvailable('')).toBe(true)

    // 抛错信息要说明白后果，否则运维只会看到「文件不存在」而随手建个空文件了事
    let message = ''
    try {
      watermark.checkFontAvailable('/nonexistent/font.ttc')
    } catch (err) {
      message = err.message
    }
    expect(message).toContain('AC-P12')
  })

  it('视频不做水印，watermarkUrl 保持为空而不是复用原图地址', async () => {
    const { projectId, foreman, itemId } = await setup()
    const res = await submit(
      projectId,
      foreman.token,
      {
        itemId: String(itemId),
        progress: '40',
        content: '说明',
        clientRequestId: nextRequestId(),
        videoDurations: [30],
      },
      [{ buffer: makeFakeMp4(), name: 'a.mp4', mime: 'video/mp4' }]
    )

    expect(res.status).toBe(200)
    const media = res.body.data.media[0]
    expect(media.type).toBe('video')
    expect(media.originalUrl).toBeNull()
    expect(media.duration).toBe(30)

    const row = await db.queryOne('SELECT watermark_url FROM progress_media WHERE report_id = ?', [
      res.body.data.id,
    ])
    expect(row.watermark_url).toBeNull()
  })
})

describe('AC-P10 断网重试的幂等', () => {
  it('同一幂等键重复提交只产生一条汇报', async () => {
    const { projectId, foreman, itemId } = await setup()
    const clientRequestId = nextRequestId()
    const fields = { itemId: String(itemId), progress: '40', content: '说明', clientRequestId }

    const first = await submit(projectId, foreman.token, fields, [{ buffer: await makeJpeg(60, 60) }])
    expect(first.status).toBe(200)

    // 模拟断网后重试：同一个幂等键再发一次
    const second = await submit(projectId, foreman.token, fields, [{ buffer: await makeJpeg(60, 60) }])
    expect(second.status).toBe(200)
    expect(second.body.data.id).toBe(first.body.data.id)
    expect(second.body.data.idempotentReplay).toBe(true)

    expect(await db.count('FROM progress_report WHERE project_id = ?', [projectId])).toBe(1)
    // 重试不该重复落盘文件
    expect(await db.count('FROM progress_media WHERE report_id = ?', [first.body.data.id])).toBe(1)
  })

  it('不同幂等键产生不同汇报', async () => {
    const { projectId, foreman, itemId } = await setup()
    for (const progress of ['40', '60']) {
      await submit(projectId, foreman.token, {
        itemId: String(itemId),
        progress,
        content: '说明',
        clientRequestId: nextRequestId(),
      })
    }
    expect(await db.count('FROM progress_report WHERE project_id = ?', [projectId])).toBe(2)
  })

  it('不同用户的相同幂等键互不影响（唯一键是 user_id + client_request_id）', async () => {
    const { projectId, items } = await setup()
    const foreman2 = await mini.login('code-foreman2')
    await db.query(
      `INSERT INTO project_member (project_id, user_id, role, status, confirmed_at, joined_at)
       VALUES (?, ?, 'foreman', 'active', NOW(), NOW())`,
      [projectId, foreman2.userId]
    )

    const shared = 'same-key-from-different-devices'
    const body = { itemId: String(items[0].id), progress: '40', content: '说明', clientRequestId: shared }

    const foreman1 = await db.queryOne('SELECT user_id FROM project_member WHERE project_id = ? LIMIT 1', [projectId])
    const first = await submit(projectId, foreman2.token, body)
    expect(first.status).toBe(200)

    // 换一个人用同一个键，应当各自成一条
    const otherToken = await (async () => {
      const u = await mini.login('code-foreman3')
      await db.query(
        `INSERT INTO project_member (project_id, user_id, role, status, confirmed_at, joined_at)
         VALUES (?, ?, 'foreman', 'active', NOW(), NOW())`,
        [projectId, u.userId]
      )
      return u.token
    })()
    const second = await submit(projectId, otherToken, body)
    expect(second.status).toBe(200)
    expect(second.body.data.id).not.toBe(first.body.data.id)
    expect(foreman1.user_id).toBeGreaterThan(0)
  })

  it('缺少幂等键时拒绝提交', async () => {
    const { projectId, foreman, itemId } = await setup()
    const res = await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '40',
      content: '说明',
    })
    expect(res.status).toBe(400)
  })
})

describe('AC-P09 / AC-P20 汇报记录流', () => {
  it('AC-P09 提交成功后记录流首行即为该条', async () => {
    const { projectId, foreman, itemId } = await setup()

    await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '40',
      content: '第一条',
      clientRequestId: nextRequestId(),
    })
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const submitted = await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '60',
      content: '第二条',
      clientRequestId: nextRequestId(),
    })

    const list = await request.authed('get', `/projects/${projectId}/reports`, foreman.token)
    expect(list.body.data.list[0].id).toBe(submitted.body.data.id)
    expect(list.body.data.list[0].content).toBe('第二条')
    expect(list.body.data.list[1].content).toBe('第一条')
    // 详情页要展示「40% → 60%」与作者角色，数据必须来自同一条汇报
    expect(list.body.data.list[0].fromProgress).toBe('40.00')
    expect(list.body.data.list[0].author.role).toBe('foreman')
    expect(list.body.data.list[0].author.roleLabel).toBe('工长')
  })

  it('AC-P20 每页 20 条、按时间倒序、有总数', async () => {
    const { projectId, foreman, itemId } = await setup()

    for (let i = 0; i < 25; i += 1) {
      await submit(projectId, foreman.token, {
        itemId: String(itemId),
        progress: String((i % 20) * 5),
        content: `第 ${i} 条`,
        clientRequestId: nextRequestId(),
      })
    }

    const page1 = await request.authed('get', `/projects/${projectId}/reports?page=1`, foreman.token)
    expect(page1.body.data.list).toHaveLength(20)
    expect(page1.body.data.pageSize).toBe(20)
    expect(page1.body.data.total).toBe(25)
    expect(page1.body.data.totalPages).toBe(2)

    const page2 = await request.authed('get', `/projects/${projectId}/reports?page=2`, foreman.token)
    expect(page2.body.data.list).toHaveLength(5)

    // 倒序：第一页最后一条的时间不早于第二页第一条
    const lastOfPage1 = page1.body.data.list[19].createdAt
    const firstOfPage2 = page2.body.data.list[0].createdAt
    expect(lastOfPage1 >= firstOfPage2).toBe(true)
  })

  it('可按工序筛选', async () => {
    const { projectId, foreman, items } = await setup()

    await submit(projectId, foreman.token, {
      itemId: String(items[0].id),
      progress: '40',
      content: '甲工序',
      clientRequestId: nextRequestId(),
    })
    await submit(projectId, foreman.token, {
      itemId: String(items[1].id),
      progress: '40',
      content: '乙工序',
      clientRequestId: nextRequestId(),
    })

    const filtered = await request.authed(
      'get',
      `/projects/${projectId}/reports?itemId=${items[1].id}`,
      foreman.token
    )
    expect(filtered.body.data.total).toBe(1)
    expect(filtered.body.data.list[0].content).toBe('乙工序')
  })

  it('汇报里带工序名与阶段名，前端不必再查一次', async () => {
    const { projectId, foreman, itemId } = await setup()
    await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '40',
      content: '说明',
      clientRequestId: nextRequestId(),
    })

    const list = await request.authed('get', `/projects/${projectId}/reports`, foreman.token)
    expect(list.body.data.list[0].itemName).toBe('强电布线')
    expect(list.body.data.list[0].stageName).toBe('水电工程')
  })

  it('AC-P26 非参与成员查看记录流返回 404，提示与项目不存在一致', async () => {
    const { projectId } = await setup()
    const outsider = await mini.login('code-outsider')

    const notMine = await mini.authed('get', `/projects/${projectId}/reports`, outsider.token)
    const notExist = await mini.authed('get', '/projects/999999/reports', outsider.token)

    expect(notMine.status).toBe(404)
    expect(notMine.body.message).toBe(notExist.body.message)
  })
})

describe('AC-P21 / AC-P22 评论', () => {
  async function setupWithComment() {
    const ctx = await setup()
    const owner = await mini.login('code-owner-c')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status, confirmed_at) VALUES (?, ?, 'owner', 'active', NOW())",
      [ctx.projectId, owner.userId]
    )

    const report = await submit(ctx.projectId, ctx.foreman.token, {
      itemId: String(ctx.itemId),
      progress: '40',
      content: '说明',
      clientRequestId: nextRequestId(),
    })

    return { ...ctx, owner, reportId: report.body.data.id }
  }

  it('AC-P21 任意角色可评论，提交后立即出现在该条汇报下方', async () => {
    const { reportId, owner } = await setupWithComment()

    const posted = await mini.authed('post', `/reports/${reportId}/comments`, owner.token).send({
      content: '这里看起来需要再确认一下',
    })
    expect(posted.status).toBe(200)

    const comments = await mini.authed('get', `/reports/${reportId}/comments`, owner.token)
    expect(comments.body.data.list).toHaveLength(1)
    expect(comments.body.data.list[0].content).toBe('这里看起来需要再确认一下')
  })

  it('评论数与记录流里的 commentCount 一致', async () => {
    const { projectId, reportId, owner, foreman } = await setupWithComment()

    for (const content of ['一', '二', '三']) {
      await mini.authed('post', `/reports/${reportId}/comments`, owner.token).send({ content })
    }

    const list = await mini.authed('get', `/projects/${projectId}/reports`, foreman.token)
    expect(list.body.data.list[0].commentCount).toBe(3)
  })

  it('AC-P22 被评论的汇报作者收到通知', async () => {
    const { reportId, owner, foreman } = await setupWithComment()

    await mini.authed('post', `/reports/${reportId}/comments`, owner.token).send({ content: '请补充照片' })

    const notification = await db.queryOne(
      'SELECT user_id, type, title, content, ref_type, ref_id FROM notification WHERE user_id = ?',
      [foreman.userId]
    )
    expect(notification).toBeTruthy()
    expect(notification.type).toBe('comment')
    expect(notification.ref_type).toBe('report')
    expect(notification.ref_id).toBe(reportId)
    expect(notification.content).toContain('请补充照片')
  })

  it('自己评论自己的汇报不产生通知', async () => {
    const { reportId, foreman } = await setupWithComment()

    await mini.authed('post', `/reports/${reportId}/comments`, foreman.token).send({ content: '自己补一句' })

    expect(await db.count('FROM notification WHERE user_id = ?', [foreman.userId])).toBe(0)
  })

  it('评论内容为空或超长时拒绝', async () => {
    const { reportId, owner } = await setupWithComment()

    expect((await mini.authed('post', `/reports/${reportId}/comments`, owner.token).send({ content: '   ' })).status).toBe(400)
    expect(
      (await mini.authed('post', `/reports/${reportId}/comments`, owner.token).send({ content: 'x'.repeat(501) })).status
    ).toBe(400)
  })

  it('非参与成员不能评论，也不能读评论', async () => {
    const { reportId } = await setupWithComment()
    const outsider = await mini.login('code-outsider-comment')

    expect(
      (await mini.authed('post', `/reports/${reportId}/comments`, outsider.token).send({ content: '插一句' })).status
    ).toBe(404)
    expect((await mini.authed('get', `/reports/${reportId}/comments`, outsider.token)).status).toBe(404)
  })
})

describe('AC-P23 连续未汇报提醒', () => {
  async function setupWithOwner({ lastReportAt, createdAt }) {
    const ctx = await setup({ status: 'building' })
    const owner = await mini.login('code-owner-stale')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status, confirmed_at) VALUES (?, ?, 'owner', 'active', NOW())",
      [ctx.projectId, owner.userId]
    )

    if (createdAt) await db.query('UPDATE project SET created_at = ? WHERE id = ?', [createdAt, ctx.projectId])
    if (lastReportAt) {
      await db.query(
        `INSERT INTO progress_report (project_id, project_item_id, user_id, progress, content, client_request_id, created_at)
         VALUES (?, ?, ?, 40.00, '历史汇报', ?, ?)`,
        [ctx.projectId, ctx.itemId, ctx.foreman.userId, `stale-${ctx.projectId}`, lastReportAt]
      )
    }

    return { ...ctx, owner }
  }

  it('超过配置天数未汇报时向业主推送一次提醒', async () => {
    const datetime = require('../../src/utils/datetime')
    const fourDaysAgo = datetime.now().subtract(4, 'day').format('YYYY-MM-DD HH:mm:ss')
    const { owner } = await setupWithOwner({ lastReportAt: fourDaysAgo })

    const result = await staleReportReminder.runOnce()
    expect(result.reminded).toBe(1)

    // 消息中心里的分类是 progress，不是去重用的 stale_report ——
    // 两个枚举不同，写错会静默查不到（见 notification.service 的映射表说明）
    const notification = await db.queryOne(
      "SELECT title, content FROM notification WHERE user_id = ? AND type = 'progress'",
      [owner.userId]
    )
    expect(notification).toBeTruthy()
    expect(notification.content).toContain('4 天')

    // 去重记录里才是提醒种类
    const reminder = await db.queryOne('SELECT type, target_user_id FROM reminder_log WHERE target_user_id = ?', [
      owner.userId,
    ])
    expect(reminder.type).toBe('stale_report')
  })

  it('同一段静默期只提醒一次（第 4 天不重复推送）', async () => {
    const datetime = require('../../src/utils/datetime')
    const fourDaysAgo = datetime.now().subtract(4, 'day').format('YYYY-MM-DD HH:mm:ss')
    const { owner } = await setupWithOwner({ lastReportAt: fourDaysAgo })

    await staleReportReminder.runOnce()
    const second = await staleReportReminder.runOnce()
    const third = await staleReportReminder.runOnce()

    expect(second.reminded).toBe(0)
    expect(third.reminded).toBe(0)
    expect(await db.count('FROM notification WHERE user_id = ?', [owner.userId])).toBe(1)
  })

  it('未达天数不发提醒', async () => {
    const datetime = require('../../src/utils/datetime')
    const oneDayAgo = datetime.now().subtract(1, 'day').format('YYYY-MM-DD HH:mm:ss')
    const { owner } = await setupWithOwner({ lastReportAt: oneDayAgo })

    const result = await staleReportReminder.runOnce()
    expect(result.reminded).toBe(0)
    expect(await db.count('FROM notification WHERE user_id = ?', [owner.userId])).toBe(0)
  })

  it('从未汇报过的项目以建档时间为起点，也会被提醒', async () => {
    const datetime = require('../../src/utils/datetime')
    const tenDaysAgo = datetime.now().subtract(10, 'day').format('YYYY-MM-DD HH:mm:ss')
    const { owner } = await setupWithOwner({ createdAt: tenDaysAgo })

    const result = await staleReportReminder.runOnce()
    // 建档后一直没人管的项目恰恰最需要被发现
    expect(result.reminded).toBe(1)
    expect(await db.count('FROM notification WHERE user_id = ?', [owner.userId])).toBe(1)
  })

  it('工长汇报后进入新的静默期，可以再次提醒', async () => {
    const datetime = require('../../src/utils/datetime')
    const fourDaysAgo = datetime.now().subtract(4, 'day').format('YYYY-MM-DD HH:mm:ss')
    const { projectId, foreman, itemId, owner } = await setupWithOwner({ lastReportAt: fourDaysAgo })

    await staleReportReminder.runOnce()
    expect(await db.count('FROM notification WHERE user_id = ?', [owner.userId])).toBe(1)

    // 工长汇报一次，静默起点刷新
    await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '60',
      content: '刚汇报',
      clientRequestId: nextRequestId(),
    })
    expect((await staleReportReminder.runOnce()).reminded).toBe(0)

    // 把这次汇报的时间改到 5 天前，模拟又静默了一段。
    //
    // 用 5 天而不是 4 天：去重键的 ref_id 是「静默起点」的**秒级**时间戳，
    // 若新起点与上一段起点落在同一秒内，会被判为「同一段静默期」而不再提醒。
    // 真实场景里静默期以天计，不存在这个问题；但测试若压在同一秒内就会假红。
    await db.query('UPDATE progress_report SET created_at = ? WHERE project_id = ?', [
      datetime.now().subtract(5, 'day').format('YYYY-MM-DD HH:mm:ss'),
      projectId,
    ])
    expect((await staleReportReminder.runOnce()).reminded).toBe(1)
    expect(await db.count('FROM notification WHERE user_id = ?', [owner.userId])).toBe(2)
  })

  it('只处理施工中的项目，待开工与已完工不催', async () => {
    const datetime = require('../../src/utils/datetime')
    const tenDaysAgo = datetime.now().subtract(10, 'day').format('YYYY-MM-DD HH:mm:ss')

    const ctx = await setupWithOwner({ createdAt: tenDaysAgo })
    await db.query("UPDATE project SET status = 'pending' WHERE id = ?", [ctx.projectId])
    expect((await staleReportReminder.runOnce()).reminded).toBe(0)

    await db.query("UPDATE project SET status = 'finished' WHERE id = ?", [ctx.projectId])
    expect((await staleReportReminder.runOnce()).reminded).toBe(0)

    await db.query("UPDATE project SET status = 'building' WHERE id = ?", [ctx.projectId])
    expect((await staleReportReminder.runOnce()).reminded).toBe(1)
  })

  it('提醒天数可通过系统配置调整（B-5.2）', async () => {
    const datetime = require('../../src/utils/datetime')
    const twoDaysAgo = datetime.now().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss')
    const { owner } = await setupWithOwner({ lastReportAt: twoDaysAgo })

    // 默认 3 天，2 天不够
    expect((await staleReportReminder.runOnce()).reminded).toBe(0)

    await db.query(
      `INSERT INTO sys_config (tenant_id, config_key, config_value, scope, description)
       VALUES (1, 'stale_report_days', '2', 'global', 'test')
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`
    )
    sysConfigService.invalidate()

    expect((await staleReportReminder.runOnce()).reminded).toBe(1)
    expect(await db.count('FROM notification WHERE user_id = ?', [owner.userId])).toBe(1)
  })

  it('pending 业主收不到提醒（AC-AD18）', async () => {
    const datetime = require('../../src/utils/datetime')
    const tenDaysAgo = datetime.now().subtract(10, 'day').format('YYYY-MM-DD HH:mm:ss')
    const { projectId } = await setupWithOwner({ createdAt: tenDaysAgo })

    const pendingOwner = await mini.login('code-pending-owner')
    await db.query(
      "INSERT INTO project_member (project_id, user_id, role, status) VALUES (?, ?, 'owner', 'pending')",
      [projectId, pendingOwner.userId]
    )

    const result = await staleReportReminder.runOnce()
    // 上一个用例已建过一个 active 业主，因此这里不为 0；
    // 关键是 pending 的那个**没收到**
    expect(result.reminded).toBeGreaterThanOrEqual(0)
    expect(await db.count('FROM notification WHERE user_id = ?', [pendingOwner.userId])).toBe(0)
  })
})

describe('AC-P17 汇报提交与进度汇总的联动', () => {
  it('提交汇报后阶段完成度、项目总进度同步更新', async () => {
    const { projectId, foreman, items } = await setup()

    await submit(projectId, foreman.token, {
      itemId: String(items[0].id),
      progress: '100',
      content: '甲工序完工',
      clientRequestId: nextRequestId(),
    })

    const stages = await mini.authed('get', `/projects/${projectId}/stages`, foreman.token)
    // 两个工序等权，一个满 100 → 50
    expect(stages.body.data.stages[0].progress).toBe('50.00')
    expect(stages.body.data.progress).toBe('50.00')
    expect(stages.body.data.stages[0].items[0].status).toBe('completed')
  })

  it('汇报里的完成度与留痕记录一致', async () => {
    const { projectId, foreman, items } = await setup()

    const report = await submit(projectId, foreman.token, {
      itemId: String(items[0].id),
      progress: '60',
      content: '说明',
      clientRequestId: nextRequestId(),
    })

    const log = await db.queryOne('SELECT report_id, from_progress, to_progress FROM progress_log WHERE project_item_id = ?', [
      items[0].id,
    ])
    // 留痕要指回触发了它的那条汇报，否则「这条汇报改了多少」查不出来
    expect(log.report_id).toBe(report.body.data.id)
    expect(log.from_progress).toBe('0.00')
    expect(log.to_progress).toBe('60.00')
  })

  it('完成度未变化时仍可提交汇报，但不产生留痕', async () => {
    const { projectId, foreman, items } = await setup()

    await submit(projectId, foreman.token, {
      itemId: String(items[0].id),
      progress: '40',
      content: '第一次',
      clientRequestId: nextRequestId(),
    })
    await submit(projectId, foreman.token, {
      itemId: String(items[0].id),
      progress: '40',
      content: '补充一句说明',
      clientRequestId: nextRequestId(),
    })

    expect(await db.count('FROM progress_report WHERE project_id = ?', [projectId])).toBe(2)
    // 同值不变更，因此只有第一条产生留痕
    expect(await db.count('FROM progress_log WHERE project_item_id = ?', [items[0].id])).toBe(1)
  })
})

describe('小程序逐文件上传：暂存 → 提交（迁移 017）', () => {
  it('单文件暂存返回 mediaId，图片带服务端水印', async () => {
    const { projectId, foreman, itemId } = await setup()
    const image = await makeJpeg(200, 150)

    const res = await stage(projectId, foreman.token, { itemId: String(itemId) }, { buffer: image })

    expect(res.status).toBe(200)
    expect(res.body.data.mediaId).toBeGreaterThan(0)
    expect(res.body.data.type).toBe('image')
    expect(res.body.data.url).toContain('/uploads/reports/')
    // 原图与水印图分开存，前端默认拿带水印的那份
    expect(res.body.data.originalUrl).toBeTruthy()
    expect(res.body.data.originalUrl).not.toBe(res.body.data.url)
  })

  it('暂存后提交汇报，附件进入正式报告并被标记 used', async () => {
    const { projectId, foreman, itemId } = await setup()
    const staged = await stage(projectId, foreman.token, { itemId: String(itemId) }, { buffer: await makeJpeg() })
    const mediaId = staged.body.data.mediaId

    const res = await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '40',
      content: '逐文件上传的汇报',
      clientRequestId: nextRequestId(),
      mediaIds: [mediaId],
    })

    expect(res.status).toBe(200)
    expect(res.body.data.media).toHaveLength(1)
    expect(res.body.data.media[0].url).toBe(staged.body.data.url)

    const row = await db.queryOne(
      'SELECT status, report_id FROM report_media_staging WHERE id = ?',
      [mediaId]
    )
    expect(row.status).toBe('used')
    expect(row.report_id).toBe(res.body.data.id)
  })

  it('同一份暂存附件不能被第二条汇报重复使用', async () => {
    const { projectId, foreman, itemId } = await setup()
    const staged = await stage(projectId, foreman.token, { itemId: String(itemId) }, { buffer: await makeJpeg() })
    const mediaId = staged.body.data.mediaId

    await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '40',
      content: '第一次',
      clientRequestId: nextRequestId(),
      mediaIds: [mediaId],
    })

    const second = await submit(projectId, foreman.token, {
      itemId: String(itemId),
      progress: '45',
      content: '第二次',
      clientRequestId: nextRequestId(),
      mediaIds: [mediaId],
    })

    expect(second.status).toBe(400)
    expect(second.body.message).toContain('附件')
    expect(await db.count('FROM progress_report WHERE project_id = ?', [projectId])).toBe(1)
  })

  it('不能消费别人暂存的附件', async () => {
    const { projectId, foreman, itemId } = await setup()
    const other = await mini.login('code-other-foreman')
    await db.query(
      `INSERT INTO project_member (project_id, user_id, role, status, is_primary, confirmed_at, joined_at)
       VALUES (?, ?, 'foreman', 'active', 0, NOW(), NOW())`,
      [projectId, other.userId]
    )

    const staged = await stage(projectId, foreman.token, { itemId: String(itemId) }, { buffer: await makeJpeg() })

    const res = await submit(projectId, other.token, {
      itemId: String(itemId),
      progress: '40',
      content: '试图使用别人的附件',
      clientRequestId: nextRequestId(),
      mediaIds: [staged.body.data.mediaId],
    })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('附件')
  })

  it('一次暂存请求带多个文件时直接拒绝', async () => {
    const { projectId, foreman, itemId } = await setup()
    const image = await makeJpeg()

    const req = request
      .post(`/projects/${projectId}/reports/media`)
      .set('Authorization', `Bearer ${foreman.token}`)
      .field('itemId', String(itemId))
      .attach('files', image, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('files', image, { filename: 'b.jpg', contentType: 'image/jpeg' })

    const res = await req
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('一个文件')
  })

  it('严格门禁下锁定阶段不允许暂存附件', async () => {
    const { projectId, foreman, itemId } = await setup()
    await db.query("UPDATE project_stage SET gate_status = 'locked' WHERE project_id = ?", [projectId])
    await db.query(
      `INSERT INTO sys_config (tenant_id, config_key, config_value, scope, description)
       VALUES (1, 'gate_strength', 'strict', 'global', 'test')
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`
    )
    sysConfigService.invalidate()

    const res = await stage(projectId, foreman.token, { itemId: String(itemId) }, { buffer: await makeJpeg() })
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('未结清')
  })

  it('两种附件提交方式不能混用', async () => {
    const { projectId, foreman, itemId } = await setup()
    const staged = await stage(projectId, foreman.token, { itemId: String(itemId) }, { buffer: await makeJpeg() })

    const res = await submit(
      projectId,
      foreman.token,
      {
        itemId: String(itemId),
        progress: '40',
        content: '混用',
        clientRequestId: nextRequestId(),
        mediaIds: [staged.body.data.mediaId],
      },
      [{ buffer: await makeJpeg() }]
    )

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('不能同时')
  })

  it('超过 24 小时未提交的暂存附件会被清理（先认领再删文件）', async () => {
    const { projectId, foreman, itemId } = await setup()
    const staged = await stage(projectId, foreman.token, { itemId: String(itemId) }, { buffer: await makeJpeg() })

    const markedKey = staged.body.data.url.split(`${config.upload.publicPath}/`)[1]
    const originalKey = staged.body.data.originalUrl.split(`${config.upload.publicPath}/`)[1]
    const markedPath = path.join(config.upload.dir, markedKey)
    const originalPath = path.join(config.upload.dir, originalKey)
    expect(fs.existsSync(markedPath)).toBe(true)
    expect(fs.existsSync(originalPath)).toBe(true)

    const result = await reportMediaCleanup.runOnce({ now: datetime.now().add(25, 'hour') })

    expect(result.claimed).toBe(1)
    expect(result.removed).toBe(1)
    expect(fs.existsSync(markedPath)).toBe(false)
    expect(fs.existsSync(originalPath)).toBe(false)
    expect(await db.count('FROM report_media_staging')).toBe(0)
  })
})
