'use strict'

/**
 * 项目批量操作与导出（B-2.13 / B-2.14 / AC-AD60 / AC-AD61）。
 *
 * ── 批量操作的核心要求：**不许静默跳过**（AC-AD60 原文）──
 * 「批量操作对选中项全部生效；部分失败时明确列出失败项与原因，不静默跳过」。
 *
 * 因此每一条都是**独立成败**：一条失败不影响其他条，且返回体里逐条给出结果。
 * 不做「一条失败就整体回滚」—— 批量归档 20 个项目时，其中一个因为已被归档
 * 而失败，把另外 19 个也回滚掉，用户只会觉得「点了没反应」。
 *
 * 也不做「失败就静默跳过」—— 用户以为 20 个都成功了，实际只成了 19 个。
 */

const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const db = require('../db/pool')
const logger = require('../utils/logger')
const dataScope = require('./dataScope.service')
const projectAccess = require('./projectAccess.service')
const operationLog = require('./operationLog.service')
const projectMemberModel = require('../models/projectMember.model')
const userModel = require('../models/user.model')

/** 单次批量的上限。再大就该走导出/脚本，而不是一个同步 HTTP 请求 */
const MAX_BATCH_SIZE = 100

/**
 * 批量分配工长（B-2.13）。
 *
 * 逐条处理并逐条报告结果。工长的邀请走 `projectMemberModel.invite`，
 * 但**不在这里做「首个工长自动成为主工长」**的判断 —— 那段逻辑在
 * projectMember.service 里，这里若复制一份，两处迟早分叉。
 * 批量分配只按「工长」身份发起邀请。角色是账号级固定的：若该手机号
 * 已被固定为业主 / 监理，或在本项目已是其他角色，这个项目会失败并在结果里
 * 单独返回原因，不影响其他项目。
 */
async function batchAssignForeman(operator, { projectIds, phone }) {
  validateBatchInput(projectIds)

  const normalized = require('./miniAuth.service').normalizePhone(phone)
  if (!normalized) throw AppError.badRequest('手机号格式不正确')

  const results = []

  for (const projectId of projectIds) {
    try {
      await projectAccess.load(operator, projectId, { requireWritable: true })

      const memberService = require('./projectMember.service')
      const result = await memberService.invite(operator, projectId, {
        phone: normalized,
        role: 'foreman',
      })

      results.push({ projectId, ok: true, memberId: result.memberId, status: result.status })
    } catch (err) {
      results.push({ projectId, ok: false, reason: err.message || '操作失败' })
    }
  }

  return summarize(results)
}

/**
 * 批量归档（B-2.13）。
 *
 * 归档是「全链路只读」的入口，因此这里**刻意不做二次确认的跳过**：
 * 调用方（后台页面）负责弹窗确认，接口层只看 `confirm` 参数。
 * 与单个归档接口保持同一门槛 —— 两处门槛不一致，绕过确认只需换个接口（同 CLAUDE.md 第 22 条）。
 */
async function batchArchive(operator, { projectIds, confirm }) {
  validateBatchInput(projectIds)
  if (!confirm) throw AppError.badRequest('归档后项目全链路只读，请二次确认')

  const results = []

  for (const projectId of projectIds) {
    try {
      const project = await projectAccess.load(operator, projectId)
      if (project.status === 'archived') {
        results.push({ projectId, ok: false, reason: '项目已归档' })
        continue
      }

      await db.withTransaction(async (tx) => {
        // 复用与单个归档相同的写法，避免两处对 archived_at 的处理分叉
        await tx.query("UPDATE project SET status = 'archived', archived_at = NOW() WHERE id = ?", [projectId])

        await operationLog.record(
          {
            operatorType: 'admin',
            operatorId: operator.id,
            action: operationLog.ACTIONS.PROJECT_ARCHIVE,
            targetType: 'project',
            targetId: projectId,
            projectId,
            detail: { before: { status: project.status }, after: { status: 'archived', via: 'batch' } },
          },
          tx
        )
      })

      results.push({ projectId, ok: true })
    } catch (err) {
      results.push({ projectId, ok: false, reason: err.message || '操作失败' })
    }
  }

  return summarize(results)
}

function validateBatchInput(projectIds) {
  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    throw AppError.badRequest('请至少选择一个项目')
  }
  if (projectIds.length > MAX_BATCH_SIZE) {
    throw AppError.badRequest(`单次批量操作最多 ${MAX_BATCH_SIZE} 个项目，当前 ${projectIds.length} 个`)
  }
}

