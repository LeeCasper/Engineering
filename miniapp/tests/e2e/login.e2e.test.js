'use strict'

/**
 * 登录入口回归（C 端）。
 *
 * 覆盖：
 *   - 开屏动画结束 → 登录页出现；
 *   - 微信登录按钮的独立 loading；
 *   - 登录后进入项目页，且 C 端不出现管理入口。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  BASE_URL,
  launchBrowser,
  newPage,
  openLogin,
  slowDownLoginRequest,
  waitForHash,
} = require('./helpers')

test('开屏结束后显示登录页，管理员入口只保留在登录页', { timeout: 30000 }, async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await newPage(browser)

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.locator('.splash').waitFor({ state: 'visible', timeout: 5000 })
  assert.equal(await page.locator('.splash').count(), 1, '开屏应当出现在首帧')

  await page.locator('.splash').waitFor({ state: 'detached', timeout: 8000 })
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 5000 })

  assert.equal(await page.locator('.admin-login-btn').count(), 1, '登录页应有管理员登录入口')
  assert.equal(await page.locator('.admin-entry').count(), 0, '登录页不应出现项目页的管理按钮')
})

test('微信登录显示独立 loading，并进入项目页', { timeout: 45000 }, async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await newPage(browser)

  await openLogin(page)
  // 让后端登录慢一点，稳定断言按钮上的 spinner
  await slowDownLoginRequest(page, 600)

  await page.locator('.wechat-btn').click()
  await page.locator('.wechat-spinner').waitFor({ state: 'visible', timeout: 3000 })

  await waitForHash(page, /#\/pages\/projects\/index/, 15000)
  await page.locator('.page').first().waitFor({ state: 'visible', timeout: 5000 })

  // C 端主界面不再展示后台身份入口
  assert.equal(await page.locator('.admin-entry').count(), 0, '项目页不应显示管理入口')
  assert.equal(await page.locator('.hero-actions').count(), 0, '项目页不应保留管理入口容器')
})
