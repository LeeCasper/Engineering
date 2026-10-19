'use strict'

/**
 * B 端内容页维护控制器（AC-U17：「内容由后台可维护」）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const contentPageService = require('../services/contentPage.service')

const saveSchema = z.object({
  title: z.string().trim().min(1, '请填写页面标题').max(100),
  // 上限 100000 字：隐私政策这类文本几千字，留足余量但挡住「粘贴一个
  // 几兆的富文本把 MEDIUMTEXT 撑满」这种意外。MEDIUMTEXT 的硬上限是 16MB，
  // 不设业务上限就等于把那个值当成实际可接受的值
  content: z.string().max(100000, '内容过长').optional(),
  version: z.string().trim().max(32).optional(),
  publish: z.boolean().optional().default(false),
})

/** GET /admin/contents —— 页面清单（含未发布的草稿） */
async function list(req, res) {
  res.ok({ list: await contentPageService.listAll(req.auth.tenantId) })
}

/** GET /admin/contents/:key —— 页面详情（含正文，编辑器用） */
async function detail(req, res) {
  res.ok(await contentPageService.getForAdmin(req.auth.tenantId, req.params.key))
}

/** PUT /admin/contents/:key —— 保存内容；publish 为 true 时发布 */
async function save(req, res) {
  const input = validate(saveSchema, req.body)
  res.ok(await contentPageService.save(req.params.key, input, req.auth))
}

module.exports = { list, detail, save }
