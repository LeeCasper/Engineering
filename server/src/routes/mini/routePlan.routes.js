'use strict'

/**
 * C 端考察计划路由（§7.3）。
 *
 * 只挂在 C 端：管理员 token 的 audience 是 admin，在 requireMini 就被拒绝，
 * 因此不会出现「管理员用后台身份规划工长路线」的入口（AC-N15）。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const { requireMini } = require('../../middlewares/miniAuth')
const controller = require('../../controllers/routePlan.controller')

const router = express.Router()

router.use(requireMini)

// /preview 必须放在 /:id 之前声明；虽然方法不同不会冲突，
// 但显式顺序能避免后续有人把 GET /preview 加进来时被通配吞掉
router.post('/preview', asyncHandler(controller.preview))
router.post('/', asyncHandler(controller.save))
router.get('/', asyncHandler(controller.list))
router.get('/:id', asyncHandler(controller.detail))
router.delete('/:id', asyncHandler(controller.remove))

module.exports = router
