'use strict'

/**
 * 项目阶段与工序的手工增删改（B-2.5 / B-2.9 / AC-AD16 / AC-AD23）。
 *
 * ── 本模块与模板无关 ──
 * 项目里的阶段与工序是建档时从模板**拷贝**出来的实例副本（§6.2）。
 * 因此这里的任何改动都不会影响源模板（AC-AD16），反之编辑模板也不影响已有项目（AC-AD17）。
 * 这是天然隔离，不需要任何同步逻辑。
 *
 * ── 每次结构变更都要重算完成度 ──
 * 阶段完成度是「该阶段下工序的加权平均」（§4.2.1）。因此**增删工序、改工序权重**
 * 都会改变这个平均值。任何一处忘记重算，`project_stage.progress` 就与事实脱节，
 * 而它正是 C 端进度条、后台看板与阶段门禁共同信任的数字。
 */

const AppError = require('../utils/AppError')
const money = require('../utils/money')
const db = require('../db/pool')
const projectAccess = require('./projectAccess.service')
const progressService = require('./progress.service')
const projectStageModel = require('../models/projectStage.model')
const projectItemModel = require('../models/projectItem.model')

// 本文件只管「结构」：项目是否存在与是否可写走 projectAccess，
// 进度重算走 progressService。一旦开始在这里直接读项目或自己算进度，
// 就会长出第二个事实来源。

/**
 * 取项目并确认可写，同时确认目标阶段/工序确实属于该项目。
 *
 * 「工序属于本项目」这一条不能省：itemId 是自增主键、可被枚举，
 * 少了它就能用 A 项目的接口去改 B 项目的工序。
 */
async function loadContext(operator, projectId) {
  return projectAccess.load(operator, projectId, { requireWritable: true })
}

async function loadStage(operator, projectId, stageId) {
  await loadContext(operator, projectId)
  const stage = await projectStageModel.findById(stageId)
  if (!stage || Number(stage.project_id) !== Number(projectId)) throw AppError.notFound('阶段不存在')
  return stage
}

async function loadItem(operator, projectId, itemId) {
  await loadContext(operator, projectId)
  const item = await projectItemModel.findById(itemId)
  if (!item) throw AppError.notFound('工序不存在')

  const stage = await projectStageModel.findById(item.project_stage_id)
  if (!stage || Number(stage.project_id) !== Number(projectId)) throw AppError.notFound('工序不存在')

  return { item, stage }
}

/** 权重：可选；传了就必须是正数（AC-AD23）。传 0 或负数一律拒绝，不静默忽略 */
function normalizeWeight(value, label) {
  if (value === null || value === undefined || value === '') return null
  const result = money.validate(value, { allowZero: false })
  if (!result.ok) throw AppError.badRequest(`${label}必须是正数：${result.reason}`)
  return result.value
}

/** 只更新传了的字段：undefined 表示「本次不改」，null 表示「清空」 */
function pick(fields, keys) {
  const picked = {}
  for (const key of keys) {
    if (fields[key] !== undefined) picked[key] = fields[key]
  }
  return picked
}

// ─────────────────────────────────────────────────────────────
// 阶段
// ─────────────────────────────────────────────────────────────

/** 新增阶段（B-2.5）。新阶段默认锁定，解锁由「上一阶段结清」触发（C-7.1） */
async function addStage(operator, projectId, input) {
  await loadContext(operator, projectId)

  const stageId = await db.withTransaction(async (tx) => {
    return projectStageModel.create(
      {
        projectId,
        name: input.name,
        planStart: input.planStart ?? null,
        planEnd: input.planEnd ?? null,
        weight: normalizeWeight(input.weight, '阶段权重'),
      },
      tx
    )
  })

  const stage = await projectStageModel.findById(stageId)
  return toStageResult(stage)
}

