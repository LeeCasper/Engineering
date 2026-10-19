'use strict'

/**
 * C 端记账路由（§7.3）。
 *
 * ── 路由注册顺序很重要 ──
 * `/projects/:id/ledger/summary` 必须**早于** `/projects/:id/ledger/:ledgerId`，
 * 否则 Express 会把 `summary` 当成 `ledgerId` 匹配进去 ——
 * 表现为「查询总览接口返回 404 流水不存在」，而且只在特定写法下复现，很难查。
 * 同理 `expense-breakdown` 也要排在 `:ledgerId` 之前。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const { tenantWriteGuard } = require('../../middlewares/tenantGuard')
const { uploadAny } = require('../../middlewares/upload')
const controller = require('../../controllers/ledger.controller')

const router = express.Router()
router.use(requireMini)
router.use('/:id', tenantWriteGuard({ resource: 'project' }))

// ── 固定路径段必须排在参数段之前 ──
router.get('/:id/ledger/summary', asyncHandler(controller.summary))
router.get('/:id/ledger/expense-breakdown', asyncHandler(controller.breakdown))
router.get('/:id/stages/ledger', asyncHandler(controller.stageLedger))

router.get('/:id/ledger', asyncHandler(controller.list))
router.post('/:id/ledger', uploadAny, asyncHandler(controller.create))

router.get('/:id/ledger/:ledgerId', asyncHandler(controller.detail))
router.put('/:id/ledger/:ledgerId', asyncHandler(controller.update))
router.delete('/:id/ledger/:ledgerId', asyncHandler(controller.remove))
router.post('/:id/ledger/:ledgerId/reverse', asyncHandler(controller.reverse))

router.get('/:id/payment-nodes', asyncHandler(controller.paymentNodes))
router.post('/:id/payment-nodes/:nodeId/pay', asyncHandler(controller.payNode))
router.post('/:id/payment-nodes/:nodeId/confirm', asyncHandler(controller.confirmNode))

module.exports = router
