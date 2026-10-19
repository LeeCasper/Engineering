'use strict'

/**
 * B 端项目阶段与工序的增删改控制器（B-2.5 / B-2.9）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const projectStructureService = require('../services/projectStructure.service')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const nameField = z.string().trim().min(1, '名称不能为空').max(50, '名称不超过 50 字')

/** 权重可选；正数性由 service 的 money.validate 统一校验，这里只做类型收敛 */
const weightField = z.union([z.string(), z.number()]).nullish()

const dateField = z
  .string()
  .regex(DATE_PATTERN, '日期格式应为 YYYY-MM-DD')
  .nullish()

const createStageSchema = z.object({
  name: nameField,
  weight: weightField,
  planStart: dateField,
  planEnd: dateField,
})

const updateStageSchema = z
  .object({
    name: nameField.optional(),
    weight: weightField,
    planStart: dateField,
    planEnd: dateField,
    actualStart: dateField,
    actualEnd: dateField,
  })
  .refine((data) => Object.keys(data).length > 0, '没有需要更新的字段')

const createItemSchema = z.object({
  name: nameField,
  weight: weightField,
  planStart: dateField,
  planEnd: dateField,
  checklist: z.array(z.string().trim().max(200)).max(30).optional(),
})

const updateItemSchema = z
  .object({
    name: nameField.optional(),
    weight: weightField,
    planStart: dateField,
    planEnd: dateField,
  })
  .refine((data) => Object.keys(data).length > 0, '没有需要更新的字段')

/** POST /admin/projects/:id/stages */
async function addStage(req, res) {
  const input = validate(createStageSchema, req.body)
  res.ok(await projectStructureService.addStage(req.auth, Number(req.params.id), input))
}

/** PUT /admin/projects/:id/stages/:stageId */
async function updateStage(req, res) {
  const input = validate(updateStageSchema, req.body)
  res.ok(
    await projectStructureService.updateStage(req.auth, Number(req.params.id), Number(req.params.stageId), input)
  )
}

/** DELETE /admin/projects/:id/stages/:stageId */
async function deleteStage(req, res) {
  res.ok(await projectStructureService.deleteStage(req.auth, Number(req.params.id), Number(req.params.stageId)))
}

/** POST /admin/projects/:id/stages/:stageId/items */
async function addItem(req, res) {
  const input = validate(createItemSchema, req.body)
  res.ok(
    await projectStructureService.addItem(req.auth, Number(req.params.id), Number(req.params.stageId), input)
  )
}

/** PUT /admin/projects/:id/items/:itemId */
async function updateItem(req, res) {
  const input = validate(updateItemSchema, req.body)
  res.ok(
    await projectStructureService.updateItem(req.auth, Number(req.params.id), Number(req.params.itemId), input)
  )
}

/** DELETE /admin/projects/:id/items/:itemId */
async function deleteItem(req, res) {
  res.ok(await projectStructureService.deleteItem(req.auth, Number(req.params.id), Number(req.params.itemId)))
}

module.exports = { addStage, updateStage, deleteStage, addItem, updateItem, deleteItem }
