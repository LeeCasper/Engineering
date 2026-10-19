'use strict'

/**
 * 包装异步控制器，把 rejected promise 转交给 Express 的错误处理。
 *
 * Express 4 不会自动捕获 async 函数抛出的异常 —— 不包一层的话，service 里
 * 抛出的异常会变成 unhandledRejection，请求悬挂到超时，客户端拿到的是一个
 * 没有任何响应的连接。Express 5 原生支持，届时本文件可整个删掉。
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

module.exports = asyncHandler
