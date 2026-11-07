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
    () => /#\/pages\/admin\/(home|change-password)\/index/.test(location.hash),
    null,
    { timeout: 15000 }
  )
  if (page.url().includes('/admin/change-password/index')) {
    t.skip('管理员仍处于首登强制改密状态，请先在开发库完成一次改密')
    return
  }
  await waitForHash(page, /#\/pages\/admin\/home\/index/, 5000)
  await page.locator('.overview-card').waitFor({ state: 'visible', timeout: 8000 })

  // 顶层 tab 是同一页面内的视图切换，不跳路由、底栏常驻
  await page.locator('.tabbar-item').filter({ hasText: '项目' }).click()
  await page.locator('.project-item').first().waitFor({ state: 'visible', timeout: 8000 })
  assert.match(page.url(), /#\/pages\/admin\/home\/index/)

  // 直接进入管理端「我的」tab（旧路径会转到壳页）
  await page.goto(`${BASE_URL}/#/pages/admin/home/index?tab=profile`, {
    waitUntil: 'networkidle',
  })
  await page.locator('.logout-btn').waitFor({ state: 'visible', timeout: 8000 })

  // 记录退出过程中的路由，确认没有经过 C 端项目首页
  await page.evaluate(() => {
    window.__logoutHashes = []
    window.addEventListener('hashchange', () => window.__logoutHashes.push(location.hash))
  })

  await page.locator('.logout-btn').click()
  await page.getByText('确定', { exact: true }).last().click()

  await page.locator('.exit-overlay').waitFor({ state: 'visible', timeout: 5000 })
  // 本用例没有登录 C 端微信身份：退出管理端应直接回登录页，
  // 不能先闪一下项目首页再被未登录守卫重定向
  await waitForHash(page, /#\/($|pages\/login\/index)/, 10000)
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 8000 })
  const visited = await page.evaluate(() => window.__logoutHashes || [])
  assert.ok(
    !visited.includes('#/pages/projects/index'),
    `退出过程中不应经过项目首页，实际路由：${visited.join(' -> ')}`
  )
})
