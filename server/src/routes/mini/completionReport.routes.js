'use strict'

/**
 * 项目竣工总报告的公开下载路由。
 *
 * 路径是 `/completion-reports/:projectId/report.pdf`，与验收报告的
 * `/acceptances/:id/report.pdf` 保持同一套签名 URL 语义：
 * 不挂登录态，靠 HMAC + 过期时间放行，方便转发给系统外的人。
 */

const express = require('express')
const asyncHandler = require('../../utils/asyncHandler')
const controller = require('../../controllers/projectCompletionReport.controller')

const router = express.Router()

router.get('/:projectId/report.pdf', asyncHandler(controller.downloadPdf))

module.exports = router
