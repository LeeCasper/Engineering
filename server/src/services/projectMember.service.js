'use strict'

/**
 * 项目成员管理（B-2.6 / B-2.7 / AC-AD18~21 / AC-AD58~59）。
 *
 * ── 邀请的核心机制：按手机号，人可能还没有账号 ──
 * §5.2 的流程是「后台录入手机号 → 生成 pending 成员 → 对方在小程序确认」。
 * 被邀请人此时很可能从未登录过小程序，系统里没有他的 `user` 行，
 * 而 `project_member.user_id` 非空。因此邀请时要先按手机号
 * **建一个占位用户**（有 phone、无 openid），成员关系挂在他身上。
 *
 * 等他微信登录并绑定该手机号时，`user.model.bindPhone` 会把那个空壳账号合并进来。
 * 详见 CLAUDE.md「关键约束」第 15 条。
 */

const AppError = require('../utils/AppError')
const logger = require('../utils/logger')
const projectAccess = require('./projectAccess.service')
const dataScope = require('./dataScope.service')
const db = require('../db/pool')
const projectMemberModel = require('../models/projectMember.model')
const miniAuthService = require('./miniAuth.service')
const operationLog = require('./operationLog.service')
const { OWNER_TYPE, OWNER_TYPE_LABELS, isPrimaryOwner } = require('../utils/ownerType')

const VALID_ROLES = ['foreman', 'supervisor', 'owner']
const ROLE_LABELS = { foreman: '工长', supervisor: '监理', owner: '业主' }

/** 取项目并做数据权限 + 归档只读校验。成员相关的每个写操作都要先过这一关 */
async function loadWritableProject(operator, projectId) {
  return projectAccess.load(operator, projectId, { requireWritable: true })
}

/**
 * 解析并锁定账号的固定角色（v2.5）。
 *
 * ── 固定角色一旦确定就不能改 ──
 * 工长永远是工长、监理永远是监理；只有「业主」可以同时参与多个项目。
 * 账号第一次被邀请时确定角色，之后任何项目都只能用同一角色邀请。
 *
 * ── 为什么不清空角色后重新邀请 ──
 * 那等于给了一条「先移除、再按另一个角色邀请」的绕行路径，和用户明确要求的
 * 「不能改变」相矛盾。若确实录错，需要平台按数据修正流程处理，不能由邀请接口
 * 顺手改掉。
 */
async function resolveAccountRole(tx, user, requestedRole) {
  let role = user.role

  if (!role) {
    // 历史数据可能已经把同一个人放进多个角色；这种情况不擅自挑一个，
    // 直接拒绝并交给数据清理，避免静默改变已有项目的权限
    const existingRoles = await tx.query(
      `SELECT DISTINCT role FROM project_member
        WHERE user_id = ? AND status IN ('pending', 'active') AND deleted_at IS NULL`,
      [user.id]
    )
    if (existingRoles.length > 1) {
      throw AppError.conflict('该账号历史数据中存在多个角色，无法确定固定角色，请联系平台处理', {
        detail: { roleConflict: true, roles: existingRoles.map((row) => row.role) },
      })
    }

    role = existingRoles.length === 1 ? existingRoles[0].role : requestedRole
    await tx.query('UPDATE user SET role = ? WHERE id = ? AND role IS NULL', [role, user.id])

    // 并发邀请：两个管理员同时邀请同一个人到不同角色时，只有一个能写入。
    // 以数据库里的最终值为准，不能拿事务开始时的内存值继续写成员关系。
    const locked = await tx.queryOne('SELECT role FROM user WHERE id = ?', [user.id])
    role = locked ? locked.role : role
  }

  if (role !== requestedRole) {
    throw AppError.conflict(
      `该账号已固定为${ROLE_LABELS[role]}，不能改为${ROLE_LABELS[requestedRole]}`,
      { detail: { roleLocked: true, currentRole: role } }
    )
  }

  return role
}

/**
 * 邀请成员（B-2.6）。
 *
 * @param {object} operator 后台操作者
 * @param {number} projectId
 * @param {object} input
 * @param {string} input.phone 被邀请人手机号
 * @param {'foreman'|'supervisor'|'owner'} input.role
 */
