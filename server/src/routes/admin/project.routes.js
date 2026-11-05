'use strict'

/**
 * B 端项目路由（挂载于 /api/v1/admin/projects）。
 *
 * 全部要求登录态。数据权限（AC-AD52）在 service 层通过统一的 dataScope 施加 ——
 * 每个 service 方法都会先按 scope 把项目查出来，查不到就是 404/403，
 * 因此这里不需要再挂一层项目级鉴权中间件。
 * 这一点的代价是：新增 service 方法时**必须**用 findByIdScoped 而不是
 * findByIdUnscoped，否则就会绕过数据权限。findByIdUnscoped 的命名就是为此。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireAdmin, requireTenant } = require('../../middlewares/adminAuth')
const { uploadAny } = require('../../middlewares/upload')
const controller = require('../../controllers/adminProject.controller')
const structure = require('../../controllers/adminStructure.controller')
const operations = require('../../controllers/adminOperations.controller')
const completionReport = require('../../controllers/projectCompletionReport.controller')
const acceptance = require('../../controllers/adminAcceptance.controller')

const router = express.Router()

router.use(requireAdmin, requireTenant)

router.get('/', asyncHandler(controller.list))
// 固定路径段必须排在 /:id 之前，否则会被当成项目 id
router.get('/stats', asyncHandler(controller.stats))
// 封面先上传再随创建 / 编辑提交 coverUrl；同样必须先于 /:id
router.post('/cover', uploadAny, asyncHandler(controller.uploadCover))
router.post('/', asyncHandler(controller.create))

// ── 固定路径段必须排在 /:id 之前 ──
// 否则 `/projects/batch/assign` 会被 `/:id` 抢先匹配，`batch` 被当成项目 id ——
// 表现为「批量接口返回 400 参数错误」或「找不到项目 batch」，
// 而且只在特定写法下复现，很难查（同 CLAUDE.md 第 47 条那类顺序问题）
router.post('/batch/assign', asyncHandler(operations.batchAssign))
router.post('/batch/archive', asyncHandler(operations.batchArchive))
router.get('/export', asyncHandler(operations.exportProjects))

router.get('/:id', asyncHandler(controller.detail))
router.put('/:id', asyncHandler(controller.update))
router.put('/:id/coordinates', asyncHandler(controller.setCoordinates))
router.put('/:id/status', asyncHandler(controller.changeStatus))

router.post('/:id/archive', asyncHandler(controller.archive))
router.post('/:id/restore', asyncHandler(controller.restore))
// 删除是软删除，仅超级管理员可操作（AC-AD26），角色校验在 service 层
router.delete('/:id', asyncHandler(controller.remove))

// 竣工总报告：后台可查看/生成，下载使用接口返回的签名链接
router.get('/:id/completion-report', asyncHandler(completionReport.adminState))
router.post('/:id/completion-report', asyncHandler(completionReport.adminGenerate))

// 验收报告查询：后台只读，数据权限与项目详情一致
router.get('/:id/acceptances', asyncHandler(acceptance.list))

router.get('/:id/members', asyncHandler(controller.listMembers))
router.post('/:id/members', asyncHandler(controller.inviteMember))
// 主工长改指（Q11）：无请求体，与成员的其他操作分开，避免被误当成一次「新增」
router.put('/:id/members/:memberId/primary', asyncHandler(controller.setPrimaryForeman))
router.delete('/:id/members/:memberId', asyncHandler(controller.removeMember))

router.get('/:id/payment-nodes', asyncHandler(controller.listPaymentNodes))
router.put('/:id/payment-nodes', asyncHandler(controller.replacePaymentNodes))

// 阶段与工序的手工增删改（B-2.5 / B-2.9）。项目阶段/工序是模板的实例副本，
// 改动不影响源模板（AC-AD16）
router.post('/:id/stages', asyncHandler(structure.addStage))
router.put('/:id/stages/:stageId', asyncHandler(structure.updateStage))
router.delete('/:id/stages/:stageId', asyncHandler(structure.deleteStage))

// AC-L15：手动触发型的付款节点由管理员手工解锁。
// 关联阶段验收的节点走不通这条路 —— 那会绕过验收这道关（见 ledger.service 的校验）
router.post('/:id/payment-nodes/:nodeId/unlock', asyncHandler(controller.unlockPaymentNode))

router.post('/:id/stages/:stageId/items', asyncHandler(structure.addItem))
// 工序用 /items/:itemId 而不是嵌在 stages 下：工序 id 全局唯一，
// 多带一层 stageId 只会在两者不一致时制造「该信哪个」的歧义
router.put('/:id/items/:itemId', asyncHandler(structure.updateItem))
router.delete('/:id/items/:itemId', asyncHandler(structure.deleteItem))

module.exports = router
