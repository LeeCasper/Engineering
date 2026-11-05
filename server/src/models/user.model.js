'use strict'

/**
 * user 数据访问层。
 *
 * 注意 phone 的处理：AC-U19/AC-U20 要求注销时把 phone 置 NULL 以释放唯一索引，
 * 因此**任何按手机号查用户的代码都必须能容忍 NULL**，
 * 且不能用 `phone = ''` 这样的写法代替 NULL（空串会撞唯一索引）。
 */

const db = require('../db/pool')

async function findById(id) {
  return db.queryOne(
    `SELECT id, openid, unionid, phone, nickname, real_name, avatar, status, role, anonymized_at, last_login_at, created_at
       FROM user WHERE id = ? AND deleted_at IS NULL`,
    [id]
  )
}

async function findByOpenid(openid) {
  if (!openid) return null
  return db.queryOne(
    `SELECT id, openid, unionid, phone, nickname, real_name, avatar, status, role, anonymized_at, last_login_at
       FROM user WHERE openid = ? AND deleted_at IS NULL`,
    [openid]
  )
}

async function findByUnionid(unionid) {
  if (!unionid) return null
  return db.queryOne('SELECT id, phone, nickname, real_name, avatar, status, role FROM user WHERE unionid = ? AND deleted_at IS NULL', [
    unionid,
  ])
}

async function findByPhone(phone) {
  if (!phone) return null
  // 已注销用户的 phone 为 NULL，因此这里天然只匹配活跃账号
  return db.queryOne('SELECT id, openid, phone, status, role FROM user WHERE phone = ? AND deleted_at IS NULL', [phone])
}

/**
 * 按微信身份创建或更新用户（静默登录的核心）。
 *
 * 以 **openid** 为唯一识别依据。openid 是「这个用户在这一个小程序里」的标识，
 * 本项目只有一个 C 端小程序，因此它稳定且唯一。
 *
 * ── 为什么不用 INSERT ... ON DUPLICATE KEY UPDATE ──
 * 那个写法只对**唯一索引**生效。表里只有 openid 与 phone 是唯一索引，
 * unionid 只是普通索引：若同一 unionid 下出现了一个新 openid，
 * ON DUPLICATE KEY 不会触发任何冲突，会直接插入第二行，留下两个同 unionid 的账号。
 * 它看起来更简洁，实际是错的。
 *
 * ── 并发安全 ──
 * 同一用户并发发起两个登录请求（前端重试、双击）时，「先查后插」的第二个请求
 * 会撞 uk_user_openid。这里捕获该错误后重查，而不是把 500 抛给用户 ——
 * 用户的意图（登录）其实已经达成了。
 *
 * ── 已知限制 ──
 * 若将来接入第二个小程序，用户在新小程序的 openid 不同、unionid 相同，
 * 这里会新建一个账号而不是认到同一个人。届时应改为按 unionid 匹配并更新 openid。
 * 现在不这么做，是因为当前没有第二个应用，多写的逻辑无法被验证。
 */
async function upsertByWechat({ openid, unionid, nickname, avatar }) {
  const existing = await findByOpenid(openid)

  if (existing) {
    await db.query(
      `UPDATE user
          SET unionid      = COALESCE(?, unionid),
              nickname     = COALESCE(?, nickname),
              avatar       = COALESCE(?, avatar),
              last_login_at = NOW()
        WHERE id = ?`,
      [unionid || null, nickname || null, avatar || null, existing.id]
    )
    return findByOpenid(openid)
  }

  try {
    const result = await db.query(
      'INSERT INTO user (openid, unionid, nickname, avatar, last_login_at) VALUES (?, ?, ?, ?, NOW())',
      [openid, unionid || null, nickname || null, avatar || null]
    )
    return findById(result.insertId)
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      // 并发下另一请求刚插入，重查即可
      return findByOpenid(openid)
    }
    throw err
  }
}

