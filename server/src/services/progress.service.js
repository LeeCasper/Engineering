'use strict'

/**
 * 完成度计算与变更（§4.2.1 / AC-P02~04、P14~19）。
 *
 * ── 本模块存在的意义：把「完成度」收敛成唯一写入口 ──
 * 工序完成度是整个产品的核心数据：C 端进度条、后台看板、阶段时间轴、
 * 阶段门禁的推进判断，全都读它。如果允许多处直接 `UPDATE project_item SET progress`，
 * 迟早会有一处忘记重算阶段完成度，于是 `project_stage.progress` 与实际工序脱节 ——
 * 而那个数字还会继续被门禁和看板当作事实使用。
 *
 * 因此：**工序完成度的任何变更都必须走 `applyItemProgress`**，
 * 它在同一个事务里完成「校验 + 加锁 + 改进度 + 写留痕 + 重算阶段」。
 * 阶段与工序的结构变更（增删、改权重）同样会改变加权平均值，
 * 由 projectStructure.service 在事务里调用 `recomputeStageProgress`。
 *
 * ── 项目总进度不落库 ──
 * §6.1 的 `project` 表没有进度字段，项目总进度每次由各阶段的 progress 现算
 * （progress.projectProgress）。这是刻意的：少一份需要同步维护的冗余状态，
 * 也就少一处能对不上的地方。代价是每次读取都要取一遍阶段 —— 但那本来就是一次索引查询。
 */

const AppError = require('../utils/AppError')
const progressUtil = require('../utils/progress')
const { lockedReasonFor } = require('../utils/stage')
const db = require('../db/pool')
const projectModel = require('../models/project.model')
const projectStageModel = require('../models/projectStage.model')
const projectItemModel = require('../models/projectItem.model')
const projectMemberModel = require('../models/projectMember.model')
const sysConfigService = require('./sysConfig.service')

/** 这些门禁状态说明阶段已经验收通过，展示状态固定为「已验收」，不再随进度变化 */
const ACCEPTED_GATES = new Set(['accepted', 'disputed', 'settled'])

/**
 * 工序展示状态（AC-P04：完成度为 0 显示「未开始」）。
 * 派生规则集中在这里，避免前端各页面各写一遍 if。
 */
function deriveItemStatus(progress) {
  const value = Number(progress)
  if (!Number.isFinite(value) || value <= 0) return 'not_started'
  if (value >= 100) return 'completed'
  return 'in_progress'
}

/**
 * 阶段展示状态（AC-P02：由系统自动判定，无手工设置入口）。
 *
 * 判定顺序不能调换：
 *   1. 已验收优先 —— 验收通过后阶段状态就固定了，即便之后有人把某个工序完成度
 *      往下调（AC-P18 允许下调），也不该把它显示回「进行中」；
 *   2. 完成度满 100 → 已完成；
 *   3. 有进度 → 进行中（AC-P04：首个存在进度的阶段显示为「进行中」）；
 *   4. 否则未开始。
 */
function deriveStageStatus({ progress, gateStatus }) {
  if (ACCEPTED_GATES.has(gateStatus)) return 'accepted'

  const value = Number(progress)
  if (value >= 100) return 'completed'
  if (value > 0) return 'in_progress'
  return 'not_started'
}

// ─────────────────────────────────────────────────────────────
// 读取
// ─────────────────────────────────────────────────────────────

/**
 * C 端阶段工序树（AC-P02 / AC-P03）。
 *
 * 可见性由 project_member 决定，与后台的数据权限是两套模型
 * （见 projectAccess.service 的说明）。非参与成员一律 404，不泄露项目是否存在（AC-P26）。
 */
