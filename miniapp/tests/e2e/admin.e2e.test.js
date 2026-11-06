'use strict'

/**
 * 管理端入口与退出回归。
 *
 * 依赖 H5 dev 构建：管理员登录页会显示「一键登录管理端」（dev-only）。
 * 如果本地种子管理员仍处于首登改密状态，测试会标记跳过退出步骤，
 * 先在开发库完成一次首登改密即可完整跑通。
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

test('管理员登录页面可进入，并可退出管理端', { timeout: 60000 }, async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await newPage(browser)

  await openLogin(page)
  await page.locator('.admin-login-btn').click()
  await waitForHash(page, /#\/pages\/admin\/login\/index/, 10000)

  await page.locator('.login-hero').waitFor({ state: 'visible', timeout: 5000 })
  const devLogin = page.locator('.dev-login-btn')
  if ((await devLogin.count()) === 0) {
    t.skip('当前不是 dev 构建，没有一键登录管理端')
    return
  }

  await devLogin.click()
  // 首登强制改密时不会进工作台；这种环境先跳过退出流程
  await page.waitForFunction(
    () => /#\/pages\/admin\/(workbench|change-password)\/index/.test(location.hash),
    null,
    { timeout: 15000 }
  )
  if (page.url().includes('/admin/change-password/index')) {
    t.skip('管理员仍处于首登强制改密状态，请先在开发库完成一次改密')
    return
  }
  await waitForHash(page, /#\/pages\/admin\/workbench\/index/, 5000)

  // 直接进入管理端「我的」页，避免依赖内页 tabbar 的点击命中区域
  await page.goto(`${BASE_URL}/#/pages/admin/profile/index`, {
    waitUntil: 'networkidle',
  })
  await page.locator('.logout-btn').waitFor({ state: 'visible', timeout: 8000 })

  await page.locator('.logout-btn').click()
  await page.getByText('确定', { exact: true }).last().click()

  await page.locator('.exit-overlay').waitFor({ state: 'visible', timeout: 5000 })
  await waitForHash(page, /#\/($|pages\/projects\/index)/, 10000)
})
