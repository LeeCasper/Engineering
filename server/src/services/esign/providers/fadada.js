'use strict'

/** 法大大适配器占位；实现要求同 esign.js。 */
function notImplemented() {
  throw new Error('法大大适配器尚未实现：请按官方文档完成映射后再启用')
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
  callbackAck: () => ({ status: 200, body: { code: 0, message: 'success' } }),
}
