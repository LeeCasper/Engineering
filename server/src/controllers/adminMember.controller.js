'use strict'

/**
 * B 端成员目录控制器（管理端「成员」tab）。
 *
 * 这里只提供跨项目的只读聚合；邀请、改指主工长、移除仍走
 * /admin/projects/:id/members，避免出现「不知道项目 id 怎么改成员」的第二套写接口。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const projectMemberService = require('../services/projectMember.service')

const listQuerySchema = z.object({
  keyword: z.string().trim().max(50, '搜索关键词不超过 50 字').optional(),
  role: z.enum(['foreman', 'supervisor', 'owner']).optional(),
  projectId: z.coerce.number().int().positive().optional(),
})

/** GET /admin/members —— 跨项目成员目录 */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const paging = parsePaging(req.query)

  const result = await projectMemberService.listMemberDirectory(req.auth, {
    ...query,
    paging,
  })

  res.page(result.list, result.total, paging, { roleCounts: result.roleCounts })
}

module.exports = { list }
