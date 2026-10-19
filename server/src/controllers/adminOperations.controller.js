'use strict'

/**
 * B 端批量操作、导出与管理员消息控制器（B-2.13 / B-2.14 / AC-AD60 / AC-AD61）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const projectBatchService = require('../services/projectBatch.service')
const exportService = require('../services/export.service')
const adminNotificationService = require('../services/adminNotification.service')

const projectIdsField = z
  .array(z.number().int().positive())
  .min(1, '请至少选择一个项目')
  .max(projectBatchService.MAX_BATCH_SIZE, `单次最多 ${projectBatchService.MAX_BATCH_SIZE} 个项目`)

const batchAssignSchema = z.object({
  projectIds: projectIdsField,
  phone: z.string().trim().min(1, '请输入工长手机号').max(20),
})

const batchArchiveSchema = z.object({
  projectIds: projectIdsField,
  confirm: z.boolean().optional().default(false),
})

const exportQuerySchema = z.object({
  name: z.string().trim().max(50).optional(),
  address: z.string().trim().max(200).optional(),
  status: z.enum(['pending', 'building', 'finished', 'archived']).optional(),
  foremanId: z.coerce.number().int().positive().optional(),
})

const notificationQuerySchema = z.object({
  onlyUnread: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
})

const markReadSchema = z.object({
  // 不传 ids 表示全部已读
  ids: z.array(z.number().int().positive()).max(500).optional(),
})

/** POST /admin/projects/batch/assign —— 批量分配工长（B-2.13） */
async function batchAssign(req, res) {
  const input = validate(batchAssignSchema, req.body)
  res.ok(await projectBatchService.batchAssignForeman(req.auth, input))
}

/** POST /admin/projects/batch/archive —— 批量归档（B-2.13） */
async function batchArchive(req, res) {
  const input = validate(batchArchiveSchema, req.body)
  res.ok(await projectBatchService.batchArchive(req.auth, input))
}

/**
 * GET /admin/projects/export —— 导出项目列表（B-2.14 / AC-AD61）。
 *
 * 小数据量直接返回 xlsx 文件流；大数据量转异步并返回 202，
 * 让前端知道「不是失败了，是还在生成」。
 */
async function exportProjects(req, res) {
  const filters = validate(exportQuerySchema, req.query)

  const result = await exportService.start(req.auth, filters, { username: req.auth.username })

  if (result.mode === 'sync') {
    res.setHeader('Content-Type', exportService.XLSX_MIME)
    // attachment 而不是 inline：xlsx 在浏览器里没法内联展示，只会触发下载
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.filename)}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
    )
    return res.send(result.buffer)
  }

  // 202 Accepted：请求已被接受，但处理尚未完成 —— 语义上比 200 准确
  return res.status(202).json({
    code: 0,
    message: '数据量较大，正在后台生成，完成后会通知你',
    data: { mode: 'async', taskId: result.taskId, total: result.total },
  })
}

/** GET /admin/exports —— 我的导出任务 */
async function listExports(req, res) {
  const result = await exportService.listTasks(req.auth, { paging: parsePaging(req.query) })
  res.page(result.list, result.total, { page: result.page, pageSize: result.pageSize })
}

/** GET /admin/exports/:id/download */
async function downloadExport(req, res) {
  const { buffer, mime, filename } = await exportService.download(req.auth, Number(req.params.id))

  res.setHeader('Content-Type', mime)
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  )
  res.send(buffer)
}

/** GET /admin/notifications —— 管理员消息列表 */
async function listNotifications(req, res) {
  const query = validate(notificationQuerySchema, req.query)
  const result = await adminNotificationService.list(req.auth.id, req.auth.tenantId, {
    ...query,
    paging: parsePaging(req.query),
  })
  res.ok(result)
}

/** POST /admin/notifications/read —— 标记已读（传 ids 则只标这些） */
async function markNotificationsRead(req, res) {
  const input = validate(markReadSchema, req.body)
  res.ok(await adminNotificationService.markRead(req.auth.id, input.ids))
}

module.exports = {
  batchAssign,
  batchArchive,
  exportProjects,
  listExports,
  downloadExport,
  listNotifications,
  markNotificationsRead,
}
