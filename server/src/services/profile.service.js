'use strict'

/**
 * C 端个人中心（C-5.1 ~ C-5.6 / AC-U01 ~ AC-U05、AC-U14 ~ AC-U16）。
 *
 * ── 与 miniAuth.service 的分工 ──
 * `miniAuth.service` 管的是**账号身份**（登录、绑手机号、注销）；
 * 本模块管的是**用户在项目里的样子**（资料与角色、专属统计、联系人）。
 * 两者都会回用户信息，但前者的视角是「你是谁」，后者是「你在某个项目里是谁」。
 */

const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const db = require('../db/pool')
const userModel = require('../models/user.model')
const projectMemberModel = require('../models/projectMember.model')
const miniAuthService = require('./miniAuth.service')
const { ownerRoleLabel, isPrimaryOwner } = require('../utils/ownerType')

const ROLE_LABELS = { foreman: '工长', supervisor: '监理', owner: '业主' }

/**
 * 个人资料（AC-U01 / AC-U02）。
 *
 * ── projectId 是可选的，这决定了角色的语义 ──
 * v2.5 起角色是**账号级固定**的：工长、监理不会因为切换项目而改变，
 * 业主可以参与多个项目。传了 projectId 就回该项目里的角色（必须与
 * accountRole 一致），不传则项目角色为 null，但仍返回 accountRole。
 *
 * ── 传了不是自己项目的 id 时返回 role: null，不是 404 ──
 * AC-P26 要求 C 端不泄露项目是否存在。若「不是成员」返回 403/404 而
 * 「项目不存在」返回另一种，两者一比就能探出某个 id 是否真实存在。
 */
async function getProfile(userId, { projectId } = {}) {
  const user = await userModel.findById(userId)
  if (!user) throw AppError.notFound('用户不存在')

  // 被邀请进入项目后必须完成实名认证；还没被邀请时可以留空。
  // pending 也算「被邀请」：不认证就不能确认邀请。
  const membershipCount = await db.count(
    `FROM project_member
      WHERE user_id = ? AND status IN ('pending', 'active') AND deleted_at IS NULL`,
    [userId]
  )
  const realNameVerified = user.real_name_status === 'verified'
  const requiresRealNameAuth = membershipCount > 0 && !realNameVerified

  const profile = {
    id: user.id,
    nickname: user.nickname,
    realName: user.real_name,
    // 兼容旧字段名：语义已从「姓名为空」升级为「未完成实名认证」
    requiresRealName: requiresRealNameAuth,
    requiresRealNameAuth,
    realNameStatus: user.real_name_status || 'none',
    realNameVerified,
    realNameVerifiedAt: user.real_name_verified_at || null,
    realNameVerifyMethod: user.real_name_verify_method || null,
    idCardMask: user.id_card_mask || null,
    avatar: user.avatar,
    // AC-U02：只回脱敏手机号，接口不做完整回显
    phoneMasked: miniAuthService.maskPhone(user.phone),
    hasPhone: Boolean(user.phone),
    lastLoginAt: user.last_login_at,
    // 账号级固定角色（v2.5）。项目内角色必须与它一致；这里单独返回，
    // 便于「我的」页在没有项目上下文时也能说明这个账号固定是什么角色。
    accountRole: user.role,
    accountRoleLabel: user.role ? ROLE_LABELS[user.role] : null,
    projectId: projectId ?? null,
    role: null,
    roleLabel: null,
    ownerType: null,
    isPrimaryOwner: false,
    isPrimaryForeman: false,
  }

  if (!projectId) return profile

  const member = await projectMemberModel.findActiveRole(projectId, userId)
  if (!member) return profile

  return {
    ...profile,
    role: member.role,
    roleLabel: ownerRoleLabel(member.role, member.owner_type),
    ownerType: member.owner_type ?? null,
    isPrimaryOwner: isPrimaryOwner(member),
    // 主工长标记（Q11）：界面上要能区分「工长」与「主工长」，
    // 因为只有后者能发起验收 —— 不显示的话，普通工长会以为自己也能
    isPrimaryForeman: member.role === 'foreman' && member.is_primary === 1,
  }
}