async function getProjectStages(userId, projectId) {
  const role = await projectMemberModel.findActiveRole(projectId, userId)
  if (!role) throw AppError.notFound('项目不存在')

  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')

  const [tree, gateStrength] = await Promise.all([
    projectStageModel.findTreeByProject(projectId),
    sysConfigService.getGateStrength(project.tenant_id),
  ])

  // 能否汇报由「角色 + 项目状态 + 门禁状态 + 门禁强度」共同决定。
  // 把这段判断放在服务端，是为了避免前端各页面各写一遍：
  // 严格档下锁定阶段不可汇报，标准/宽松档下可汇报但必须给出提示（AC-S09）。
  const canReportBase = role.role === 'foreman' && project.status !== 'archived' && project.status !== 'finished'

  return {
    projectId,
    // 项目总进度现算，与列表页、后台看板共用同一段算法（AC-AD38 要求同源）
    progress: progressUtil.projectProgress(tree.map((s) => ({ progress: s.progress, weight: s.weight }))),
    myRole: role.role,
    // Q11：仅主工长能发起验收，前端据此决定验收按钮是否可用
    isPrimaryForeman: Number(role.is_primary) === 1,
    gateStrength,
    stages: tree.map((stage) => toStageView(stage, { tree, gateStrength, canReportBase })),
  }
}

function toStageView(stage, { tree, gateStrength, canReportBase }) {
  const locked = stage.gate_status === 'locked'
  // settled 是终态，不允许再汇报；locked 在严格档下也不允许。
  // 其余状态（含 accepted / disputed）允许「补充说明」，与 §4.7.1 的表一致
  const canReport =
    canReportBase && stage.gate_status !== 'settled' && !(locked && gateStrength === 'strict')

  return {
    id: stage.id,
    name: stage.name,
    seq: stage.seq,
    weight: stage.weight,
    // status 是派生值，与库里的字段一致；这里显式再算一次，
    // 保证即便有人手工改过库也不会给出自相矛盾的响应
    status: deriveStageStatus({ progress: stage.progress, gateStatus: stage.gate_status }),
    gateStatus: stage.gate_status,
    progress: stage.progress,
    planStart: stage.plan_start,
    planEnd: stage.plan_end,
    actualStart: stage.actual_start,
    actualEnd: stage.actual_end,
    // C-2.13 / C-7.2：锁定阶段必须能说明原因，前端直接展示这句话
    lockedReason: locked ? lockedReasonFor(tree, stage) : null,
    // 前端据此决定是否显示「汇报」入口；具体提交时后端仍会再校验一次
    canReport,
    items: stage.items.map((item) => ({
      id: item.id,
      name: item.name,
      seq: item.seq,
      weight: item.weight,
      progress: item.progress,
      status: deriveItemStatus(item.progress),
      // 计划时间随阶段生成，用于 AC-P24 的工序级延期判断
      planStart: item.plan_start,
      planEnd: item.plan_end,
    })),
  }
}

/**
 * 某工序的完成度变更历史（AC-P19：按时间倒序，可查「谁在何时把完成度从 X 改为 Y」）。
 */
async function getItemHistory(userId, projectId, itemId) {
  const role = await projectMemberModel.findActiveRole(projectId, userId)
  if (!role) throw AppError.notFound('项目不存在')

  const item = await projectItemModel.findById(itemId)
  if (!item) throw AppError.notFound('工序不存在')

  // 工序必须属于本项目 —— 否则拿别的项目的 itemId 就能读到别人的变更历史
  const stage = await projectStageModel.findById(item.project_stage_id)
  if (!stage || Number(stage.project_id) !== Number(projectId)) {
    throw AppError.notFound('工序不存在')
  }

  const rows = await db.query(
    `SELECT l.id, l.from_progress, l.to_progress, l.remark, l.created_at,
            u.id AS user_id, u.nickname
       FROM progress_log l
       LEFT JOIN user u ON u.id = l.user_id
      WHERE l.project_item_id = ? AND l.deleted_at IS NULL
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 100`,
    [itemId]
  )

  return {
    itemId,
    itemName: item.name,
    currentProgress: item.progress,
    history: rows.map((row) => ({
      id: row.id,
      fromProgress: row.from_progress,
      toProgress: row.to_progress,
      operator: row.nickname || `用户${row.user_id}`,
      operatorId: row.user_id,
      remark: row.remark,
      changedAt: row.created_at,
    })),
  }
}

// ─────────────────────────────────────────────────────────────
// 写入：唯一入口
// ─────────────────────────────────────────────────────────────

