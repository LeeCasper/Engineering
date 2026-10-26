'use strict'

/**
 * C 端验收路由。
 *
 * §7.3 的路径照搬；`PUT /acceptances/:id`（存草稿）、`POST /:id/self-check`、
 * `POST /:id/resubmit`、`POST /:id/report/retry` 是按 C-3.3 / C-3.8 / AC-A08 / AC-A19
 * 补的 —— 原清单只有发起、通过与驳回三个动作，而「草稿」「自检」「整改重提」
 * 是流程里独立的三步。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { tenantWriteGuard } = require('../../middlewares/tenantGuard')
const { uploadAny } = require('../../middlewares/upload')
const controller = require('../../controllers/acceptance.controller')
const esignController = require('../../controllers/esign.controller')

const projectRouter = express.Router()
projectRouter.use(requireMini)
projectRouter.use('/:id', tenantWriteGuard({ resource: 'project' }))
projectRouter.post('/:id/acceptances', uploadAny, asyncHandler(controller.create))
projectRouter.get('/:id/acceptances', asyncHandler(controller.list))

const acceptanceRouter = express.Router()

// 报告下载放在鉴权之前：AC-A20 要求「带签名的临时 URL」可被**转发**，
// 因此它不能要求登录态。签名校验在 controller 里做
acceptanceRouter.get('/:id/report.pdf', asyncHandler(controller.downloadPdf))

// 证据报告下载放在鉴权之前：链接本身带短时 HMAC，由详情接口按需签发
acceptanceRouter.get('/:id/esign/evidence', asyncHandler(esignController.downloadEvidence))

acceptanceRouter.use(requireMini)
// 跨项目收件箱：验收 tab 的默认视图。必须在 `/:id` 之前定义，
// 否则 `GET /acceptances` 会被当成 id 为空的详情请求
acceptanceRouter.get('/', asyncHandler(controller.inbox))
// `:id` 是验收单 id；PDF 下载是 GET，不受只读守卫影响
acceptanceRouter.use('/:id', tenantWriteGuard({ resource: 'acceptance' }))
acceptanceRouter.get('/:id', asyncHandler(controller.detail))
acceptanceRouter.get('/:id/flow', asyncHandler(controller.flow))
acceptanceRouter.put('/:id', asyncHandler(controller.saveDraft))
acceptanceRouter.post('/:id/self-check', asyncHandler(controller.selfCheck))
acceptanceRouter.post('/:id/approve', uploadAny, asyncHandler(controller.approve))
acceptanceRouter.post('/:id/reject', uploadAny, asyncHandler(controller.reject))
acceptanceRouter.post('/:id/resubmit', asyncHandler(controller.resubmit))
acceptanceRouter.post('/:id/report/retry', asyncHandler(controller.retryPdf))
acceptanceRouter.post('/:id/esign', asyncHandler(esignController.create))
acceptanceRouter.get('/:id/esign', asyncHandler(esignController.status))
acceptanceRouter.post('/:id/esign/sync', asyncHandler(esignController.sync))
acceptanceRouter.post('/:id/esign/cancel', asyncHandler(esignController.cancel))
acceptanceRouter.get('/:id/esign/document', asyncHandler(esignController.downloadDocument))

module.exports = { projectRouter, acceptanceRouter }
