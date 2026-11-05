'use strict'

/**
 * project_member 数据访问层。
 *
 * ── 本项目最容易出错的一条约定，在这里落地 ──
 * `status='pending'` 的成员**不计入任何权限判定**（§6.2 / AC-AD18）。
 * 因此凡是用到成员关系的地方，都必须显式写明 status 条件。
 * 本模块把「活跃成员」的过滤收在 ACTIVE 常量里，避免各处手写漏掉。
 *
 * 唯一的例外是「我的待确认邀请」—— 那个查询要的正是 pending，
 * 单独用 findPendingInvitations 表达，不复用活跃成员的条件。
 */

const db = require('../db/pool')
const dataScope = require('../services/dataScope.service')

/** 唯一合法的「有权限」状态。任何权限查询都必须带上它 */
const ACTIVE = "pm.status = 'active' AND pm.deleted_at IS NULL"

/**
 * 查某人在某项目中的活跃角色。
 * @returns {Promise<{role: string, id: number}|null>}
 */
async function findActiveRole(projectId, userId) {
  // is_primary 一并返回：验收发起、阶段结算单提交的权限判定要用它（Q11），
  // 让调用方不必再查一次
  return db.queryOne(
    `SELECT id, user_id, role, is_primary, owner_type
       FROM project_member pm
      WHERE pm.project_id = ? AND pm.user_id = ? AND ${ACTIVE}`,
    [projectId, userId]
  )
}

/**
 * 某人所属的租户列表（C 端跨租户的基础查询）。
 *
 * 只统计 active 成员关系对应的项目所属租户 —— pending 还没确认，
 * 不在其中出现，与 AC-AD18「pending 不计入任何权限判定」同口径。
 */
async function listUserTenants(userId) {
  return db.query(
    `SELECT DISTINCT p.tenant_id, t.name AS tenant_name, t.code AS tenant_code
       FROM project_member pm
       JOIN project p ON p.id = pm.project_id AND p.deleted_at IS NULL
       JOIN tenant t ON t.id = p.tenant_id AND t.deleted_at IS NULL
      WHERE pm.user_id = ? AND pm.status = 'active' AND pm.deleted_at IS NULL
      ORDER BY p.tenant_id`,
    [userId]
  )
}

/** 查某人在某项目中的成员记录（含 pending），用于判断「是否已被邀请」 */
async function findAny(projectId, userId, tx = db) {
  return tx.queryOne(
    'SELECT id, role, status, owner_type FROM project_member WHERE project_id = ? AND user_id = ?',
    [projectId, userId]
  )
}

/**
 * 按角色统计项目成员数。用于 AC-AD58 的人数约束：
 * 工长必须且仅 1 人、业主至少 1 人。
 *
 * @param {string} [role] 不传则统计全部活跃成员
 */
async function countByRole(projectId, role) {
  const params = [projectId]
  let clause = ACTIVE
  if (role) {
    clause += ' AND pm.role = ?'
    params.push(role)
  }
  return db.count(`FROM project_member pm WHERE pm.project_id = ? AND ${clause}`, params)
}

/**
 * 创建或重新激活成员关系（B-2.6 邀请流程）。
 *
 * 用 ON DUPLICATE KEY UPDATE 而不是先查后插：`project_member` 对
 * (project_id, user_id) 有唯一索引（AC-AD20：同一用户在同一项目内只能有一个角色），
 * 「解除关系后重新邀请」会命中同一行，必须走更新而不是插入。
 *
 * 重复分配时**替换角色**而不是新增 —— AC-AD20 明确要求「提示替换而非新增」。
 */
async function invite({ projectId, userId, role, invitedBy, isPrimary = false, ownerType = null, tx = db }) {
  await tx.query(
    `INSERT INTO project_member (project_id, user_id, role, status, invited_by, is_primary, owner_type)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       role       = VALUES(role),
       status     = 'pending',
       invited_by = VALUES(invited_by),
       is_primary = VALUES(is_primary),
       owner_type = VALUES(owner_type),
       confirmed_at = NULL,
       left_at    = NULL,
       deleted_at = NULL`,
    [projectId, userId, role, invitedBy ?? null, isPrimary ? 1 : 0, ownerType ?? null]
  )

  return findAny(projectId, userId, tx)
}

