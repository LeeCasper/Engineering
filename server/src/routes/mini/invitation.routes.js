'use strict'

/**
 * C 端项目邀请路由（§5.2 的「对方在小程序确认」）。
 *
 * 需求文档 §7.3 的接口清单里没有这一步，是按 §5.2 的邀请流程补的。
 * 路径放在 /invitations 而不是 /projects/:id/members/confirm：
 * 发起确认的是**被邀请人**，他的视角里还没有「项目」这个上下文，
 * 只知道自己收到了一条邀请。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { tenantWriteGuard } = require('../../middlewares/tenantGuard')
const controller = require('../../controllers/project.controller')

const router = express.Router()

router.use(requireMini)
// 确认/拒绝邀请都是写操作；`:memberId` 是成员关系 id，回表取项目
router.use('/:memberId', tenantWriteGuard({ resource: 'project_member', param: 'memberId' }))

router.post('/:memberId/confirm', asyncHandler(controller.confirmInvitation))
router.post('/:memberId/reject', asyncHandler(controller.rejectInvitation))

module.exports = router
