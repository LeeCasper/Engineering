'use strict'

/**
 * 验收三方签署摘要的纯逻辑单测。
 *
 * 详情接口与 PDF 都依赖这个函数，因此重点锁住边界：
 * 轮次、无监理、历史业主签名字段回退、可靠电子签、驳回记录不参与。
 */

const {
  collectRoundSignatures,
  SIGNATURE_STATES,
} = require('../../src/utils/acceptanceSignatures')

function row(overrides) {
  return {
    round: 1,
    step: 'self_check',
    action: 'submit',
    signature_url: null,
    operator_id: 1,
    real_name: null,
    nickname: null,
    operated_at: '2026-11-08 10:00:00',
    ...overrides,
  }
}

describe('三方签署摘要', () => {
  it('三方都签名时返回已签署，并带出签名人与时间', () => {
    const flow = [
      row({ step: 'self_check', signature_url: '/s/foreman.png', real_name: '张三' }),
      row({ step: 'supervisor', action: 'approve', signature_url: '/s/supervisor.png', nickname: '李四' }),
      row({ step: 'owner', action: 'approve', signature_url: '/s/owner.png', real_name: '王五' }),
    ]

    const result = collectRoundSignatures(flow, { round: 1, hasSupervisor: true, status: 'passed' })

    expect(result.round).toBe(1)
    expect(result.mode).toBe('legacy')
    expect(result.foreman).toMatchObject({
      state: SIGNATURE_STATES.SIGNED,
      signed: true,
      signatureUrl: '/s/foreman.png',
      operator: '张三',
    })
    expect(result.supervisor.operator).toBe('李四')
    expect(result.owner.operator).toBe('王五')
  })

  it('无监理时监理为已跳过，工长与业主仍要求签名', () => {
    const flow = [
      row({ step: 'self_check', signature_url: '/s/foreman.png' }),
      row({ step: 'owner', action: 'approve', signature_url: '/s/owner.png' }),
    ]

    const result = collectRoundSignatures(flow, { round: 1, hasSupervisor: false, status: 'passed' })

    expect(result.supervisor.required).toBe(false)
    expect(result.supervisor.state).toBe(SIGNATURE_STATES.SKIPPED)
    expect(result.supervisor.stateLabel).toContain('未配置监理')
    expect(result.foreman.signed).toBe(true)
    expect(result.owner.signed).toBe(true)
  })

  it('历史单据 flow 无签名时，业主回退到 acceptance.signature_url', () => {
    const result = collectRoundSignatures([], {
      round: 1,
      hasSupervisor: true,
      ownerFallback: { signatureUrl: '/s/legacy-owner.png', signedAt: '2026-01-01 10:00:00' },
      status: 'passed',
    })

    expect(result.owner).toMatchObject({
      state: SIGNATURE_STATES.SIGNED,
      signed: true,
      signatureUrl: '/s/legacy-owner.png',
      source: 'acceptance',
    })
    expect(result.foreman.state).toBe(SIGNATURE_STATES.MISSING)
    expect(result.foreman.stateLabel).toBe('未采集')
    expect(result.supervisor.stateLabel).toBe('未采集')
  })

  it('可靠电子签模式：业主显示已可靠电子签，工长 / 监理仍按手写状态判断', () => {
    const flow = [
      row({ step: 'self_check', signature_url: '/s/foreman.png' }),
      row({ step: 'supervisor', action: 'approve', signature_url: '/s/supervisor.png' }),
    ]

    const result = collectRoundSignatures(flow, {
      round: 1,
      hasSupervisor: true,
      providerMode: true,
      providerSigned: true,
      status: 'passed',
    })

    expect(result.mode).toBe('provider')
    expect(result.owner).toMatchObject({
      state: SIGNATURE_STATES.PROVIDER,
      signed: true,
      source: 'provider',
    })
    expect(result.foreman.signed).toBe(true)
    expect(result.supervisor.signed).toBe(true)
  })

  it('只取指定轮次，旧轮次签名不会串到新轮次', () => {
    const flow = [
      row({ round: 1, step: 'self_check', signature_url: '/s/r1-foreman.png' }),
      row({ round: 1, step: 'supervisor', action: 'approve', signature_url: '/s/r1-supervisor.png' }),
      row({ round: 2, step: 'self_check', signature_url: '/s/r2-foreman.png' }),
    ]

    const result = collectRoundSignatures(flow, { round: 2, hasSupervisor: true, status: 'pending_supervisor' })

    expect(result.round).toBe(2)
    expect(result.foreman.signatureUrl).toBe('/s/r2-foreman.png')
    expect(result.supervisor.state).toBe(SIGNATURE_STATES.MISSING)
    expect(result.supervisor.stateLabel).toBe('待签署')
  })

  it('驳回记录即使误带签名也不作为签署依据', () => {
    const flow = [
      row({ step: 'self_check', signature_url: '/s/old.png' }),
      row({ step: 'supervisor', action: 'reject', signature_url: '/s/reject.png' }),
    ]

    const result = collectRoundSignatures(flow, { round: 1, hasSupervisor: true, status: 'pending_rectify' })

    expect(result.foreman.signed).toBe(true)
    expect(result.supervisor.signed).toBe(false)
  })
})