async function invite(operator, projectId, input) {
  await loadWritableProject(operator, projectId)

  if (!VALID_ROLES.includes(input.role)) {
    throw AppError.badRequest('非法的成员角色')
  }

  const phone = miniAuthService.normalizePhone(input.phone)
  if (!phone) throw AppError.badRequest('手机号格式不正确')

  return db.withTransaction(async (tx) => {
    // 1. 找到或创建占位用户
    const user = await findOrCreateUserByPhone(tx, phone)

    // 2. 账号角色是全局固定的：工长 / 监理 / 业主不能跨项目变化
    await resolveAccountRole(tx, user, input.role)

    // 3. 看这个人当前在本项目里是什么角色
    const existing = await tx.queryOne(
      'SELECT id, role, status, owner_type FROM project_member WHERE project_id = ? AND user_id = ?',
      [projectId, user.id]
    )

    // 同一用户在同一项目内仍然只能有一个角色。历史上如果已经存在与本项目
    // 不一致的角色，说明数据不一致，不能靠「替换」把它悄悄改成新角色。
    if (existing && existing.status !== 'removed' && existing.role !== input.role) {
      throw AppError.conflict('账号角色已固定，不能替换项目角色；请使用对应角色的账号邀请', {
        detail: { roleLocked: true, currentRole: existing.role },
      })
    }

    if (existing && existing.status === 'active' && existing.role === input.role) {
      throw AppError.conflict(`该用户已是本项目的${ROLE_LABELS[input.role]}`)
    }

    // 4. 确定是否为主工长（Q11）
    //
    // 项目允许配置**多名**工长，其中有且仅有 1 名主工长。
    // 首个工长自动成为主工长，避免出现「有工长但没人能发起验收」的死角 ——
    // 那种死角一旦出现，现场只能停在那里等管理员发现。
    //
    // 查询要排除**本人**：重新邀请一位已是主工长的工长时，
    // 若不排除，他会「查到自己」从而被认为「已有主工长」，
    // 于是 is_primary 被置 0 —— 主工长身份被自己挤掉了。
    let isPrimary = false
    if (input.role === 'foreman') {
      const currentPrimary = await tx.queryOne(
        `SELECT id FROM project_member
          WHERE project_id = ? AND role = 'foreman' AND is_primary = 1
            AND status IN ('pending', 'active') AND deleted_at IS NULL
            AND user_id <> ?`,
        [projectId, user.id]
      )
      isPrimary = !currentPrimary
    }

    // 4b. 确定主业主 / 临时业主。
    //
    // 与主工长同理：首个业主（含 pending）占住主业主名额，后续业主是临时业主。
    // 查询必须排除本人，否则重新邀请当前 pending 主业主时会把自己降为临时。
    let ownerType = null
    if (input.role === 'owner') {
      const currentPrimary = await tx.queryOne(
        `SELECT id FROM project_member
          WHERE project_id = ? AND role = 'owner' AND owner_type = 'primary'
            AND status IN ('pending', 'active') AND deleted_at IS NULL
            AND user_id <> ?`,
        [projectId, user.id]
      )
      ownerType = currentPrimary ? OWNER_TYPE.TEMPORARY : OWNER_TYPE.PRIMARY
    }

    // 5. 写入或更新成员关系
    const writeMember = () =>
      projectMemberModel.invite({
        projectId,
        userId: user.id,
        role: input.role,
        invitedBy: operator.id,
        isPrimary,
        ownerType,
        tx,
      })

    try {
      await writeMember()
    } catch (err) {
      // 两个管理员同时邀请首位业主时，双方都读到「没有主业主」，
      // 唯一索引 uk_pm_primary_owner 会让其中一条失败。
      // 这不是业务错误：把后来者降为临时业主即可。
      const duplicatePrimaryKey =
        err.code === 'ER_DUP_ENTRY' && String(err.message || '').includes('uk_pm_primary_owner')
      if (ownerType !== OWNER_TYPE.PRIMARY || !duplicatePrimaryKey) throw err
      ownerType = OWNER_TYPE.TEMPORARY
      await writeMember()
    }

    const member = await tx.queryOne(
      'SELECT id, role, status, is_primary, owner_type FROM project_member WHERE project_id = ? AND user_id = ?',
      [projectId, user.id]
    )
    // 唯一键冲突时 ON DUPLICATE KEY UPDATE 可能更新到另一条行（历史上主工长
    // 唯一位被 removed 行占用时就出现过），事务内读不到本次要写入的成员关系。
    // 这里给出可读的冲突提示，而不是让下面 member.id 抛 500。
    if (!member) throw AppError.conflict('成员关系写入冲突，请刷新后重试')

    // 邀请留痕（AC-AD09 / AC-AD18）。手机号**不进日志明文** ——
    // operation_log 面向全体有权限的后台人员，而手机号是受保护的个人信息
    // （AC-U02 要求接口层面都做掩码）。日志只留掩码与成员 id，
    // 需要完整号码时从成员列表按权限取
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.MEMBER_INVITE,
        targetType: 'project_member',
        targetId: member.id,
        projectId,
        detail: {
          before: existing
            ? { role: existing.role, status: existing.status, ownerType: existing.owner_type ?? null }
            : null,
          after: {
            role: member.role,
            status: member.status,
            isPrimaryForeman: member.is_primary === 1,
            ownerType: member.owner_type ?? null,
            isPrimaryOwner: isPrimaryOwner(member),
            phoneMasked: miniAuthService.maskPhone(phone),
            isNewUser: user.__created === true,
          },
        },
      },
      tx
    )

    return {
      memberId: member.id,
      userId: user.id,
      role: member.role,
      roleLabel: ROLE_LABELS[member.role],
      ownerType: member.owner_type ?? null,
      ownerTypeLabel: member.owner_type ? OWNER_TYPE_LABELS[member.owner_type] : null,
      isPrimaryOwner: isPrimaryOwner(member),
      status: member.status,
      isPrimaryForeman: member.is_primary === 1,
      // 占位账号：说明这个人还没注册过小程序，等他绑定手机号才能看到邀请
      isNewUser: user.__created === true,
      phoneMasked: miniAuthService.maskPhone(phone),
    }
  })
}