/** 当前主工长（仅 active，pending 不计入权限判定 —— AC-AD18） */
async function findPrimaryForeman(projectId) {
  return db.queryOne(
    `SELECT pm.id, pm.user_id, u.nickname, u.real_name, u.openid
       FROM project_member pm JOIN user u ON u.id = pm.user_id
      WHERE pm.project_id = ? AND pm.role = 'foreman' AND pm.is_primary = 1
        AND pm.status = 'active' AND pm.deleted_at IS NULL`,
    [projectId]
  )
}

/** 已确认的主业主（active）；重要决策判定的数据来源 */
async function findPrimaryOwner(projectId) {
  return db.queryOne(
    `SELECT pm.id, pm.user_id, u.nickname, u.real_name, u.openid
       FROM project_member pm JOIN user u ON u.id = pm.user_id
      WHERE pm.project_id = ? AND pm.role = 'owner' AND pm.owner_type = 'primary'
        AND pm.status = 'active' AND pm.deleted_at IS NULL`,
    [projectId]
  )
}

/**
 * 主业主名额（含 pending）。
 *
 * 管理员邀请业主时要用它判断「本次会不会产生主业主」：一个还没确认的
 * 主业主邀请同样占着名额，不能因为 pending 不计入权限就再安排一个主业主。
 */
async function findPrimaryOwnerSlot(projectId) {
  return db.queryOne(
    `SELECT pm.id, pm.user_id, pm.status, pm.owner_type, u.nickname, u.real_name
       FROM project_member pm JOIN user u ON u.id = pm.user_id
      WHERE pm.project_id = ? AND pm.role = 'owner' AND pm.owner_type = 'primary'
        AND pm.status IN ('pending', 'active') AND pm.deleted_at IS NULL`,
    [projectId]
  )
}

/**
 * 注销主业主后提升最早的临时业主。
 *
 * 只在 miniAuth.deactivate 中使用，且调用前必须先把原主业主的
 * owner_type 清空 —— 否则会撞 uk_pm_primary_owner。
 * active 优先于 pending：先让已确认的人接手。
 */
async function promoteFirstTemporaryOwner(projectId, tx = db) {
  const candidate = await tx.queryOne(
    `SELECT id, user_id, status
       FROM project_member
      WHERE project_id = ? AND role = 'owner' AND owner_type = 'temporary'
        AND status IN ('pending', 'active') AND deleted_at IS NULL
      ORDER BY FIELD(status, 'active', 'pending'), id ASC
      LIMIT 1`,
    [projectId]
  )
  if (!candidate) return null

  const result = await tx.query(
    `UPDATE project_member
        SET owner_type = 'primary'
      WHERE id = ? AND role = 'owner' AND owner_type = 'temporary'
        AND status IN ('pending', 'active') AND deleted_at IS NULL`,
    [candidate.id]
  )
  return result.affectedRows > 0 ? candidate : null
}

/**
 * 指定主工长（Q11）。
 *
 * ── 两步的顺序不能换 ──
 * `primary_foreman_key` 上有唯一索引（一个项目最多 1 名主工长）。
 * 若先把新人置为 1，此刻旧主工长还占着这个键，会直接撞唯一索引 ——
 * 表现为一个莫名其妙的「数据已存在」。必须先全部清零，再置位。
 * 这与 user.model.bindPhone 的占位账号合并是同一类陷阱。
 *
 * 只清 `role='foreman'` 的行：非工长角色的 is_primary 本就恒为 0，
 * 但显式限定角色能让语句的意图更清楚。
 */
async function setPrimary(projectId, userId, tx = db) {
  await tx.query(
    "UPDATE project_member SET is_primary = 0 WHERE project_id = ? AND role = 'foreman' AND is_primary = 1",
    [projectId]
  )
  const result = await tx.query(
    "UPDATE project_member SET is_primary = 1 WHERE project_id = ? AND user_id = ? AND role = 'foreman' AND status = 'active' AND deleted_at IS NULL",
    [projectId, userId]
  )
  return result.affectedRows > 0
}

