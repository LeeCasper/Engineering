import { request, uploadFile } from './request'

/**
 * 现场签到（§4.6 / C-6.13 ~ C-6.20）。
 *
 * 照片先逐张传到 `/visits/media` 拿到 mediaId，再一次性提交签到；
 * 微信的 `uni.uploadFile` 一次只能带一个文件，不能把 1–3 张照片塞进同一个请求。
 */

/** 签到页引导：阈值、今日是否已签到、项目坐标与可签到状态 */
export function fetchVisitMeta(projectId) {
  return request({ url: `/projects/${projectId}/visits/meta` })
}

/** 单张照片暂存。提交时再用 mediaId 换取正式签到记录 */
export function uploadVisitMedia(projectId, filePath) {
  return uploadFile({
    url: `/projects/${projectId}/visits/media`,
    filePath,
    name: 'file',
  })
}

/** 提交签到。payload: { latitude, longitude, mediaIds, remark, abnormalReason, routePlanId, seqInPlan } */
export function submitVisit(projectId, payload) {
  return request({
    url: `/projects/${projectId}/visits`,
    method: 'POST',
    data: payload,
  })
}

/** 项目考察记录（倒序分页） */
export function fetchProjectVisits(projectId, { page = 1, pageSize = 20 } = {}) {
  return request({
    url: `/projects/${projectId}/visits?page=${page}&pageSize=${pageSize}`,
  })
}

/** 单条签到记录 */
export function fetchVisit(visitId) {
  return request({ url: `/visits/${visitId}` })
}
