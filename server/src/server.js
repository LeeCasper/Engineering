'use strict'

/**
 * 进程入口：监听端口 + 优雅退出。
 *
 * 只做「启动与停止」两件事，不掺业务逻辑 —— 集成测试构造 app 时直接
 * require('./app')，绕开本文件，因此这里加任何初始化逻辑都要问一句：
 * 测试环境是否也需要它？
 */

const config = require('../config')
const logger = require('./utils/logger')
const db = require('./db/pool')
const cache = require('./cache')
const { createApp } = require('./app')

async function bootstrap() {
  // 危险配置的自检放在最前面：宁可起不来，也不要带着「谁都能伪造 openid」的
  // 配置对外提供服务。写在文档里靠人记得是不可靠的
  try {
    require('./services/wx.service').assertSafeConfig()
    require('./utils/password').assertSecureConfig()
    require('./services/doorCode.service').assertKeyConfigured()
  } catch (err) {
    logger.error(`配置自检未通过，进程退出：${err.message}`)
    process.exit(1)
  }

  const app = createApp()

  // 启动自检：数据库连不上就直接退出，而不是带着一个坏掉的服务接流量。
  // 容器编排下这会触发重启，通常比「起来了但每个请求都 500」更快暴露问题。
  try {
    await db.ping()
    logger.info('MySQL 连接正常', { host: config.db.host, database: config.db.database })
  } catch (err) {
    logger.error('MySQL 连接失败，进程退出', {
      host: config.db.host,
      database: config.db.database,
      message: err.message,
    })
    process.exit(1)
  }

  if (cache._kind() === 'redis' && !(await cache.isAvailable())) {
    // 不退出：缓存已按需降级，且业务代码对缓存故障有兜底。
    // 但必须显式告警 —— 静默降级会让「验证码偶尔错」这种问题查很久。
    logger.warn('Redis 不可用，相关功能将降级。请检查 REDIS_HOST / REDIS_PORT')
  }

  // 冷启动时清理滞留的导出任务：进程内异步没有持久化能力，
  // 重启后状态停在 running 的任务永远不会有人推进。
  // 不清理的话发起人会一直看到「生成中」——比明确失败更糟，因为他不知道该等还是该重试
  await require('./services/export.service')
    .sweepStaleTasks()
    .catch((err) => logger.warn('清理滞留导出任务失败', { message: err.message }))

  // 定时任务只在真实进程里启动，测试不启动 ——
  // 否则集成测试跑几分钟就可能被定时器插入的提醒打乱断言
  require('./jobs/staleReportReminder').start()
  require('./jobs/acceptanceTimeout').start()
  require('./jobs/reportMediaCleanup').start()

  const server = app.listen(config.server.port, () => {
    logger.info('服务已启动', {
      url: `http://127.0.0.1:${config.server.port}`,
      apiPrefix: config.server.apiPrefix,
      env: config.env,
    })
    // 开发便利是有代价的，必须显式说出来：这个字段一旦出现在生产响应里，
    // 图形验证码就等于没有。启动日志是最后一道提醒。
    if (config.isDev) {
      logger.warn('开发模式：验证码接口会回显答案（debugAnswer），请勿在生产环境使用')
    }
  })

  // ── 优雅退出 ──
  // 收到信号后停止接收新连接，等在途请求结束再关连接池，
  // 否则正在写库的请求会拿到 "Connection closed" 之类的假故障。
  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`收到 ${signal}，开始优雅退出`)

    server.close(async () => {
      try {
        await cache.close()
        await db.close()
        logger.info('已释放数据库与缓存连接，进程退出')
        process.exit(0)
      } catch (err) {
        logger.error('退出时释放资源失败', { err })
        process.exit(1)
      }
    })

    // 兜底：在途请求长时间不结束时强制退出，避免进程僵死挂着不释放端口
    setTimeout(() => {
      logger.warn('优雅退出超时，强制结束进程')
      process.exit(1)
    }, 10_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // 未捕获异常：记录后退出。进程状态已不可信，继续服务可能写坏数据。
  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝', { reason })
  })
  process.on('uncaughtException', (err) => {
    logger.error('未捕获异常，进程退出', { err })
    process.exit(1)
  })

  return server
}

if (require.main === module) {
  bootstrap()
}

module.exports = { bootstrap }