/**
 * 工长专属统计（C-5.5 / AC-U14）：本月汇报数、待整改数、待验收数。
 *
 * ── 「我的」与「项目的」混用是有意的 ──
 * 文档写的是「**我的**汇报统计」，但三项里只有第一项真的是「我的」：
 *   - 本月汇报数：我提交的（确实是我的产出）
 *   - 待整改数：本项目处于待整改的验收单（谁提交的都要整改）
 *   - 待验收数：本项目正在流转中的验收单（多工长下，等的是别人也是等）
 *
 * 若后两项也按提交人过滤，普通工长（非主工长）看到的永远是 0 ——
 * 因为只有主工长能发起验收（Q11）。对一个「待办」性质的数字来说，
 * 恒为 0 比不展示更糟：他会以为自己没有待办。
 *
 * ── 统计口径必须与验收模块一致（AC-U14 的「与进度、验收模块的统计一致」）──
 * 待整改取 `pending_rectify`，待验收取「已提交、还没走完」的两个环节，
 * 两者都直接读 `acceptance.status`，不另设状态映射表。
 */
async function getMyStats(userId, projectId) {
  const member = await projectMemberModel.findActiveRole(projectId, userId)
  if (!member) throw AppError.notFound('项目不存在')

  // C-5.5 明确是「工长专属」。其余角色拿到一份空统计没有意义，
  // 反而会让前端以为「有数据但都是 0」
  if (member.role !== 'foreman') {
    throw AppError.forbidden('仅工长可查看汇报统计')
  }

  const monthStart = datetime.dayjs().startOf('month').format(datetime.DATETIME_FORMAT)
  const monthEnd = datetime.dayjs().add(1, 'month').startOf('month').format(datetime.DATETIME_FORMAT)

  const [reportCount, rectifyCount, pendingCount] = await Promise.all([
    db.count(
      `FROM progress_report
        WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL
          AND created_at >= ? AND created_at < ?`,
      [projectId, userId, monthStart, monthEnd]
    ),
    db.count(
      "FROM acceptance WHERE project_id = ? AND status = 'pending_rectify' AND deleted_at IS NULL",
      [projectId]
    ),
    db.count(
      `FROM acceptance
        WHERE project_id = ? AND status IN ('pending_supervisor', 'pending_owner') AND deleted_at IS NULL`,
      [projectId]
    ),
  ])

  return {
    scope: 'project',
    projectId,
    month: monthStart.slice(0, 7),
    monthReportCount: reportCount,
    pendingRectifyCount: rectifyCount,
    pendingAcceptanceCount: pendingCount,
  }
}

/**
 * 工长的跨项目汇报统计（v2.5）。
 *
 * 「我的」页在没有选中具体项目时展示全部项目汇总；选中项目后仍走
 * `getMyStats(projectId)` 的单项目口径。两者共用同一组状态定义：
 * 待整改 = pending_rectify，待验收 = pending_supervisor / pending_owner。
 */
async function getMyStatsAll(userId) {
  const user = await userModel.findById(userId)
  if (!user) throw AppError.notFound('用户不存在')
  if (user.role !== 'foreman') throw AppError.forbidden('仅工长可查看汇报统计')

  const monthStart = datetime.dayjs().startOf('month').format(datetime.DATETIME_FORMAT)
  const monthEnd = datetime.dayjs().add(1, 'month').startOf('month').format(datetime.DATETIME_FORMAT)

  const [projectCount, reportCount, rectifyCount, pendingCount] = await Promise.all([
    db.count(
      `FROM project_member pm
        JOIN project p ON p.id = pm.project_id AND p.deleted_at IS NULL AND p.status <> 'archived'
       WHERE pm.user_id = ? AND pm.role = 'foreman'
         AND pm.status = 'active' AND pm.deleted_at IS NULL`,
      [userId]
    ),
    db.count(
      `FROM progress_report pr
        JOIN project p ON p.id = pr.project_id AND p.deleted_at IS NULL AND p.status <> 'archived'
        JOIN project_member pm ON pm.project_id = p.id AND pm.user_id = ?
             AND pm.role = 'foreman' AND pm.status = 'active' AND pm.deleted_at IS NULL
       WHERE pr.user_id = ? AND pr.deleted_at IS NULL
         AND pr.created_at >= ? AND pr.created_at < ?`,
      [userId, userId, monthStart, monthEnd]
    ),
    db.count(
      `FROM acceptance a
        JOIN project p ON p.id = a.project_id AND p.deleted_at IS NULL AND p.status <> 'archived'
        JOIN project_member pm ON pm.project_id = p.id AND pm.user_id = ?
             AND pm.role = 'foreman' AND pm.status = 'active' AND pm.deleted_at IS NULL
       WHERE a.status = 'pending_rectify' AND a.deleted_at IS NULL`,
      [userId]
    ),
    db.count(
      `FROM acceptance a
        JOIN project p ON p.id = a.project_id AND p.deleted_at IS NULL AND p.status <> 'archived'
        JOIN project_member pm ON pm.project_id = p.id AND pm.user_id = ?
             AND pm.role = 'foreman' AND pm.status = 'active' AND pm.deleted_at IS NULL
       WHERE a.status IN ('pending_supervisor', 'pending_owner') AND a.deleted_at IS NULL`,
      [userId]
    ),
  ])

  return {
    scope: 'all',
    projectCount,
    month: monthStart.slice(0, 7),
    monthReportCount: reportCount,
    pendingRectifyCount: rectifyCount,
    pendingAcceptanceCount: pendingCount,
  }
}

