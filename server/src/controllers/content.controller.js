'use strict'

/**
 * 静态内容页控制器（C-5.8 / AC-U17）。
 *
 * C 端只读已发布的页面；写侧在 adminContent.controller（AC-U17 的
 * 「内容由后台可维护」）。
 */

const contentPageService = require('../services/contentPage.service')

/** GET /contents/:key —— 关于我们 / 用户协议 / 隐私政策 */
async function detail(req, res) {
  // 可选的 tenantId：登录前读平台默认版本，进入项目后读该租户的版本
  const tenantId = req.query.tenantId ? Number(req.query.tenantId) : null
  res.ok(await contentPageService.getPublished(tenantId, req.params.key))
}

module.exports = { detail }