/**
 * 指定主工长（Q11）。
 *
 * 只能指定**已确认**（active）的工长：pending 的成员不计入任何权限判定（AC-AD18），
 * 把一个还没确认的人设为主工长，等于让项目暂时没有能发起验收的人。
 */
async function setPrimaryForeman(operator, projectId, memberId) {
  await projectAccess.load(operator, projectId, { requireWritable: true })

  return db.withTransaction(async (tx) => {
    const member = await tx.queryOne(
      'SELECT id, user_id, role, status, is_primary FROM project_member WHERE id = ? AND project_id = ? AND deleted_at IS NULL',
      [memberId, projectId]
    )
    if (!member) throw AppError.notFound('成员不存在')

    if (member.role !== 'foreman') {
      throw AppError.badRequest('只能指定工长为主工长')
    }
    if (member.status !== 'active') {
      throw AppError.conflict(
        member.status === 'pending' ? '该工长尚未确认邀请，确认后才能设为主工长' : '该成员已被移除'
      )
    }
    if (member.is_primary === 1) {
      throw AppError.conflict('该工长已是主工长')
    }

    // 先记下当前主工长：setPrimary 会先清零再置位（顺序不能反，见 CLAUDE.md 第 24 条），
    // 清零之后就查不出「原来是谁」了，日志的 before 会永远是空
    const previousPrimary = await tx.queryOne(
      `SELECT id, user_id FROM project_member
        WHERE project_id = ? AND role = 'foreman' AND is_primary = 1 AND deleted_at IS NULL`,
      [projectId]
    )

    const ok = await projectMemberModel.setPrimary(projectId, member.user_id, tx)
    if (!ok) throw AppError.conflict('指定主工长失败，请刷新后重试')

    // 这是「谁能发起验收」的权限变更，日志里必须有人拍板的痕迹。
    // before 里带上原主工长，事后才能回答「当时是谁被换下来的」
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.MEMBER_SET_PRIMARY,
        targetType: 'project_member',
        targetId: memberId,
        projectId,
        detail: {
          before: previousPrimary ? { primaryMemberId: previousPrimary.id, userId: previousPrimary.user_id } : null,
          after: { primaryMemberId: memberId, userId: member.user_id },
        },
      },
      tx
    )

    return { memberId, userId: member.user_id, isPrimaryForeman: true }
  })
}

/**
 * 按手机号找到用户，没有就建占位账号。
 *
 * 占位账号的特征是 `phone` 有值、`openid` 为 NULL。
 * 不设 openid 是刻意的：这个人还没登录过，凭空造一个 openid 会与将来
 * 真实的 openid 冲突，也会让「是不是微信用户」这个判断失真。
 */
async function findOrCreateUserByPhone(tx, phone) {
  const existing = await tx.queryOne(
    'SELECT id, phone, openid, status, role, anonymized_at FROM user WHERE phone = ? AND deleted_at IS NULL',
    [phone]
  )

  if (existing) {
    // AC-U19：注销账号已匿名化，其手机号不应能直接被重新拉进项目 ——
    // 那会让一个已注销的人凭空恢复对项目的访问
    if (existing.status === 'deleted' || existing.anonymized_at) {
      throw AppError.conflict('该手机号对应的账号已注销，请让对方重新注册后再邀请')
    }
    return existing
  }

  const result = await tx.query('INSERT INTO user (phone) VALUES (?)', [phone])
  return {
    id: result.insertId,
    phone,
    openid: null,
    status: 'active',
    role: null,
    anonymized_at: null,
    __created: true,
  }
}

