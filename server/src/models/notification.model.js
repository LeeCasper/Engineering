'use strict'

/**
 * notification / reminder_log / user_subscription 数据访问层。
 */

const db = require('../db/pool')

async function create({ userId, tenantId, projectId, type, title, content, refType, refId }, tx = db) {
  const result = await tx.query(
    `INSERT INTO notification (user_id, tenant_id, project_id, type, title, content, ref_type, ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, tenantId ?? null, projectId ?? null, type, title, content ?? null, refType ?? null, refId ?? null]
  )
  return result.insertId
}

/**
 * 记录一次提醒并**抢占式去重**（AC-P23 / AC-A22 / AC-L30）。
 *
 * 直接 INSERT，撞唯一键（`uk_reminder_once`）就说明这条提醒已经发过。
 * 用「先查再插」在定时任务多实例部署下会双发 —— 两个进程同时查到「没发过」，
 * 然后各发一条。唯一索引不会有这个问题。
 *
 * @returns {Promise<boolean>} true 表示本次是首次，应当真的发送
 */
async function claimReminder({ projectId, type, refType, refId, targetUserId, channel }, tx = db) {
  try {
    await tx.query(
      `INSERT INTO reminder_log (project_id, type, ref_type, ref_id, target_user_id, channel)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId ?? null, type, refType, refId, targetUserId, channel]
    )
    return true
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return false
    throw err
  }
}

/**
 * 释放一次提醒的去重占用。
 *
 * 用在「抢占成功但通知写失败」时（见 notification.service.notifyOnce）：
 * 不释放的话这条提醒会被永久跳过，而用户其实一条都没收到。
 */
async function releaseReminderClaim({ projectId, type, refType, refId, targetUserId }) {
  // ── 必须按 project_key 一起删 ──
  // 去重键从 (type, ref_type, ref_id, target_user_id) 扩成了带 project_key
  // （迁移 016）：两个项目的锚点落在同一秒、业主又是同一个人时，
  // 它们本是两条独立的提醒。释放时不带项目，会把**另一条已经发出去的**
  // 占用一起删掉，下一次扫描就会重复推送。
  await db.query(
    'DELETE FROM reminder_log WHERE project_key = ? AND type = ? AND ref_type = ? AND ref_id = ? AND target_user_id = ?',
    [projectId ?? 0, type, refType, refId, targetUserId]
  )
}

/** 未读消息数（M10 的消息中心与 tab 红点会用） */
async function countUnread(userId) {
  return db.count('FROM notification WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL', [userId])
}

// ─────────────────────────────────────────────────────────────
// 消息中心读取侧（AC-U06 ~ AC-U09）
// ─────────────────────────────────────────────────────────────

/**
 * 拼消息列表/计数的 WHERE 条件。
 *
 * ── 为什么列表与计数必须共用这一段 ──
 * AC-U07 要求「tab 红点数量等于未读消息数」。若红点用一套条件、列表用另一套，
 * 就会出现「红点显示 3 条，点进去一条都没有」—— 用户会认为消息丢了，
 * 而这种差异只在特定筛选组合下出现，最难排查。
 * 因此口径只有一个来源：本函数。
 */
function buildFilter({ userId, tenantId, type, projectId, unreadOnly }) {
  const where = ['user_id = ?', 'deleted_at IS NULL']
  const params = [userId]

  // 租户筛选是**可选**的：不传时就是「我的全部消息」，红点口径也是全局的
  // （CLAUDE.md 第 59 条：红点回答「我有多少条没看」，与筛选无关）
  // 带租户筛选时，**平台级消息（tenant_id IS NULL）也要一并返回** ——
  // 那是「与任何项目无关的系统通知」，属于用户自己的消息，
  // 按租户过滤时把它排除掉，用户会永远看不到。
  if (tenantId) {
    where.push('(tenant_id = ? OR tenant_id IS NULL)')
    params.push(tenantId)
  }

  if (type) {
    where.push('type = ?')
    params.push(type)
  }
  if (projectId) {
    where.push('project_id = ?')
    params.push(projectId)
  }
  if (unreadOnly) where.push('is_read = 0')

  return { clause: `FROM notification WHERE ${where.join(' AND ')}`, params }
}

/**
 * 消息列表（AC-U06 分类筛选 / AC-U09 未读筛选），按时间倒序。
 *
 * 不 JOIN 项目表：`content` 里已经带了项目名（「『XX 小区』已有 3 天没有汇报」），
 * 而消息列表是高频查询，为了一句提示再连一张表不划算。
 * 需要项目名的场景由客户端用 `projectId` 从已缓存的我的项目列表里取。
 */
