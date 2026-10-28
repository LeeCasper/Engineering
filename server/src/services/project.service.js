'use strict'

/**
 * 项目服务。
 *
 * 覆盖 C 端的项目列表（C-1.2~1.5）与 B 端的建档、状态机、归档删除（B-2.x）。
 * 成员管理在 projectMember.service.js，付款节点在 paymentNode.service.js。
 */

const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const logger = require('../utils/logger')
const progress = require('../utils/progress')
const { lockedReasonFor } = require('../utils/stage')
const money = require('../utils/money')
const { OWNER_TYPE, ownerRoleLabel, isPrimaryOwner } = require('../utils/ownerType')
const dataScope = require('./dataScope.service')
const projectAccess = require('./projectAccess.service')
const mapService = require('./map.service')
const db = require('../db/pool')
const projectModel = require('../models/project.model')
const projectStageModel = require('../models/projectStage.model')
const projectMemberModel = require('../models/projectMember.model')
const userModel = require('../models/user.model')
const stageTemplateModel = require('../models/stageTemplate.model')
const paymentNodeModel = require('../models/paymentNode.model')
const sysConfigService = require('./sysConfig.service')
// 单向依赖：projectMember.service 不反向引用本模块，因此不会形成循环
const projectMemberService = require('./projectMember.service')
const operationLog = require('./operationLog.service')
// 配额检查（M13 P3）。tenant.service 不反向引用本模块，不会形成循环
const tenantService = require('./tenant.service')

/** 角色与状态的展示文案。放服务端而不是前端，保证多端一致 */
const ROLE_LABELS = { foreman: '工长', supervisor: '监理', owner: '业主' }
const STATUS_LABELS = { pending: '待开工', building: '施工中', finished: '已完工', archived: '已归档' }

/**
 * 项目状态机（B-2.10）。
 * 仅允许正向流转；反向流转需二次确认（AC-AD24 / AC-AD55）。
 */
const STATUS_ORDER = ['pending', 'building', 'finished', 'archived']

// ─────────────────────────────────────────────────────────────
// C 端：我的项目（C-1.2 ~ C-1.5）
// ─────────────────────────────────────────────────────────────

async function myProjects(userId, { tenantId } = {}) {
  const rows = await projectModel.listByUser(userId, { tenantId })
  const pendingInvitations = await projectMemberModel.findPendingInvitations(userId, { tenantId })

  const stages = await projectModel.listStagesOfProjects(rows.map((r) => r.id))
  const stagesByProject = groupBy(stages, 'project_id')

  // 首页卡片要展示业主/工长，但不该把整份成员列表带进列表响应。
  // 只取 active 的 owner/foreman，展示名在服务层脱敏（见 memberDisplayName）。
  const keyMembers = await projectMemberModel.listKeyMembersOfProjects(rows.map((r) => r.id))
  const membersByProject = groupBy(keyMembers, 'project_id')

  const items = rows.map((row) =>
    toProjectSummary(row, stagesByProject.get(row.id) || [], membersByProject.get(row.id) || [])
  )

  const groups = [
    { key: 'managed', label: '我负责的', items: items.filter((it) => it.myRole === 'foreman') },
    { key: 'participating', label: '我参与的', items: items.filter((it) => it.myRole !== 'foreman') },
  ].filter((group) => group.items.length > 0)

  // 一个工长可能同时给两家装修公司干活。这里按租户汇总，
  // 前端据此显示「切换公司」入口 —— 只有 1 个租户时它不会出现。
  const tenantMap = new Map()
  for (const item of items) {
    if (!item.tenantId) continue
    const entry = tenantMap.get(item.tenantId) || { id: item.tenantId, name: item.tenantName, projectCount: 0 }
    entry.projectCount += 1
    tenantMap.set(item.tenantId, entry)
  }
  const tenants = [...tenantMap.values()].sort((a, b) => a.id - b.id)

  return {
    groups,
    total: items.length,
    tenants,
    // C-1.3：恰好一个项目且无待确认邀请时才自动进入。
    // 有待确认邀请却直接进项目，用户会错过确认入口
    autoEnterProjectId: items.length === 1 && pendingInvitations.length === 0 ? items[0].id : null,
    // C-1.5：没有任何项目时前端展示引导页，联系方式由后台配置。
    // 传了 tenantId 就用该租户的联系方式；否则用平台默认的联系方式
    supportContact:
      items.length === 0 ? await sysConfigService.getRaw(tenantId ?? null, 'support_contact') : null,
    pendingInvitations: pendingInvitations.map((row) => ({
      memberId: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      projectAddress: row.project_address,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      role: row.role,
      roleLabel: ownerRoleLabel(row.role, row.owner_type),
      ownerType: row.owner_type ?? null,
      invitedAt: row.invited_at,
      invitedBy: row.inviter_username,
    })),
  }
}

/**
 * 项目总进度用与阶段详情、后台看板**同一个** progress.projectProgress 计算 ——
 * 三处各算一遍是「看板数字和详情对不上」的经典来源（AC-AD38 要求同源）。
 */
