'use strict'

/**
 * C 端现场签到路由（§4.6 / §7.3）。
 *
 * `/projects/:id/visits` 与 `/visits/:id` 分两个 router，与汇报 / 验收的模式一致：
 * 前者以项目为主语，后者以签到记录为主语。
 *
 * 没有任何 PUT / PATCH / DELETE 路由 —— AC-N26 要求签到记录对任何角色只读，
 * 而 `visitRecord.model.js` 也不导出 update / delete。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { tenantWriteGuard } = require('../../middlewares/tenantGuard')
const { uploadAny } = require('../../middlewares/upload')
const controller = require('../../controllers/visit.controller')

const projectRouter = express.Router()
projectRouter.use(requireMini)
// 租户停用 / 到期后 C 端只读；GET 不受影响
projectRouter.use('/:id', tenantWriteGuard({ resource: 'project' }))

// meta 是只读引导接口，必须放在列表之前声明（路径不冲突，但阅读顺序更清楚）
projectRouter.get('/:id/visits/meta', asyncHandler(controller.meta))
// 单文件暂存：小程序一次只能传一张，逐张拿到 mediaId 后再提交
projectRouter.post('/:id/visits/media', uploadAny, asyncHandler(controller.stageMedia))
projectRouter.post('/:id/visits', asyncHandler(controller.submit))
projectRouter.get('/:id/visits', asyncHandler(controller.list))

const visitRouter = express.Router()
visitRouter.use(requireMini)
// 只读接口，不需要 tenantWriteGuard；成员关系在 service 里按 project_id 校验
visitRouter.get('/:id', asyncHandler(controller.detail))

module.exports = { projectRouter, visitRouter }
