'use strict'

const { OWNER_TYPE, ownerRoleLabel, isPrimaryOwner, ownerTypeOf, assertPrimaryOwner } = require('../../src/utils/ownerType')

describe('主业主 / 临时业主判定', () => {
  it('主业主通过重要决策校验', () => {
    expect(() =>
      assertPrimaryOwner({ role: 'owner', owner_type: OWNER_TYPE.PRIMARY }, '确认验收')
    ).not.toThrow()
    expect(isPrimaryOwner({ role: 'owner', owner_type: 'primary' })).toBe(true)
  })

  it('临时业主被拒绝', () => {
    expect(() =>
      assertPrimaryOwner({ role: 'owner', owner_type: OWNER_TYPE.TEMPORARY }, '确认付款')
    ).toThrow(/仅主业主可确认付款/)
    expect(isPrimaryOwner({ role: 'owner', owner_type: 'temporary' })).toBe(false)
  })

  it('owner_type 为 NULL 时失败关闭（不把来源不明的业主当主业主）', () => {
    expect(() => assertPrimaryOwner({ role: 'owner', owner_type: null }, '确认对账')).toThrow(
      /仅主业主可确认对账/
    )
    expect(isPrimaryOwner({ role: 'owner' })).toBe(false)
  })

  it('非业主不能执行主业主动作', () => {
    expect(() => assertPrimaryOwner({ role: 'foreman', owner_type: null }, '确认验收')).toThrow(
      /仅业主可确认验收/
    )
    expect(() => assertPrimaryOwner(null, '确认验收')).toThrow(/仅业主可确认验收/)
  })

  it('展示标签按主 / 临时 / 其他角色返回', () => {
    expect(ownerRoleLabel('owner', 'primary')).toBe('主业主')
    expect(ownerRoleLabel('owner', 'temporary')).toBe('临时业主')
    // 数据异常时回落到通用业主，而不是编造一个主业主
    expect(ownerRoleLabel('owner', null)).toBe('业主')
    expect(ownerRoleLabel('foreman', null)).toBe('工长')
    expect(ownerRoleLabel('supervisor', null)).toBe('监理')
  })

  it('ownerTypeOf 只对业主返回类型', () => {
    expect(ownerTypeOf({ role: 'owner', owner_type: 'primary' })).toBe('primary')
    expect(ownerTypeOf({ role: 'foreman', owner_type: 'primary' })).toBeNull()
    expect(ownerTypeOf({ role: 'owner', owner_type: null })).toBeNull()
  })
})
