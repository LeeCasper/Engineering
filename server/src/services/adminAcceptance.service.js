'use strict'

/**
 * 后台验收报告查询。
 *
 * C 端的验收接口按「项目成员」鉴权；后台必须走 dataScope（AC-AD52），
 * 因此单独一个 service，而不是复用 acceptance.service 里的 C 端入口。
 *
 * 列表展示的是**验收单**，不是只有已通过的单子：草稿与流转中的单子也要
 * 让管理员看到，否则项目为什么卡住只能靠猜。报告 PDF 只对已通过且
 * 生成成功的单子签发下载链接。
 */

const signedUrl = require('../utils/signedUrl')
const { buildAcceptanceReportNo } = require('../utils/acceptanceReportNo')
const acceptanceModel = require('../models/acceptance.model')
const projectAccess = require('./projectAccess.service')

const STATUS_LABELS = {
  draft: '草稿',
  pending_supervisor: '待监理审核',
  pending_owner: '待业主确认',
  pending_rectify: '待整改',
  passed: '已通过',
}

async function list(operator, projectId) {
  // 统一数据权限校验；跨租户 / 无权项目在 projectAccess 里处理
  await projectAccess.load(operator, projectId)

  const rows = await acceptanceModel.listByProject(projectId)
  const items = rows.map((row) => {
    const passed = row.status === 'passed'
    const reportStatus = row.report_pdf_status || 'pending'

    return {
      id: row.id,
      type: row.type,
      typeLabel: row.type === 'item' ? '工序验收' : '阶段验收',
      stageId: row.project_stage_id,
      stageName: row.stage_name,
      itemId: row.project_item_id,
      itemName: row.item_name,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] || row.status,
      round: Number(row.resubmit_count || 0) + 1,
      resubmitCount: Number(row.resubmit_count || 0),
      rejectCount: Number(row.reject_count || 0),
      submitter: row.submitter_nickname || null,
      submittedAt: row.submitted_at,
      finishedAt: row.finished_at,
      hasSignature: Boolean(row.signature_url || row.signature_key) || row.esign_status === 'signed',
      signatureMode: row.signature_mode || 'legacy',
      esignStatus: row.esign_status || null,
      // 与 PDF 上印的编号一致：旧报告是回填的 AC-{id}，新报告是日期+项目+id；
      // 已通过但报告还没生成的单子也先给出编号，生成后（同一函数）不会变
      reportNo: row.report_no || (passed ? buildAcceptanceReportNo(row) : null),
      reportPdf: {
        status: reportStatus,
        error: row.report_pdf_error || null,
        // 只有已通过且生成成功才签发；签名 URL 2 小时有效
        signedPath:
          passed && reportStatus === 'success'
            ? signedUrl.buildPath({
                resource: 'acceptance-report',
                id: row.id,
                path: `/api/v1/acceptances/${row.id}/report.pdf`,
              })
            : null,
      },
    }
  })

  return {
    items,
    summary: {
      total: items.length,
      passed: items.filter((item) => item.status === 'passed').length,
      inProgress: items.filter((item) => item.status !== 'passed').length,
      reportReady: items.filter((item) => item.reportPdf.status === 'success' && item.status === 'passed').length,
    },
  }
}

module.exports = { list }
