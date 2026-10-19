'use strict'

/**
 * C 端门锁密码路由（§4.8 / AC-K01 ~ AC-K16）。
 *
 * 与 report / acceptance 同样导出两个 router：
 *   projectRouter 挂 `/projects`（`/:id/door-codes` 与 `.../access-log`）
 *   codeRouter    挂 `/door-codes`（`/:id`、`/:id/revoke`）
 *
 * §7.3 就是这么分的：列表关心「某项目的密码」，改动关心「某条密码」。
 *
 * ── 全部挂在 requireMini 之下，没有 B 端版本 ──
 * §4.8.2 的权限表里，超级管理员与项目管理员的「新增/修改/失效」与
 * 「查看」四栏**全是 ❌**。这意味着本模块在后台上没有对应接口 ——
 * 不是「还没做」，是**刻意不做**：后台管理员负责建档与配置，
 * 没有任何业务理由需要知道业主家的门锁密码。
 * 给他开这个口子，等于把平台内部人员也纳入泄露面。
 *
 * 因此 AC-K02「后台管理员查看返回 403」在这里的表现是 **401**：
 * 后台 token 的 audience 与 C 端不同，在 `requireMini` 就被拒了 ——
 * 请求根本没走到业务代码。这比 403 更强，详见 tests/integration/doorCode.test.js。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { tenantWriteGuard } = require('../../middlewares/tenantGuard')
const controller = require('../../controllers/doorCode.controller')

const projectRouter = express.Router()
projectRouter.use(requireMini)
projectRouter.use('/:id', tenantWriteGuard({ resource: 'project' }))
// 静态段写在前面，避免将来新增 `/:codeId` 时把 access-log 当成一个 id
projectRouter.get('/:id/door-codes/access-log', asyncHandler(controller.accessLog))
projectRouter.get('/:id/door-codes', asyncHandler(controller.list))
projectRouter.post('/:id/door-codes', asyncHandler(controller.create))

const codeRouter = express.Router()
codeRouter.use(requireMini)
// `:id` 是密码条目 id；读取（GET）不受只读守卫影响，
// 租户停用后业主仍然可以查看已存的密码 —— 那是「读」不是「改」
codeRouter.use('/:id', tenantWriteGuard({ resource: 'project_door_code' }))
codeRouter.put('/:id', asyncHandler(controller.update))
codeRouter.post('/:id/revoke', asyncHandler(controller.revoke))

module.exports = { projectRouter, codeRouter }
