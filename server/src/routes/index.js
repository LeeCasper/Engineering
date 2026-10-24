'use strict'

/**
 * 路由汇总，app.js 只认这一个入口。
 *
 * 路径约定：C 端逐字照搬需求文档 §7.3（/auth/login、/projects…）；
 * B 端统一挂 /admin 之下（/admin/auth/login、/admin/admin-users…）。
 *
 * /admin 前缀是文档没写但必须有的一层：§7.1 要求两端 token 互不通用（AC-AD10），
 * 鉴权中间件得按前缀分流。若两端接口平铺在同一命名空间（如 §7.3 里 /admin-users
 * 与 /projects 并列），就只能逐个接口手工指定鉴权方式 —— 漏一个就是越权。
 */

const express = require('express')
const asyncHandler = require('../utils/asyncHandler')
const db = require('../db/pool')
const cache = require('../cache')

const router = express.Router()

/**
 * 就绪探针。与 /health（存活探针，只证明进程活着）的区别是本接口真的去 ping
 * MySQL 与缓存，避免「进程起来了但数据库连不上」的实例被挂上负载均衡接流量。
 */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const checks = { database: false, cache: false }

    try {
      checks.database = await db.ping()
    } catch {
      checks.database = false
    }

    checks.cache = await cache.isAvailable()

    // 只把数据库当致命项：缓存不可用已在门面层降级，服务仍能工作
    const healthy = checks.database
    res.status(healthy ? 200 : 503).json({
      code: healthy ? 0 : 500,
      message: healthy ? 'success' : '依赖服务不可用',
      data: { checks },
    })
  })
)

router.use('/admin', require('./admin/index'))

// C 端路径逐字照搬 §7.3，因此这里用 '/' 挂载而不是加前缀
router.use('/auth', require('./mini/auth.routes'))
router.use('/branding', require('./mini/branding.routes'))
router.use('/invitations', require('./mini/invitation.routes'))

const reportRoutes = require('./mini/report.routes')
const acceptanceRoutes = require('./mini/acceptance.routes')
const doorCodeRoutes = require('./mini/doorCode.routes')
const visitRoutes = require('./mini/visit.routes')
// 子资源挂在项目路由下，顶层挂「以子资源自身为主语」的接口。
// §7.3 就是这么分的：/projects/:id/reports 与 /reports/:id/comments 并列，
// 前者关心「某项目的汇报」，后者关心「某条汇报的评论」。
const reconciliationRoutes = require('./mini/reconciliation.routes')

router.use(
  '/projects',
  require('./mini/project.routes'),
  reportRoutes.projectRouter,
  acceptanceRoutes.projectRouter,
  require('./mini/ledger.routes'),
  reconciliationRoutes.projectRouter,
  // 门锁密码（§4.8）：列表按项目，改动按条目
  doorCodeRoutes.projectRouter,
  // 现场签到（§4.6）：照片逐张暂存，提交时消费 mediaIds
  visitRoutes.projectRouter
)
router.use('/reports', reportRoutes.reportRouter)
router.use('/visits', visitRoutes.visitRouter)
router.use('/acceptances', acceptanceRoutes.acceptanceRouter)
router.use('/reconciliations', reconciliationRoutes.reconciliationRouter)
// 门锁密码的条目级接口。**只有 C 端有**：§4.8.2 的权限表里，
// 后台管理员对「新增/修改/失效」与「查看」四栏全是 ❌（AC-K01 / AC-K02）
router.use('/door-codes', doorCodeRoutes.codeRouter)

// 考察计划与路线规划（§4.6）。路线方案是个人资产，因此挂在顶层，
// 与「当前看哪个项目」无关；项目坐标仍通过 /projects/:id/location 提供
router.use('/route-plans', require('./mini/routePlan.routes'))

// 消息中心（AC-U06~U10）。挂在顶层而不是 /projects 之下：消息是「给我的」，
// 与当前看哪个项目无关 —— 进入某个项目才看得到自己的消息，会让人漏掉提醒
router.use('/notifications', require('./mini/notification.routes'))

// 静态内容页（AC-U17）与意见反馈（AC-U18）。
// `/contents` 是 C 端唯一不需要登录态的接口 —— 用户协议与隐私政策
// 必须在登录之前就能读到，否则「用户如何得知自己的信息会被怎么用」不成立
router.use('/contents', require('./mini/content.routes'))
router.use('/feedback', require('./mini/feedback.routes'))

module.exports = router