/** 编辑阶段：名称、计划日期、权重 */
async function updateStage(operator, projectId, stageId, input) {
  await loadStage(operator, projectId, stageId)

  await db.withTransaction(async (tx) => {
    await projectStageModel.update(
      stageId,
      {
        ...pick(input, ['name', 'planStart', 'planEnd', 'actualStart', 'actualEnd']),
        weight: input.weight === undefined ? undefined : normalizeWeight(input.weight, '阶段权重'),
      },
      tx
    )

    // 阶段权重影响的是**项目总进度**（各阶段的加权平均），而总进度是现算的，
    // 因此改权重之后不需要重算任何落库字段。但阶段自身的完成度也要跟着刷新一次
    // —— 它只依赖工序，不依赖自身权重，这里重算只是为了保持调用链一致，
    // 避免将来有人把阶段完成度的算法改成依赖权重时漏掉这一处
    await progressService.recomputeStageProgress(tx, stageId)
  })

  const stage = await projectStageModel.findById(stageId)
  return toStageResult(stage)
}

/**
 * 删除阶段（B-2.5）。
 *
 * 两条限制：
 *   1. **不能删掉最后一个阶段** —— 没有阶段的项目，总进度恒为 0，
 *      且 C 端的阶段时间轴会是一片空白，用户看不出发生了什么；
 *   2. 该阶段下的工序一并软删除。
 */
async function deleteStage(operator, projectId, stageId) {
  await loadStage(operator, projectId, stageId)

  const total = await projectStageModel.countByProject(projectId)
  if (total <= 1) {
    throw AppError.conflict('项目至少需要保留 1 个阶段，无法删除')
  }

  await db.withTransaction(async (tx) => {
    await projectItemModel.softDeleteByStage(stageId, tx)
    await projectStageModel.softDelete(stageId, tx)
  })

  return { id: stageId, deleted: true }
}

// ─────────────────────────────────────────────────────────────
// 工序
// ─────────────────────────────────────────────────────────────

/** 新增工序（B-2.5）。新增后必须重算阶段完成度 —— 加权平均的分母变了 */
async function addItem(operator, projectId, stageId, input) {
  await loadStage(operator, projectId, stageId)

  const itemId = await db.withTransaction(async (tx) => {
    const id = await projectItemModel.create(
      {
        projectStageId: stageId,
        name: input.name,
        weight: normalizeWeight(input.weight, '工序权重'),
        planStart: input.planStart ?? null,
        planEnd: input.planEnd ?? null,
        checklist: input.checklist,
      },
      tx
    )

    await progressService.recomputeStageProgress(tx, stageId)
    return id
  })

  return { id: itemId, stageId }
}

/** 编辑工序：名称、权重、计划日期、验收项清单 */
async function updateItem(operator, projectId, itemId, input) {
  const { item } = await loadItem(operator, projectId, itemId)

  await db.withTransaction(async (tx) => {
    await projectItemModel.update(
      itemId,
      {
        ...pick(input, ['name', 'planStart', 'planEnd']),
        weight: input.weight === undefined ? undefined : normalizeWeight(input.weight, '工序权重'),
      },
      tx
    )

    // AC-AD23：修改权重后阶段完成度按新权重重算
    await progressService.recomputeStageProgress(tx, item.project_stage_id)
  })

  const updated = await projectItemModel.findById(itemId)
  return { id: itemId, name: updated.name, weight: updated.weight, stageId: item.project_stage_id }
}

/**
 * 删除工序（B-2.5）。
 *
 * **不能删掉某阶段的最后一个工序**：阶段完成度是各工序的加权平均，
 * 零个工序会算成 0.00，于是这个阶段永远无法推进到 100% 触发验收 ——
 * 而界面上看不出任何异常，只会看到一个进度永远不动的阶段。
 */
async function deleteItem(operator, projectId, itemId) {
  const { item } = await loadItem(operator, projectId, itemId)

  const count = await projectItemModel.countByStage(item.project_stage_id)
  if (count <= 1) {
    throw AppError.conflict('每个阶段至少需要保留 1 个工序，无法删除')
  }

  await db.withTransaction(async (tx) => {
    await projectItemModel.softDelete(itemId, tx)
    await progressService.recomputeStageProgress(tx, item.project_stage_id)
  })

  return { id: itemId, deleted: true }
}

function toStageResult(stage) {
  return {
    id: stage.id,
    name: stage.name,
    seq: stage.seq,
    weight: stage.weight,
    planStart: stage.plan_start,
    planEnd: stage.plan_end,
    gateStatus: stage.gate_status,
  }
}

module.exports = {
  normalizeWeight,
  addStage,
  updateStage,
  deleteStage,
  addItem,
  updateItem,
  deleteItem,
}
