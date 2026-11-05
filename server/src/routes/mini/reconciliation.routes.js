'use strict'

/**
 * C 端对账路由。
 *
 * 发起挂在项目下（`/projects/:id/reconciliations`），确认与异议挂在顶层
 * （`/reconciliations/:id/confirm`）—— 与 §7.3 对验收、评论的划分方式一致：
 * 后者关心的是「这张单子」，操作者手上只有单子 id。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { tenantWriteGuard } = require('../../middlewares/tenantGuard')
const controller = require('../../controllers/reconciliation.controller')

const projectRouter = express.Router()
projectRouter.use(requireMini)
projectRouter.use('/:id', tenantWriteGuard({ resource: 'project' }))
projectRouter.post('/:id/reconciliations', asyncHandler(controller.initiate))
projectRouter.get('/:id/reconciliations', asyncHandler(controller.list))

// 阶段结算（§4.7 / §7.3）：验收通过后自动生成草稿，主工长提交。
// 确认仍走顶层的 `/reconciliations/:id/confirm`，与周期对账同一入口。
projectRouter.get('/:id/stages/:stageId/settlement', asyncHandler(controller.stageSettlement))
projectRouter.post('/:id/stages/:stageId/settlement/submit', asyncHandler(controller.submitStageSettlement))

const reconciliationRouter = express.Router()

// 结算单下载放在鉴权之前：AC-L24 要求双方均可下载，且与 AC-A20 同口径 ——
// 带签名的临时链接要能被转发给不在系统里的人。签名校验在 controller 里做
reconciliationRouter.get('/:id/settlement.pdf', asyncHandler(controller.downloadSettlement))

reconciliationRouter.use(requireMini)
// `:id` 是结算单 id；PDF 下载是 GET，不受只读守卫影响
reconciliationRouter.use('/:id', tenantWriteGuard({ resource: 'reconciliation' }))
reconciliationRouter.get('/:id', asyncHandler(controller.detail))
reconciliationRouter.post('/:id/confirm', asyncHandler(controller.confirm))
reconciliationRouter.post('/:id/dispute', asyncHandler(controller.dispute))

module.exports = { projectRouter, reconciliationRouter }
