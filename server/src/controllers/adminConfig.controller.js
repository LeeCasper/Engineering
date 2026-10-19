'use strict'

/**
 * B 端系统配置控制器（B-5.1 ~ B-5.9 / AC-AD65~67）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const sysConfigService = require('../services/sysConfig.service')

/**
 * 值统一以字符串传入。
 *
 * 不让前端按类型传 Number/Boolean：`config_value` 是 VARCHAR（§6.2 统一以字符串存储），
 * 而这里再引入一套「数字走 Number、开关走 Boolean」的约定，就等于让同一个字段
 * 有两种线上形态，取值范围与校验也要各写一遍。字符串进、服务端按注册表解析。
 */
const updateSchema = z.object({
  value: z.union([z.string().max(500), z.number(), z.boolean()]).transform((v) => String(v)),
})

/** GET /admin/sys-configs —— 配置清单（含默认值标记与是否已生效） */
async function list(req, res) {
  res.ok({ list: await sysConfigService.describeAll(req.auth.tenantId) })
}

/** PUT /admin/sys-configs/:key —— 修改配置（仅超级管理员，路由层已拦） */
async function update(req, res) {
  const input = validate(updateSchema, req.body)
  res.ok(await sysConfigService.update(req.params.key, input.value, req.auth))
}

module.exports = { list, update }