function toProjectSummary(row, stages, members = []) {
  const total = progress.projectProgress(stages.map((s) => ({ progress: s.progress, weight: s.weight })))
  const current = pickCurrentStage(stages)
  // 主业主优先；没有主业主时才回退第一位业主（兼容数据异常）
  const owner =
    members.find((m) => m.role === 'owner' && m.owner_type === OWNER_TYPE.PRIMARY) ||
    members.find((m) => m.role === 'owner')
  const primaryForeman = members.find((m) => m.role === 'foreman' && Number(m.is_primary) === 1)
  const foreman = primaryForeman || members.find((m) => m.role === 'foreman')

  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name ?? null,
    name: row.name,
    address: row.address,
    coverUrl: row.cover_url || null,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    myRole: row.my_role,
    myRoleLabel: ownerRoleLabel(row.my_role, row.my_owner_type),
    ownerType: row.my_owner_type ?? null,
    isPrimaryOwner: row.my_role === 'owner' && row.my_owner_type === OWNER_TYPE.PRIMARY,
    // 首页卡片的「业主 / 工长」展示位。没有成员时返回「待分配」，
    // 让前端不必自己判断 null；昵称为空时用脱敏手机号（AC-U02）。
    ownerName: memberDisplayName(owner, '待分配'),
    foremanName: memberDisplayName(foreman, '待分配'),
    area: row.area,
    progress: total,
    currentStageName: current ? current.name : null,
    currentStageGateStatus: current ? current.gate_status : null,
    // 首页只展示 3 个阶段胶囊，但阶段数量随模板变化；
    // 完整摘要交给前端按 seq 取「当前阶段起连续 3 个」。
    stages: stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      seq: stage.seq,
      progress: stage.progress,
      status: stage.status,
      gateStatus: stage.gate_status,
    })),
    hasCoordinates: row.longitude !== null && row.latitude !== null,
    startDate: row.start_date,
    planEndDate: row.plan_end_date,
    actualEndDate: row.actual_end_date,
    isOverdue: isOverdue(row),
  }
}

/**
 * 成员展示名：昵称优先，其次脱敏手机号，最后回落到角色占位文案。
 * 项目列表里**不能**出现完整手机号 —— 那是成员管理页的权限范围。
 */
function memberDisplayName(member, fallback) {
  if (!member) return fallback
  if (member.nickname) return member.nickname
  return member.phone ? maskPhone(member.phone) : fallback
}

/** 当前阶段 = 第一个尚未结清的阶段 */
function pickCurrentStage(stages) {
  if (stages.length === 0) return null
  const sorted = [...stages].sort((a, b) => a.seq - b.seq)
  return sorted.find((s) => s.gate_status !== 'settled') || sorted[sorted.length - 1]
}

/**
 * 延期判定（§5.4 统计口径）：
 * 已完工项目以 actual_end_date 与 plan_end_date 比较，判定结果**冻结**；
 * 未完项目以当前日期与 plan_end_date 比较。
 *
 * 若一律用当前日期，2019 年就按期完工的项目今天看会变成「延期 6 年」。
 */
function isOverdue(row) {
  if (!row.plan_end_date) return false
  if (row.status === 'archived') return false

  const referenceDate = row.actual_end_date || datetime.formatDate()
  return datetime.parse(referenceDate).isAfter(datetime.parse(row.plan_end_date), 'day')
}

/**
 * 确认项目邀请（AC-AD18 → AC-AD19）。
 * 查询条件带 user_id：memberId 是自增主键、可被枚举。
 */
async function confirmInvitation(userId, memberId) {
  const member = await projectMemberModel.findPendingById(memberId, userId)
  if (!member) throw AppError.notFound('邀请不存在或已处理')

  // 角色是账号级固定的。邀请发出时已经写进 user.role；确认时再校验一次，
  // 防止历史数据或并发邀请把同一个账号放进不同角色。
  const user = await userModel.findById(userId)
  if (!user) throw AppError.notFound('用户不存在')

  if (!user.role) {
    // 历史数据可能没有 user.role，但已经在别的项目里是另一个角色。
    // 此时不能凭这一条邀请就把账号「选定」成新角色，否则会制造新的不一致。
    const otherRoles = await db.query(
      `SELECT DISTINCT role FROM project_member
        WHERE user_id = ? AND status IN ('pending', 'active') AND deleted_at IS NULL AND id <> ?`,
      [userId, memberId]
    )
    if (otherRoles.some((row) => row.role !== member.role)) {
      throw AppError.conflict('该账号历史数据中存在多个角色，无法确认邀请，请联系平台处理', {
        detail: { roleConflict: true },
      })
    }
    await db.query('UPDATE user SET role = ? WHERE id = ? AND role IS NULL', [member.role, userId])
    const locked = await userModel.findById(userId)
    if (!locked || locked.role !== member.role) {
      throw AppError.conflict('该账号已被另一个项目锁定为其他角色，无法确认邀请', {
        detail: { roleLocked: true, currentRole: locked ? locked.role : null },
      })
    }
  } else if (user.role !== member.role) {
    throw AppError.conflict(
      `该账号已固定为${ROLE_LABELS[user.role]}，不能确认${ROLE_LABELS[member.role]}项目的邀请`,
      { detail: { roleLocked: true, currentRole: user.role } }
    )
  }

  const done = await projectMemberModel.confirm(member.project_id, userId)
  if (!done) throw AppError.conflict('邀请已被处理')

  return {
    projectId: member.project_id,
    role: member.role,
    roleLabel: ownerRoleLabel(member.role, member.owner_type),
    ownerType: member.owner_type ?? null,
    isPrimaryOwner: member.role === 'owner' && member.owner_type === OWNER_TYPE.PRIMARY,
  }
}

/** 拒绝项目邀请。文档未规定，按现实需要补充（手机号录错时不能永远挂着） */
async function rejectInvitation(userId, memberId) {
  const member = await projectMemberModel.findPendingById(memberId, userId)
  if (!member) throw AppError.notFound('邀请不存在或已处理')

  const done = await projectMemberModel.reject(member.project_id, userId)
  if (!done) throw AppError.conflict('邀请已被处理')

  return { projectId: member.project_id, rejected: true }
}

