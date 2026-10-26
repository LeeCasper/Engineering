'use strict'

/**
 * 统一业务异常。
 *
 * 需求文档 §7.2 约定响应体 code 取 HTTP 语义值（400/401/403/404/409/500），
 * 因此这里让 HTTP 状态码与业务 code **保持同一个数字**，不再做 ×100 之类的映射 ——
 * 两套编号（HTTP 码 + 业务码）一旦分叉，排查线上问题时总要多绕一层。
 *
 * 用法：throw AppError.conflict('该阶段已有未终结的验收单')
 */

/** 提示面向终端用户，不暴露内部细节（AC-AD46） */
const CODE_MESSAGE = {
  400: '参数错误',
  401: '未登录或登录已失效',
  403: '无权限',
  404: '资源不存在',
  409: '状态冲突',
  // 429 是需求文档 §7.2 表格之外的一项，为 §8.2「接口限流：单用户 60 次/分钟」而加。
  // 没有复用 403：403 表示「你没有这个权限」，429 表示「你可以，但太快了」——
  // 混用会让前端把限流误报成权限问题，用户按提示去申请权限，永远解决不了。
  429: '请求过于频繁，请稍后再试',
  500: '服务端错误',
  503: '服务暂不可用',
}

class AppError extends Error {
  /** options.detail 会原样放进响应 data；options.cause 仅进服务端日志，不返回客户端 */
  constructor(code, message, options = {}) {
    super(message || CODE_MESSAGE[code] || '请求失败')
    this.name = 'AppError'
    this.code = code
    this.status = code
    this.detail = options.detail
    this.cause = options.cause
    // 标记为「可预期错误」：错误处理器据此决定是否打 error 级日志 + 上报。
    // 用户输错参数不该刷满错误日志，否则真正的故障会被淹没。
    this.expected = true
    Error.captureStackTrace(this, AppError)
  }
}

/** 为每个 code 生成快捷构造器，避免业务代码里到处写数字（AppError.notFound('项目不存在')） */
for (const [code, defaultMessage] of Object.entries(CODE_MESSAGE)) {
  const key = {
    400: 'badRequest',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'notFound',
    409: 'conflict',
    429: 'tooManyRequests',
    500: 'internal',
    503: 'serviceUnavailable',
  }[code]

  AppError[key] = (message, options) => new AppError(Number(code), message || defaultMessage, options)
}

/**
 * 把任意未知异常包装成 AppError：一律以 500 对外，原始错误挂在 cause 上仅供日志使用 ——
 * 客户端永远看不到 SQL 语句或堆栈（AC-AD46）。
 */
AppError.from = function from(err) {
  if (err instanceof AppError) return err
  const wrapped = new AppError(500, CODE_MESSAGE[500], { cause: err })
  wrapped.expected = false
  return wrapped
}

AppError.CODE_MESSAGE = CODE_MESSAGE

module.exports = AppError
