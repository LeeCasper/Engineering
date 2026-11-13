import { request, uploadFile } from './request'

/**
 * 意见反馈（AC-U18）：最多 3 张图片。
 *
 * 微信的 `uni.uploadFile` 一次只能带一个文件，而提交要求一次原子完成，
 * 所以图片先逐张传到这里暂存，提交时用 `mediaIds` 一次性消费
 * （后端 /feedback/media，模式与进度汇报、现场签到照片相同）。
 */
export function stageFeedbackImage(filePath) {
  return uploadFile({
    url: '/feedback/media',
    filePath,
    // 后端按 multipart 的任意字段收文件；这里固定一个语义化字段名便于排查
    name: 'file',
  })
}

/** 提交反馈。`mediaIds` 为逐张暂存后的图片 ID，顺序即用户选择的顺序 */
export function submitFeedback({ content, projectId, tenantId, contact, mediaIds }) {
  return request({
    url: '/feedback',
    method: 'POST',
    data: {
      content,
      projectId,
      tenantId,
      contact,
      mediaIds: mediaIds && mediaIds.length ? mediaIds : undefined,
    },
  })
}