/**
 * 绑定手机号（C-1.1 首次进入引导绑定），含**占位账号合并**。
 *
 * ── 为什么需要合并 ──
 * §5.2 的邀请流程是「后台录入手机号 → 生成状态为 pending 的待确认成员」，
 * 而 `project_member.user_id` 非空 —— 也就是说，建档时被邀请的那个人
 * **可能还没有账号**。因此邀请方（M4）必须先按手机号创建一个占位用户
 * （`phone` 有值、`openid` 为 NULL），把成员关系挂上去。
 *
 * 等这个人真的用微信登录时，静默登录会按 openid 匹配不到任何账号，于是新建一个
 * 只有 openid、没有手机号的空账号。此时绑定手机号就会撞上那个占位账号 ——
 * 若简单地判「手机号已被占用」，被邀请人将永远无法确认邀请，
 * 因为他真正的身份（手机号）早就在系统里了。
 *
 * 因此：手机号已存在、且其账号**没有 openid**（即占位账号）时，
 * 把当前账号的微信身份合并过去，并作废当前这个空壳账号。
 *
 * ── 合并的安全边界 ──
 * 当前账号若已经挂上了任何项目成员关系，就**拒绝合并**。
 * 那种情况下合并会悄悄把数据从一个账号搬到另一个账号，出错时极难追溯；
 * 宁可报错让人工处理。
 */
async function bindPhone(userId, phone) {
  return db.withTransaction(async (tx) => {
    const existing = await tx.queryOne(
      'SELECT id, openid, role FROM user WHERE phone = ? AND deleted_at IS NULL',
      [phone]
    )

    // 常规情况：手机号没被占，直接绑
    if (!existing) {
      await tx.query('UPDATE user SET phone = ? WHERE id = ?', [phone, userId])
      return { ok: true, merged: false }
    }

    if (existing.id === userId) {
      return { ok: true, merged: false }
    }

    // 已被一个有微信身份的账号占用 → 真正的冲突，不给合并
    if (existing.openid) {
      return { ok: false, reason: '该手机号已被其他账号绑定' }
    }

    // 当前账号已经挂了数据 → 不自动合并，交人工处理
    const attached = await tx.queryOne(
      `SELECT (SELECT COUNT(*) FROM project_member WHERE user_id = ? AND deleted_at IS NULL)
            + (SELECT COUNT(*) FROM progress_report WHERE user_id = ? AND deleted_at IS NULL) AS total`,
      [userId, userId]
    )
    if (Number(attached.total) > 0) {
      return { ok: false, reason: '该手机号已被其他账号绑定' }
    }

    const current = await tx.queryOne('SELECT id, openid, nickname, real_name, avatar, role FROM user WHERE id = ?', [userId])

    // ── 固定角色不能因手机号合并而改变 ──
    // 占位账号通常是管理员按手机号邀请时创建的，角色已经确定；
    // 当前微信账号如果也已经有固定角色，两者必须一致。
    // 不一致时拒绝合并，而不是悄悄让其中一方变成另一个角色。
    if (existing.role && current.role && existing.role !== current.role) {
      return { ok: false, reason: '该手机号对应的账号角色与当前微信账号不一致，请联系管理员处理' }
    }
    const mergedRole = existing.role || current.role || null

    // ── 三步的顺序不能换 ──
    // openid 上有唯一索引，两个账号不能同时持有同一个 openid。
    // 若先给占位账号写入 openid，此刻当前账号还占着它，会直接撞 uk_user_openid
    // （表现为一个莫名其妙的「数据已存在」409）。因此必须先腾空、再写入、最后作废。
    await tx.query('UPDATE user SET openid = NULL WHERE id = ?', [userId])

    await tx.query(
      `UPDATE user
          SET openid = ?, nickname = COALESCE(nickname, ?), real_name = COALESCE(real_name, ?),
              avatar = COALESCE(avatar, ?), role = COALESCE(role, ?), last_login_at = NOW()
        WHERE id = ?`,
      [current.openid, current.nickname, current.real_name, current.avatar, mergedRole, existing.id]
    )

    await tx.query('UPDATE user SET deleted_at = NOW() WHERE id = ?', [userId])

    // 管理员微信绑定按 openid 查找；合并后 openid 不变，绑定仍然有效。
    // 这里只修正 user_id，保持审计数据与当前用户行一致。
    if (current.openid) {
      await tx.query(
        'UPDATE admin_wechat_binding SET user_id = ? WHERE openid = ? AND user_id <> ?',
        [existing.id, current.openid, existing.id]
      )
    }

    return { ok: true, merged: true, mergedIntoUserId: existing.id }
  })
}