/**
 * 被邀请人确认，状态转为 active（AC-AD18 → AC-AD19）。
 *
 * 条件里带 status='pending' 是并发保护：两个确认请求同时到达时，
 * 只有一个能改到行（另一个的 WHERE 不匹配），不会重复写入 joined_at。
 *
 * @returns {Promise<boolean>} 是否真的完成了状态流转
 */
async function confirm(projectId, userId) {
  const result = await db.query(
    `UPDATE project_member
        SET status = 'active', confirmed_at = NOW(), joined_at = COALESCE(joined_at, NOW())
      WHERE project_id = ? AND user_id = ? AND status = 'pending' AND deleted_at IS NULL`,
    [projectId, userId]
  )
  return result.affectedRows > 0
}

/**
 * 拒绝邀请（§5.2 邀请流程的另一半，需求文档未明确要求，按现实需要补充）。
 *
 * ── 为什么不用一个新的状态值 ──
 * §6.1 把 status 定为 `pending/active/removed` 三个值。为「拒绝」新增一个枚举值
 * 需要一次迁移，而这三个值其实已经够表达：
 *
 *   拒绝 = status 'removed' 且 **confirmed_at 仍为 NULL**
 *   解除 = status 'removed' 且 confirmed_at 有值
 *
 * 前者是「从未成为成员就退出」，后者是「曾是成员后被解除」。
 * 管理后台据此就能区分，不必加字段。
 *
 * 保留记录而不是删除：管理员需要看到「这个人拒绝了」，
 * 否则列表里凭空少一条，会被误判成邀请没发出去。
 *
 * 条件带 status='pending' 保证只能拒绝未处理的邀请；
 * 已确认过的成员要走 remove（解除关系），语义不同。
 */
async function reject(projectId, userId) {
  const result = await db.query(
    `UPDATE project_member
        SET status = 'removed', left_at = NOW(), owner_type = NULL
      WHERE project_id = ? AND user_id = ? AND status = 'pending' AND deleted_at IS NULL`,
    [projectId, userId]
  )
  return result.affectedRows > 0
}

/** 解除成员关系（AC-AD21：立即失去访问权限，但历史记录保留） */
async function remove(projectId, userId) {
  const result = await db.query(
    // 同时清掉 is_primary：即使历史上出现过「移除但主工长标记残留」，
    // 也不该继续占用 uk_pm_primary_foreman（见迁移 029）
    `UPDATE project_member
        SET status = 'removed', left_at = NOW(), is_primary = 0, owner_type = NULL
      WHERE project_id = ? AND user_id = ? AND status <> 'removed' AND deleted_at IS NULL`,
    [projectId, userId]
  )
  return result.affectedRows > 0
}

/**
 * 某项目的全部成员（含 pending 与 removed）。
 *
 * 这里**不**用 ACTIVE 过滤：成员管理界面需要看到「已邀请但未确认」和
 * 「已移除」的人，否则管理员会以为邀请没发出去（AC-AD18 的可见性要求）。
 * 需要活跃成员的场景请用 countByRole。
 */
async function listByProject(projectId) {
  return db.query(
    `SELECT pm.id, pm.user_id, pm.role, pm.status, pm.invited_by, pm.is_primary, pm.owner_type,
            pm.created_at AS invited_at, pm.confirmed_at, pm.left_at,
            u.nickname, u.real_name, u.avatar, u.phone
       FROM project_member pm
       JOIN user u ON u.id = pm.user_id
      WHERE pm.project_id = ? AND pm.deleted_at IS NULL
      ORDER BY FIELD(pm.role, 'foreman', 'supervisor', 'owner'),
               FIELD(pm.owner_type, 'primary', 'temporary'), pm.id`,
    [projectId]
  )
}

