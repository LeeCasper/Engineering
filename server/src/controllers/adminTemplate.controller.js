'use strict'

/**
 * B 端阶段模板控制器（B-3.x）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const templateService = require('../services/template.service')

/**
 * 权重：可选，但传了就必须是正数（AC-AD23）。
 * 不限制小数位为 2 —— 那是金额的规则；权重列是 DECIMAL(5,2)，
 * 但让 service 层的 money.validate 统一校验能少一处规则分叉，
 * 且业务上权重本来就该是 1、2、0.5 这类简单值。
 */
const weightField = z.union([z.string(), z.number()]).optional().nullable()

const itemSchema = z.object({
  name: z.string().trim().min(1).max(50),
  weight: weightField,
  // B-3.5 / AC-AD32：默认验收项清单，生成项目验收单时带入
  checklist: z.array(z.string().trim().max(200)).max(30).optional(),
})

const stageSchema = z.object({
  name: z.string().trim().min(1).max(50),
  // AC-AD30：计划工期必填且为正整数。用 z.number().int().positive()
  // 而不是自定义 refine —— 这里前端传的是数字，不是金额那种字符串场景
  planDays: z.number().int().positive(),
  weight: weightField,
  // AC-AD64：每个阶段至少 1 个工序。写成显式中文 message 而不是依赖
  // zodLocale 的通用兜底 —— 「不能为空」说不清是哪个数组空了
  items: z
    .array(itemSchema)
    .min(1, '每个阶段至少需要包含 1 个工序')
    .max(templateService.MAX_ITEMS_PER_STAGE, `每个阶段最多 ${templateService.MAX_ITEMS_PER_STAGE} 个工序`),
})

// AC-AD64：模板至少包含 1 个阶段
const structureField = z
  .array(stageSchema)
  .min(1, '模板至少需要包含 1 个阶段')
  .max(templateService.MAX_STAGES, `单个模板最多 ${templateService.MAX_STAGES} 个阶段`)

const createSchema = z.object({
  name: z.string().trim().min(1, '请输入模板名称').max(50, '模板名称不超过 50 字'),
  isDefault: z.boolean().optional().default(false),
  stages: structureField,
})

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    isDefault: z.boolean().optional(),
    // 不传 stages 表示只改名称与默认标记，不动结构
    stages: structureField.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, '没有需要更新的字段')

const duplicateSchema = z.object({
  name: z.string().trim().min(1, '请输入副本名称').max(50, '模板名称不超过 50 字'),
})

const listQuerySchema = z.object({
  keyword: z.string().trim().max(50).optional(),
  onlyDefault: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
})

/** GET /admin/stage-templates */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const result = await templateService.listTemplates(req.auth, { ...query, paging: parsePaging(req.query) })
  res.page(result.list, result.total, { page: result.page, pageSize: result.pageSize })
}

/** GET /admin/stage-templates/:id —— 完整结构，供只读预览（B-3.9）与编辑器回显 */
async function detail(req, res) {
  res.ok(await templateService.getTemplate(req.auth, Number(req.params.id)))
}

/** POST /admin/stage-templates */
async function create(req, res) {
  const input = validate(createSchema, req.body)
  res.ok(await templateService.createTemplate(req.auth, input))
}

/** PUT /admin/stage-templates/:id */
async function update(req, res) {
  const input = validate(updateSchema, req.body)
  res.ok(await templateService.updateTemplate(req.auth, Number(req.params.id), input))
}

/** POST /admin/stage-templates/:id/duplicate —— 复制（B-3.7 / AC-AD34） */
async function duplicate(req, res) {
  const input = validate(duplicateSchema, req.body)
  res.ok(await templateService.duplicateTemplate(req.auth, Number(req.params.id), input))
}

/** DELETE /admin/stage-templates/:id */
async function remove(req, res) {
  res.ok(await templateService.deleteTemplate(req.auth, Number(req.params.id)))
}

/** PUT /admin/stage-templates/:id/default */
async function setDefault(req, res) {
  res.ok(await templateService.setDefaultTemplate(req.auth, Number(req.params.id)))
}

module.exports = { list, detail, create, update, duplicate, remove, setDefault }
