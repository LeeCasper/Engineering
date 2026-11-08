'use strict'

/**
 * 可靠电子签名（验收单）集成测试。
 *
 * 使用 mock provider 走完整链路：
 *   创建任务 → 模拟服务商签署 → 回调 → 下载/验签/归档 → 验收通过
 * 不访问任何外部网络。
 */

process.env.ESIGN_ENABLED = 'true'
process.env.ESIGN_PROVIDER = 'mock'
process.env.ESIGN_APP_ID = 'test-app'
process.env.ESIGN_APP_SECRET = 'test-secret'
process.env.ESIGN_CALLBACK_SECRET = 'test-callback-secret'
process.env.ESIGN_LEGACY_SIGNING = 'false'
process.env.ESIGN_PRIVATE_DIR = './private-esign-test'

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const { prepareDatabase } = require('./helpers/db')
const fixtures = require('./helpers/fixtures')
const mini = require('./helpers/mini')
const request = require('./helpers/request')
const mock = require('../../src/services/esign/providers/mock')

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
  mock._mock.reset()
})

let seq = 0

const sharp = require('sharp')

/** 生成一张能被 pdfkit 正常嵌入的 JPEG 签名图 */
async function makeSignature() {
  return sharp({
    create: { width: 300, height: 120, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><path d="M20 80 Q 80 20 140 80 T 280 60" stroke="#111" stroke-width="3" fill="none"/></svg>'
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg()
    .toBuffer()
}

async function createContext({ withTemporary = true } = {}) {
  seq += 1
  const foreman = await mini.login(`esign-foreman-${seq}`)
  const owner = await mini.login(`esign-owner-${seq}`)
  const temporary = withTemporary ? await mini.login(`esign-temp-${seq}`) : null

  await db.query('UPDATE user SET phone = ? WHERE id = ?', ['13800000001', owner.userId])
  if (temporary) await db.query('UPDATE user SET phone = ? WHERE id = ?', ['13800000002', temporary.userId])

  const projectId = await mini.createProject({ name: `电子签-${seq}` })
  const stageId = await mini.createStage({
    projectId,
    name: '水电验收',
    seq: 1,
    progress: '100.00',
    status: 'completed',
    gateStatus: 'pending_acceptance',
  })

  await mini.addMember({ projectId, userId: foreman.userId, role: 'foreman' })
  await db.query('UPDATE project_member SET is_primary = 1 WHERE project_id = ? AND user_id = ?', [
    projectId,
    foreman.userId,
  ])
  await mini.addMember({ projectId, userId: owner.userId, role: 'owner', ownerType: 'primary' })
  if (temporary) {
    await mini.addMember({ projectId, userId: temporary.userId, role: 'owner', ownerType: 'temporary' })
  }

  const created = await mini
    .authed('post', `/projects/${projectId}/acceptances`, foreman.token)
    .send({ stageId, description: '水电验收' })
  const acceptanceId = created.body.data.id
  const items = created.body.data.items.map((item) => ({ id: item.id, result: 'pass' }))
  const signature = await makeSignature()
  const submitted = await mini
    .authed('post', `/acceptances/${acceptanceId}/self-check`, foreman.token)
    .field('items', JSON.stringify(items))
    .attach('signature', signature, { filename: 'sign.jpg', contentType: 'image/jpeg' })
  if (submitted.status !== 200) throw new Error(`提交自检失败：${JSON.stringify(submitted.body)}`)

  const detail = await mini.authed('get', `/acceptances/${acceptanceId}`, owner.token)

  return {
    projectId,
    stageId,
    acceptanceId,
    foreman,
    owner,
    temporary,
    consentVersion: detail.body.data.esign.consentVersion,
  }
}

async function createTask(ctx) {
  const res = await mini.authed('post', `/acceptances/${ctx.acceptanceId}/esign`, ctx.owner.token).send({
    consentAccepted: true,
    consentVersion: ctx.consentVersion,
  })
  expect(res.status).toBe(200)
  return res.body.data
}

async function taskRow(acceptanceId) {
  return db.queryOne('SELECT * FROM esign_task WHERE acceptance_id = ? ORDER BY id DESC LIMIT 1', [
    acceptanceId,
  ])
}

async function sendCallback(task, overrides = {}) {
  const callback = mock._mock.buildCallback({
    providerTaskId: task.provider_task_id,
    providerBusinessId: task.idempotency_key,
    status: 'signed',
    ...overrides,
  })
  return request
    .post('/esign/callback/mock')
    .set('Content-Type', 'application/json')
    .set('x-esign-signature', callback.headers['x-esign-signature'])
    .send(callback.rawBody.toString('utf8'))
}

async function waitFor(fn, timeoutMs = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

describe('可靠电子签名 · 验收单', () => {
  it('只有主业主能创建任务，任务冻结文档并返回签署链接', async () => {
    const ctx = await createContext()

    const tempRes = await mini
      .authed('post', `/acceptances/${ctx.acceptanceId}/esign`, ctx.temporary.token)
      .send({ consentAccepted: true, consentVersion: ctx.consentVersion })
    expect(tempRes.status).toBe(403)

    const esign = await createTask(ctx)
    expect(esign.status).toBe('pending')
    expect(esign.signUrl).toContain('mock://')

    const task = await taskRow(ctx.acceptanceId)
    expect(task.status).toBe('pending')
    expect(task.provider_task_id).toBeTruthy()
    expect(task.document_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(task.document_key).toBeTruthy()
    expect(task.content_snapshot_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(task.consent_text_hash).toMatch(/^[0-9a-f]{64}$/)

    const acceptance = await db.queryOne('SELECT signature_mode, esign_status FROM acceptance WHERE id = ?', [
      ctx.acceptanceId,
    ])
    expect(acceptance.signature_mode).toBe('provider')
    expect(acceptance.esign_status).toBe('pending')
  })

  it('合法回调完成验签/归档后验收通过，重复回调幂等', async () => {
    const ctx = await createContext()
    await createTask(ctx)
    const task = await taskRow(ctx.acceptanceId)

    mock._mock.simulateSign(task.provider_task_id, {
      signerSubjectId: `mock-owner-${ctx.owner.userId}`,
      nameMasked: '李*',
    })

    const first = await sendCallback(task)
    expect(first.status).toBe(200)

    expect(
      await waitFor(async () => {
        const row = await db.queryOne('SELECT status FROM acceptance WHERE id = ?', [ctx.acceptanceId])
        return row.status === 'passed'
      })
    ).toBe(true)

    const acceptance = await db.queryOne(
      'SELECT status, esign_status, report_pdf_key, report_pdf_private, report_pdf_source, report_pdf_sha256 FROM acceptance WHERE id = ?',
      [ctx.acceptanceId]
    )
    expect(acceptance.status).toBe('passed')
    expect(acceptance.esign_status).toBe('signed')
    expect(acceptance.report_pdf_key).toBeTruthy()
    expect(acceptance.report_pdf_private).toBe(1)
    expect(acceptance.report_pdf_source).toBe('signed')
    expect(acceptance.report_pdf_sha256).toMatch(/^[0-9a-f]{64}$/)

    const flow = await db.query(
      "SELECT action, esign_task_id FROM acceptance_flow WHERE acceptance_id = ? AND action = 'approve'",
      [ctx.acceptanceId]
    )
    expect(flow).toHaveLength(1)
    expect(Number(flow[0].esign_task_id)).toBe(Number(task.id))

    const signedTask = await taskRow(ctx.acceptanceId)
    expect(signedTask.status).toBe('signed')
    expect(signedTask.verify_status).toBe('valid')
    expect(signedTask.signed_document_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(signedTask.evidence_key).toBeTruthy()

    const duplicate = await sendCallback(task)
    expect(duplicate.status).toBe(200)
    const flowAfter = await db.count('FROM acceptance_flow WHERE acceptance_id = ? AND action = ?', [
      ctx.acceptanceId,
      'approve',
    ])
    expect(flowAfter).toBe(1)
  })

  it('非法回调签名不改变状态；原始哈希不匹配不放行', async () => {
    const ctx = await createContext()
    await createTask(ctx)
    const task = await taskRow(ctx.acceptanceId)
    mock._mock.simulateSign(task.provider_task_id)

    const bad = await request
      .post('/esign/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-esign-signature', 'deadbeef')
      .send(Buffer.from(JSON.stringify({ eventId: 'bad', status: 'signed' })))
    expect(bad.status).toBe(401)

    const acceptance = await db.queryOne('SELECT status FROM acceptance WHERE id = ?', [ctx.acceptanceId])
    expect(acceptance.status).toBe('pending_owner')

    // 把服务商侧原始哈希改掉，模拟“拿到的不是我们冻结的那份”
    const providerTask = mock._mock.getTaskForTest(task.provider_task_id)
    providerTask.documentHash = '0'.repeat(64)
    const res = await sendCallback(task)
    expect(res.status).toBe(200)

    expect(
      await waitFor(async () => {
        const row = await taskRow(ctx.acceptanceId)
        return row.status === 'failed'
      })
    ).toBe(true)
    const after = await db.queryOne('SELECT status FROM acceptance WHERE id = ?', [ctx.acceptanceId])
    expect(after.status).toBe('pending_owner')
  })

  it('电子签模式下旧的手写签名接口被拒绝', async () => {
    const ctx = await createContext()
    const res = await mini
      .authed('post', `/acceptances/${ctx.acceptanceId}/approve`, ctx.owner.token)
      .attach('signature', Buffer.from('not-a-real-signature'), {
        filename: 'sign.png',
        contentType: 'image/png',
      })
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('电子签名')
  })

  it('私有存储不通过 /uploads 暴露，已签 PDF 可下载', async () => {
    const ctx = await createContext()
    await createTask(ctx)
    const task = await taskRow(ctx.acceptanceId)
    mock._mock.simulateSign(task.provider_task_id)
    await sendCallback(task)
    expect(
      await waitFor(async () => {
        const row = await db.queryOne('SELECT status FROM acceptance WHERE id = ?', [ctx.acceptanceId])
        return row.status === 'passed'
      })
    ).toBe(true)

    const detail = await mini.authed('get', `/acceptances/${ctx.acceptanceId}`, ctx.owner.token)
    const signedPath = detail.body.data.reportPdf.signedPath
    expect(signedPath).toBeTruthy()

    const pdf = await request.raw('get', signedPath)
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')

    const privateKey = (await taskRow(ctx.acceptanceId)).signed_document_key
    const exposed = await request.raw('get', `/uploads/${privateKey}`)
    expect(exposed.status).toBe(404)
  })
})
