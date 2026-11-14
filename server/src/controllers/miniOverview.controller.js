'use strict'

/**
 * C 端首屏聚合控制器（BZGGCB-12）。
 *
 * 只做参数解析与响应封装；聚合与权限口径在 miniOverview.service。
 * 这两个接口是 GET，走与其它读接口相同的限流桶（BZGGCB-11 的读档）。
 */

const service = require('../services/miniOverview.service')

/** GET /projects/:id/overview —— 项目详情页首屏聚合 */
async function projectOverview(req, res) {
  res.ok(await service.getProjectOverview(req.auth.id, Number(req.params.id)))
}

/** GET /projects/:id/ledger/overview —— 记账页首屏聚合 */
async function ledgerOverview(req, res) {
  res.ok(await service.getLedgerOverview(req.auth.id, Number(req.params.id)))
}

module.exports = { projectOverview, ledgerOverview }
