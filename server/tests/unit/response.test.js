'use strict'

/**
 * 响应体与错误对象单测。
 *
 * 对应需求文档 §7.2 的响应结构与 AC-AD46
 * 「错误响应统一结构，不向前端暴露 SQL 语句、堆栈或框架内部信息」。
 */

const AppError = require('../../src/utils/AppError')
const { buildSuccess, buildPage, SUCCESS_CODE } = require('../../src/utils/response')

describe('response · 成功响应体（§7.2）', () => {
  it('结构为 { code, message, data }，成功 code 恒为 0', () => {
    expect(buildSuccess({ id: 1 })).toEqual({ code: 0, message: 'success', data: { id: 1 } })
    expect(SUCCESS_CODE).toBe(0)
  })

  it('data 为 undefined 时输出 null 而不是丢掉键', () => {
    // JSON.stringify 会丢弃值为 undefined 的键，导致前端拿不到 data 字段
    expect(buildSuccess(undefined)).toEqual({ code: 0, message: 'success', data: null })
    expect(buildSuccess()).toEqual({ code: 0, message: 'success', data: null })
  })

  it('data 为 null / 0 / false / 空数组时原样保留', () => {
    expect(buildSuccess(null).data).toBeNull()
    expect(buildSuccess(0).data).toBe(0)
    expect(buildSuccess(false).data).toBe(false)
    expect(buildSuccess([]).data).toEqual([])
  })
})

describe('response · 分页响应体（AC-AD45）', () => {
  it('字段名全局统一为 list / total / page / pageSize / totalPages', () => {
    const body = buildPage([{ id: 1 }], 21, { page: 1, pageSize: 20 })
    expect(body).toEqual({
      code: 0,
      message: 'success',
      data: { list: [{ id: 1 }], total: 21, page: 1, pageSize: 20, totalPages: 2 },
    })
  })

  it('total 为 0 时 totalPages 为 0，不是 NaN 或 1', () => {
    expect(buildPage([], 0, { page: 1, pageSize: 20 }).data.totalPages).toBe(0)
  })

  it('整除时不多出一页', () => {
    expect(buildPage([], 40, { page: 1, pageSize: 20 }).data.totalPages).toBe(2)
  })

  it('pageSize 为 0 时不产生 Infinity', () => {
    expect(buildPage([], 10, { page: 1, pageSize: 0 }).data.totalPages).toBe(0)
  })
})

describe('AppError · 业务码与 HTTP 状态码同源（§7.2）', () => {
  it('各快捷构造器生成对应的 code 与 status', () => {
    const cases = [
      ['badRequest', 400],
      ['unauthorized', 401],
      ['forbidden', 403],
      ['notFound', 404],
      ['conflict', 409],
      ['tooManyRequests', 429],
      ['internal', 500],
    ]
    for (const [method, code] of cases) {
      const err = AppError[method]('自定义提示')
      expect(err.code).toBe(code)
      expect(err.status).toBe(code)
      expect(err.message).toBe('自定义提示')
      expect(err).toBeInstanceOf(Error)
    }
  })

  it('不传提示时使用该 code 的标准中文文案', () => {
    expect(AppError.notFound().message).toBe('资源不存在')
    expect(AppError.conflict().message).toBe('状态冲突')
    expect(AppError.tooManyRequests().message).toBe('请求过于频繁，请稍后再试')
  })

  it('可预期错误带 expected 标记（决定记 warn 还是 error）', () => {
    expect(AppError.badRequest().expected).toBe(true)
  })

  it('detail 原样保留，供前端回填表单', () => {
    const err = AppError.badRequest('参数校验失败', {
      detail: { issues: [{ path: 'amount', message: '金额必须大于 0' }] },
    })
    expect(err.detail.issues[0].path).toBe('amount')
  })
})

describe('AppError.from · 未知异常一律以 500 对外（AC-AD46）', () => {
  it('已是 AppError 时原样返回', () => {
    const original = AppError.forbidden('无权限')
    expect(AppError.from(original)).toBe(original)
  })

  it('把任意异常包装成 500，且原始错误挂在 cause 上仅供日志使用', () => {
    const raw = new Error("ER_PARSE_ERROR: You have an error in your SQL syntax near 'SELECT * FROM user'")
    const wrapped = AppError.from(raw)

    expect(wrapped.code).toBe(500)
    // 对外的 message 是标准文案，不含 SQL —— 客户端看不到内部细节
    expect(wrapped.message).toBe('服务端错误')
    expect(wrapped.message).not.toMatch(/SQL|SELECT/i)
    // 服务端仍能拿到原始异常用于排查
    expect(wrapped.cause).toBe(raw)
    expect(wrapped.expected).toBe(false)
  })

  it('非 Error 值（字符串、null、对象）也能安全包装', () => {
    for (const value of ['炸了', null, undefined, { weird: true }]) {
      const wrapped = AppError.from(value)
      expect(wrapped.code).toBe(500)
      expect(wrapped.message).toBe('服务端错误')
    }
  })
})