/**
 * 解除成员关系（B-2.7 / AC-AD21）。
 * 解除后该用户立即失去项目访问权限，但历史操作与汇报记录保留。
 */
async function removeMember(operator, projectId, memberId) {
  await loadWritableProject(operator, projectId)

  const member = await db.queryOne(
    'SELECT id, user_id, role, status, is_primary, owner_type FROM project_member WHERE id = ? AND project_id = ? AND deleted_at IS NULL',
    [memberId, projectId]
  )
  if (!member) throw AppError.notFound('成员不存在')
  if (member.status === 'removed') throw AppError.conflict('该成员已被移除')

  // 主业主身份一经确认不可变更、不可移除。
  // pending 的主业主邀请还没有生效，可以撤销（撤销后下一位被邀请的业主成为主业主）。
  if (member.role === 'owner' && member.owner_type === OWNER_TYPE.PRIMARY && member.status === 'active') {
    throw AppError.conflict('该成员是本项目的主业主。主业主身份一经确认不可移除或改指', {
      detail: { isPrimaryOwner: true },
    })
  }

  // 不能直接移除主工长（Q11 的决策）。
  // 若自动把下一位工长提为主工长，就会**静默地**改变「谁能发起验收」——
  // 这种权限变更应该有人明确拍板并在操作日志里留痕，而不是由一次删除顺带完成。
  if (member.is_primary === 1) {
    const otherForeman = await db.queryOne(
      `SELECT pm.id FROM project_member pm
        WHERE pm.project_id = ? AND pm.role = 'foreman' AND pm.status = 'active'
          AND pm.deleted_at IS NULL AND pm.user_id <> ?`,
      [projectId, member.user_id]
    )

    // 两种情形的下一步操作完全不同，提示必须分开写：
    // 有人可接手时说「去改指」，没人接手时说「先邀请一名工长」——
    // 否则管理员照着提示操作会卡在原地
    throw AppError.conflict(
      otherForeman
        ? '该成员是主工长，请先将另一位工长指定为主工长，再移除'
        : '该成员是项目唯一的主工长，移除后无人可发起验收。请先邀请并确认另一名工长，再指定其为主工长',
      { detail: { isPrimaryForeman: true, hasOtherForeman: Boolean(otherForeman) } }
    )
  }

  await projectMemberModel.remove(projectId, member.user_id)

  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.MEMBER_REMOVE,
    targetType: 'project_member',
    targetId: memberId,
    projectId,
    detail: {
      before: {
        userId: member.user_id,
        role: member.role,
        status: member.status,
        ownerType: member.owner_type ?? null,
      },
      after: { status: 'removed', ownerType: null },
    },
  })

  // ── AC-K13 / AC-K15：被移除者立即失去门锁密码的查看权，且业主被告知 ──
  // 「失去查看权」由成员关系派生（`doorCode.service.assertCanView` 查
  // project_member.status='active'），这里不需要做任何事 —— 这正是
  // 「在既有流程里顺带处理、不新增校验入口」的含义：没有第二处需要同步的地方。
  //
  // 但要提醒业主换锁：这个人在被移除之前**看得到明文密码**，
  // 他现在只是不能在系统里看了，而记在手机里的那串数字依然能开门。
  //
  // 只有曾能查看密码的角色（工长 / 监理）才值得提醒：
  // 移除另一个业主不会让他「失去」任何东西 —— 他本来就知道。
  if (member.role === 'foreman' || member.role === 'supervisor') {
    // 函数级 require：doorCode.service 经 projectAccess 与本模块有依赖交叉，
    // 顶层 require 会形成加载期循环（CLAUDE.md 第 63 条）
    const doorCodeService = require('./doorCode.service')
    await doorCodeService
      .warnOwnerToChangeLock(projectId, {
        refType: 'project_member',
        // 事件标识用成员 id：同一次移除只提醒一次，换一个人被移除是新的风险事件
        refId: memberId,
        reason: `项目的${ROLE_LABELS[member.role]}已被移出项目`,
      })
      .catch((err) => {
        // 提醒失败不能让解除成员失败 —— 后者是管理员明确的意图
        logger.error('移除成员后提醒业主更换门锁密码失败（移除已成功）', {
          projectId,
          memberId,
          message: err.message,
        })
      })
  }

  // 这里**只**改状态，不动该用户的历史数据 ——
  // AC-AD21 明确要求「其历史操作与汇报记录保留」。
  // 也不要「顺手」把他从已生成的验收单里剔除：验收流转记录是只追加的（AC-A26）
  return { memberId, status: 'removed' }
}

