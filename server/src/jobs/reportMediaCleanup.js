'use strict'

/**
 * 清理长期未提交的汇报附件暂存。
 *
 * ── 为什么必须有一个清理任务 ──
 * 暂存接口把文件先落到磁盘、元数据写入 `report_media_staging`，等待用户
 * 提交汇报时消费。用户上传到一半退出、网络失败、或者只是反悔，这些文件
 * 就永远没有归属 —— 没有清理任务，磁盘会被这种「上传了但没提交」的附件
 * 慢慢填满，且没有任何一条业务记录能解释它们为什么在那里。
 *
 * ── 先认领再删文件，顺序不能反 ──
 * 见 reportMediaStaging.model.claimStale 的注释：如果先扫出 staged 行就直接
 * 删文件，用户恰好在这时提交汇报，会把已经属于正式汇报的图片删掉。
 * 因此第一步是用条件 UPDATE 把行认领为 expired，第二步才删文件。
 *
 * ── 为什么是 24 小时 ──
 * 用户从拍照到填写说明、逐张上传，正常不会超过一天。留太长会让磁盘堆积，
 * 留太短会让正在编辑的用户突然丢附件。清理失败时行保持 expired，下一轮重试。
 */

const logger = require('../utils/logger')
const datetime = require('../utils/datetime')
const storage = require('../storage')
const reportMediaStagingModel = require('../models/reportMediaStaging.model')

/** 暂存附件的保留时长 */
const TTL_HOURS = 24
/** 单轮最多处理多少条，避免一次清理把数据库连接占太久 */
const BATCH_SIZE = 200

/**
 * 跑一轮清理。导出为独立函数，便于测试与运维手动触发。
 *
 * @param {object} [options]
 * @param {object} [options.now] dayjs 兼容对象，测试可传入未来时间
 * @returns {Promise<{claimed: number, removed: number}>}
 */
async function runOnce({ now = datetime.now() } = {}) {
  const cutoff = now.subtract(TTL_HOURS, 'hour').format(datetime.DATETIME_FORMAT)

  // 第一步：认领。条件 UPDATE 同时完成「筛选」与「状态迁移」，
  // 与提交事务的 FOR UPDATE 在同一行上互斥。
  const claimed = await reportMediaStagingModel.claimStale(cutoff, BATCH_SIZE)
  if (claimed === 0) return { claimed: 0, removed: 0 }

  // 第二步：删文件。只处理 expired，不会碰刚被用户消费的 used 行。
  const rows = await reportMediaStagingModel.listExpired(BATCH_SIZE)

  for (const row of rows) {
    // 图片有原图与水印两份；视频只有一份。用 Set 去重，避免同一 key 删两次。
    const keys = new Set(
      [row.watermark_url, row.url]
        .map((url) => storage.extractKey(url))
        .filter(Boolean)
    )
    for (const key of keys) {
      // remove 内部对「文件不存在」返回 false、对权限错误只记 warn，不会抛错
      await storage.remove(key)
    }
  }

  // 第三步：删记录。storage.remove 对「文件不存在」与「删除失败」都返回 false
  // 且只记日志（见 storage/index.js），无法在这里区分；因此记录照删，
  // 极少数删文件失败的孤儿文件按存储层的约定交给运维清理，不让一条坏文件
  // 把清理队列永久卡住。
  const removed = await reportMediaStagingModel.removeExpiredByIds(rows.map((row) => row.id))

  if (removed > 0) {
    logger.info('已清理过期的汇报附件暂存', { claimed, removed, ttlHours: TTL_HOURS })
  }

  return { claimed, removed }
}

let timer = null
const INTERVAL_MS = 60 * 60 * 1000

function start() {
  if (timer) return timer

  timer = setInterval(() => {
    runOnce().catch((err) => {
      // 定时任务抛错不该让进程退出：下一小时还会再跑
      logger.error('汇报附件暂存清理任务执行失败', { err })
    })
  }, INTERVAL_MS)

  if (typeof timer.unref === 'function') timer.unref()

  logger.info('汇报附件暂存清理任务已启动', { intervalMs: INTERVAL_MS, ttlHours: TTL_HOURS })
  return timer
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { runOnce, start, stop, TTL_HOURS, INTERVAL_MS }
