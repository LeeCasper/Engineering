'use strict'

/**
 * C 端汇报与评论路由。
 *
 * `/projects/:id/reports` 与 `/reports/:id/comments` 照搬 §7.3；
 * `GET /reports/:id/comments` 是按 C-2.6 的记录流需要补的
 * （详情页要能单独拉评论，不必重拉整条汇报）。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { tenantWriteGuard } = require('../../middlewares/tenantGuard')
const { uploadAny } = require('../../middlewares/upload')
const controller = require('../../controllers/report.controller')

/**
 * 两条挂载路径共用同一组 handler，因此导出两个 router：
 *   projectRouter 挂在 /projects 下（含 `/:id/reports`）
 *   reportRouter  挂在 /reports 下（含 `/:id/comments`）
 */
const projectRouter = express.Router()
projectRouter.use(requireMini)
projectRouter.use('/:id', tenantWriteGuard({ resource: 'project' }))
projectRouter.post('/:id/reports', uploadAny, asyncHandler(controller.submit))
projectRouter.get('/:id/reports', asyncHandler(controller.list))

const reportRouter = express.Router()
reportRouter.use(requireMini)
// 这里的 `:id` 是汇报 id，需要回表取 project_id
reportRouter.use('/:id', tenantWriteGuard({ resource: 'progress_report' }))
reportRouter.post('/:id/comments', asyncHandler(controller.addComment))
reportRouter.get('/:id/comments', asyncHandler(controller.listComments))

module.exports = { projectRouter, reportRouter }
