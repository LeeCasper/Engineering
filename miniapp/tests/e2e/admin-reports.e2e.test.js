'use strict'

/**
 * 管理端「验收报告」页回归。
 *
 * 覆盖：汇总数字、状态 / 类型 / 关键词筛选、下载报告签名链接、
 * 空态与接口错误态。验收单接口用 fixture mock，不依赖开发库数据。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  BASE_URL,
  launchBrowser,
  newPage,
  openLogin,
  waitForHash,
} = require('./helpers')

const FIXTURE = {
  items: [
    {
      id: 101,
      type: 'stage',
      typeLabel: '阶段验收',
      stageId: 1,
      stageName: '水电改造',
      itemId: null,
      itemName: null,
      status: 'passed',
      statusLabel: '已通过',
      round: 2,
      resubmitCount: 1,
      rejectCount: 0,
      submitter: '张工长',
      submittedAt: '2026-11-01 10:00:00',
      finishedAt: '2026-11-01 12:00:00',
      hasSignature: true,
      signatureMode: 'legacy',
      esignStatus: null,
      reportNo: 'AC-20261105-8092-000101',
      reportPdf: {
        status: 'success',
        error: null,
        signedPath: '/api/v1/acceptances/101/report.pdf?expires=9999999999&sig=fixture',
      },
    },
    {
      id: 102,
      type: 'item',
      typeLabel: '工序验收',
      stageId: 1,
      stageName: '水电改造',
      itemId: 11,
      itemName: '强弱电布线',
      status: 'pending_owner',
      statusLabel: '待业主确认',
      round: 1,
      resubmitCount: 0,
      rejectCount: 0,
      submitter: '李监理',
      submittedAt: '2026-11-02 09:00:00',
      finishedAt: null,
      hasSignature: false,
      signatureMode: 'legacy',
      esignStatus: null,
      reportPdf: { status: 'pending', error: null, signedPath: null },
    },
    {
      id: 103,
      type: 'stage',
      typeLabel: '阶段验收',
      stageId: 2,
      stageName: '泥瓦工程',
      itemId: null,
      itemName: null,
      status: 'draft',
      statusLabel: '草稿',
      round: 1,
      resubmitCount: 0,
      rejectCount: 0,
      submitter: null,
      submittedAt: null,
      finishedAt: null,
      hasSignature: false,
      signatureMode: 'legacy',
      esignStatus: null,
      reportPdf: { status: 'pending', error: null, signedPath: null },
    },
    {
      id: 104,
      type: 'item',
      typeLabel: '工序验收',
      stageId: 3,
      stageName: '木作工程',
      itemId: 12,
      itemName: '吊顶龙骨',
      status: 'pending_rectify',
      statusLabel: '待整改',
      round: 1,
      resubmitCount: 0,
      rejectCount: 1,
      submitter: '王工长',
      submittedAt: '2026-11-03 08:30:00',
      finishedAt: null,
      hasSignature: false,
      signatureMode: 'legacy',
      esignStatus: null,
      reportPdf: { status: 'pending', error: null, signedPath: null },
    },
  ],
  summary: { total: 4, passed: 1, inProgress: 3, reportReady: 1 },
}

function jsonBody(data) {
  return JSON.stringify({ code: 0, message: 'success', data })
}

test('管理端验收报告：列表、筛选、下载与空/错态', { timeout: 120000 }, async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { context, page } = await newPage(browser)

  // 管理端一键登录（dev 构建）
  await openLogin(page)
  await page.locator('.admin-login-btn').click()
  await waitForHash(page, /#\/pages\/admin\/login\/index/, 10000)
  await page.locator('.login-hero').waitFor({ state: 'visible', timeout: 8000 })
  const devLogin = page.locator('.dev-login-btn')
  // dev 账号卡在页面挂载后条件渲染，给它一个明确的等待窗口
  await devLogin.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if ((await devLogin.count()) === 0) {
    t.skip('当前不是 dev 构建，没有一键登录管理端')
    return
  }
  await devLogin.click()
  await page.waitForFunction(
    () => /#\/pages\/admin\/(home|change-password)\/index/.test(location.hash),
    null,
    { timeout: 15000 }
  )
  if (page.url().includes('/admin/change-password/index')) {
    t.skip('管理员仍处于首登强制改密状态，请先在开发库完成一次改密')
    return
  }
  await waitForHash(page, /#\/pages\/admin\/home\/index/, 8000)

  let mode = 'list'
  await page.route('**/api/v1/admin/projects/*/acceptances', (route) => {
    if (mode === 'empty') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: jsonBody({
          items: [],
          summary: { total: 0, passed: 0, inProgress: 0, reportReady: 0 },
        }),
      })
    }
    if (mode === 'error') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({ code: 500, message: '服务器错误' }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: jsonBody(FIXTURE),
    })
  })
  // 下载会新开窗口，用 context 级路由兜住 PDF 请求
  await context.route('**/api/v1/acceptances/*/report.pdf*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n%%EOF') })
  )

  const reportsUrl = `${BASE_URL}/#/pages/admin/project/reports?id=999`
  await page.goto(reportsUrl, { waitUntil: 'networkidle' })
  await page.locator('.summary-card').waitFor({ state: 'visible', timeout: 10000 })

  // 汇总
  assert.deepEqual(await page.locator('.summary-value').allTextContents(), ['4', '1', '3', '1'])
  assert.equal(await page.locator('.report-card').count(), 4)
  assert.equal(await page.locator('.download-btn').count(), 1)
  // 卡片展示的是 PDF 上的报告编号；未生成的显示「待生成」
  assert.match(
    await page.locator('.report-card').first().locator('.report-no').innerText(),
    /AC-20261105-8092-000101/
  )
  assert.equal(await page.getByText('待生成').count(), 3)

  const statusRow = page.locator('.filter-row').nth(0)
  const typeRow = page.locator('.filter-row').nth(1)

  // 状态筛选：已通过
  await statusRow.locator('.admin-chip').filter({ hasText: '已通过' }).click()
  assert.equal(await page.locator('.report-card').count(), 1)
  await statusRow.locator('.admin-chip').filter({ hasText: '全部' }).click()
  assert.equal(await page.locator('.report-card').count(), 4)

  // 类型筛选：工序验收
  await typeRow.locator('.admin-chip').filter({ hasText: '工序验收' }).click()
  assert.equal(await page.locator('.report-card').count(), 2)
  await typeRow.locator('.admin-chip').filter({ hasText: '全部类型' }).click()

  // 关键词：报告编号
  await page.locator('.admin-search-input input').fill('AC-20261105-8092-000101')
  assert.equal(await page.locator('.report-card').count(), 1)
  await page.locator('.admin-search-input input').fill('')

  // 下载报告：H5 走 window.open(signedPath)
  const popupPromise = page.waitForEvent('popup', { timeout: 8000 })
  await page.locator('.download-btn').click()
  const popup = await popupPromise
  await popup.waitForURL(/\/api\/v1\/acceptances\/101\/report\.pdf\?expires=/, { timeout: 8000 })
  await popup.close()

  // 空态（同一 URL 的 goto 不会重新加载 SPA，用 reload 触发 onLoad）
  mode = 'empty'
  await page.reload({ waitUntil: 'networkidle' })
  await page
    .locator('.admin-state-title')
    .filter({ hasText: '暂无验收单' })
    .waitFor({ state: 'visible', timeout: 15000 })

  // 错误态
  mode = 'error'
  await page.reload({ waitUntil: 'networkidle' })
  await page
    .locator('.admin-state-title')
    .filter({ hasText: '加载失败' })
    .waitFor({ state: 'visible', timeout: 15000 })
  assert.match(await page.locator('.admin-state-text').innerText(), /服务器错误/)
  assert.ok(await page.locator('.admin-state-btn').isVisible())
})
