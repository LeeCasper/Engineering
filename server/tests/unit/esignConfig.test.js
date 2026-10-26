'use strict'

/**
 * 电子签配置门禁：生产必须 fail-closed。
 *
 * 用子进程隔离，避免进程内已经加载的 config 缓存影响结果。
 */

const path = require('node:path')
const { execFileSync } = require('node:child_process')

const SERVER_DIR = path.resolve(__dirname, '../..')

function run(env) {
  const script = "require('./src/services/esign/config').assertSafeConfig()"
  return execFileSync(process.execPath, ['-e', script], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ESIGN_PROVIDER: '',
      ESIGN_APP_ID: '',
      ESIGN_APP_SECRET: '',
      ESIGN_CALLBACK_SECRET: '',
      ESIGN_CALLBACK_URL: '',
      ESIGN_API_BASE: '',
      ESIGN_OPERATOR_ID: '',
      ...env,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

function runFailure(env) {
  try {
    run(env)
  } catch (err) {
    return String(err.stderr || err.stdout || err.message)
  }
  throw new Error('预期断言失败，但进程正常退出')
}

describe('电子签配置门禁', () => {
  it('生产未启用电子签时拒绝启动', () => {
    const output = runFailure({ ESIGN_ENABLED: 'false' })
    expect(output).toContain('生产环境必须启用 ESIGN_ENABLED')
  })

  it('生产使用 mock provider 时拒绝启动', () => {
    const output = runFailure({
      ESIGN_ENABLED: 'true',
      ESIGN_PROVIDER: 'mock',
      ESIGN_APP_ID: 'x',
      ESIGN_APP_SECRET: 'x',
      ESIGN_CALLBACK_SECRET: 'x',
      ESIGN_CALLBACK_URL: 'https://example.com/callback',
      ESIGN_API_BASE: 'https://example.com',
      ESIGN_OPERATOR_ID: 'u1',
    })
    expect(output).toContain('生产环境禁止 ESIGN_PROVIDER=mock')
  })

  it('生产腾讯电子签缺回调密钥时拒绝启动', () => {
    const output = runFailure({
      ESIGN_ENABLED: 'true',
      ESIGN_PROVIDER: 'tencent',
      ESIGN_APP_ID: 'x',
      ESIGN_APP_SECRET: 'x',
      ESIGN_CALLBACK_URL: 'https://example.com/callback',
      ESIGN_API_BASE: 'https://example.com',
      ESIGN_OPERATOR_ID: 'u1',
    })
    expect(output).toContain('ESIGN_CALLBACK_SECRET')
  })

  it('开发/测试关闭电子签时允许启动（保留 legacy）', () => {
    const script = "require('./src/services/esign/config').assertSafeConfig()"
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ESIGN_ENABLED: 'false',
      },
      encoding: 'utf8',
    })
    expect(output.trim()).toBe('')
  })
})
