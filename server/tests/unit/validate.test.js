'use strict'

/**
 * 入参校验单测。
 *
 * 两条要锁住的行为：
 *   1. 校验失败的提示必须是**中文**。zod 默认是英文，而 validate() 会把单条错误
 *      直接作为面向用户的 message 返回 —— 漏掉映射，用户就会看到
 *      "Array must contain at least 1 element"。这类回归不会让测试变红，
 *      只会让线上多一句英文，所以必须有断言盯着。
 *   2. 只有一个字段出错时，把它的话提到 message；多个字段出错时用通用文案。
 */

const { z } = require('zod')
const { validate } = require('../../src/utils/validate')
const AppError = require('../../src/utils/AppError')

/** 取校验失败时抛出的 AppError；成功则让用例失败 */
function expectFailure(schema, data) {
  try {
    validate(schema, data)
  } catch (err) {
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe(400)
    return err
  }
  throw new Error('期望校验失败，但通过了')
}

describe('validate · 中文错误映射', () => {
  it('必填字段缺失时提示「必填」而不是「Expected string, received undefined」', () => {
    const err = expectFailure(z.object({ name: z.string() }), {})
    expect(err.message).toBe('该项为必填')
    expect(err.message).not.toMatch(/[a-zA-Z]{4,}/)
  })

  it('类型错误的中文提示', () => {
    const err = expectFailure(z.object({ age: z.number() }), { age: 'abc' })
    expect(err.message).toBe('应为数字，实际收到文本')
  })

  it('空数组提示「不能为空」', () => {
    const err = expectFailure(z.object({ items: z.array(z.string()).min(1) }), { items: [] })
    expect(err.message).toBe('不能为空')
  })

  it('长度超限的中文提示', () => {
    const tooLong = expectFailure(z.object({ name: z.string().max(5) }), { name: '一二三四五六' })
    expect(tooLong.message).toContain('不得超过 5')

    const tooShort = expectFailure(z.object({ name: z.string().min(3) }), { name: 'a' })
    expect(tooShort.message).toContain('不得少于 3')
  })

  it('枚举取值非法时列出可选值', () => {
    const err = expectFailure(z.object({ role: z.enum(['admin', 'user']) }), { role: 'root' })
    expect(err.message).toContain('admin')
    expect(err.message).toContain('user')
  })

  it('自定义 message 优先于通用映射（业务上需要更精确的措辞时）', () => {
    const schema = z.object({ name: z.string().min(1, '请输入项目名称') })
    expect(expectFailure(schema, { name: '' }).message).toBe('请输入项目名称')
  })

  it('refine 未写 message 时也不返回英文的 Invalid input', () => {
    const schema = z
      .object({ a: z.string(), b: z.string() })
      .refine((d) => d.a === d.b, { message: '两值必须相同', path: ['b'] })
    expect(expectFailure(schema, { a: 'x', b: 'y' }).message).toBe('两值必须相同')
  })
})

describe('validate · message 与 issues 的取舍', () => {
  it('单个字段出错时，message 就是那句话（curl 与冒烟脚本不必再去挖 issues）', () => {
    const schema = z.object({ name: z.string().min(1, '请输入名称') })
    const err = expectFailure(schema, { name: '' })
    expect(err.message).toBe('请输入名称')
    expect(err.detail.issues).toHaveLength(1)
  })

  it('多个字段出错时用通用文案，issues 逐条给出（前端回填表单项用）', () => {
    const schema = z.object({
      name: z.string().min(1, '请输入名称'),
      age: z.number({ invalid_type_error: '年龄必须是数字' }),
    })
    const err = expectFailure(schema, {})

    // 挑一条展示会掩盖其他问题，那种情况前端本来就该逐条高亮
    expect(err.message).toBe('参数校验失败')
    expect(err.detail.issues.length).toBeGreaterThanOrEqual(2)
    expect(err.detail.issues.every((i) => typeof i.path === 'string' && typeof i.message === 'string')).toBe(true)
  })

  it('issues 的 path 是点分字符串，嵌套字段可定位', () => {
    const schema = z.object({ stages: z.array(z.object({ planDays: z.number() })) })
    const err = expectFailure(schema, { stages: [{ planDays: 'x' }] })
    expect(err.detail.issues[0].path).toBe('stages.0.planDays')
  })

  it('校验通过时原样返回解析后的数据（默认值已应用）', () => {
    const schema = z.object({ role: z.enum(['a', 'b']).default('a') })
    expect(validate(schema, {})).toEqual({ role: 'a' })
  })

  it('未声明的字段被丢弃，不会悄悄流进 service（role、status 这类字段尤其危险）', () => {
    const schema = z.object({ name: z.string() })
    const parsed = validate(schema, { name: 'x', role: 'owner', isDefault: true })
    expect(parsed).toEqual({ name: 'x' })
    expect(parsed).not.toHaveProperty('role')
  })
})
