'use strict'

/**
 * 统一响应体（需求文档 §7.2）：{ code, message, data }。
 * 成功恒为 code 0 + HTTP 200；失败由 errorHandler 输出，且 HTTP 状态码与 code 同值。
 */

const SUCCESS_CODE = 0

function buildSuccess(data = null, message = 'success') {
  // data 为 undefined 时给 null：JSON.stringify 会丢弃值为 undefined 的键，
  // 前端就拿不到 data 字段了
  return { code: SUCCESS_CODE, message, data: data === undefined ? null : data }
}

/**
 * 分页响应体。字段名全局统一，否则前端要为每个列表单独写适配。
 * AC-AD45 要求所有列表接口强制分页。
 *
 * `extra` 供列表顺带返回的随行信息（如消息中心的全局未读数、验收列表的红点计数）。
 * 它**排在分页字段之前**展开：万一 extra 里手滑写了 `total`，
 * 被覆盖的应该是调用方那个多余字段，而不是分页的权威值 ——
 * 分页字段算错会让前端翻页直接错乱，比多一个字段严重得多。
 */
function buildPage(list, total, { page, pageSize }, extra = null) {
  return buildSuccess({
    ...(extra || {}),
    list,
    total,
    page,
    pageSize,
    // 由服务端算好总页数，避免各前端各算一遍还可能算法不一致
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  })
}

/** 语法糖中间件，让 controller 写成 res.ok(data) / res.page(list, total, paging, extra) */
function attachResponseHelpers(req, res, next) {
  res.ok = (data, message) => res.status(200).json(buildSuccess(data, message))
  res.page = (list, total, paging, extra) => res.status(200).json(buildPage(list, total, paging, extra))
  next()
}

module.exports = { SUCCESS_CODE, buildSuccess, buildPage, attachResponseHelpers }