/**
 * 变更工序完成度。**这是工序完成度的唯一写入口。**
 *
 * 在同一个事务里完成五件事：
 *   1. 校验操作者是该项目的工长（AC-P25：仅工长可提交汇报）；
 *   2. 校验门禁（C-7.3 / AC-S09：严格档下锁定阶段不可汇报）；
 *   3. `SELECT ... FOR UPDATE` 锁住工序行（§6.2 要求行锁，防并发把留痕写乱）；
 *   4. 更新工序完成度与派生状态，并写入 `progress_log`（AC-P18）；
 *   5. 重算所属阶段的完成度与状态（AC-P14 / AC-P17）。
 *
 * @param {object} params
 * @param {number} params.projectId
 * @param {number} params.itemId
 * @param {number} params.userId 操作者
 * @param {string|number} params.progress 新的完成度（0–100，步进 5）
 * @param {number} [params.reportId] 由哪条汇报触发
 * @param {string} [params.remark] 变更原因
 * @returns {Promise<object>} 变更结果与重算后的阶段/项目进度
 */
async function applyItemProgress(params, externalTx = null) {
  const validation = progressUtil.validateProgress(params.progress)
  if (!validation.ok) throw AppError.badRequest(validation.reason)

  // ── 为什么允许外部传入事务 ──
  // 提交进度汇报时，「写入汇报记录」与「变更完成度」必须是一个原子操作：
  // 分开提交会出现「有汇报但进度没变」或反之的中间态，而这两张表
  // 恰恰是争议时互相对照的证据。
  // 因此 controller 层可以带着自己的事务调进来，此时不再另开一个 ——
  // 另开事务会取到**另一条连接**，行锁失效，还可能自己把自己锁死。
  if (externalTx) return runApply(externalTx, params, validation)

  return db.withTransaction((tx) => runApply(tx, params, validation))
}

