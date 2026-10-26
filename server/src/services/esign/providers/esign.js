'use strict'

/**
 * e签宝适配器占位。
 *
 * 计划里作为腾讯电子签的备选。接入前需要按 e签宝 SaaS V3 官方文档确认：
 * 实名/人脸、创建签署流程、获取签署链接、回调 HMAC、下载已签文件、验签/证据报告。
 * 未完成映射前不允许在生产选择该 provider。
 */

function notImplemented() {
  throw new Error('e签宝适配器尚未实现：请按 e签宝 SaaS V3 官方文档完成映射后再启用')
}

module.exports = {
  createTask: notImplemented,
  getTask: notImplemented,
  getSignUrl: notImplemented,
  findByExternalId: notImplemented,
  downloadArtifacts: notImplemented,
  verifySignedDocument: notImplemented,
  getRealNameResult: notImplemented,
  cancelTask: notImplemented,
  verifyCallback: notImplemented,
  callbackAck: () => ({ status: 200, body: { code: 200, message: 'success' } }),
}
