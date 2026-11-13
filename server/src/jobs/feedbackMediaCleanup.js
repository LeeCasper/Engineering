'use strict'

/**
 * 清理长期未提交的意见反馈图片暂存。
 *
 * 用户选了三张图、传了两张就退出，暂存的文件永远没有归属。
 * 不清理的话，磁盘会被「上传了但没提交」的截图慢慢填满，
 * 且没有任何业务记录能解释它们为什么在那里。
 *
 * 与 reportMediaCleanup / visitMediaCleanup 同构：先认领再删文件，顺序不能反。
 */

const logger = require('../utils/logger')
const datetime = require('../utils/datetime')
const storage = require('../storage')
const feedbackMediaStagingModel = require('../models/feedbackMediaStaging.model')

const TTL_HOURS = 24
const BATCH_SIZE = 200
const INTERVAL_MS = 60 * 60 * 1000

async function runOnce({ now = datetime.now() } = {}) {
  const cutoff = now.subtract(TTL_HOURS, 'hour').format(datetime.DATETIME_FORMAT)

  // 第一步：认领。条件 UPDATE 与提交事务的 FOR UPDATE 在同一行上互斥。
  const claimed = await feedbackMediaStagingModel.claimStale(cutoff, BATCH_SIZE)
  if (claimed === 0) return { claimed: 0, removed: 0 }

  // 第二步：删文件。只处理 expired，不会碰刚被反馈消费的 used 行。
  const rows = await feedbackMediaStagingModel.listExpired(BATCH_SIZE)
  for (const row of rows) {
    const key = storage.extractKey(row.url)
    if (key) await storage.remove(key)
  }

  // 第三步：删记录。删文件失败只记日志，不让一条坏文件把队列永久卡住。
  const removed = await feedbackMediaStagingModel.removeExpiredByIds(rows.map((row) => row.id))

  if (removed > 0) {
    logger.info('已清理过期的反馈图片暂存', { claimed, removed, ttlHours: TTL_HOURS })
  }

  return { claimed, removed }
}

let timer = null

function start() {
  if (timer) return timer

  timer = setInterval(() => {
    runOnce().catch((err) => {
      logger.error('反馈图片暂存清理任务执行失败', { err })
    })
  }, INTERVAL_MS)

  if (typeof timer.unref === 'function') timer.unref()

  logger.info('反馈图片暂存清理任务已启动', { intervalMs: INTERVAL_MS, ttlHours: TTL_HOURS })
  return timer
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { runOnce, start, stop, TTL_HOURS, INTERVAL_MS }
