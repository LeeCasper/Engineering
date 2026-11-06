'use strict'

/**
 * H5 E2E 执行器。
 *
 * 默认本地：
 *   - 后端 http://127.0.0.1:3000（WX_MOCK=true，development）
 *   - H5   http://localhost:5173
 *
 * 两个服务未启动时会自动拉起，测试结束后关闭；已在运行则直接复用。
 * 只允许打本机地址，避免误把自动化跑向生产。
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const SERVER_DIR = path.resolve(ROOT, '..', 'server')
const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '')
const BACKEND_HEALTH = process.env.E2E_BACKEND_HEALTH || 'http://127.0.0.1:3000/api/v1/health'
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const children = []
let cleaningUp = false

function isLocal(url) {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch (err) {
    return false
  }
}

async function isUp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
    return response.ok
  } catch (err) {
    return false
  }
}

async function waitFor(url, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isUp(url)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`等待 ${label} 超时：${url}`)
}

function start(command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    detached: true,
  })
  children.push(child)
  return child
}

function killChild(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (err) {
    try {
      child.kill('SIGTERM')
    } catch (inner) {
      // ignore
    }
  }
}

function cleanup() {
  if (cleaningUp) return
  cleaningUp = true
  for (const child of children.reverse()) killChild(child)
}

process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})
process.on('SIGTERM', () => {
  cleanup()
  process.exit(143)
})

async function main() {
  if (!isLocal(BASE_URL) && process.env.E2E_ALLOW_REMOTE !== '1') {
    throw new Error('E2E_BASE_URL 不是本机地址；如确认要打远程环境，请设置 E2E_ALLOW_REMOTE=1')
  }

  if (!(await isUp(BACKEND_HEALTH))) {
    console.log('[e2e] 启动后端 dev server ...')
    start('node', ['src/server.js'], SERVER_DIR, {
      NODE_ENV: 'development',
      WX_MOCK: 'true',
    })
  }
  await waitFor(BACKEND_HEALTH, '后端健康检查')

  if (!(await isUp(BASE_URL))) {
    console.log('[e2e] 启动 H5 dev server ...')
    start(NPM, ['run', 'dev:h5'], ROOT, {
      VITE_DEV_PHONE_BIND: 'true',
    })
  }
  await waitFor(BASE_URL, 'H5 dev server')

  const testsDir = __dirname
  const files = fs
    .readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join(testsDir, name))

  if (!files.length) throw new Error('没有找到 tests/e2e/*.test.js')

  console.log(`[e2e] 执行 ${files.length} 个测试文件`)
  const runner = spawn(
    process.execPath,
    ['--test', '--test-timeout=60000', ...files],
    {
      cwd: ROOT,
      env: { ...process.env, E2E_BASE_URL: BASE_URL },
      stdio: 'inherit',
    }
  )

  const code = await new Promise((resolve) => runner.on('exit', (value) => resolve(value || 0)))
  cleanup()
  process.exit(code)
}

main().catch((err) => {
  console.error('[e2e] 失败：', err.message)
  cleanup()
  process.exit(1)
})