/**
 * C 端项目详情。
 *
 * 可见性由 **project_member** 决定，不走后台的 dataScope —— 两者的授权模型
 * 完全不同：后台是「管理员能管哪些项目」，C 端是「这个人参与了哪些项目」。
 *
 * AC-P26 要求「访问非本人参与的项目返回 403/404 **且不泄露项目是否存在**」，
 * 因此无权与不存在一律返回 404，且提示文案完全相同。
 * 这与后台的处理相反（后台直接 403「无权访问」）—— 后台面对的是内部人员，
 * C 端面对的是外部用户，前者告知有助于排查，后者告知等于泄露他人项目是否存在。
 */
async function getProjectForMember(userId, projectId) {
  const role = await projectMemberModel.findActiveRole(projectId, userId)
  if (!role) throw AppError.notFound('项目不存在')

  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')

  // 详情页头部要展示「业主 / 主工长」，与首页卡片保持同一套脱敏规则。
  // 成员数量与「是否有监理」供快捷入口展示，避免前端为两个数字再发两次请求。
  const [tree, keyMembers, memberCount, supervisorCount] = await Promise.all([
    projectStageModel.findTreeByProject(projectId),
    projectMemberModel.listKeyMembersOfProjects([projectId]),
    projectMemberModel.countByRole(projectId),
    projectMemberModel.countByRole(projectId, 'supervisor'),
  ])

  const owner =
    keyMembers.find((m) => m.role === 'owner' && m.owner_type === OWNER_TYPE.PRIMARY) ||
    keyMembers.find((m) => m.role === 'owner')
  const foreman =
    keyMembers.find((m) => m.role === 'foreman' && Number(m.is_primary) === 1) ||
    keyMembers.find((m) => m.role === 'foreman')
  const currentStage = pickCurrentStage(tree)

  return {
    id: project.id,
    tenantId: project.tenant_id,
    name: project.name,
    address: project.address,
    coverUrl: project.cover_url || null,
    status: project.status,
    statusLabel: STATUS_LABELS[project.status] || project.status,
    area: project.area,
    startDate: project.start_date,
    planEndDate: project.plan_end_date,
    actualEndDate: project.actual_end_date,
    longitude: project.longitude,
    latitude: project.latitude,
    hasCoordinates: project.longitude !== null && project.latitude !== null,
    myRole: role.role,
    myRoleLabel: ownerRoleLabel(role.role, role.owner_type),
    ownerType: role.owner_type ?? null,
    // 主业主才能确认验收 / 付款 / 对账；临时业主的普通能力与业主一致
    isPrimaryOwner: isPrimaryOwner(role),
    // Q11：主工长才能发起验收。详情页据此决定「发起验收」是否出现
    isPrimaryForeman: role.role === 'foreman' && Number(role.is_primary) === 1,
    ownerName: memberDisplayName(owner, '待分配'),
    foremanName: memberDisplayName(foreman, '待分配'),
    memberCount,
    hasSupervisor: supervisorCount > 0,
    progress: progress.projectProgress(tree.map((s) => ({ progress: s.progress, weight: s.weight }))),
    currentStageId: currentStage ? currentStage.id : null,
    currentStageName: currentStage ? currentStage.name : null,
    currentStageGateStatus: currentStage ? currentStage.gate_status : null,
    currentStageProgress: currentStage ? currentStage.progress : null,
    isOverdue: isOverdue(project),
    stages: tree.map((stage) => ({
      id: stage.id,
      name: stage.name,
      seq: stage.seq,
      status: stage.status,
      gateStatus: stage.gate_status,
      progress: stage.progress,
      planStart: stage.plan_start,
      planEnd: stage.plan_end,
      // C-2.13：锁定状态要能说明原因，前端据此渲染提示
      lockedReason: stage.gate_status === 'locked' ? lockedReasonFor(tree, stage) : null,
      items: stage.items.map((item) => ({
        id: item.id,
        name: item.name,
        seq: item.seq,
        progress: item.progress,
        status: item.status,
      })),
    })),
  }
}

// ─────────────────────────────────────────────────────────────
// B 端：列表与详情
// ─────────────────────────────────────────────────────────────

/**
 * 项目列表（AC-AD11）。
 * 数据权限由 dataScope 统一施加，列表、详情、导出共用同一段过滤条件。
 */
async function listProjects(operator, query) {
  const scope = dataScope.buildFilter(operator)

  const { total, rows } = await projectModel.list({
    scope,
    filters: {
      name: query.name,
      address: query.address,
      status: query.status,
      foremanId: query.foremanId,
      templateId: query.templateId,
    },
    paging: query.paging,
    sort: query.sort,
  })

  // 列表需要的工长、进度都是一次批量查回再组装，避免逐项目查询
  const projectIds = rows.map((r) => r.id)
  const [members, stages] = await Promise.all([
    projectModel.listForemenOfProjects(projectIds),
    projectModel.listStagesOfProjects(projectIds),
  ])

  const membersByProject = groupBy(members, 'project_id')
  const stagesByProject = groupBy(stages, 'project_id')

  const list = rows.map((row) => {
    const stageRows = stagesByProject.get(row.id) || []
    const projectMembers = membersByProject.get(row.id) || []
    const foreman =
      projectMembers.find((m) => m.role === 'foreman' && m.status === 'active' && Number(m.is_primary) === 1) ||
      projectMembers.find((m) => m.role === 'foreman' && m.status === 'active')
    const owner =
      projectMembers.find(
        (m) => m.role === 'owner' && m.status === 'active' && m.owner_type === OWNER_TYPE.PRIMARY
      ) || projectMembers.find((m) => m.role === 'owner' && m.status === 'active')

    return {
      id: row.id,
      name: row.name,
      address: row.address,
      // 没有封面时前端回落内置占位图，后端不编造默认图
      coverUrl: row.cover_url || null,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] || row.status,
      area: row.area,
      contractAmount: row.contract_amount,
      startDate: row.start_date,
      planEndDate: row.plan_end_date,
      actualEndDate: row.actual_end_date,
      templateId: row.template_id,
      progress: progress.projectProgress(stageRows.map((s) => ({ progress: s.progress, weight: s.weight }))),
      currentStageName: (pickCurrentStage(stageRows) || {}).name || null,
      foreman: foreman ? { userId: foreman.user_id, nickname: foreman.nickname } : null,
      foremanName: memberDisplayName(foreman, '待分配'),
      ownerName: memberDisplayName(owner, '待分配'),
      isOverdue: isOverdue(row),
      archivedAt: row.archived_at,
      createdAt: row.created_at,
    }
  })

  return { list, total, page: query.paging.page, pageSize: query.paging.pageSize }
}

