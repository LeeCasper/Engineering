'use strict'

/**
 * 项目导出（B-2.14 / AC-AD61）。
 *
 * ── 为什么分同步与异步两条路 ──
 * xlsx 生成是 CPU 密集的：一万行大约几百毫秒，再往上就会顶到网关超时 ——
 * 用户点了导出，转半分钟，最后拿到一个失败页，而且不知道该改什么。
 * 因此在行数超过阈值时改为：落一条任务 → 立即返回「已开始生成」→
 * 后台生成完成后发一条管理员消息，消息里带下载入口。
 *
 * ── 异步任务的两个必须处理好的点 ──
 * 1. **下载只能给发起人**：导出的是项目列表，含合同金额。
 *    按 §5.1 的数据权限，别人的导出文件不该被同一个后台的另一个管理员取走。
 * 2. **进程重启会让任务永远停在 running**：进程内异步没有队列的持久化能力。
 *    冷启动时把滞留的任务标记为失败，让发起人看到「请重试」而不是无限等待。
 *    真要可靠就得引入消息队列 —— 那是另一个量级的复杂度，当前规模不值当。
 */

const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const storage = require('../storage')
const logger = require('../utils/logger')
const adminNotification = require('./adminNotification.service')
const projectBatch = require('./projectBatch.service')
const adminNotificationModel = require('../models/adminNotification.model')
const db = require('../db/pool')

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * 发起导出。
 *
 * @returns {Promise<{mode: 'sync'|'async', buffer?: Buffer, filename?: string, taskId?: number, total: number}>}
 */
async function start(operator, filters, { username } = {}) {
  const plan = await projectBatch.planExport(operator, filters)

  if (plan.total === 0) {
    // 零行导出没有意义，且用户多半是筛选条件写错了 ——
    // 让他直接改条件，比给他一个只有表头的空文件有用
    throw AppError.conflict('当前筛选条件下没有可导出的项目')
  }

  if (plan.mode === 'sync') {
    const rows = await projectBatch.fetchExportRows(operator, filters, { limit: projectBatch.SYNC_ROW_LIMIT })
    const buffer = await projectBatch.buildWorkbook(rows, { generatedBy: username })
    return {
      mode: 'sync',
      buffer,
      filename: `项目列表_${datetime.format().replace(/[-: ]/g, '')}.xlsx`,
      total: rows.length,
    }
  }

  const taskId = await adminNotificationModel.createExportTask({ tenantId: operator.tenantId, createdBy: operator.id, filters })
  // 后台执行，不阻塞响应。**必须 catch** —— 未处理的 rejection 会让进程退出
  runTask(taskId, operator, filters, { username }).catch((err) => {
    logger.error('导出任务执行异常', { taskId, err })
  })

  return { mode: 'async', taskId, total: plan.total }
}

/**
 * 执行导出任务。
 *
 * 整个过程不抛错到调用方：失败要落到 `export_task.status = 'failed'`，
 * 让发起人能看到原因，而不是在日志里。
 */
async function runTask(taskId, operator, filters, { username } = {}) {
  await adminNotificationModel.markExportRunning(taskId)

  try {
    // 异步路径下这个上限只是「别再涨了」的护栏；
    // 真要导出十万行，应该分批或走数仓，而不是让一个 HTTP 请求等它
    const rows = await projectBatch.fetchExportRows(operator, filters, { limit: 100_000 })
    const buffer = await projectBatch.buildWorkbook(rows, { generatedBy: username })

    const saved = await storage.saveGenerated(buffer, { category: 'exports', ext: 'xlsx' })
    await adminNotificationModel.markExportSuccess(taskId, { rowCount: rows.length, fileUrl: saved.url })

    await adminNotification.notify({
      tenantId: operator.tenantId,
      adminUserId: operator.id,
      type: adminNotification.TYPES.EXPORT,
      title: '项目导出已完成',
      content: `共 ${rows.length} 条，可在「我的导出」中下载`,
      refType: 'export_task',
      refId: taskId,
    })

    return { taskId, rowCount: rows.length, url: saved.url }
  } catch (err) {
    await adminNotificationModel.markExportFailed(taskId, { error: err.message })

    await adminNotification.notify({
      tenantId: operator.tenantId,
      adminUserId: operator.id,
      type: adminNotification.TYPES.EXPORT,
      title: '项目导出失败',
      content: String(err.message || '未知错误').slice(0, 200),
      refType: 'export_task',
      refId: taskId,
    })

    logger.error('导出任务失败', { taskId, err })
    throw err
  }
}

/** 我的导出任务列表（AC-AD61 的「通知下载」在后台侧的表现形式） */
async function listTasks(operator, { paging }) {
  const { total, rows } = await adminNotificationModel.listExportTasks({
    adminUserId: operator.id,
    offset: paging.offset,
    limit: paging.limit,
  })

  return {
    list: rows.map((row) => ({
      id: row.id,
      status: row.status,
      statusLabel: { pending: '排队中', running: '生成中', success: '已完成', failed: '失败' }[row.status] || row.status,
      rowCount: row.row_count,
      // 只在成功时给下载地址，且地址本身是**相对路径** ——
      // 下载要再走一次权限校验，不能靠 URL 直接拿到文件
      downloadPath: row.status === 'success' ? `/api/v1/admin/exports/${row.id}/download` : null,
      error: row.error,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    })),
    total,
    page: paging.page,
    pageSize: paging.pageSize,
  }
}

/**
 * 下载导出文件。
 *
 * **只能下载自己发起的任务**（`created_by` 必须等于当前管理员）。
 * 导出内容含合同金额，按 §5.1 的数据权限不该被同后台的其他人取走。
 */
async function download(operator, taskId) {
  const task = await adminNotificationModel.findExportTask(taskId)
  // 不存在与不属于自己返回同一句提示，避免用 id 枚举探测别人导了什么
  if (!task || Number(task.created_by) !== Number(operator.id)) {
    throw AppError.notFound('导出任务不存在')
  }

  if (task.status !== 'success' || !task.file_url) {
    throw AppError.conflict(
      task.status === 'failed' ? `导出失败：${task.error || '未知错误'}` : '导出尚未完成，请稍后再试'
    )
  }

  const buffer = await storage.read(task.file_url)
  return { buffer, mime: XLSX_MIME, filename: `项目列表_${taskId}.xlsx` }
}

/**
 * 冷启动时清理滞留的导出任务。
 *
 * 进程内异步没有持久化能力：进程重启后，状态停在 `running` 的任务永远不会有人推进。
 * 不清理的话，发起人会一直看到一个「生成中」的任务 —— 比明确失败更糟，
 * 因为他不知道该等还是该重试。
 *
 * 由 server.js 在启动时调用，测试不调。
 */
async function sweepStaleTasks({ olderThanMinutes = 10 } = {}) {
  const cutoff = datetime.now().subtract(olderThanMinutes, 'minute').format('YYYY-MM-DD HH:mm:ss')

  const result = await db.query(
    `UPDATE export_task
        SET status = 'failed', error = '服务重启导致任务中断，请重试', finished_at = NOW()
      WHERE status IN ('pending', 'running')
        AND COALESCE(started_at, created_at) < ?
        AND deleted_at IS NULL`,
    [cutoff]
  )

  if (result.affectedRows > 0) {
    logger.warn('已清理滞留的导出任务（多因服务重启）', { count: result.affectedRows })
  }
  return result.affectedRows
}

module.exports = { XLSX_MIME, start, runTask, listTasks, download, sweepStaleTasks }
