'use strict'

/**
 * C 端门锁密码控制器（§4.8 / AC-K01 ~ AC-K16）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const doorCodeService = require('../services/doorCode.service')

const nameField = z.string().trim().min(1, '请填写条目名称').max(50, '名称不超过 50 字')

/**
 * 密码明文。
 *
 * ── 只校验长度，不校验字符集 ──
 * 门锁密码可能是 4 位数字，也可能是带字母的管理密码，甚至带空格。
 * 加一条「只能是数字」的正则，会把一批合法的智能锁密码挡在门外，
 * 而用户完全不知道为什么不行。
 *
 * ── 错误信息里不回显输入内容（§6.2 / CLAUDE.md 第 58 条）──
 * `z.string().max(64)` 的默认提示会带上实际长度，但不会带上值本身 ——
 * 这是刻意的：密码一旦出现在 400 的响应体里，它就被写进了前端日志与错误上报。
 */
const codeField = z
  .string()
  .min(1, '请输入门锁密码')
  .max(64, '门锁密码不超过 64 位')
  // 全空白等于没填。用 refine 而不是 trim 后再判空：trim 会顺手把
  // 首尾空白去掉，而这里只想判断「是不是全是空白」
  .refine((value) => value.trim() !== '', '请输入门锁密码')

const createSchema = z.object({
  name: nameField,
  code: codeField,
  remark: z.string().trim().max(200, '备注不超过 200 字').optional(),
})

const updateSchema = z.object({
  name: nameField.optional(),
  // 不传表示不改密码，只改名称或备注
  code: codeField.optional(),
  remark: z.string().trim().max(200, '备注不超过 200 字').optional(),
})

/**
 * GET /projects/:id/door-codes —— 密码列表（AC-K02 / AC-K09 / AC-K11）
 *
 * `Cache-Control: no-store` 是 AC-K08 的硬要求：响应体里有明文密码，
 * 任何中间层（CDN、反向代理）或客户端缓存把它留下来，都等于在
 * 「明文绝不进日志」之外又开了一条泄漏路径。
 */
async function list(req, res) {
  const result = await doorCodeService.list(req.auth.id, Number(req.params.id), {
    ip: req.ip,
    requestId: req.id,
  })

  res.setHeader('Cache-Control', 'no-store')
  // Pragma 是给 HTTP/1.0 时代的中间层看的。现代客户端不看它，
  // 但成本是一个字符串，而漏掉它可能让某个老旧代理缓存住密码
  res.setHeader('Pragma', 'no-cache')
  res.ok(result)
}

/** GET /projects/:id/door-codes/access-log —— 访问记录（AC-K03） */
async function accessLog(req, res) {
  const paging = parsePaging(req.query)
  const result = await doorCodeService.accessLog(req.auth.id, Number(req.params.id), paging)
  // 访问记录本身不含密码，但会暴露「谁在什么时候关注过这家的门锁」，
  // 同样不该被中间层缓存
  res.setHeader('Cache-Control', 'no-store')
  res.page(result.list, result.total, paging)
}

/** POST /projects/:id/door-codes —— 新增（AC-K01） */
async function create(req, res) {
  const input = validate(createSchema, req.body)
  res.ok(await doorCodeService.create(req.auth.id, Number(req.params.id), input, { ip: req.ip, requestId: req.id }))
}

/** PUT /door-codes/:id —— 修改（AC-K01） */
async function update(req, res) {
  const input = validate(updateSchema, req.body)
  res.ok(
    await doorCodeService.update(req.auth.id, Number(req.params.id), input, { ip: req.ip, requestId: req.id })
  )
}

/** POST /door-codes/:id/revoke —— 失效（AC-K01 / AC-K14） */
async function revoke(req, res) {
  res.ok(await doorCodeService.revoke(req.auth.id, Number(req.params.id), { ip: req.ip, requestId: req.id }))
}

module.exports = { list, accessLog, create, update, revoke }