/**
 * 管理端概览统计（工作台 / 项目状态筛选计数）。
 *
 * 数学口径全部在 model 层用同一条 dataScope 过滤完成；这里只负责把
 * 参考日期固定成服务端的「今天」，避免数据库与 Node 时区不同导致
 * 工作台数字与列表卡片上的 isOverdue 对不上。
 */
async function getProjectStats(operator) {
  const scope = dataScope.buildFilter(operator)
  return projectModel.getStats(scope, { today: datetime.formatDate() })
}

/** 项目详情（B-2.4）：概览 + 阶段工序树 + 成员 + 付款节点 + 概况 */
async function getProjectDetail(operator, projectId) {
  // 读操作：归档项目一样能看（归档只是禁止写，AC-AD25）
  const project = await projectAccess.load(operator, projectId)

  const [tree, members, paymentNodes] = await Promise.all([
    projectStageModel.findTreeByProject(projectId),
    projectMemberModel.listByProject(projectId),
    paymentNodeModel.listByProject(projectId),
  ])

  const activeForemen = members.filter((m) => m.role === 'foreman' && m.status === 'active')
  const activeOwners = members.filter((m) => m.role === 'owner' && m.status === 'active')
  const ownerCount = activeOwners.length
  const primary = activeForemen.find((m) => m.is_primary === 1)
  const primaryOwnerSlot = members.find(
    (m) => m.role === 'owner' && m.owner_type === OWNER_TYPE.PRIMARY && m.status !== 'removed'
  )

  return {
    id: project.id,
    name: project.name,
    address: project.address,
    coverUrl: project.cover_url || null,
    status: project.status,
    statusLabel: STATUS_LABELS[project.status] || project.status,
    area: project.area,
    contractAmount: project.contract_amount,
    startDate: project.start_date,
    planEndDate: project.plan_end_date,
    actualEndDate: project.actual_end_date,
    remark: project.remark,
    longitude: project.longitude,
    latitude: project.latitude,
    // 未解析出坐标时前端展示「手工拾取」入口（AC-AD54）
    needsCoordinates: project.longitude === null || project.latitude === null,
    templateId: project.template_id,
    createdBy: project.created_by,
    archivedAt: project.archived_at,
    progress: progress.projectProgress(tree.map((s) => ({ progress: s.progress, weight: s.weight }))),
    isOverdue: isOverdue(project),
    stages: tree.map((stage) => ({
      id: stage.id,
      name: stage.name,
      seq: stage.seq,
      weight: stage.weight,
      status: stage.status,
      gateStatus: stage.gate_status,
      progress: stage.progress,
      planStart: stage.plan_start,
      planEnd: stage.plan_end,
      actualStart: stage.actual_start,
      actualEnd: stage.actual_end,
      unlockedAt: stage.unlocked_at,
      settledAt: stage.settled_at,
      items: stage.items.map((item) => ({
        id: item.id,
        name: item.name,
        seq: item.seq,
        weight: item.weight,
        progress: item.progress,
        status: item.status,
        planStart: item.plan_start,
        planEnd: item.plan_end,
      })),
    })),
    members: members.map(projectMemberService.toMemberView),
    paymentNodes: paymentNodes.map((node) => ({
      id: node.id,
      seq: node.seq,
      name: node.name,
      amount: node.amount,
      triggerType: node.trigger_type,
      triggerStageId: node.trigger_stage_id,
      status: node.status,
      unlockedAt: node.unlocked_at,
    })),
    // 人数约束的当前状态（AC-AD58）。放进详情是为了让管理员一眼看到缺什么，
    // 而不是等到流转被拒才知道
    memberComposition: {
      foremanCount: activeForemen.length,
      ownerCount,
      primaryForemanUserId: primary ? primary.user_id : null,
      primaryForemanName: primary ? primary.nickname : null,
      // 主业主名额包含 pending：管理员邀请下一位业主时要据此判断是否为临时业主
      primaryOwnerUserId: primaryOwnerSlot ? primaryOwnerSlot.user_id : null,
      primaryOwnerName: primaryOwnerSlot ? primaryOwnerSlot.nickname : null,
      primaryOwnerActive: Boolean(primaryOwnerSlot && primaryOwnerSlot.status === 'active'),
      temporaryOwnerCount: activeOwners.filter((m) => m.owner_type === OWNER_TYPE.TEMPORARY).length,
      // 与 assertMemberComposition 的口径一致：至少 1 名工长且有主工长、至少 1 名业主且有主业主。
      // 两处的条件必须一样，否则会出现「详情显示已配齐、流转时却被拒」
      meetsRequirement:
        activeForemen.length >= 1 &&
        Boolean(primary) &&
        ownerCount >= 1 &&
        Boolean(primaryOwnerSlot && primaryOwnerSlot.status === 'active'),
    },
  }
}

