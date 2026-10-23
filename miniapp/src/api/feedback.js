import { request } from './request'

/**
 * 意见反馈（AC-U18）。
 *
 * 当前小程序只提交文字与联系方式；后端 multipart 接口也接受纯 JSON。
 * 图片反馈需要先解决微信一次只能上传一个文件的限制（暂存接口），
 * 在补上之前不要做一个“选了 3 张图却只传出去 1 张”的假上传。
 */
export function submitFeedback({ content, projectId, tenantId, contact }) {
  return request({
    url: '/feedback',
    method: 'POST',
    data: { content, projectId, tenantId, contact },
  })
}
