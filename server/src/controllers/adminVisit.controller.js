'use strict'

/**
 * B 端考察统计与项目签到阈值控制器（B-4.6 / B-5.1）。
 *
 * 两个能力放在同一个控制器里，是因为它们回答的是同一个业务问题：
 * 「这个项目 / 这组项目的现场考察做得怎么样」。统计读的是签到记录，
 * 阈值决定这些记录当时按什么标准判正常 / 异常。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const projectAccess = require('../services/projectAccess.service')
const visitStatsService = require('../services/visitStats.service')
const sysConfigService = require('../services/sysConfig.service')

/** 阈值配置项固定为签到的距离阈值（B-5.1）。项目级目前只开放这一项 */
const THRESHOLD_KEY = 'sign_in_distance_threshold'

/**
 * 统计筛选。
 *
 * 日期只校验格式，区间是否合法（结束早于开始、是不是真实日期）在 service 里判 ——
 * 「2026-02-30」能过正则但不代表存在，这是 dateField 在项目模块里已经踩过的点。
 */
const statsQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '开始日期格式应为 YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '结束日期格式应为 YYYY-MM-DD').optional(),
  // 签到人 id。字段名沿用需求里的「工长」，但统计里也包含监理 ——
  // 现场考察本来就不只有工长会做，硬过滤掉监理会让覆盖率和实际对不上
  foremanId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
})

/** PUT /admin/projects/:id/visit-threshold 的请求体 */
const thresholdSchema = z.object({
  // 与全局配置接口一致：字符串进、服务端按注册表校验区间
  value: z.union([z.string().max(20), z.number()]).transform((v) => String(v)),
})

/** GET /admin/visit-stats —— 考察统计（B-4.6） */
async function stats(req, res) {
  const filters = validate(statsQuerySchema, req.query)
  const result = await visitStatsService.getStats(req.auth, filters, { paging: parsePaging(req.query) })
  res.page(result.list, result.total, { page: result.page, pageSize: result.pageSize }, result)
}

/** GET /admin/visit-stats/export —— 导出考察明细（B-4.6） */
async function exportStats(req, res) {
  const filters = validate(statsQuerySchema, req.query)
  const result = await visitStatsService.exportStats(req.auth, filters, {
    generatedBy: req.auth.username,
  })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  // attachment + 双写文件名：中文名在老浏览器里需要 filename* 才不乱码
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(result.filename)}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
  )
  res.send(result.buffer)
}

/**
 * GET /admin/projects/:id/visit-threshold —— 项目阈值配置回显（B-5.1）
 *
 * 读对所有后台账号开放（§5.5「所有后台账号都能查看生效值」），
 * 项目管理员看不到的话，遇到「为什么这个项目按 300 米判」只能去问租户管理员。
 */
async function getProjectThreshold(req, res) {
  const project = await projectAccess.load(req.auth, Number(req.params.id))
  const config = await sysConfigService.describeProject(project.id, project.tenant_id, THRESHOLD_KEY)
  res.ok({ ...config, projectId: Number(project.id), projectName: project.name })
}

/**
 * PUT /admin/projects/:id/visit-threshold —— 设置项目级覆盖（B-5.1）
 *
 * 写权限在 service 里收口到「本租户 owner」；这里先过项目可达性与归档只读，
 * 避免对不存在 / 已归档的项目写出一行永远用不上的配置。
 */
async function updateProjectThreshold(req, res) {
  const input = validate(thresholdSchema, req.body)
  const project = await projectAccess.load(req.auth, Number(req.params.id), { requireWritable: true })
  const result = await sysConfigService.updateProject(req.auth, project, THRESHOLD_KEY, input.value)
  res.ok({ ...result, projectId: Number(project.id), projectName: project.name })
}

/** DELETE /admin/projects/:id/visit-threshold —— 清除覆盖，回到全局值（B-5.1） */
async function resetProjectThreshold(req, res) {
  const project = await projectAccess.load(req.auth, Number(req.params.id), { requireWritable: true })
  const result = await sysConfigService.resetProject(req.auth, project, THRESHOLD_KEY)
  res.ok({ ...result, projectId: Number(project.id), projectName: project.name })
}

module.exports = {
  THRESHOLD_KEY,
  stats,
  exportStats,
  getProjectThreshold,
  updateProjectThreshold,
  resetProjectThreshold,
}
