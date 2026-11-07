'use strict'

/**
 * 验收报告编号。
 *
 * 锁住三件事：
 * - 格式是 AC-{通过日期}-{项目 id}-{验收单 id 6 位}；
 * - 日期取通过时间，重提 / 重试生成不会换号；
 * - 缺 id 时返回 null（调用方负责显示「待生成」）。
 */

const { buildAcceptanceReportNo } = require('../../src/utils/acceptanceReportNo')

describe('acceptanceReportNo · 验收报告编号', () => {
  it('按通过日期、项目、验收单生成编号', () => {
    expect(
      buildAcceptanceReportNo({
        id: 40,
        project_id: 8092,
        status: 'passed',
        finished_at: '2026-11-05 18:16:18',
        submitted_at: '2026-11-05 18:16:00',
      })
    ).toBe('AC-20261105-8092-000040')
  })

  it('重试生成（finished_at 不变）编号不变', () => {
    const acceptance = {
      id: 7,
      project_id: 12,
      finished_at: '2026-01-02 09:00:00',
      submitted_at: '2026-01-01 09:00:00',
    }
    const first = buildAcceptanceReportNo(acceptance)
    const second = buildAcceptanceReportNo({ ...acceptance })
    expect(first).toBe('AC-20260102-12-000007')
    expect(second).toBe(first)
  })

  it('没有通过时间时回落到提交时间，再回落到创建时间', () => {
    expect(
      buildAcceptanceReportNo({
        id: 5,
        project_id: 3,
        submitted_at: '2026-02-03 10:00:00',
        created_at: '2026-02-01 10:00:00',
      })
    ).toBe('AC-20260203-3-000005')

    expect(
      buildAcceptanceReportNo({
        id: 5,
        project_id: 3,
        created_at: '2026-02-01 10:00:00',
      })
    ).toBe('AC-20260201-3-000005')
  })

  it('缺验收单 id 时返回 null，不生成半截编号', () => {
    expect(buildAcceptanceReportNo(null)).toBeNull()
    expect(buildAcceptanceReportNo({ project_id: 3 })).toBeNull()
  })
})