/** 搜索框里的角色词，映射到 project_member.role */
const ROLE_KEYWORDS = {
  工长: 'foreman',
  foreman: 'foreman',
  监理: 'supervisor',
  supervisor: 'supervisor',
  业主: 'owner',
  owner: 'owner',
}

/** 转义 LIKE 通配符：用户输入的 % 与 _ 按字面匹配 */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/**
 * 跨项目成员列表的 WHERE。
 *
 * 数据权限仍然只来自 `dataScope.buildFilter()`，它引用的别名是 `p`，
 * 因此这里必须先 JOIN project 再拼 scope.clause —— 不能只看 project_member，
 * 否则项目管理员能搜到未授权项目里的成员姓名与手机号。
 */
function buildDirectoryWhere(scope, { keyword, role, projectId } = {}) {
  dataScope.assertValid(scope)

  const where = ['pm.deleted_at IS NULL', "pm.status <> 'removed'", scope.clause]
  const params = [...scope.params]

  if (projectId) {
    where.push('p.id = ?')
    params.push(projectId)
  }
  if (role) {
    where.push('pm.role = ?')
    params.push(role)
  }
  if (keyword) {
    const like = `%${escapeLike(keyword)}%`
    const roleKey = ROLE_KEYWORDS[keyword]
    if (roleKey) {
      // 搜索框占位写的是「姓名 / 手机号 / 角色」，角色词要真的能搜到
      where.push('(u.real_name LIKE ? OR u.nickname LIKE ? OR u.phone LIKE ? OR p.name LIKE ? OR pm.role = ?)')
      params.push(like, like, like, like, roleKey)
    } else {
      where.push('(u.real_name LIKE ? OR u.nickname LIKE ? OR u.phone LIKE ? OR p.name LIKE ?)')
      params.push(like, like, like, like)
    }
  }

  return { where, params }
}

const DIRECTORY_FROM = `
  FROM project_member pm
  JOIN project p ON p.id = pm.project_id AND p.deleted_at IS NULL
  JOIN user u ON u.id = pm.user_id
`

/**
 * 管理端「成员」tab 的跨项目成员列表。
 *
 * 与项目列表一样强制分页（AC-AD45）。排序刻意让主工长 / 主业主排在前面，
 * 已加入的排在待确认前面 —— 与设计稿的成员排序一致。
 */
async function listAcrossProjects(scope, { filters = {}, paging }) {
  const { where, params } = buildDirectoryWhere(scope, filters)
  const clause = `${DIRECTORY_FROM} WHERE ${where.join(' AND ')}`

  const total = await db.count(clause, params)
  const rows = await db.query(
    `SELECT pm.id, pm.project_id, pm.user_id, pm.role, pm.status, pm.is_primary, pm.owner_type,
            pm.created_at AS invited_at, pm.confirmed_at, pm.left_at,
            u.nickname, u.real_name, u.avatar, u.phone,
            p.name AS project_name, p.status AS project_status
       ${clause}
      ORDER BY FIELD(pm.role, 'foreman', 'supervisor', 'owner'),
               pm.is_primary DESC,
               (pm.owner_type = 'primary') DESC,
               FIELD(pm.status, 'active', 'pending', 'removed'),
               p.name, pm.id
      LIMIT ? OFFSET ?`,
    [...params, paging.limit, paging.offset]
  )

  return { total, rows }
}

/**
 * 成员 tab 的角色计数。
 *
 * 计数**忽略当前角色筛选**，否则点了「工长」之后另外三个胶囊都变成 0，
 * 用户会以为项目里没有监理和业主。关键词与项目范围仍然生效，
 * 这样搜索时胶囊上的数字与结果一致。
 */
