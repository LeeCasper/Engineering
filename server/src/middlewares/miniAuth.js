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
const { userRateLimit } = require('./rateLimit')

/**
 * 要求 C 端登录态。
 *
 * ── 幂等：同一请求只鉴权、只计一次限流 ──
 * `routes/index.js` 把 7 条子路由串在同一个 `/projects` 挂载点上，每条子路由
 * 自己 `use(requireMini)`。Express 会把它们**全部**执行一遍（匹配不到路由的那几条
 * 也会跑 use 中间件），所以一个 `/projects/:id/visits` 请求会进来 7 次。
 * 不在这里挡住的话，一次请求要回库查 7 次用户、并且扣掉 7 个读限流额度 ——
 * 实测进一次项目详情（聚合前 9 个接口）扣了 24 个额度，用户可用量只剩标称的
 * 1/3~1/4（CLAUDE.md 第 95 条）。鉴权结果与限流额度都是**请求级**的，
 * 第二次进来直接放行，既不重查库也不重复计数。
 */
async function requireMini(req, res, next) {
  if (req.auth && req.auth.type === 'mini') return next()

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

    // 鉴权之后按用户计数（§8.2，读 180 / 写 60 次/分钟，见 rateLimit.js）。
    // 必须在 req.auth 写入之后：限流键取用户 id，不取 IP ——
    // 同一办公室的自然人共用一个出口 IP，按 IP 会互相误伤。
    return userRateLimit(req, res, next)
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
