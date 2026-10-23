'use strict'

/**
 * C 端登录（C-1.1）。
 *
 * 微信**静默登录**的含义：不需要用户点「授权」按钮，小程序 `wx.login()` 拿到的
 * code 直接换 openid，用户无感知地完成登录。因此接口不接收手机号、不接收昵称，
 * 那些属于「登录之后引导补全」的步骤（C-1.1 的「首次进入引导绑定手机号」）。
 */

const AppError = require('../utils/AppError')
const logger = require('../utils/logger')
const jwt = require('../utils/jwt')
const wx = require('./wx.service')
const userModel = require('../models/user.model')
const projectMemberModel = require('../models/projectMember.model')
const notificationModel = require('../models/notification.model')
const feedbackModel = require('../models/feedback.model')
const adminWechatBindingModel = require('../models/adminWechatBinding.model')
const db = require('../db/pool')
const operationLog = require('./operationLog.service')
const adminNotification = require('./adminNotification.service')

/**
 * 静默登录。
 *
 * @param {object} params
 * @param {string} params.code wx.login() 的 code
 * @param {string} [params.nickname] 小程序侧已获取时一并带上，免得再发一次请求
 * @param {string} [params.avatar]
 * @returns {Promise<object>}
 */
async function login({ code, nickname, avatar }) {
  const session = await wx.code2session(code)
  const user = await userModel.upsertByWechat({
    openid: session.openid,
    unionid: session.unionid,
    nickname,
    avatar,
  })

  if (!user) throw AppError.internal('登录失败，请重试')

  // 注销过的账号不允许直接恢复：AC-U19 要求注销后登录态失效、资料匿名化，
  // 若这里放行，用户注销后一登录就「复活」了，历史记录还挂在他名下
  if (user.status === 'deleted' || user.anonymized_at) {
    throw AppError.forbidden('该账号已注销，如需继续使用请重新注册')
  }

  const { token, issuedAt, expiresIn } = jwt.signMini({ sub: user.id, openid: user.openid })

  // 顺带把待确认邀请数带回去：前端首屏要据此决定是否弹「你有一个待确认的项目邀请」
  const pendingInvitations = await projectMemberModel.findPendingInvitations(user.id)

  return {
    token,
    issuedAt,
    expiresIn,
    user: {
      id: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      // AC-U02：手机号脱敏，且**接口不做完整回显**
      phoneMasked: maskPhone(user.phone),
      hasPhone: Boolean(user.phone),
    },
    pendingInvitationCount: pendingInvitations.length,
  }
}

/**
 * 绑定手机号（C-1.1）。
 *
 * 两种入参二选一：
 *   - `code`：真实环境，来自 `getPhoneNumber` 按钮，由微信侧换取；
 *   - `phone`：mock 环境，直接由前端提交（无微信凭据时唯一的调试途径）。
 * 生产环境 `phone` 这条路径会被 wx.getPhoneNumber 的凭据校验挡住，
 * 因为 mock 关闭后 `getPhoneNumber` 会因缺少 appid 直接报错。
 *
 * @param {number} userId
 * @param {{code?: string, phone?: string}} params
 */
async function bindPhone(userId, { code, phone }) {
  let resolved

  if (code) {
    resolved = await wx.getPhoneNumber(code)
  } else if (phone) {
    if (!require('../../config').wechat.mock) {
      // 生产环境不接受前端直传手机号：那等于任何人都能把任意手机号绑到自己账号上，
      // 而手机号是成员邀请的唯一凭据（§5.2）
      throw AppError.badRequest('请通过微信授权获取手机号')
    }
    resolved = phone
  } else {
    throw AppError.badRequest('缺少手机号凭证')
  }

  const normalized = normalizePhone(resolved)
  if (!normalized) throw AppError.badRequest('手机号格式不正确')

  const result = await userModel.bindPhone(userId, normalized)
  if (!result.ok) throw AppError.conflict(result.reason)

  if (!result.merged) {
    return { phoneMasked: maskPhone(normalized), token: null }
  }

  // 发生了占位账号合并：当前账号已被作废，手里的 token 指向一个不存在的用户，
  // 下一次请求就会 401。必须换发一个指向合并后账号的新 token，
  // 否则用户刚绑完手机号就被踢下线。
  const merged = await userModel.findById(result.mergedIntoUserId)
  const { token } = jwt.signMini({ sub: merged.id, openid: merged.openid })

  return { phoneMasked: maskPhone(normalized), token, merged: true }
}

/**
 * 手机号脱敏：中间 4 位掩码（AC-U02）。
 *
 * 11 位手机号保留前 3 后 4，即 138****8000。
 * 非 11 位的号码（如境外号、座机）保留前 2 后 2，总之**不完整回显**。
 */
