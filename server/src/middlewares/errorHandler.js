'use strict'

/**
 * 统一错误处理与 404。
 *
 * 需求文档 §7.2 定义响应体，AC-AD46 要求「错误响应统一结构，**不向前端暴露
 * SQL 语句、堆栈或框架内部信息**」。本文件是这条标准的唯一出口 ——
 * 因此 controller / service 里不允许出现任何 res.status(4xx).json(...)，
 * 一律 throw AppError，由这里统一成形。
 */

const config = require('../../config')
const AppError = require('../utils/AppError')
const logger = require('../utils/logger')

/**
 * 把基础设施异常翻译成用户能看懂的提示。
 *
 * 不翻译的后果：MySQL 唯一键冲突会原样返回
 * 「ER_DUP_ENTRY: Duplicate entry '138...' for key 'user.uk_user_phone'」，
 * 既暴露表结构（AC-AD46 违规）用户也看不懂。翻译后仍须在服务端日志保留原始信息。
 */
function translate(err) {
  switch (err.code) {
    case 'ER_DUP_ENTRY':
      return { code: 409, message: '数据已存在，请勿重复提交', detail: undefined }
    case 'ER_NO_REFERENCED_ROW_2':
    case 'ER_NO_REFERENCED_ROW':
      return { code: 400, message: '关联的数据不存在' }
    case 'ER_ROW_IS_REFERENCED_2':
    case 'ER_ROW_IS_REFERENCED':
      return { code: 409, message: '该数据已被引用，无法删除' }
    case 'ER_DATA_TOO_LONG':
      return { code: 400, message: '输入内容超出长度限制' }
    case 'ER_LOCK_DEADLOCK':
      return { code: 409, message: '操作冲突，请重试' }
    case 'ER_LOCK_WAIT_TIMEOUT':
      return { code: 409, message: '系统繁忙，请稍后重试' }
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
    case 'ETIMEDOUT':
      return { code: 500, message: '服务暂时不可用，请稍后重试' }
    default:
      return null
  }
}

/**
 * 404：路由未命中。放在所有路由之后注册。
 *
 * 提示里**不回显请求路径**。路径是用户可控输入，原样放进响应体意味着
 * 攻击者可以让接口返回任意字符串 —— 一旦某个前端用 innerHTML 渲染这段文案，
 * 就是一个反射型 XSS。排查接口错拼用服务端访问日志里的 path 就够了。
 */
function notFoundHandler(req, res, next) {
  next(AppError.notFound('接口不存在'))
}

/**
 * 兜底错误处理器。必须是四参数签名，Express 据此识别为错误中间件。
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let appError

  if (err instanceof AppError) {
    appError = err
  } else if (err && err.name === 'ZodError') {
    // zod 校验失败：把字段级问题整理成 { 字段: 提示 }，前端可直接回填到表单项
    appError = AppError.badRequest('参数校验失败', {
      detail: {
        issues: (err.issues || []).map((issue) => ({
          path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path),
          message: issue.message,
        })),
      },
    })
  } else if (err && err.type === 'entity.too.large') {
    appError = AppError.badRequest('请求体过大')
  } else {
    const translated = translate(err || {})
    if (translated) {
      appError = new AppError(translated.code, translated.message, { cause: err, detail: translated.detail })
      appError.expected = err.code === 'ER_DUP_ENTRY' || err.code === 'ER_LOCK_DEADLOCK'
    } else {
      appError = AppError.from(err)
    }
  }

  if (appError.expected && appError.code < 500) {
    logger.warn('业务异常', {
      requestId: req.id,
      path: req.originalUrl.split('?')[0],
      // 字段名是 status 而不是 code —— `code` 已被列进日志脱敏名单
      // （门锁密码在代码里就叫 code，一次 `logger.debug('创建密码', input)`
      // 就会把业主家的门锁密码写进日志）。沿用 `code` 的话，
      // 这里记下来的 HTTP 状态码会变成 "[REDACTED]"，排查问题时一头雾水
      status: appError.code,
      message: appError.message,
    })
  } else {
    // 5xx 或未预期异常：完整记录 cause 的堆栈，这是唯一能定位根因的地方
    logger.error('未处理异常', {
      requestId: req.id,
      path: req.originalUrl.split('?')[0],
      status: appError.code,
      message: appError.message,
      detail: appError.detail,
      cause: err,
      stack: err && err.stack,
    })
  }

  // 响应头可能已被发送（如流式响应中途出错），此时只能交给 Express 关闭连接
  if (res.headersSent) return next(err)

  const body = {
    code: appError.code,
    message: appError.message,
    data: appError.detail === undefined ? null : appError.detail,
  }
  // 仅非生产环境附带 requestId，方便本地对着日志排查
  if (!config.isProd) body.requestId = req.id

  res.status(appError.status || 500).json(body)
}

module.exports = { errorHandler, notFoundHandler }
