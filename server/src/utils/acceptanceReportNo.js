'use strict'

/**
 * 验收报告编号（迁移 034）。
 *
 * 旧编号是 `AC-{验收单 id}`（AC-000004），看不出日期与项目；
 * 新编号把「验收通过日 + 项目 + 验收单」拼在一起：
 *
 *   AC-20261105-8092-000040
 *   └┬┘ └──┬───┘ └┬─┘ └──┬──┘
 *   前缀  通过日期  项目   验收单 id（6 位）
 *
 * 规则：
 * - 日期取 `finished_at`（通过时间），同一份验收单重试生成时编号不变；
 *   没有通过时间时依次回落到提交时间、创建时间；
 * - 项目 id 让离开系统后的 PDF 仍能看出属于哪个项目；
 * - PDF 渲染与列表接口必须调用同一个函数，App 显示的编号才能和 PDF 对上；
 * - 已生成的旧报告在迁移里回填为旧编号，这里不负责改写历史。
 */

const datetime = require('./datetime')

function buildAcceptanceReportNo(acceptance) {
  if (!acceptance || !acceptance.id) return null

  const projectId = acceptance.project_id ?? acceptance.projectId
  const dateText = datetime.formatDate(
    acceptance.finished_at || acceptance.submitted_at || acceptance.created_at
  )
  const date = dateText ? dateText.replace(/-/g, '') : datetime.now().format('YYYYMMDD')
  const id = String(acceptance.id).padStart(6, '0')

  return projectId ? `AC-${date}-${projectId}-${id}` : `AC-${date}-${id}`
}

module.exports = { buildAcceptanceReportNo }
