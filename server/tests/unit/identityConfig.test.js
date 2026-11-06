'use strict'

/**
 * 实名认证启动自检。
 *
 * 配置错误必须在进程启动时暴露，而不是等用户提交认证才发现 503。
 */

const identityService = require('../../src/services/identity.service')

const ALIYUN_OK = {
  enabled: true,
  provider: 'aliyun',
  aliyun: { accessKeyId: 'ak', accessKeySecret: 'sk' },
}

describe('实名认证 provider 配置自检', () => {
  it('local 不需要 AccessKey', () => {
    expect(() => identityService.assertSafeConfig({ enabled: true, provider: 'local' })).not.toThrow()
  })

  it('aliyun 配置完整时通过', () => {
    expect(() => identityService.assertSafeConfig(ALIYUN_OK)).not.toThrow()
  })

  it('aliyun 缺 AccessKey 时拒绝启动', () => {
    expect(() =>
      identityService.assertSafeConfig({
        ...ALIYUN_OK,
        aliyun: { accessKeyId: '', accessKeySecret: '' },
      })
    ).toThrow(/ALIYUN_ACCESS_KEY_ID/)
  })

  it('未知 provider 拒绝启动', () => {
    expect(() =>
      identityService.assertSafeConfig({ enabled: true, provider: 'tencent' })
    ).toThrow(/不受支持/)
  })

  it('关闭实名认证时不要求 provider 配置', () => {
    expect(() =>
      identityService.assertSafeConfig({ enabled: false, provider: 'whatever' })
    ).not.toThrow()
  })
})