function maskPhone(phone) {
  if (!phone) return null
  const value = String(phone)
  if (value.length === 11) return `${value.slice(0, 3)}****${value.slice(-4)}`
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(1, value.length - 4))}${value.slice(-2)}`
}

// ─────────────────────────────────────────────────────────────
// B 端：建档
// ─────────────────────────────────────────────────────────────

/**
 * 新建项目（B-2.3 / B-2.5）。
 *
 * 建档是**事务**操作：项目行与由模板生成的阶段工序必须一起成功或一起失败。
 * 否则会留下一个「有项目但没有阶段」的空壳 —— 那种项目在 C 端完全没法用，
 * 而且管理员看不出问题出在哪（列表里它看起来很正常）。
 */
async function createProject(operator, input) {
  const templateId = await resolveTemplateId(input.templateId, operator.tenantId)
  const structure = await stageTemplateModel.findStructure(templateId)

  if (structure.length === 0) {
    // AC-AD64：模板至少包含 1 个阶段。模板侧已拦，这里是数据被改坏时的兜底
    throw AppError.badRequest('所选阶段模板没有任何阶段，无法生成项目结构')
  }

  // 地图选点坐标优先：管理员已经在地图上确认过的位置，不再让地址解析覆盖。
  // 没有手工坐标时才走原有地理编码；失败不阻断建档（AC-AD54）。
  const hasManualCoordinates = input.longitude !== undefined && input.latitude !== undefined
  const coordinates = hasManualCoordinates
    ? { longitude: input.longitude, latitude: input.latitude }
    : await mapService.geocode(input.address)
  const coordinateSource = hasManualCoordinates ? 'manual' : coordinates ? 'geocode' : 'none'

  // B-2.3：同一管理员下重名时告警，但**允许保存** —— 返回 warning 而不是抛错
  const duplicate = await db.queryOne(
    'SELECT id FROM project WHERE name = ? AND created_by = ? AND deleted_at IS NULL LIMIT 1',
    [input.name, operator.id]
  )

  const projectId = await db.withTransaction(async (tx) => {
    // 配额必须在事务内、且在建档之前检查：它会锁住 tenant 行，
    // 让并发建档串行化（见 tenant.service.assertProjectQuota 的说明）
    await tenantService.assertProjectQuota(operator.tenantId, tx)

    const id = await projectModel.create(
      {
        tenantId: operator.tenantId,
        name: input.name,
        address: input.address,
        coverUrl: input.coverUrl || null,
        longitude: coordinates ? coordinates.longitude : null,
        latitude: coordinates ? coordinates.latitude : null,
        geocodedAt: coordinates ? datetime.format() : null,
        area: input.area ?? null,
        contractAmount: input.contractAmount,
        startDate: input.startDate,
        planEndDate: input.planEndDate,
        templateId,
        remark: input.remark ?? null,
        createdBy: operator.id,
      },
      tx
    )

    await projectStageModel.generateFromTemplate(id, input.startDate, structure, tx)

    // AC-AD09：建档必须留痕。放在事务内 —— 日志与项目同生共死，
    // 不会出现「日志说有这个项目，项目却回滚了」这种审计与事实不符的情况
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.PROJECT_CREATE,
        targetType: 'project',
        targetId: id,
        projectId: id,
        // 建档没有 before（新增），只记 after。金额按 DECIMAL 存字符串，
        // 日志里同样保持字符串 —— 落成 Number 会让审计看到 100000 而不是 100000.00
        detail: {
          after: {
            name: input.name,
            address: input.address,
            coverUrl: input.coverUrl || null,
            contractAmount: input.contractAmount,
            startDate: input.startDate,
            planEndDate: input.planEndDate,
            status: 'pending',
            templateId,
            stageCount: structure.length,
            longitude: coordinates ? coordinates.longitude : null,
            latitude: coordinates ? coordinates.latitude : null,
            coordinateSource,
          },
        },
      },
      tx
    )

    return id
  })

  return {
    id: projectId,
    templateId,
    stageCount: structure.length,
    itemCount: structure.reduce((sum, s) => sum + s.items.length, 0),
    geocoded: Boolean(coordinates),
    coordinateSource,
    // AC-AD54：未解析出坐标时明确告知，让前端引导管理员手工拾取
    needsCoordinates: !coordinates,
    duplicates: duplicate ? { id: duplicate.id, name: input.name } : null,
  }
}

/** 未显式选择模板时用默认模板（B-2.5 / AC-AD33） */
async function resolveTemplateId(templateId, tenantId) {
  if (templateId) {
    // 带租户查：不带的话，管理员可以传一个别的租户的模板 id，
    // 于是自己的项目套上了别人的阶段工序
    const template = await stageTemplateModel.findById(templateId, tenantId)
    if (!template) throw AppError.badRequest('阶段模板不存在')
    return template.id
  }

  const fallback = await stageTemplateModel.findDefault(tenantId)
  if (!fallback) {
    throw AppError.badRequest('系统没有可用的默认阶段模板，请先在后台创建模板')
  }
  return fallback.id
}

/** 编辑项目（B-2.3 的编辑）。归档项目只读（AC-AD25） */
async function updateProject(operator, projectId, input) {
  const project = await projectAccess.load(operator, projectId, { requireWritable: true })

  const addressChanged = input.address !== undefined && input.address !== project.address
  const hasManualCoordinates = input.longitude !== undefined && input.latitude !== undefined

  // 坐标来源优先级：
  //   1. 地图选点 / 手工坐标 —— 管理员明确确认过，地址同时改也不重新解析；
  //   2. 地址变更 —— 沿用既有地理编码，失败时清空旧坐标（AC-N10）；
  //   3. 都不涉及 —— 坐标保持原值。
  let coordinates = null
  if (hasManualCoordinates) {
    coordinates = { longitude: input.longitude, latitude: input.latitude }
  } else if (addressChanged) {
    coordinates = await mapService.geocode(input.address)
  }

  const coordinatePatch = {}
  if (hasManualCoordinates || addressChanged) {
    coordinatePatch.longitude = coordinates ? coordinates.longitude : null
    coordinatePatch.latitude = coordinates ? coordinates.latitude : null
    coordinatePatch.geocodedAt = coordinates ? datetime.format() : null
  }

  await projectModel.update(projectId, { ...input, ...coordinatePatch })

  const coordinateSource = hasManualCoordinates
    ? 'manual'
    : addressChanged
      ? (coordinates ? 'geocode' : 'none')
      : 'unchanged'

  // AC-AD09 要求记「变更前后内容」。只记 input 里出现的键 ——
  // 把整行 before/after 都塞进去的话，每次编辑的 diff 里都会夹着
  // updated_at 这类无论如何都会变的字段，真正改了哪一项反而看不出来。
  // 地址变更会连带改变坐标，因此这里显式把坐标加入审计键；
  // 否则「改地址导致坐标被清空」这件事在日志里看不到。
  const auditKeys = Object.keys(input)
  if (hasManualCoordinates || addressChanged) {
    for (const key of ['longitude', 'latitude']) {
      if (!auditKeys.includes(key)) auditKeys.push(key)
    }
  }
  const auditAfter =
    hasManualCoordinates || addressChanged
      ? { ...input, longitude: coordinatePatch.longitude, latitude: coordinatePatch.latitude }
      : input

  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.PROJECT_UPDATE,
    targetType: 'project',
    targetId: projectId,
    projectId,
    detail: {
      before: pickChanged(project, auditKeys),
      after: pickChanged(auditAfter, auditKeys),
    },
  })

  const projectHasCoordinates =
    project.longitude !== null &&
    project.longitude !== undefined &&
    project.latitude !== null &&
    project.latitude !== undefined

  let needsCoordinates
  if (hasManualCoordinates) needsCoordinates = false
  else if (addressChanged) needsCoordinates = !coordinates
  else needsCoordinates = !projectHasCoordinates

  return { id: projectId, needsCoordinates, coordinateSource }
}

/** 从源对象里挑出若干字段，并把下划线列名转成接口常见的驼峰名，供审计 diff 使用 */
function pickChanged(source, keys) {
  const snapshot = {}
  for (const key of keys) {
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    const value = source[key] !== undefined ? source[key] : source[snake]
    if (value !== undefined) snapshot[key] = value
  }
  return snapshot
}

/** 手工拾取坐标（AC-AD54） */
async function setCoordinates(operator, projectId, { longitude, latitude }) {
  const project = await projectAccess.load(operator, projectId, { requireWritable: true })

  await projectModel.updateCoordinates(projectId, {
    longitude,
    latitude,
    geocodedAt: datetime.format(),
  })

  // 复用 PROJECT_UPDATE 而不是新加一个动作：这是「编辑项目」的一种，
  // 单开一个动作会让「这个项目被改过几次」需要合并两个动作去数。
  // 坐标用字符串写入 —— DECIMAL(10,7) 落成 Number 会丢精度（CLAUDE.md 第 20 条）
  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.PROJECT_UPDATE,
    targetType: 'project',
    targetId: projectId,
    projectId,
    detail: {
      before: { longitude: project.longitude, latitude: project.latitude },
      after: { longitude, latitude },
    },
  })

  return { id: projectId, longitude, latitude }
}

// ─────────────────────────────────────────────────────────────
// B 端：状态机、归档、删除
// ─────────────────────────────────────────────────────────────

/**
 * 项目状态流转（B-2.10 / AC-AD24 / AC-AD55）。
 *
 * 正向流转直接放行；反向流转需二次确认（请求体带 confirmReverse: true）。
 * 二次确认在这里是「多一个显式字段」而不是「前端弹个框」——
 * 前端弹框只能拦住手滑，拦不住误调的脚本，而反向流转会改变项目在统计口径里的归属。
 */
async function changeStatus(operator, projectId, targetStatus, { confirmReverse = false } = {}) {
  // 不加 requireWritable：已归档项目的「恢复」正是通过本接口完成的
  // （状态改回 finished），加了就永远恢复不了
  const project = await projectAccess.load(operator, projectId)

  const from = project.status

  if (!STATUS_ORDER.includes(targetStatus)) {
    throw AppError.badRequest('非法的项目状态')
  }
  if (from === targetStatus) {
    throw AppError.conflict(`项目已是「${STATUS_LABELS[targetStatus]}」状态`)
  }

  const fromIndex = STATUS_ORDER.indexOf(from)
  const toIndex = STATUS_ORDER.indexOf(targetStatus)

  // 已归档是终态，只能由超级管理员执行「恢复」（§5.2）
  if (from === 'archived') {
    if (operator.role !== 'owner') throw AppError.forbidden('仅租户管理员可恢复已归档的项目')
    if (!confirmReverse) throw AppError.badRequest('恢复到「已完工」需要二次确认')
    // 恢复后回到「已完工」而非「施工中」：归档前的实际状态就是已完工，
    // 直接跳到施工中会让「已完工 → 施工中」这一步绕过它自己的二次确认
    if (targetStatus !== 'finished') throw AppError.badRequest('已归档的项目只能恢复到「已完工」')
  } else if (toIndex < fromIndex) {
    if (!confirmReverse) {
      throw AppError.badRequest(
        `从「${STATUS_LABELS[from]}」退回「${STATUS_LABELS[targetStatus]}」需要二次确认`
      )
    }
  } else if (targetStatus === 'archived' && !confirmReverse) {
    // 正向流入归档也要二次确认（B-2.11）。不写这一条的话，
    // POST /archive 要求 confirm 而 PUT /status {status:'archived'} 不要求 ——
    // 同一件事两个接口两套要求，绕过确认只需要换一个接口
    throw AppError.badRequest('归档后项目全链路只读，请二次确认')
  }

  // 进入「施工中」前校验人员配置（AC-AD58）
  if (targetStatus === 'building') {
    await assertMemberComposition(projectId)
  }

  // 「已完工」需要显式给出实际竣工日期，否则延期统计永远算不出结果
  await db.withTransaction(async (tx) => {
    await projectModel.updateStatus(projectId, targetStatus, tx)
    if (targetStatus === 'finished' && !project.actual_end_date) {
      await tx.query('UPDATE project SET actual_end_date = ? WHERE id = ?', [datetime.formatDate(), projectId])
    }

    // AC-AD55 明确要求反向流转「写入操作日志」，正向流转同样要记（AC-AD09
    // 说的是「所有增删改」）。除了流转本身，`reverse` 也记进去 ——
    // 事后追责时「他是明知反向还确认过的」与「他没注意到是反向」是两回事
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.PROJECT_STATUS,
        targetType: 'project',
        targetId: projectId,
        projectId,
        detail: {
          before: { status: from },
          after: { status: targetStatus },
          reverse: toIndex < fromIndex,
        },
      },
      tx
    )
  })

  return { id: projectId, from, to: targetStatus }
}

/**
 * 人员数量约束（AC-AD58）：**至少 1 名工长（其中 1 名为「主工长」）、至少 1 名业主**。
 *
 * 工长可以有**多名**（§9 Q11 已定）：所有工长都能汇报进度、登记支出，
 * 但只有主工长能发起验收、提交阶段结算单。因此这里要校验两件事：
 * 有工长、且其中有且仅有 1 名主工长。
 *
 * ── 关于校验时机的一处解释 ──
 * 文档说「不满足时拒绝保存」，但没说清「保存」指哪一步：
 * §5.2 的新建项目表单里**没有**人员字段，人员分配（B-2.6）是独立的一步，
 * 而且邀请后成员处于 pending、要等对方在小程序确认（AC-AD18）。
 * 若在建档时就要求工长，建档将无法完成。
 *
 * 因此本实现把校验放在**流转到「施工中」**这一步：
 * 那是「人员配置齐了、可以开工」的自然语义位置，也是唯一能保证
 * 后续汇报、验收有明确操作人的时机。
 *
 * 只统计 active 成员 —— AC-AD18 明确 pending 不计入任何权限判定，
 * 因此「邀请了一个还没确认的工长」不算配齐。
 */
async function assertMemberComposition(projectId) {
  const [foremanCount, ownerCount, primaryForeman, primaryOwner, primaryOwnerSlot] = await Promise.all([
    projectMemberModel.countByRole(projectId, 'foreman'),
    projectMemberModel.countByRole(projectId, 'owner'),
    projectMemberModel.findPrimaryForeman(projectId),
    projectMemberModel.findPrimaryOwner(projectId),
    projectMemberModel.findPrimaryOwnerSlot(projectId),
  ])

  const problems = []
  if (foremanCount === 0) {
    problems.push('尚未指定工长')
  } else if (!primaryForeman) {
    // 查不出主工长说明数据库里的 is_primary 与服务层的预期不一致，
    // 属于数据异常而非用户操作问题，因此提示写得更直接
    problems.push('尚未指定主工长（仅主工长可发起验收）')
  }
  if (ownerCount === 0) {
    problems.push('尚未指定业主')
  } else if (!primaryOwner) {
    problems.push(
      primaryOwnerSlot
        ? '主业主尚未确认邀请（确认后才能确认验收、付款与对账）'
        : '尚未指定主业主（仅主业主可确认验收、付款与对账）'
    )
  }

  if (problems.length > 0) {
    throw AppError.conflict(`无法进入施工中：${problems.join('；')}`)
  }
}

/**
 * 归档（B-2.11）。归档后全链路只读（AC-AD25 / AC-AD57）。
 * 需二次确认 —— 归档会让 C 端所有人立刻无法提交任何东西。
 */
async function archiveProject(operator, projectId, { confirm = false } = {}) {
  // 不加 requireWritable：归档本身就是要写 archived 状态，
  // 而重复归档由下面的 409 处理
  const project = await projectAccess.load(operator, projectId)

  if (!confirm) throw AppError.badRequest('归档后项目全链路只读，请二次确认')
  if (project.status === 'archived') throw AppError.conflict('项目已归档')

  await db.withTransaction(async (tx) => {
    await projectModel.updateStatus(projectId, 'archived', tx)
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.PROJECT_ARCHIVE,
        targetType: 'project',
        targetId: projectId,
        projectId,
        detail: { before: { status: project.status }, after: { status: 'archived' } },
      },
      tx
    )
  })

  // ── AC-K12 / AC-K15：归档会让门锁密码立即不可查看 ──
  // 「不可查看」本身由 `doorCode.service.assertCanView` 查 project.status 得到，
  // 不需要在这里做任何事。但**业主必须被告知**：「刚才那些能开你家门的人，
  // 现在在系统里看不到了，而你还需要换锁」—— 已经记下密码的人照样能开门。
  //
  // 事件标识用当前秒级时间戳而不是 projectId：一次归档提醒一次，
  // 将来恢复后再归档是一次**新的**风险事件，用 projectId 会被去重成「已发过」。
  await warnLockChangeSafely(projectId, Math.floor(Date.now() / 1000))

  return { id: projectId, status: 'archived' }
}

/**
 * 归档后提醒业主换锁（AC-K15）。
 *
 * 包一层是因为**提醒失败绝不能让归档失败**：归档是管理员明确的意图，
 * 而提醒只是补救措施。反过来（提醒失败导致归档回滚）会让管理员
 * 反复点击归档却始终不成功，而错误提示还看不出原因。
 */
async function warnLockChangeSafely(projectId, eventRefId) {
  try {
    // 服务层函数级 require：doorCode.service → projectAccess → ... 的依赖链
    // 与 project.service 有交叉，顶层 require 会形成加载期循环（CLAUDE.md 第 63 条）
    const doorCodeService = require('./doorCode.service')
    await doorCodeService.warnOwnerToChangeLock(projectId, {
      refType: 'project',
      refId: eventRefId,
      reason: '项目已归档',
    })
  } catch (err) {
    logger.error('归档后提醒业主更换门锁密码失败（归档已成功）', { projectId, message: err.message })
  }
}

/** 软删除（AC-AD26）。仅租户管理员，需二次确认 */
async function deleteProject(operator, projectId, { confirm = false } = {}) {
  if (operator.role !== 'owner') throw AppError.forbidden('仅租户管理员可删除项目')
  if (!confirm) throw AppError.badRequest('删除后项目将不在列表展示，请二次确认')

  // 取 unscoped 再**显式比对租户**。
  // 这里不能用 projectAccess.load：软删除的项目 `deleted_at` 已非空，
  // 而 load 只返回未删除的行 —— 那会让「删除一个已删除的项目」永远 404，
  // 而真正需要拦的是「删除别的租户的项目」。
  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')
  // 跨租户一律 404：项目 id 自增可枚举，403 会暴露对方有多少项目
  if (Number(project.tenant_id) !== Number(operator.tenantId)) throw AppError.notFound('项目不存在')

  await db.withTransaction(async (tx) => {
    await projectModel.softDelete(projectId, tx)
    // 删除必须留痕：项目被软删后从列表里消失，若没有这条日志，
    // 「项目怎么不见了」只能靠翻数据库回答
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.PROJECT_DELETE,
        targetType: 'project',
        targetId: projectId,
        projectId,
        detail: { before: { name: project.name, status: project.status, deletedAt: null }, after: { deletedAt: 'now' } },
      },
      tx
    )
  })

  return { id: projectId, deleted: true }
}

/** 恢复软删除的项目（AC-AD27：阶段、汇报、验收、账目数据完整无缺失） */
async function restoreProject(operator, projectId) {
  if (operator.role !== 'owner') throw AppError.forbidden('仅租户管理员可恢复项目')

  const row = await db.queryOne(
    'SELECT id, tenant_id, name, status, deleted_at FROM project WHERE id = ?',
    [projectId]
  )
  if (!row) throw AppError.notFound('项目不存在')
  if (Number(row.tenant_id) !== Number(operator.tenantId)) throw AppError.notFound('项目不存在')
  if (!row.deleted_at) throw AppError.conflict('项目未被删除')

  await db.withTransaction(async (tx) => {
    // 恢复也占用配额：软删除的项目不计入计数，恢复后再计一次，
    // 不检查的话「删一个、建一个、再恢复」就能突破上限
    await tenantService.assertProjectQuota(operator.tenantId, tx)
    await projectModel.restore(projectId, tx)
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.PROJECT_RESTORE,
        targetType: 'project',
        targetId: projectId,
        projectId,
        detail: {
          before: { deletedAt: row.deleted_at },
          after: { deletedAt: null, name: row.name, status: row.status },
        },
      },
      tx
    )
  })

  // 软删除只是把 deleted_at 置回 NULL，所有关联数据本来就没动过，
  // 因此这里不做任何「恢复关联数据」的动作 —— 若将来有人把软删除改成级联标记，
  // 这条注释就是提醒：恢复逻辑必须跟着改
  return { id: projectId, deleted_at: null }
}

/**
 * 归档项目只读守卫（AC-AD25 / AC-AD57）。
 *
 * 「已完工」刻意**不**在这里拦：AC-AD56 明确要求完工后验收与对账仍可继续，
 * 一刀切只读会让收尾工作无法进行。完工对进度汇报的限制由进度模块单独判断。
 */
function assertWritable(project) {
  if (project.status === 'archived') {
    throw AppError.forbidden('项目已归档，全部数据只读')
  }
}

/** 已完工项目不再接受新的进度汇报（AC-AD56），但验收与对账不受影响 */
function assertCanReportProgress(project) {
  assertWritable(project)
  if (project.status === 'finished') {
    throw AppError.forbidden('项目已完工，不再接受新的进度汇报')
  }
}

/** 按字段分组的小工具，避免到处写 for 循环 */
function groupBy(rows, key) {
  const map = new Map()
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], [])
    map.get(row[key]).push(row)
  }
  return map
}

module.exports = {
  ROLE_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
  myProjects,
  getProjectForMember,
  isOverdue,
  pickCurrentStage,
  confirmInvitation,
  rejectInvitation,
  listProjects,
  getProjectStats,
  getProjectDetail,
  createProject,
  updateProject,
  setCoordinates,
  changeStatus,
  archiveProject,
  deleteProject,
  restoreProject,
  assertWritable,
  assertCanReportProgress,
  maskPhone,
  groupBy,
}
