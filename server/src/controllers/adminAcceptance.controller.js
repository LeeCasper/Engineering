'use strict'

/**
 * 后台验收报告查询控制器（B 端只读）。
 */

const service = require('../services/adminAcceptance.service')

/** GET /admin/projects/:id/acceptances */
async function list(req, res) {
  res.ok(await service.list(req.auth, Number(req.params.id)))
}

module.exports = { list }
