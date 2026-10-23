import { request } from './request'

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
