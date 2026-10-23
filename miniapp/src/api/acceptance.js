import { request, uploadFile } from './request'

/** 跨项目验收收件箱（验收 tab）：items + 四类 counts + projects */
export function fetchAcceptanceInbox() {
  return request({ url: '/acceptances' })
}

/** 验收单详情：验收项、照片、流转记录、报告状态、myActions */
export function fetchAcceptanceDetail(id) {
  return request({ url: `/acceptances/${id}` })
}

/** 某项目的阶段推进（阶段梯子 / 「查看阶段」） */
export function fetchProjectStages(projectId) {
  return request({ url: `/projects/${projectId}/stages` })
}

/**
 * 发起验收。有现场照片时走 multipart；没有照片时走 JSON。
 * 表单字段必须是字符串，multipart 不接受对象。
 */
export function createAcceptance(projectId, { stageId, description = '' }, photoPath = '') {
  if (photoPath) {
    return uploadFile({
      url: `/projects/${projectId}/acceptances`,
      filePath: photoPath,
      name: 'photos',
      formData: { stageId: String(stageId), description },
    })
  }

  return request({
    url: `/projects/${projectId}/acceptances`,
    method: 'POST',
    data: { stageId, description: description || undefined },
  })
}

/** 保存草稿 */
export function saveAcceptanceDraft(id, data) {
  return request({ url: `/acceptances/${id}`, method: 'PUT', data })
}

/** 提交自检 */
export function submitSelfCheck(id, data) {
  return request({ url: `/acceptances/${id}/self-check`, method: 'POST', data })
}

/** 整改后重新提交 */
export function resubmitAcceptance(id, data) {
  return request({ url: `/acceptances/${id}/resubmit`, method: 'POST', data })
}

/** 监理通过（不需要签名） */
export function approveAcceptance(id) {
  return request({ url: `/acceptances/${id}/approve`, method: 'POST' })
}

/** 业主通过并签名：signature 字段名是后端约定的，不能改 */
export function approveAcceptanceWithSignature(id, filePath) {
  return uploadFile({
    url: `/acceptances/${id}/approve`,
    filePath,
    name: 'signature',
  })
}

/** 驳回：原因必填；有凭证照片时走 multipart */
export function rejectAcceptance(id, reason, photoPath = '') {
  if (photoPath) {
    return uploadFile({
      url: `/acceptances/${id}/reject`,
      filePath: photoPath,
      name: 'photos',
      formData: { reason },
    })
  }

  return request({
    url: `/acceptances/${id}/reject`,
    method: 'POST',
    data: { reason },
  })
}

/** 验收报告 PDF 生成失败后重试 */
export function retryAcceptanceReport(id) {
  return request({ url: `/acceptances/${id}/report/retry`, method: 'POST' })
}