async function countDirectoryByRole(scope, { keyword, projectId } = {}) {
  const { where, params } = buildDirectoryWhere(scope, { keyword, projectId })
  const row = await db.queryOne(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(pm.role = 'foreman'), 0) AS foreman,
            COALESCE(SUM(pm.role = 'supervisor'), 0) AS supervisor,
            COALESCE(SUM(pm.role = 'owner'), 0) AS owner
       ${DIRECTORY_FROM} WHERE ${where.join(' AND ')}`,
    params
  )

  return {
    all: Number(row.total) || 0,
    foreman: Number(row.foreman) || 0,
    supervisor: Number(row.supervisor) || 0,
    owner: Number(row.owner) || 0,
  }
}

/**
 * 按 id 查某人的待确认邀请。
 *
 * `user_id` 条件不可省：id 是自增主键、可被枚举，
 * 只按 id 查会让任何人确认任意一条邀请，把自己塞进别人的项目。
 * 同时带 status='pending'，使「不存在」与「已处理」对外表现一致。
 */
async function findPendingById(memberId, userId) {
  return db.queryOne(
    `SELECT id, project_id, role, owner_type
       FROM project_member
      WHERE id = ? AND user_id = ? AND status = 'pending' AND deleted_at IS NULL`,
    [memberId, userId]
  )
}

/**
 * 我的待确认邀请（C-1.1 之后的引导，也是 AC-AD18 的另一半）。
 * 这里要的正是 pending，与上面的 ACTIVE 过滤相反，因此单独一个方法。
 */
async function findPendingInvitations(userId, { tenantId } = {}) {
  const where = ["pm.user_id = ?", "pm.status = 'pending'", 'pm.deleted_at IS NULL', 'p.deleted_at IS NULL']
  const params = [userId]

  if (tenantId) {
    where.push('p.tenant_id = ?')
    params.push(tenantId)
  }

  return db.query(
    // admin_user 表没有 nickname 字段（§6.1 只定义了 username），
    // 邀请人展示名就用 username
    `SELECT pm.id, pm.project_id, pm.role, pm.owner_type, pm.created_at AS invited_at,
            p.name AS project_name, p.address AS project_address,
            p.tenant_id, t.name AS tenant_name,
            u.username AS inviter_username
       FROM project_member pm
       JOIN project p ON p.id = pm.project_id AND p.deleted_at IS NULL
       JOIN tenant t ON t.id = p.tenant_id AND t.deleted_at IS NULL
       LEFT JOIN admin_user u ON u.id = pm.invited_by
      WHERE ${where.join(' AND ')}
      ORDER BY pm.id DESC`,
    params
  )
}

/**
 * 批量取多个项目的业主与工长（C 端首页卡片）。
 *
 * 首页要展示「业主：张先生 | 工长：李师傅」，但不要把整份成员列表带上 ——
 * 手机号、邀请状态等都不该出现在项目列表的响应里。这里只取展示所需的
 * nickname / phone，由服务层决定展示名（昵称为空时才回落到脱敏手机号）。
 *
 * 必须批量查询：首页一屏可能有 10 个项目，逐个项目查成员是典型的 N+1。
 */
async function listKeyMembersOfProjects(projectIds) {
  if (projectIds.length === 0) return []

  const placeholders = projectIds.map(() => '?').join(', ')
  return db.query(
    `SELECT pm.project_id, pm.role, pm.is_primary, pm.owner_type,
            u.nickname, u.real_name, u.phone
       FROM project_member pm
       JOIN user u ON u.id = pm.user_id
      WHERE pm.project_id IN (${placeholders})
        AND pm.role IN ('owner', 'foreman')
        AND pm.status = 'active' AND pm.deleted_at IS NULL
      ORDER BY pm.project_id, FIELD(pm.role, 'foreman', 'owner'),
               pm.is_primary DESC, FIELD(pm.owner_type, 'primary', 'temporary'), pm.id ASC`,
    projectIds
  )
}

module.exports = {
  ACTIVE,
  findActiveRole,
  listUserTenants,
  findAny,
  countByRole,
  invite,
  confirm,
  reject,
  remove,
  findPrimaryForeman,
  findPrimaryOwner,
  findPrimaryOwnerSlot,
  promoteFirstTemporaryOwner,
  setPrimary,
  listByProject,
  listAcrossProjects,
  countDirectoryByRole,
  listKeyMembersOfProjects,
  findPendingById,
  findPendingInvitations,
}
