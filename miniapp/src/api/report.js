import { request, uploadFile } from './request'

/**
 * 单文件暂存（C-2.4 / AC-P10）。
 *
 * 微信 `uni.uploadFile` 一次只能带一个文件，而一次汇报最多 9 图 + 1 视频。
 * 先逐张上传拿到 mediaId，提交汇报时一次性消费。
 * 图片在暂存阶段就会由服务端叠加水印（时间 + 项目地址 + 工序名）。
 */
export function stageReportMedia(projectId, itemId, filePath, { duration } = {}) {
  const formData = { itemId: String(itemId) }
  if (duration !== undefined && duration !== null) {
    formData.duration = String(duration)
  }

  return uploadFile({
    url: `/projects/${projectId}/reports/media`,
    filePath,
    name: 'file',
    formData,
  })
}

/**
 * 提交进度汇报（C-2.4）。
 *
 * `progress` 必须是字符串（后端按 5% 步进校验）；`clientRequestId` 是幂等键，
 * 断网重试时必须复用同一个值。
 */
export function submitReport(projectId, payload) {
  return request({
    url: `/projects/${projectId}/reports`,
    method: 'POST',
    data: payload,
  })
}

/** 某条汇报的评论列表（C-2.8 / AC-P21） */
export function fetchReportComments(reportId) {
  return request({ url: `/reports/${reportId}/comments` })
}

/** 对某条汇报发表评论（C-2.8 / AC-P21） */
export function addReportComment(reportId, content) {
  return request({
    url: `/reports/${reportId}/comments`,
    method: 'POST',
    data: { content },
  })
}
