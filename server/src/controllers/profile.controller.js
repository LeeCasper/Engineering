'use strict'

/**
 * C 端个人中心控制器（C-5.5 / C-5.6 / AC-U14 / AC-U15）。
 *
 * ── 与 miniAuth.controller 的分工 ──
 * `miniAuth.controller` 处理**账号身份**（登录、绑定手机号、资料、注销），
 * 那几个接口的视角是「你是谁」，与项目无关；
 * 本文件处理**在某个项目里的你**（我的汇报统计、我能联系谁），
 * 路径都带 `:id`。
 */

const profileService = require('../services/profile.service')

/** GET /projects/:id/my-stats —— 工长专属统计（AC-U14） */
async function myStats(req, res) {
  res.ok(await profileService.getMyStats(req.auth.id, Number(req.params.id)))
}

/** GET /projects/:id/contacts —— 业主查看工长/监理联系方式（AC-U15） */
async function contacts(req, res) {
  res.ok(await profileService.getContacts(req.auth.id, Number(req.params.id)))
}

module.exports = { myStats, contacts }