/**
 * 汇总逐条结果。
 *
 * 返回体里同时给出 `succeeded` / `failed` 两个数组，而不是只给一个布尔或总数 ——
 * AC-AD60 要求「明确列出失败项与原因」，前端据此高亮出问题的行。
 */
function summarize(results) {
  const succeeded = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)

  return {
    total: results.length,
    successCount: succeeded.length,
    failureCount: failed.length,
    succeeded: succeeded.map((r) => r.projectId),
    // 失败项带上原因，前端直接展示，不必再猜
    failures: failed.map((r) => ({ projectId: r.projectId, reason: r.reason })),
    results,
  }
}

/**
 * 导出项目列表为 Excel（B-2.14 / AC-AD61）。
 *
 * AC-AD61：「导出内容与当前筛选条件一致；大数据量时改为异步生成并通知下载」。
 * 因此这里分两条路：
 *   - 行数在 `SYNC_ROW_LIMIT` 以内 → 同步返回文件流（用户点一下就能下载）
 *   - 超过 → 落一条 `export_task`，后台异步生成，完成后发管理员消息
 *
 * 同步/异步的分界不是拍脑袋的：xlsx 生成是 CPU 密集的，
 * 一万行大约几百毫秒，再往上就会顶到网关超时，用户拿到的是一个失败页。
 */

/** 同步导出的行数上限。超过则转异步 */
const SYNC_ROW_LIMIT = 2000

/**
 * 估算当前筛选条件下的行数，决定走同步还是异步。
 *
 * 用 COUNT 而不是先查全部再判断长度 —— 后者恰恰是我们要避免的
 * 「把十万行拉进内存再决定要不要异步」。
 */
async function planExport(operator, filters) {
  const scope = dataScope.buildFilter(operator)
  const query = buildProjectQuery(scope, filters)
  const total = await db.count(query.clause, query.params)

  return { total, mode: total > SYNC_ROW_LIMIT ? 'async' : 'sync' }
}

/**
 * 构造导出用的查询。
 *
 * **复用与列表接口完全相同的过滤条件**（AC-AD61 要求「与当前筛选条件一致」）。
 * 若这里另写一套，导出结果与页面显示迟早对不上，
 * 而「导出和看到的不是一回事」是这类功能最容易被投诉的点。
 */
function buildProjectQuery(scope, filters = {}) {
  const projectModel = require('../models/project.model')

  const where = ['p.deleted_at IS NULL', scope.clause]
  const params = [...scope.params]

  if (filters.name) {
    where.push('p.name LIKE ?')
    params.push(`%${projectModel.escapeLike(filters.name)}%`)
  }
  if (filters.address) {
    where.push('p.address LIKE ?')
    params.push(`%${projectModel.escapeLike(filters.address)}%`)
  }
  if (filters.status) {
    where.push('p.status = ?')
    params.push(filters.status)
  }
  if (filters.foremanId) {
    where.push(`EXISTS (
      SELECT 1 FROM project_member pm
       WHERE pm.project_id = p.id AND pm.role = 'foreman'
         AND pm.status = 'active' AND pm.deleted_at IS NULL AND pm.user_id = ?
    )`)
    params.push(filters.foremanId)
  }

  return {
    clause: `FROM project p WHERE ${where.join(' AND ')}`,
    params,
    // 导出不分页：分页导出只会得到「第一页」，那不是用户要的
    orderBy: 'p.id DESC',
  }
}

