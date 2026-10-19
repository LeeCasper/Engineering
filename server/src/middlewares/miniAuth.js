'use strict'

/**
 * C 端鉴权中间件。
 *
 * 与 B 端同理，每个请求都回库查一次 user：注销（AC-U19）与「占位账号合并」
 * 都会让已签发的 token 指向一个不再有效的用户，只验签名是发现不了的。
 *
 * 项目级的权限判定（是不是这个项目的工长/监理/业主）不在这里，
 * 需要项目 id 才能判断，放在 M4 的数据权限中间件里。本文件只回答
 * 「你是谁」，不回答「你能对哪个项目做什么」。
 */

const AppError = require('../utils/AppError')
const jwt = require('../utils/jwt')
const userModel = require('../models/user.model')

/**
 * 要求 C 端登录态。
 */
async function requireMini(req, res, next) {
  try {
    const token = jwt.extractToken(req)
    if (!token) throw AppError.unauthorized()

    const payload = jwt.verifyMini(token)
    const user = await userModel.findById(payload.sub)

    if (!user) throw AppError.unauthorized()
    // 已注销账号的 token 立即失效（AC-U19）
    if (user.status !== 'active' || user.anonymized_at) {
      throw AppError.forbidden('账号已注销')
    }

    req.auth = {
      type: 'mini',
      id: user.id,
      openid: user.openid,
      phone: user.phone,
      hasPhone: Boolean(user.phone),
      // 审计用，与 adminAuth 同理。C 端的记账操作同样要写 operation_log
      // （AC-L28 要求记变更前后金额），因此这里也必须带 IP 与 requestId
      ip: req.ip || null,
      requestId: req.id || null,
    }

    return next()
  } catch (err) {
    return next(err)
  }
}

/**
 * 要求已绑定手机号。
 *
 * 只挂在「需要手机号才能成立」的接口上，而不是全局。
 * 理由：手机号在业务上只有两个用途 —— 被邀请（§5.2 按手机号邀请）
 * 与接收通知。用户不绑手机号也应该能看自己已有的项目，
 * 全局强制绑定会制造一个「登录了但什么都看不了」的死锁状态，
 * 而那个状态恰恰最容易出现在刚被邀请、还没来得及绑号的人身上。
 */
function requirePhone(req, res, next) {
  if (!req.auth || !req.auth.hasPhone) {
    return next(AppError.forbidden('请先绑定手机号'))
  }
  return next()
}

module.exports = { requireMini, requirePhone }