/**
 * 一键联系工长 / 监理（C-5.6 / AC-U15）。
 *
 * ── 为什么这里返回**完整手机号**，而 AC-U02 要求脱敏 ──
 * AC-U02 约束的是「个人资料不做完整回显」—— 那说的是**用户自己**的资料页。
 * AC-U15 的功能就是拨号，脱敏后的号码拨不出去。
 *
 * 两者的边界靠**可见范围**来守，而不是靠打码：
 *   - 只有业主能调本接口（C-5.6 明确写「业主专属」）；
 *   - 只返回本项目的工长与监理，不返回其他业主 —— 业主之间没有互相联系的需求，
 *     而多业主的家庭住址、手机号彼此可见是明显的隐私问题；
 *   - 成员关系本身就是可见性授权：被邀请进同一个项目，就意味着同意被对方联系。
 *
 * 不做读取留痕（与门锁密码不同）：门锁密码是物理安全凭证，泄露的后果是有人能进门；
 * 手机号是项目内部的正常协作信息。为后者每次点按写一条审计日志，
 * 只会把 operation_log 冲成噪音，让真正的变更记录淹没在里面。
 */
async function getContacts(userId, projectId) {
  const member = await projectMemberModel.findActiveRole(projectId, userId)
  if (!member) throw AppError.notFound('项目不存在')

  if (member.role !== 'owner') {
    throw AppError.forbidden('仅业主可查看工长与监理的联系方式')
  }

  const rows = await db.query(
    `SELECT pm.role, pm.is_primary, u.nickname, u.real_name, u.phone
       FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pm.project_id = ?
        AND pm.role IN ('foreman', 'supervisor')
        AND pm.status = 'active'
        AND pm.deleted_at IS NULL
      -- 主工长排最前：业主最常联系的是他，而「先联系谁」在界面上的默认顺序
      -- 就是这个排序
      ORDER BY FIELD(pm.role, 'foreman', 'supervisor'), pm.is_primary DESC, pm.id`,
    [projectId]
  )

  // 没有手机号的成员不进列表：给了名字却拨不出去，界面上会变成一个点了没反应的按钮。
  // 这种情况真实存在 —— 邀请时建的占位账号在对方绑定手机号之前是没有号码的
  const contacts = rows
    .filter((r) => r.phone)
    .map((r) => ({
      role: r.role,
      roleLabel: ROLE_LABELS[r.role],
      name: r.real_name || r.nickname || r.roleLabel,
      phone: r.phone,
      isPrimaryForeman: r.is_primary === 1,
    }))

  return {
    projectId,
    contacts,
    // AC-U15：「项目未配置监理时不展示该入口」。给一个显式布尔值，
    // 免得前端为了这一点去遍历数组判断角色
    hasSupervisor: contacts.some((c) => c.role === 'supervisor'),
  }
}

/**
 * 被邀请（pending/active）且尚未完成实名认证。
 * 邀请确认与资料清空都要用它，避免只在前端拦截。
 */
async function requiresRealName(userId) {
  const user = await userModel.findById(userId)
  if (!user || user.real_name_status === 'verified') return false
  const count = await db.count(
    `FROM project_member
      WHERE user_id = ? AND status IN ('pending', 'active') AND deleted_at IS NULL`,
    [userId]
  )
  return count > 0
}

module.exports = { ROLE_LABELS, getProfile, getMyStats, getMyStatsAll, getContacts, requiresRealName }
