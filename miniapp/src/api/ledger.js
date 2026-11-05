import { request, uploadFile } from './request'

/**
 * C 端记账接口（C-4.x）。
 *
 * 汇总、流水、支出构成、阶段账目都要求「业主 / 工长」身份；监理会被后端 403。
 * 金额一律是 DECIMAL 字符串，前端只负责格式化，不参与运算。
 */

/** 账目总览（C-4.1）：合同额、已收、已支、待收、结余 */
export function fetchLedgerSummary(projectId) {
  return request({ url: `/projects/${projectId}/ledger/summary` })
}

/** 流水列表（C-4.2），后端强制分页 */
export function fetchLedgerEntries(projectId, { page = 1, pageSize = 20, type, category, stageId } = {}) {
  const params = [`page=${page}`, `pageSize=${pageSize}`]
  if (type) params.push(`type=${type}`)
  if (category) params.push(`category=${category}`)
  if (stageId) params.push(`stageId=${stageId}`)
  return request({ url: `/projects/${projectId}/ledger?${params.join('&')}` })
}

/**
 * 新增流水（C-4.3 / C-4.4，仅工长）。
 *
 * 后端这个接口走 multipart（要带票据照片），字段在 `formData` 里都是字符串。
 * 有票据时用 `uploadFile` 一次带一个文件；没有票据时用普通 JSON 请求。
 * 微信 `uni.uploadFile` 一次只能带一个文件，因此当前 UI 只提供 1 张票据。
 */
export function createLedgerEntry(projectId, data, receiptPath) {
  if (!receiptPath) {
    return request({ url: `/projects/${projectId}/ledger`, method: 'POST', data })
  }

  const formData = {}
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== '') formData[key] = String(value)
  }

  return uploadFile({
    url: `/projects/${projectId}/ledger`,
    filePath: receiptPath,
    name: 'receipt',
    formData,
  })
}

/** 工长发起周期对账（AC-L19，仅工长） */
export function initiateReconciliation(projectId, { periodStart, periodEnd, remark }) {
  return request({
    url: `/projects/${projectId}/reconciliations`,
    method: 'POST',
    data: {
      periodStart,
      periodEnd,
      remark: remark || undefined,
    },
  })
}

/** 支出构成（C-4.5）：按分类汇总 */
export function fetchExpenseBreakdown(projectId) {
  return request({ url: `/projects/${projectId}/ledger/expense-breakdown` })
}

/** 阶段账目（C-4.12）：每个阶段的应收 / 已收 / 支出 / 结余 */
export function fetchStageLedger(projectId) {
  return request({ url: `/projects/${projectId}/stages/ledger` })
}

/** 对账单列表（AC-L22）：同时返回阶段结算单与周期对账单 */
export function fetchReconciliations(projectId) {
  return request({ url: `/projects/${projectId}/reconciliations` })
}

/** 阶段结算单（C-7.5，不存在时后端自动生成草稿） */
export function fetchStageSettlement(projectId, stageId) {
  return request({ url: `/projects/${projectId}/stages/${stageId}/settlement` })
}

/** 主工长提交阶段结算单（C-7.6） */
export function submitStageSettlement(projectId, stageId, { remark } = {}) {
  return request({
    url: `/projects/${projectId}/stages/${stageId}/settlement/submit`,
    method: 'POST',
    data: { remark: remark || undefined },
  })
}

/** 对账单详情：明细、异议与结算单下载路径 */
export function fetchReconciliationDetail(id) {
  return request({ url: `/reconciliations/${id}` })
}

/** 业主确认对账（AC-L20）。确认后相关流水锁定 */
export function confirmReconciliation(id) {
  return request({ url: `/reconciliations/${id}/confirm`, method: 'POST' })
}

/** 业主对某条明细提出异议（AC-L21），说明必填 */
export function disputeReconciliation(id, { detailId, remark }) {
  return request({
    url: `/reconciliations/${id}/dispute`,
    method: 'POST',
    data: { detailId, remark },
  })
}