const MEMBER_STATUS_LABELS = { pending: '待确认', active: '已加入', removed: '已移除' }

/**
 * 成员视图。定义在这里而不是 project.service ——
 * 项目详情与成员列表都要返回同样的结构，两处各写一份迟早会漂移。
 */
function toMemberView(row) {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role,
    ownerType: row.owner_type ?? null,
    ownerTypeLabel: row.owner_type ? OWNER_TYPE_LABELS[row.owner_type] : null,
    isPrimaryOwner: row.role === 'owner' && row.owner_type === OWNER_TYPE.PRIMARY,
    // Q11：主工长是「仅他能发起验收、提交结算单」的那个人
    isPrimaryForeman: row.role === 'foreman' && row.is_primary === 1,
    status: row.status,
    statusLabel: MEMBER_STATUS_LABELS[row.status] || row.status,
    nickname: row.nickname,
    realName: row.real_name || null,
    // 后台成员列表展示用户自己设置的头像；没有头像时前端回落首字母
    avatar: row.avatar || null,
    // 手机号脱敏（与 AC-U02 同口径）。成员的完整手机号没有对外暴露的必要，
    // 管理员要联系成员时看的是项目里登记的联系方式，不是这里
    phoneMasked: miniAuthService.maskPhone(row.phone),
    invitedAt: row.invited_at ?? row.created_at,
    confirmedAt: row.confirmed_at,
    leftAt: row.left_at,
  }
}

/** 成员列表（B-2.7）。读操作，归档项目也能看 */
async function listMembers(operator, projectId) {
  await projectAccess.load(operator, projectId)

  const rows = await projectMemberModel.listByProject(projectId)
  const members = rows.map(toMemberView)

  const activeForemen = members.filter((m) => m.role === 'foreman' && m.status === 'active')
  const primary = activeForemen.find((m) => m.isPrimaryForeman)
  const activeOwners = members.filter((m) => m.role === 'owner' && m.status === 'active')
  // 主业主名额包含 pending：邀请弹窗要靠它判断下一位业主是不是临时业主
  const primaryOwnerSlot = members.find(
    (m) => m.role === 'owner' && m.ownerType === OWNER_TYPE.PRIMARY && m.status !== 'removed'
  )

  return {
    members,
    composition: {
      // 只统计 active：AC-AD18 明确 pending 不计入任何权限判定，
      // 而人数约束（AC-AD58）约束的正是「实际有权限的人」
      foremanCount: activeForemen.length,
      ownerCount: activeOwners.length,
      primaryForemanUserId: primary ? primary.userId : null,
      primaryForemanName: primary ? primary.realName || primary.nickname : null,
      primaryOwnerUserId: primaryOwnerSlot ? primaryOwnerSlot.userId : null,
      primaryOwnerName: primaryOwnerSlot ? primaryOwnerSlot.realName || primaryOwnerSlot.nickname : null,
      primaryOwnerActive: Boolean(primaryOwnerSlot && primaryOwnerSlot.status === 'active'),
      temporaryOwnerCount: activeOwners.filter((m) => m.ownerType === OWNER_TYPE.TEMPORARY).length,
    },
  }
}

/**
 * 管理端「成员」tab：跨项目成员目录（B-2.7 的只读聚合视图）。
 *
 * 成员的新增 / 移除仍然挂在具体项目下（POST/DELETE /projects/:id/members），
 * 这里只解决「我要找一个成员，但不知道他在哪个项目」的问题。
 * 数据权限与项目列表完全一致：只聚合调用者可见的项目。
 */
async function listMemberDirectory(operator, { keyword, role, projectId, paging }) {
  const scope = dataScope.buildFilter(operator)
  const filters = {
    keyword: keyword ? String(keyword).trim() || undefined : undefined,
    role,
    projectId,
  }

  const [result, roleCounts] = await Promise.all([
    projectMemberModel.listAcrossProjects(scope, { filters, paging }),
    projectMemberModel.countDirectoryByRole(scope, {
      keyword: filters.keyword,
      projectId: filters.projectId,
    }),
  ])

  return {
    list: result.rows.map((row) => ({
      ...toMemberView(row),
      projectId: row.project_id,
      projectName: row.project_name,
      projectStatus: row.project_status,
    })),
    total: result.total,
    roleCounts,
  }
}

module.exports = {
  VALID_ROLES,
  ROLE_LABELS,
  MEMBER_STATUS_LABELS,
  invite,
  setPrimaryForeman,
  removeMember,
  listMembers,
  listMemberDirectory,
  toMemberView,
  findOrCreateUserByPhone,
}
