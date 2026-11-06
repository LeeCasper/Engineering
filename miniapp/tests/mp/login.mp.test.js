'use strict'

/**
 * 微信小程序端 E2E（miniprogram-automator）。
 *
 * 运行前提：
 *   1. 安装依赖：npm install --save-dev miniprogram-automator
 *   2. 微信开发者工具打开项目，设置 → 安全设置 → 开启「服务端口」
 *   3. 后端以 NODE_ENV=development、WX_MOCK=true 启动
 *   4. 先构建 dev 包：npm run dev:mp-weixin（保持 watcher 运行）
 *
 * 运行方式（二选一）：
 *
 *   A. 已开启自动化端口（Linux 开发者工具推荐）：
 *      # IDE 的 HTTP 端口在 ~/.config/wechat-devtools/<hash>/Default/.cli
 *      wechat-devtools-cli --electron --port=<IDE_HTTP_PORT> \
 *        auto --project="$PWD/dist/dev/mp-weixin" --auto-port=9420 --trust-project
 *      MP_AUTOMATION_WS=ws://127.0.0.1:9420 npm run test:e2e:mp
 *
 *   B. Mac / Windows 直接用 automator 启动：
 *      WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" \
 *      MP_PROJECT_PATH="$PWD/dist/dev/mp-weixin" \
 *      npm run test:e2e:mp
 *
 * 这个用例验证真正的微信运行时：开屏、微信登录按钮的 loading、登录后路由。
 * 业务深度用例可以按同样的 page.$ / element.tap 模式继续补。
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let automator
try {
  automator = require('miniprogram-automator')
} catch (err) {
  console.error(
    '缺少 miniprogram-automator。请先安装：\n' +
      '  cd miniapp && npm install --save-dev miniprogram-automator'
  )
  process.exit(1)
}

const PROJECT_PATH = path.resolve(
  process.env.MP_PROJECT_PATH || path.resolve(__dirname, '..', '..', 'dist', 'dev', 'mp-weixin')
)
const CLI_PATH = process.env.WECHAT_DEVTOOLS_CLI
// 已经通过 CLI 开启自动化端口时，直接连接，避免重复启动项目
const AUTOMATION_WS = process.env.MP_AUTOMATION_WS

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  let miniProgram
  let launched = false

  if (AUTOMATION_WS) {
    console.log(`[mp-e2e] 连接自动化端口：${AUTOMATION_WS}`)
    miniProgram = await automator.connect({ wsEndpoint: AUTOMATION_WS })
  } else {
    if (!CLI_PATH) {
      throw new Error(
        '请设置 WECHAT_DEVTOOLS_CLI 为微信开发者工具 CLI 的绝对路径，' +
          '或先手动开启自动化后用 MP_AUTOMATION_WS 连接'
      )
    }
    if (!fs.existsSync(PROJECT_PATH)) {
      throw new Error(`找不到 dev 包：${PROJECT_PATH}，请先运行 npm run dev:mp-weixin`)
    }

    console.log(`[mp-e2e] 启动开发者工具：${PROJECT_PATH}`)
    miniProgram = await automator.launch({
      projectPath: PROJECT_PATH,
      cliPath: CLI_PATH,
      trustProject: true,
    })
    launched = true
  }

  try {
    // 自动化环境清掉本地登录态，保证每次都从登录页开始
    await miniProgram.callWxMethod('clearStorageSync')
    const loginPage = await miniProgram.reLaunch('/pages/login/index')
    await sleep(500)

    // 开屏最少 1.18s，等它消失后再操作登录页
    await sleep(1800)
    const adminEntry = await loginPage.$('.admin-login-btn')
    assert.ok(adminEntry, '登录页应有管理员登录入口')

    const wechatButton = await loginPage.$('.wechat-btn')
    assert.ok(wechatButton, '登录页应有微信登录按钮')
    await wechatButton.tap()

    // doLogin 会先让 loading 渲染一帧再调用 uni.login，30ms 足够看到 spinner
    await sleep(30)
    const spinner = await loginPage.$('.wechat-spinner')
    assert.ok(spinner, '点击微信登录后应出现独立 spinner')

    await sleep(2500)
    const current = await miniProgram.currentPage()
    assert.match(
      current.path,
      /pages\/(projects|login)\/index/,
      `登录后应进入项目页，当前为 ${current.path}`
    )

    // C 端主界面不应再有管理入口
    const adminEntryOnProjects = await current.$('.admin-entry')
    assert.equal(adminEntryOnProjects, null, 'C 端项目页不应显示管理入口')

    console.log(`[mp-e2e] 通过，当前页面：${current.path}`)
  } finally {
    // 连接模式只断开，不关闭用户正在使用的开发者工具项目
    if (launched) await miniProgram.close()
    else await miniProgram.disconnect()
  }
}

main().catch((err) => {
  console.error('[mp-e2e] 失败：', err.message)
  process.exit(1)
})
