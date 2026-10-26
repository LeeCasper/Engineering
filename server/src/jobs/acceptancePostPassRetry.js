'use strict'

/**
 * 验收通过后的联动补偿。
 *
 * 电子签回调已经把验收改成 passed，但付款节点解锁/通知可能失败。
 * 已签事实不能回滚，因此用 post_pass_status 记录并定时重试。
 */

const logger = require('../utils/logger')
const acceptanceModel = require('../models/acceptance.model')
const acceptancePass = require('../services/acceptancePass.service')

let timer = null

async function run() {
  try {
    const rows = await acceptanceModel.listPostPassPending(100)
    for (const acceptance of rows) {
      await acceptancePass
        .finalizeAfterPass(acceptance, null, { generatePdf: false })
        .catch((err) => logger.warn('验收通过后联动补偿失败', { acceptanceId: acceptance.id, err }))
    }
  } catch (err) {
    logger.error('验收通过后联动补偿任务异常', { err })
  }
}

function start() {
  if (timer) return timer
  timer = setInterval(() => {
    run().catch((err) => logger.error('验收通过后联动补偿任务未捕获异常', { err }))
  }, 60_000)
  timer.unref()
  return timer
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { start, stop, run }
