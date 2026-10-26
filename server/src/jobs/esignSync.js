'use strict'

/**
 * 电子签补偿任务。
 *
 * 回调是主通道，但服务商可能丢回调、本地可能在写库前崩溃，因此必须有：
 *   - pending：主动查单，服务商已签则转 archiving 并归档；
 *   - archiving：重新下载/验签/归档；
 *   - creating：按 externalId 对账，避免服务商已创建而本地没有 provider id；
 *   - 未解析的 esign_event：任务后来写库后继续处理。
 */

const datetime = require('../utils/datetime')
const logger = require('../utils/logger')
const esignTaskModel = require('../models/esignTask.model')
const esignEventModel = require('../models/esignEvent.model')
const esignService = require('../services/esign.service')
const provider = require('../services/esign')

let timer = null

async function run() {
  const now = Date.now()
  const pendingBefore = datetime.format(new Date(now - 30_000))
  const creatingBefore = datetime.format(new Date(now - 2 * 60_000))

  try {
    const pending = await esignTaskModel.listByStatusOlderThan('pending', pendingBefore, 100)
    for (const task of pending) await esignService.syncTask(task)

    const archiving = await esignTaskModel.listByStatusOlderThan('archiving', pendingBefore, 100)
    for (const task of archiving) await esignService.processTask(task.id)

    const creating = await esignTaskModel.listByStatusOlderThan('creating', creatingBefore, 100)
    for (const task of creating) {
      let remote = null
      try {
        remote = await provider.findByExternalId({ externalId: task.idempotency_key })
      } catch (err) {
        logger.warn('电子签 creating 对账失败', { taskId: task.id, message: err.message })
        continue
      }
      if (remote && remote.providerTaskId) {
        await esignTaskModel.update(task.id, {
          status: 'pending',
          provider_task_id: remote.providerTaskId,
          last_synced_at: datetime.format(),
          error_code: null,
          error_message: null,
        })
        const fresh = await esignTaskModel.findById(task.id)
        await esignService.syncTask(fresh)
      } else {
        await esignTaskModel.update(task.id, {
          status: 'failed',
          error_code: 'ESIGN_CREATE_UNKNOWN',
          error_message: '创建签署任务超时且服务商无法对账，请重新发起',
        })
      }
    }

    const events = await esignEventModel.listUnresolved(100)
    for (const event of events) {
      if (event.task_id) {
        await esignService.processEvent(event.id)
        continue
      }
      const task = await esignTaskModel.findByProviderTaskId(event.provider, event.provider_task_id)
      if (task) {
        await esignEventModel.mark(event.id, { taskId: task.id })
        await esignService.processEvent(event.id)
      }
    }
  } catch (err) {
    logger.error('电子签补偿任务异常', { err })
  }
}

function start() {
  if (timer) return timer
  timer = setInterval(() => {
    run().catch((err) => logger.error('电子签补偿任务未捕获异常', { err }))
  }, 60_000)
  timer.unref()
  run().catch((err) => logger.error('电子签补偿任务首次执行失败', { err }))
  return timer
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { start, stop, run }