/** 拉取导出数据（含工长与进度，与列表接口同口径） */
async function fetchExportRows(operator, filters, { limit } = {}) {
  const scope = dataScope.buildFilter(operator)
  const { clause, params, orderBy } = buildProjectQuery(scope, filters)

  const rows = await db.query(
    `SELECT p.id, p.name, p.address, p.status, p.area, p.contract_amount,
            p.start_date, p.plan_end_date, p.actual_end_date, p.created_at
       ${clause} ORDER BY ${orderBy} LIMIT ?`,
    [...params, limit]
  )

  if (rows.length === 0) return []

  // 工长与进度是一次批量查回再组装（与列表接口同一套，避免 N+1）
  const projectModel = require('../models/project.model')
  const progress = require('../utils/progress')
  const projectService = require('./project.service')

  const ids = rows.map((r) => r.id)
  const [members, stages] = await Promise.all([
    projectModel.listForemenOfProjects(ids),
    projectModel.listStagesOfProjects(ids),
  ])

  const membersByProject = new Map()
  for (const m of members) {
    if (!membersByProject.has(m.project_id)) membersByProject.set(m.project_id, [])
    membersByProject.get(m.project_id).push(m)
  }
  const stagesByProject = new Map()
  for (const s of stages) {
    if (!stagesByProject.has(s.project_id)) stagesByProject.set(s.project_id, [])
    stagesByProject.get(s.project_id).push(s)
  }

  return rows.map((row) => {
    const stageRows = stagesByProject.get(row.id) || []
    const foreman = (membersByProject.get(row.id) || []).find(
      (m) => m.role === 'foreman' && m.status === 'active'
    )

    return {
      ...row,
      statusLabel: projectService.STATUS_LABELS[row.status] || row.status,
      foremanName: foreman ? foreman.nickname || `用户${foreman.user_id}` : '',
      progress: progress.projectProgress(stageRows.map((s) => ({ progress: s.progress, weight: s.weight }))),
      // 延期口径与列表页、看板共用同一个函数（§5.4）
      isOverdue: projectService.isOverdue(row),
    }
  })
}

/** 列定义。表头与顺序集中在这里，同步与异步导出共用同一份 */
const EXPORT_COLUMNS = [
  { header: '项目ID', key: 'id', width: 10 },
  { header: '项目名称', key: 'name', width: 26 },
  { header: '项目地址', key: 'address', width: 40 },
  { header: '状态', key: 'statusLabel', width: 10 },
  { header: '工长', key: 'foremanName', width: 14 },
  { header: '当前进度', key: 'progress', width: 10 },
  { header: '户型面积(㎡)', key: 'area', width: 12 },
  { header: '合同金额(元)', key: 'contract_amount', width: 16 },
  { header: '开工日期', key: 'start_date', width: 14 },
  { header: '计划竣工', key: 'plan_end_date', width: 14 },
  { header: '实际竣工', key: 'actual_end_date', width: 14 },
  { header: '是否延期', key: 'isOverdue', width: 10 },
  { header: '建档时间', key: 'created_at', width: 20 },
]

/**
 * 生成 xlsx。
 *
 * 金额列写成**字符串**而不是 Number —— AC-L11 要求全链路无浮点，
 * 而 Excel 对超过 15 位的数字会丢精度。字符串形式在 Excel 里仍可排序与求和，
 * 但不会在我们这一侧引入精度问题。
 */
async function buildWorkbook(rows, { generatedBy } = {}) {
  const ExcelJS = require('exceljs')

  const workbook = new ExcelJS.Workbook()
  workbook.creator = '工程宝'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('项目列表')
  sheet.columns = EXPORT_COLUMNS.map((col) => ({ header: col.header, key: col.key, width: col.width }))

  // 表头加粗并冻结，行数多时滚动仍能看到列名
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of rows) {
    sheet.addRow({
      ...row,
      // 空值给空串而不是 null —— Excel 里 null 会显示成一片空白但排序行为怪异
      area: row.area ?? '',
      actual_end_date: row.actual_end_date ?? '',
      isOverdue: row.isOverdue ? '是' : '否',
    })
  }

  // 生成说明写在第二张表：导出的是什么时候、按什么条件导的。
  // 这份表往往会被转发给不在系统里的人，附上口径能省掉很多「这数怎么来的」的追问
  const meta = workbook.addWorksheet('导出说明')
  meta.columns = [
    { header: '项', key: 'k', width: 20 },
    { header: '值', key: 'v', width: 60 },
  ]
  meta.getRow(1).font = { bold: true }
  meta.addRow({ k: '导出时间', v: datetime.format() })
  meta.addRow({ k: '导出人', v: generatedBy || '—' })
  meta.addRow({ k: '数据行数', v: String(rows.length) })
  meta.addRow({ k: '金额口径', v: 'DECIMAL(12,2)，未经浮点运算' })
  meta.addRow({ k: '数据范围', v: '仅包含导出人有权限查看的项目（§5.1 数据权限）' })

  return workbook.xlsx.writeBuffer()
}

module.exports = {
  MAX_BATCH_SIZE,
  SYNC_ROW_LIMIT,
  EXPORT_COLUMNS,
  batchAssignForeman,
  batchArchive,
  planExport,
  fetchExportRows,
  buildWorkbook,
  buildProjectQuery,
  summarize,
}