async function list({ userId, tenantId, type, projectId, unreadOnly, offset, limit }) {
  const { clause, params } = buildFilter({ userId, tenantId, type, projectId, unreadOnly })

  const total = await db.count(clause, params)
  const rows = await db.query(
    `SELECT id, project_id, type, title, content, ref_type, ref_id, is_read, read_at, created_at
       ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return { total, rows }
}

/**
 * 未读数，按分类分组（AC-U06 的分类角标 + AC-U07 的 tab 红点）。
 *
 * 返回**补齐过的**完整分类表而不是 SQL 的分组结果：SQL 里没有未读的分类
 * 压根不会出现在结果中，「缺键」与「值为 0」在前端是两种不同的渲染
 * （undefined 角标 vs 不显示角标），补零的活放在服务端做一次，
 * 省得每个客户端各写一遍 `byType.x || 0`。
 */
async function countUnreadByType(userId) {
  const rows = await db.query(
    `SELECT type, COUNT(*) AS total
       FROM notification
      WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL
      GROUP BY type`,
    [userId]
  )

  const counts = {}
  for (const row of rows) counts[row.type] = row.total

  return counts
}

/**
 * 标记已读（AC-U09 单条已读 / 全部已读）。
 *
 * ── 两个必须留在 WHERE 里的条件 ──
 * 1. `user_id = ?` —— id 是自增主键、可被枚举，少了它任何人都能把**别人的**
 *    消息标成已读（把对方的红点清掉）。
 * 2. `is_read = 0` —— 让接口天然幂等，重复点击不会把 read_at 刷成新时间。
 *    「第一次读的时间」在争议场景下比「最后一次点的时刻」有意义。
 *
 * @returns {Promise<number>} 实际更新的条数（重复标记时为 0，不是错误）
 */
async function markRead({ userId, ids = null }) {
  if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ')
    const result = await db.query(
      `UPDATE notification SET is_read = 1, read_at = NOW()
        WHERE id IN (${placeholders}) AND user_id = ? AND is_read = 0 AND deleted_at IS NULL`,
      [...ids, userId]
    )
    return result.affectedRows
  }

  const result = await db.query(
    `UPDATE notification SET is_read = 1, read_at = NOW()
      WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL`,
    [userId]
  )
  return result.affectedRows
}

// ─────────────────────────────────────────────────────────────
// 订阅消息授权（AC-U11 ~ AC-U13）
// ─────────────────────────────────────────────────────────────

/**
 * 某人某租户下的模板授权记录。
 *
 * 必须带租户：模板 ID 是各租户自己配的，同一个人可能在 A 公司授权了
 * 「验收通知」而没在 B 公司授权 —— 不带租户会把两边的记录混成一份。
 */
async function listSubscriptions(userId, tenantId) {
  if (!tenantId) throw new Error('查询订阅授权必须带 tenantId')
  return db.query(
    `SELECT template_id, template_key, status, updated_at
       FROM user_subscription
      WHERE user_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [userId, tenantId]
  )
}

/**
 * 记录一次订阅授权结果。
 *
 * ── 唯一键是 (user_id, template_id)，不是 (user_id, template_key) ──
 * 因此 `template_id` 为空时**不能**写库：空串在唯一索引里是一个确定的值，
 * 同一个用户配了两个模板 ID 都会折到同一行上，后写的覆盖先写的 ——
 * 表现是「授权了两个模板，管理页只显示一个」。服务层负责跳过未配置的模板。
 *
 * `ban` 是微信侧的长期拒绝（用户在设置里勾了「不再询问」），与一次性拒绝区分：
 * 前者不该再引导，后者可以换个时机再问（AC-U12）。
 */
async function upsertSubscription({ userId, tenantId, templateId, templateKey, status }, tx = db) {
  if (!tenantId) throw new Error('订阅授权必须带 tenantId')
  await tx.query(
    `INSERT INTO user_subscription (user_id, tenant_id, template_id, template_key, status)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       template_key = VALUES(template_key),
       status       = VALUES(status),
       deleted_at   = NULL`,
    [userId, tenantId, templateId, templateKey ?? null, status]
  )
}

/** 用户注销时删除订阅授权：它绑定的是具体模板 ID，注销后没有任何意义 */
async function deleteSubscriptions(userId, tx = db) {
  await tx.query('DELETE FROM user_subscription WHERE user_id = ?', [userId])
}

module.exports = {
  create,
  claimReminder,
  releaseReminderClaim,
  countUnread,
  buildFilter,
  list,
  countUnreadByType,
  markRead,
  listSubscriptions,
  upsertSubscription,
  deleteSubscriptions,
}
