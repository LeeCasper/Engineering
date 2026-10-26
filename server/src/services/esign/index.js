'use strict'

/**
 * 电子签服务商门面。
 *
 * 业务层只依赖这里的规范化接口，不直接碰任何服务商字段。
 * 新增 e签宝/法大大时，只需在 providers/ 下实现同一组方法。
 */

const { providerName } = require('./config')

function adapter() {
  const provider = providerName()
  if (!provider) throw new Error('电子签服务商未配置')
  if (provider === 'mock') return require('./providers/mock')
  if (provider === 'tencent') return require('./providers/tencent')
  if (provider === 'esign') return require('./providers/esign')
  if (provider === 'fadada') return require('./providers/fadada')
  throw new Error(`不支持的电子签服务商：${provider}`)
}

module.exports = {
  adapter,
  createTask: (...args) => adapter().createTask(...args),
  getTask: (...args) => adapter().getTask(...args),
  getSignUrl: (...args) => adapter().getSignUrl(...args),
  findByExternalId: (...args) => adapter().findByExternalId(...args),
  downloadArtifacts: (...args) => adapter().downloadArtifacts(...args),
  verifySignedDocument: (...args) => adapter().verifySignedDocument(...args),
  getRealNameResult: (...args) => adapter().getRealNameResult(...args),
  cancelTask: (...args) => adapter().cancelTask(...args),
  verifyCallback: (...args) => adapter().verifyCallback(...args),
  callbackAck: (...args) => adapter().callbackAck(...args),
}