function maskPhone(phone) {
  if (!phone) return null
  const value = String(phone)
  if (value.length === 11) return `${value.slice(0, 3)}****${value.slice(-4)}`
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(1, value.length - 4))}${value.slice(-2)}`
}

/** 归一化：去掉空格、横线、+86 前缀。微信返回的是 11 位纯数字，但 mock 输入可能不规范 */
function normalizePhone(phone) {
  if (!phone) return null
  let value = String(phone).replace(/[\s-]/g, '')
  if (value.startsWith('+86')) value = value.slice(3)
  else if (value.startsWith('86') && value.length === 13) value = value.slice(2)

  return /^1[3-9]\d{9}$/.test(value) ? value : null
}

/**
 * 注销账号（C-5.9 / AC-U19 / AC-U20）。
 *
 * ── 保留什么、抹掉什么 ──
 * AC-U19 的两句话其实是一对约束：「个人资料匿名化」+「历史汇报、验收与账目记录**保留**」。
 * 因此**不能软删除这条 user 行** —— 大量查询带 `AND u.deleted_at IS NULL`
 * （成员列表、提醒收件人、验收单提交人），删了之后他的历史记录会跟着一起消失，
 * 看起来像「这些活从来没人干过」。匿名化由 `anonymized_at` 表达，行留着。
 *
 * 抹掉的是能指向具体自然人的字段：昵称头像、手机号、微信身份（详见 user.model.anonymize）。
 *
 * ── 三处附带动作，缺一个都会留下说不清的中间态 ──
 * 1. **解除项目成员关系**。不解的话，项目里挂着一个永远不会回应的「工长」，
 *    而 AC-AD58 的人数校验还会把他算作「人员配齐」——
 *    一个既不能汇报也不能验收的人占着名额，现场只能停在那里等管理员发现。
 * 2. **是主工长则清掉主工长标记**，并给项目管理员发一条消息。
 *    Q11 规定「不能直接移除主工长」，但注销是**用户的法定权利**，
 *    系统无权以「你还得先交接」为由拒绝 —— 那是把公司的管理责任转嫁给个人。
 *    折中办法是照做，但**不静默**：管理员会收到明确提示，让他重新指定。
 * 3. **删除订阅授权记录**。它绑定的是具体模板 ID，账号没了就没有意义；
 *    留着会让「已授权人数」这类统计一直偏高。
 *
 * @param {number} userId
 * @param {object} operator 审计上下文（req.auth）
 */
async function deactivate(userId, operator) {
  const user = await userModel.findById(userId)
  if (!user) throw AppError.notFound('用户不存在')
  if (user.anonymized_at) throw AppError.conflict('账号已注销')

  // 影响到的项目与「是否留下了无人接手的主工长」，在事务里收集、事务外发消息 ——
  // 消息是外部副作用，不能跟着事务一起回滚（发了又没注销，用户会收到莫名其妙的提醒）
  const affected = await db.withTransaction(async (tx) => {
    const memberships = await tx.query(
      `SELECT pm.id, pm.project_id, pm.role, pm.is_primary, p.name AS project_name
         FROM project_member pm
         JOIN project p ON p.id = pm.project_id AND p.deleted_at IS NULL
        WHERE pm.user_id = ? AND pm.status IN ('pending', 'active') AND pm.deleted_at IS NULL`,
      [userId]
    )

    for (const member of memberships) {
      // 置为 removed 而不是删行：AC-U19 要求历史记录保留，
      // 而「曾是成员后离开」与「从未加入」是两件事（CLAUDE.md 第 15 条）
      await tx.query(
        `UPDATE project_member SET status = 'removed', left_at = NOW(), is_primary = 0 WHERE id = ?`,
        [member.id]
      )
    }

    // 注销会清空 openid，之后再也找不到这些绑定；必须在匿名化之前撤销。
    // 绑定表保留 revoked 行用于审计，不做物理删除。
    await adminWechatBindingModel.revokeByOpenid(user.openid, 'user_deactivated', tx)
    await userModel.anonymize(userId, tx)
    await notificationModel.deleteSubscriptions(userId, tx)
    await feedbackModel.detachUser(userId, tx)

    return memberships
  })

  // 事务外：通知项目管理员（AC-AD18 的邀请确认走的是另一条路，这里只发提醒）
  for (const member of affected) {
    // 只有「他原本是主工长」才需要惊动管理员：普通成员离开会由管理员在成员列表里看到，
    // 而主工长离开会让**发起验收的人消失**，不提醒的话项目会静默卡住
    if (member.is_primary !== 1) continue

    await adminNotification
      .notifyProjectAdmin({
        projectId: member.project_id,
        title: '项目主工长已注销账号',
        content: `「${member.project_name}」的主工长已注销账号并退出项目，请重新指定一名主工长，否则该项目无法发起验收。`,
      })
      .catch((err) => {
        // 通知失败不能让注销失败：用户的注销权不能被一个消息通道的抖动挡住
        logger.error('注销后通知项目管理员失败', { projectId: member.project_id, message: err.message })
      })
  }

  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.ACCOUNT_DEACTIVATE,
    targetType: 'user',
    targetId: userId,
    // **只记 id，不记昵称**：注销的目的就是让这条记录不再指向一个具体的人，
    // 而审计链只需要能关联到 userId（历史汇报、验收上的 userId 也没变）。
    // 把昵称抄进日志等于把刚抹掉的个人信息换个地方存了一份
    detail: {
      before: { status: user.status, hasPhone: Boolean(user.phone) },
      after: { anonymized: true, membershipsRemoved: affected.length, primaryForemanOf: affected.filter((m) => m.is_primary === 1).length },
    },
  })

  return { deactivated: true, membershipsRemoved: affected.length }
}

module.exports = { login, bindPhone, maskPhone, normalizePhone, deactivate }
