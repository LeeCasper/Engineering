'use strict'

/**
 * B 端路由汇总（挂载于 /api/v1/admin）。
 *
 * 注意这里**不统一挂 requireAdmin**：auth 路由里登录与取验证码必须公开，
 * 统一挂上会把登录接口自己锁在门外。各子路由自行声明鉴权，
 * 因此新增文件时务必确认每个接口都写了 requireAdmin —— 漏一个就是未授权访问。
 * 后续会补一条集成测试遍历路由表做兜底检查。
 */

const express = require('express')

const router = express.Router()

router.use('/auth', require('./auth.routes'))
// 平台运营的入口。与业务路由的差别不在前缀，而在它**不挂 requireTenant**：
// 其余所有业务路由都要求租户账号，平台默认进不来（见 middlewares/adminAuth.js）
router.use('/platform', require('./platform.routes'))
// 排障授权由**租户**发起（平台不能给自己开窗）。路径与 /platform 同级，
// Express 的挂载路径按段匹配，`/platform-grants` 不会落进 `/platform`
router.use('/platform-grants', require('./platformGrant.routes'))
router.use('/admin-users', require('./adminUser.routes'))
router.use('/projects', require('./project.routes'))
// 成员 tab 的跨项目只读目录。写操作仍挂在 /projects/:id/members
router.use('/members', require('./member.routes'))
router.use('/stage-templates', require('./template.routes'))
router.use('/exports', require('./export.routes'))
router.use('/notifications', require('./notification.routes'))
// operation-logs 而不是 logs：后台另有登录日志（B-1.8），两者的可见范围不同
router.use('/operation-logs', require('./log.routes'))
// 登录日志与操作日志分开：前者回答「谁试图进来」，后者回答「谁改了什么」，
// 权限口径也不同（项目管理员只看自己的登录记录）
router.use('/login-logs', require('./loginLog.routes'))
router.use('/sys-configs', require('./config.routes'))
// 内容页与反馈是 M11 补出来的后台侧：AC-U17 明确要求「内容由后台可维护」，
// 而反馈若没有读取侧，C 端的「提交成功」就是把内容丢进一个没人看的表
router.use('/contents', require('./content.routes'))
router.use('/feedback', require('./feedback.routes'))

module.exports = router
