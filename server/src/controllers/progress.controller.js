'use strict'

/**
 * C 端进度控制器。
 *
 * 注意这里**没有**「直接修改完成度」的接口：C-2.4 规定完成度是随
 * 进度汇报提交的，唯一写入口是 progress.service.applyItemProgress，
 * 由 M7 的汇报提交接口调用。单独开一个改完成度的接口会绕过汇报留痕，
 * 而留痕正是这个产品在质量争议时的价值所在。
 */

const progressService = require('../services/progress.service')

/** GET /projects/:id/stages —— 阶段工序树（AC-P02 / AC-P03） */
async function stages(req, res) {
  res.ok(await progressService.getProjectStages(req.auth.id, Number(req.params.id)))
}

/** GET /projects/:id/items/:itemId/history —— 完成度变更历史（AC-P19） */
async function itemHistory(req, res) {
  res.ok(
    await progressService.getItemHistory(req.auth.id, Number(req.params.id), Number(req.params.itemId))
  )
}

module.exports = { stages, itemHistory }
