'use strict'

/**
 * 清理长期未提交的现场签到照片暂存。
 *
 * 用户上传到一半退出、网络失败、或者提交前反悔，暂存文件就永远没有归属。
 * 没有清理任务，磁盘会被「上传了但没签到」的照片慢慢填满，
 * 且没有任何业务记录能解释它们为什么在那里。
 *
 * 与 reportMediaCleanup 同构：先认领再删文件，顺序不能反。
 */

const logger = require('../utils/logger')
const datetime = require('../utils/datetime')
const storage = require('../storage')
const visitMediaStagingModel = require('../models/visitMediaStaging.model')

const TTL_HOURS = 24
const BATCH_SIZE = 200
const INTERVAL_MS = 60 * 60 * 1000

async function runOnce({ now = datetime.now() } = {}) {
  const cutoff = now.subtract(TTL_HOURS, 'hour').format(datetime.DATETIME_FORMAT)

  // 第一步：认领。条件 UPDATE 与提交事务的 FOR UPDATE 在同一行上互斥。
  const claimed = await visitMediaStagingModel.claimStale(cutoff, BATCH_SIZE)
  if (claimed === 0) return { claimed: 0, removed: 0 }

  // 第二步：删文件。只处理 expired，不会碰刚被签到消费的 used 行。
  const rows = await visitMediaStagingModel.listExpired(BATCH_SIZE)
  for (const row of rows) {
    const key = storage.extractKey(row.url)
    if (key) await storage.remove(key)
  }

  // 第三步：删记录。删文件失败只记日志，不让一条坏文件把队列永久卡住。
  const removed = await visitMediaStagingModel.removeExpiredByIds(rows.map((row) => row.id))

  if (removed > 0) {
    logger.info('已清理过期的签到照片暂存', { claimed, removed, ttlHours: TTL_HOURS })
  }

  return { claimed, removed }
}

let timer = null

function start() {
  if (timer) return timer

  timer = setInterval(() => {
    runOnce().catch((err) => {
      logger.error('签到照片暂存清理任务执行失败', { err })
    })
  }, INTERVAL_MS)

  if (typeof timer.unref === 'function') timer.unref()

  logger.info('签到照片暂存清理任务已启动', { intervalMs: INTERVAL_MS, ttlHours: TTL_HOURS })
  return timer
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { runOnce, start, stop, TTL_HOURS, INTERVAL_MS }
