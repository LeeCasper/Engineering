'use strict'

/**
 * H5 端 E2E 辅助。
 *
 * 小程序端另有 tests/mp（miniprogram-automator）用于真机/开发者工具验证；
 * 这里用 H5 构建跑业务界面回归，优点是可以在 Linux CI 上直接执行，
 * 并且与小程序共用同一套页面代码与后端接口。
 */

const fs = require('node:fs')
const { chromium } = require('playwright-core')

const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '')

function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
  return candidates.find((file) => fs.existsSync(file))
}

async function launchBrowser() {
  return chromium.launch({
    headless: true,
    executablePath: resolveChromePath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
}

async function newPage(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  return { context, page }
}

/** 打开入口页，等待开屏结束、登录表单出现 */
async function openLogin(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.locator('.splash').waitFor({ state: 'visible', timeout: 5000 })
  await page.locator('.splash').waitFor({ state: 'detached', timeout: 8000 })
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 5000 })
}

/** 给按钮的 loading 状态留出可见时间，避免断言跑在 40ms 之前 */
async function slowDownLoginRequest(page, delayMs = 500) {
  await page.route('**/api/v1/auth/login', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    await route.continue()
  })
}

async function waitForHash(page, pattern, timeout = 15000) {
  await page.waitForFunction(
    (source) => new RegExp(source).test(location.hash),
    pattern.source,
    { timeout }
  )
}

module.exports = {
  BASE_URL,
  launchBrowser,
  newPage,
  openLogin,
  slowDownLoginRequest,
  waitForHash,
}
