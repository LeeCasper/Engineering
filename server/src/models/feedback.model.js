'use strict'

/**
 * feedback / user_subscription 数据访问层。
 */

const db = require('../db/pool')

// ─────────────────────────────────────────────────────────────
// 意见反馈（C-5.7 / AC-U18）
// ─────────────────────────────────────────────────────────────

async function createFeedback({ userId, tenantId, projectId, content, images, contact }, tx = db) {
  const result = await tx.query(
    'INSERT INTO feedback (user_id, tenant_id, project_id, content, images, contact) VALUES (?, ?, ?, ?, ?, ?)',
    [
      userId,
      // tenantId 可为 null：未指定项目的反馈是提给**平台**的
      tenantId ?? null,
      projectId ?? null,
      content,
      images && images.length > 0 ? JSON.stringify(images) : null,
      contact ?? null,
    ]
  )
  return result.insertId
}

async function findFeedback(id, tenantId, tx = db) {
  const scope = tenantId == null ? 'tenant_id IS NULL' : 'tenant_id = ?'
  const params = tenantId == null ? [id] : [id, tenantId]

  return tx.queryOne(
    `SELECT id, tenant_id, user_id, project_id, content, images, contact, status, reply,
            handled_by, handled_at, created_at
       FROM feedback WHERE id = ? AND ${scope} AND deleted_at IS NULL`,
    params
  )
}

/**
 * 后台反馈列表。
 *
 * ── 为什么按「状态」建了独立分支而不是塞进 where 数组 ──
 * 后台的默认视图与「全部」视图在排序上不同：待处理的按**正序**（先来先处理），
 * 全部/已处理的按**倒序**（最近的在前面）。用同一个 ORDER BY 会让
 * 待处理列表里最老的那条沉到最下面 —— 而它恰恰是最该先被看到的。
 */
async function listFeedback({ tenantId, status, projectId, userId, offset, limit }) {
  const where = ['deleted_at IS NULL']
  const params = []

  // 租户管理员只看本租户的反馈；平台看 tenant_id IS NULL 的那些（提给平台的）
  if (tenantId === null) {
    where.push('tenant_id IS NULL')
  } else if (tenantId !== undefined) {
    where.push('tenant_id = ?')
    params.push(tenantId)
  }

  if (status) {
    where.push('status = ?')
    params.push(status)
  }
  if (projectId) {
    where.push('project_id = ?')
    params.push(projectId)
  }
  if (userId) {
    where.push('user_id = ?')
    params.push(userId)
  }

  const clause = `FROM feedback WHERE ${where.join(' AND ')}`
  const total = await db.count(clause, params)

  const order = status === 'new' ? 'created_at ASC' : 'id DESC'
  const rows = await db.query(
    `SELECT id, user_id, project_id, content, images, contact, status, reply,
            handled_by, handled_at, created_at
       ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return { total, rows }
}

/** 处理反馈（置状态、写回执）。仅允许从 new → processing → resolved 正向流转由服务层判定 */
async function handleFeedback({ id, status, reply, handledBy }, tx = db) {
  const result = await tx.query(
    'UPDATE feedback SET status = ?, reply = ?, handled_by = ?, handled_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [status, reply ?? null, handledBy ?? null, id]
  )
  return result.affectedRows
}

/**
 * 用户注销时解除反馈与人的关联（AC-U19）。
 *
 * `user_id` 置 NULL 而不是删掉反馈：反馈是运维了解问题的线索，
 * 而它本身不含个人信息（正文与截图是用户主动提交的内容）。
 * 保留 user_id 则会让一个已注销的账号继续与具体内容关联。
 */
async function detachUser(userId, tx = db) {
  await tx.query('UPDATE feedback SET user_id = NULL, contact = NULL WHERE user_id = ?', [userId])
}

module.exports = {
  createFeedback,
  findFeedback,
  listFeedback,
  handleFeedback,
  detachUser,
}
