'use strict'

/**
 * C 端项目路由。
 *
 * `/projects` 照搬 §7.3；邀请确认接口 §7.3 没有列，是按 §5.2「对方在小程序
 * 收到通知并确认」这一步补的。放在 `/invitations` 而不是 `/projects/:id/members/confirm`，
 * 因为发起确认的是被邀请人，他的视角里没有「项目」这个上下文 ——
 * 他只是收到一条邀请。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { tenantWriteGuard } = require('../../middlewares/tenantGuard')
const controller = require('../../controllers/project.controller')
const progress = require('../../controllers/progress.controller')
const profile = require('../../controllers/profile.controller')

const router = express.Router()

router.use(requireMini)
// 租户停用/到期后 C 端只读。`:id` 就是项目 id（本文件其余路由全是 GET）
router.use('/:id', tenantWriteGuard({ resource: 'project' }))

router.get('/', asyncHandler(controller.myProjects))
router.get('/:id', asyncHandler(controller.detail))

// 阶段工序树单列一个接口（§7.3）。它与项目详情的 stages 字段内容一致，
// 但进度页需要单独刷新（提交汇报后只刷时间轴，不重拉整个项目详情）
router.get('/:id/stages', asyncHandler(progress.stages))
router.get('/:id/items/:itemId/history', asyncHandler(progress.itemHistory))

// 个人中心里与项目相关的两块（C-5.5 工长统计 / C-5.6 业主联系入口）。
// 挂在项目下而不是顶层 `/my-stats`：两者都要 projectId 才能算，
// 放进路径比放进 query 更能说明「这是某个项目的视图」
router.get('/:id/my-stats', asyncHandler(profile.myStats))
router.get('/:id/contacts', asyncHandler(profile.contacts))

module.exports = router
