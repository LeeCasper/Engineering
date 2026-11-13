'use strict'

/**
 * 后台验收报告查询控制器（B 端只读）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const service = require('../services/adminAcceptance.service')

/**
 * 列表筛选。
 *
 * 这三个筛选此前由后台前端在拿到全量数据后本地过滤，下沉到服务端后
 * 分页才是真正的分页（AC-AD45）—— 否则「第 2 页」只是全量结果里的第 21~40 条。
 */
const listQuerySchema = z.object({
  status: z.enum(['passed', 'pending', 'rectify']).optional(),
  type: z.enum(['stage', 'item']).optional(),
  keyword: z.string().trim().max(100, '搜索关键词过长').optional(),
})

/** GET /admin/projects/:id/acceptances */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const paging = parsePaging(req.query)

  const result = await service.list(req.auth, Number(req.params.id), {
    filters: query,
    paging,
  })

  // 摘要随列表一起返回；它是项目全量统计，不受 status / type / keyword 影响
  res.page(result.list, result.total, paging, { summary: result.summary })
}

module.exports = { list }