async function updateProfile(id, { nickname, realName, avatar }) {
  const fields = []
  const params = []
  if (nickname !== undefined) {
    fields.push('nickname = ?')
    params.push(nickname)
  }
  if (realName !== undefined) {
    fields.push('real_name = ?')
    params.push(realName)
  }
  if (avatar !== undefined) {
    fields.push('avatar = ?')
    params.push(avatar)
  }
  if (fields.length === 0) return

  params.push(id)
  await db.query(`UPDATE user SET ${fields.join(', ')} WHERE id = ?`, params)
}

async function touchLastLogin(id) {
  await db.query('UPDATE user SET last_login_at = NOW() WHERE id = ?', [id])
}

/**
 * 注销账号（AC-U19 / AC-U20）。
 *
 * ── 这里**不设** `deleted_at`，这是最容易被写错的一处 ──
 * 直觉上「注销 = 软删除」，但本项目大量查询带 `AND u.deleted_at IS NULL`：
 * 成员列表、未汇报提醒的收件人、验收单的提交人……软删除这个人之后，
 * 他**历史汇报与验收上的署名会一起消失**（JOIN 直接把他过滤掉），
 * 而 AC-U19 明确要求「其历史汇报、验收与账目记录**保留**」。
 *
 * 因此注销用 `anonymized_at` 表达：行还在、历史还在，只是这个人不再是「某个人」。
 * 登录态的失效由 `requireMini` 检查 `anonymized_at` / `status` 完成。
 *
 * ── 释放 openid 与 phone 而不是保留 ──
 * 两个列上都有唯一索引。保留的话：
 *   - 手机号无法被本人重新注册（直接违反 AC-U20）；
 *   - 同一个微信号再次登录会被 `upsertByWechat` 匹配到这个已注销的行，
 *     于是「重新注册」变成「原地复活一个匿名账号」，昵称头像都是空的。
 * 置 NULL 后唯一索引不再约束（MySQL 唯一索引不约束多个 NULL），
 * 本机重新登录会走「新建账号」的正常路径。
 *
 * ── 昵称与头像换成占位值而不是留空 ──
 * 历史记录里会显示这个昵称。留空会让「已注销用户」在验收单上显示为空白，
 * 看起来像数据缺失；给一个明确的「已注销用户」反而更清楚。
 * 不用 NULL 还有一个原因：前端到处是 `nickname || phone`，
 * NULL 会退化成显示手机号 —— 而手机号刚刚被清掉了。
 */
async function anonymize(userId, tx = db) {
  await tx.query(
    `UPDATE user
        SET status        = 'deleted',
            anonymized_at = NOW(),
            phone         = NULL,
            openid        = NULL,
            unionid       = NULL,
            nickname      = '已注销用户',
            real_name     = NULL,
            avatar        = NULL
      WHERE id = ? AND anonymized_at IS NULL`,
    [userId]
  )
}

module.exports = {
  findById,
  findByOpenid,
  findByUnionid,
  findByPhone,
  upsertByWechat,
  bindPhone,
  updateProfile,
  touchLastLogin,
  anonymize,
}