async function runApply(tx, { projectId, itemId, userId, progress, reportId = null, remark = null }, validation) {
  // 1. 权限：必须是在该项目中已确认的工长
  const role = await tx.queryOne(
      "SELECT id, role FROM project_member WHERE project_id = ? AND user_id = ? AND role = 'foreman' AND status = 'active' AND deleted_at IS NULL",
      [projectId, userId]
  )
  if (!role) throw AppError.forbidden('仅该项目的工长可提交进度')

  // 2. 加锁读工序，并确认它确实属于本项目
  const item = await projectItemModel.lockById(tx, itemId)
  if (!item) throw AppError.notFound('工序不存在')

  const stage = await projectStageModel.lockGate(tx, item.project_stage_id)
  if (!stage || Number(stage.project_id) !== Number(projectId)) {
      // 工序与项目对不上 —— 防止用 A 项目的 itemId 去改 B 项目的数据
      throw AppError.notFound('工序不存在')
  }

  // 3. 门禁（C-7.3 / AC-S09）。默认「标准」档放行汇报但阻断验收，
  //    这里只处理汇报这一侧；验收侧的阻断在验收模块。
  //    门禁强度是**按租户**配置的，租户由项目决定 —— 这里只有 projectId，
  //    因此取一次项目的 tenant_id（与阶段锁同一个事务，保证读到的是同一份数据）
  const projectRow = await tx.queryOne('SELECT tenant_id FROM project WHERE id = ? AND deleted_at IS NULL', [projectId])
  const gateStrength = await sysConfigService.getGateStrength(projectRow ? projectRow.tenant_id : null)
  const locked = stage.gate_status === 'locked'

  if (locked && gateStrength === 'strict') {
      throw AppError.conflict(`上一阶段尚未结清，「${stage.name}」暂不可汇报进度`)
  }

  // 4. 完成度未变化时不写留痕 —— AC-P18 说的是「每次**变更**均写入」，
  //    同值重复提交（前端重试、用户连点）不该在历史里刷出一串无意义的记录
  const from = item.progress
  const to = validation.value

  if (from === to) {
  return {
      changed: false,
      itemId,
      progress: to,
      stageProgress: stage.progress,
      projectProgress: await currentProjectProgress(tx, projectId),
      warning: locked ? buildLockedWarning(stage, gateStrength) : null,
  }
  }

  await projectItemModel.update(itemId, { progress: to, status: deriveItemStatus(to) }, tx)

  await tx.query(
  `INSERT INTO progress_log (project_id, project_item_id, user_id, from_progress, to_progress, report_id, remark)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [projectId, itemId, userId, from, to, reportId, remark]
  )

  // 5. 重算阶段（AC-P14 / AC-P17）
  const stageProgress = await recomputeStageProgress(tx, stage.id, { gateStatus: stage.gate_status })

  return {
  changed: true,
  itemId,
  from,
  to,
  itemStatus: deriveItemStatus(to),
  stageId: stage.id,
  stageProgress,
  projectProgress: await currentProjectProgress(tx, projectId),
  // AC-S09：标准档下锁定阶段放行汇报，但要给出醒目提示，让工长知道原因
  warning: locked ? buildLockedWarning(stage, gateStrength) : null,
  }
}

function buildLockedWarning(stage, gateStrength) {
  return {
    code: 'stage_locked',
    message: `「${stage.name}」的上一阶段尚未结清，本次汇报已记录，但该阶段暂不可发起验收`,
    gateStrength,
  }
}

// ─────────────────────────────────────────────────────────────
// 重算
// ─────────────────────────────────────────────────────────────

/**
 * 重算阶段完成度并写回（§4.2.1）。
 *
 * 必须由**所有**会改变「该阶段下工序集合或其权重」的操作调用：
 * 改进度、增工序、删工序、改工序权重。漏掉任何一处，
 * `project_stage.progress` 就会与实际脱节，而门禁与看板都信任这个数字。
 *
 * @returns {Promise<string>} 新的阶段完成度（两位小数字符串）
 */
async function recomputeStageProgress(tx, stageId, { gateStatus } = {}) {
  const items = await projectItemModel.listByStage(stageId, tx)

  // 用与 AC-P14 用例同一个函数计算（权重 1:1:2、完成度 40/60/80 → 65）
  const value = progressUtil.stageProgress(items)

  let gate = gateStatus
  if (!gate) {
    const stage = await projectStageModel.findById(stageId, tx)
    gate = stage ? stage.gate_status : 'active'
  }

  // §4.7.1：本阶段所有工序进度 = 100% 时，门禁由 active 进入 pending_acceptance。
  //
  // **只做正向流转**，不因为进度回落而退回 active。理由：进度下调可能发生在
  // 验收已经发起之后（AC-P18 允许下调），此时退回 active 会让「有验收单在飞」
  // 的阶段显示为「可施工」，与事实不符。真正的状态推进由验收与结算驱动。
  if (gate === 'active' && Number(value) >= 100) {
    gate = 'pending_acceptance'
    await tx.query("UPDATE project_stage SET gate_status = 'pending_acceptance' WHERE id = ? AND gate_status = 'active'", [
      stageId,
    ])
  }

  await projectStageModel.updateProgress(
    stageId,
    { progress: value, status: deriveStageStatus({ progress: value, gateStatus: gate }) },
    tx
  )

  return value
}

/** 当前项目总进度。现算，不落库（见文件头说明） */
async function currentProjectProgress(tx, projectId) {
  const tree = await tx.query(
    'SELECT progress, weight FROM project_stage WHERE project_id = ? AND deleted_at IS NULL',
    [projectId]
  )
  return progressUtil.projectProgress(tree)
}

/**
 * 重算某项目全部阶段的完成度与状态。
 *
 * 用于「权重批量调整」这类一次性影响多个阶段的场景。
 */
async function recomputeProject(tx, projectId) {
  const stages = await projectStageModel.findTreeByProject(projectId)
  for (const stage of stages) {
    await recomputeStageProgress(tx, stage.id, { gateStatus: stage.gate_status })
  }
  return currentProjectProgress(tx, projectId)
}

module.exports = {
  ACCEPTED_GATES,
  deriveItemStatus,
  deriveStageStatus,
  getProjectStages,
  getItemHistory,
  applyItemProgress,
  recomputeStageProgress,
  recomputeProject,
  currentProjectProgress,
}
