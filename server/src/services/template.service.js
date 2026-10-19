'use strict'

/**
 * 阶段模板管理（B-3.x / AC-AD28~35、62~64）。
 *
 * ── 模板是全局资源，不做项目级数据权限 ──
 * §5.1 的角色能力边界表里，「阶段模板管理」对超级管理员与项目管理员**都**开放，
 * 且模板不归属于任何项目。因此这里不施加 dataScope 过滤 ——
 * 硬套项目隔离反而会让项目管理员看不到自己项目正在用的模板。
 *
 * ── 编辑模板不影响已生成的项目 ──
 * 项目里的阶段与工序是建档时拷贝的**实例副本**（§6.2、AC-AD17），
 * 与模板之间没有引用关系。因此这条「不回溯」是天然成立的，
 * 不需要任何同步或版本号机制。AC-AD63 要求的只是**提示管理员**这一点 ——
 * 由 updateTemplate 返回 `referencingProjectCount` 供前端展示。
 */

const AppError = require('../utils/AppError')
const money = require('../utils/money')
const db = require('../db/pool')
const stageTemplateModel = require('../models/stageTemplate.model')
const operationLog = require('./operationLog.service')

/** 单个模板的结构上限。防止一次请求塞进几万个节点把库写满 */
const MAX_STAGES = 30
const MAX_ITEMS_PER_STAGE = 50

// ─────────────────────────────────────────────────────────────
// 查询
// ─────────────────────────────────────────────────────────────

/** 模板列表（B-3.1 / AC-AD28）。附带阶段数、工序数、引用项目数 */
async function listTemplates(operator, query) {
  const { total, rows } = await stageTemplateModel.list({
    tenantId: operator.tenantId,
    offset: query.paging.offset,
    limit: query.paging.limit,
    keyword: query.keyword,
    onlyDefault: query.onlyDefault,
  })

  return {
    list: rows.map(toListView),
    total,
    page: query.paging.page,
    pageSize: query.paging.pageSize,
  }
}

function toListView(row) {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default === 1,
    stageCount: Number(row.stage_count),
    itemCount: Number(row.item_count),
    // AC-AD35：引用项目数既用于删除保护，也用于 AC-AD63 的「修改不影响已生成的项目」提示
    referencingProjectCount: Number(row.project_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 模板详情：完整阶段工序结构（B-3.9 只读预览） */
async function getTemplate(operator, templateId) {
  const template = await stageTemplateModel.findById(templateId, operator.tenantId)
  if (!template) throw AppError.notFound('模板不存在')

  const [structure, referencingProjectCount] = await Promise.all([
    stageTemplateModel.findStructure(templateId),
    stageTemplateModel.countReferencingProjects(templateId),
  ])

  return {
    id: template.id,
    name: template.name,
    isDefault: template.is_default === 1,
    referencingProjectCount,
    // AC-AD63：前端据此决定是否在编辑器顶部展示「修改不影响已生成的项目」
    affectsExistingProjects: false,
    stages: structure.map((stage) => ({
      id: stage.id,
      name: stage.name,
      seq: stage.seq,
      planDays: stage.plan_days,
      weight: stage.weight,
      items: stage.items.map((item) => ({
        id: item.id,
        name: item.name,
        seq: item.seq,
        weight: item.weight,
        // 模板里存的是 [{"name":"..."}]，对外拍平成字符串数组更好用
        checklist: parseChecklist(item.default_checklist),
      })),
    })),
  }
}

/** 库里存的是 [{"name":"..."}]，对外拍平成 ["..."] —— 嵌套一层没有信息量 */
function parseChecklist(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((v) => (typeof v === 'string' ? v : v && v.name)).filter(Boolean)
  if (typeof raw === 'string') {
    try {
      return parseChecklist(JSON.parse(raw))
    } catch {
      return []
    }
  }
  return []
}

// ─────────────────────────────────────────────────────────────
// 写入
// ─────────────────────────────────────────────────────────────

/** 新建模板（B-3.2）。请求体带完整结构，一次成型 —— 编辑器本来就是整体保存的 */
async function createTemplate(operator, input) {
  const structure = normalizeStructure(input.stages)

  const templateId = await db.withTransaction(async (tx) => {
    // 设为默认前必须先清掉旧默认：default_key 上有唯一索引（迁移 009），
    // 直接插入第二个 is_default = 1 的行会撞键
    if (input.isDefault) await stageTemplateModel.clearDefault(operator.tenantId, tx)

    const id = await stageTemplateModel.create(
      { tenantId: operator.tenantId, name: input.name, isDefault: input.isDefault, createdBy: operator.id },
      tx
    )
    await stageTemplateModel.replaceStructure(id, structure, tx)

    // 模板是全局对象（没有项目归属），因此 projectId 留空。
    // 阶段/工序数记进日志：模板被改小之后，「当时保存的是几个阶段」
    // 只能从这里回答，否则得去翻已被替换掉的旧行 —— 而它们是物理删除的
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.TEMPLATE_CREATE,
        targetType: 'stage_template',
        targetId: id,
        detail: {
          after: {
            name: input.name,
            isDefault: Boolean(input.isDefault),
            stageCount: structure.length,
            itemCount: structure.reduce((sum, s) => sum + s.items.length, 0),
          },
        },
      },
      tx
    )

    return id
  })

  return getTemplate(operator, templateId)
}

/**
 * 编辑模板（B-3.2 / B-3.3 / B-3.4）。
 *
 * `stages` 缺省时只改名称与默认标记，不动结构 ——
 * 重命名不该要求前端把整个结构回传，那既浪费带宽也容易因为前端持有的
 * 结构已过期而把结构改回旧版本。
 */
async function updateTemplate(operator, templateId, input) {
  const template = await stageTemplateModel.findById(templateId, operator.tenantId)
  if (!template) throw AppError.notFound('模板不存在')

  const structure = input.stages === undefined ? undefined : normalizeStructure(input.stages)

  await db.withTransaction(async (tx) => {
    if (input.isDefault === true && template.is_default !== 1) {
      // 同样先清再置
      await stageTemplateModel.clearDefault(operator.tenantId, tx)
      await stageTemplateModel.setDefault(templateId, operator.tenantId, tx)
    }

    if (input.name !== undefined) {
      await stageTemplateModel.updateName(templateId, input.name, tx)
    }

    if (structure) {
      await stageTemplateModel.replaceStructure(templateId, structure, tx)
    }

    // 结构是**整体替换**（旧行物理删除，见 CLAUDE.md 第 26 条），
    // 因此 before 里不再留存旧结构明细 —— 那些行已经不存在了，
    // 日志里放一份完整的旧结构会让 operation_log 迅速膨胀，
    // 而真正需要回答的问题（「这次改了什么」）由名称与数量就够定位
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.TEMPLATE_UPDATE,
        targetType: 'stage_template',
        targetId: templateId,
        detail: {
          before: { name: template.name, isDefault: template.is_default === 1 },
          after: {
            name: input.name === undefined ? template.name : input.name,
            isDefault: input.isDefault === true ? true : template.is_default === 1,
            ...(structure
              ? { stageCount: structure.length, itemCount: structure.reduce((sum, s) => sum + s.items.length, 0) }
              : {}),
          },
          structureReplaced: Boolean(structure),
        },
      },
      tx
    )
  })

  const detail = await getTemplate(operator, templateId)
  return {
    ...detail,
    // AC-AD63：改完之后告诉前端有多少项目在引用它，
    // 前端据此展示「本次修改不影响已生成的 N 个项目」
    notice:
      detail.referencingProjectCount > 0
        ? `本次修改不影响已生成的 ${detail.referencingProjectCount} 个项目`
        : null,
  }
}

/**
 * 复制模板（B-3.7 / AC-AD34）。
 *
 * 副本与源模板**相互独立**：结构是逐行复制出来的新记录，没有共享引用，
 * 改副本不会影响源模板。这一点不需要额外机制 —— 只要复制时不共享 id 即可。
 */
async function duplicateTemplate(operator, templateId, { name }) {
  const source = await stageTemplateModel.findById(templateId, operator.tenantId)
  if (!source) throw AppError.notFound('模板不存在')

  const structure = await stageTemplateModel.findStructure(templateId)

  const newId = await db.withTransaction(async (tx) => {
    // 副本一律不是默认模板：一次复制就悄悄抢走默认标记，会让
    // 「新建项目用哪个模板」变得不可预期
    const id = await stageTemplateModel.create({ tenantId: operator.tenantId, name, isDefault: false, createdBy: operator.id }, tx)

    await stageTemplateModel.replaceStructure(
      id,
      structure.map((stage) => ({
        name: stage.name,
        planDays: stage.plan_days,
        weight: stage.weight,
        items: stage.items.map((item) => ({
          name: item.name,
          weight: item.weight,
          checklist: parseChecklist(item.default_checklist),
        })),
      })),
      tx
    )

    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.TEMPLATE_DUPLICATE,
        targetType: 'stage_template',
        targetId: id,
        // sourceTemplateId 是关键信息：副本与源模板相互独立（AC-AD34），
        // 事后要回答「这个模板是从哪一份抄来的」只能靠这条日志
        detail: { after: { name, sourceTemplateId: templateId, stageCount: structure.length } },
      },
      tx
    )

    return id
  })

  return getTemplate(operator, newId)
}

/**
 * 删除模板（B-3.2 / B-3.8 / AC-AD33 / AC-AD35）。
 *
 * 两道保护：
 *   1. 已被项目引用 → 409，并告知被引用的项目数；
 *   2. 是默认模板 → 409。§5.3 要求「系统始终保留至少一个默认模板」，
 *      而默认模板不可删除正是这条约束的落地方式。
 */
async function deleteTemplate(operator, templateId) {
  const template = await stageTemplateModel.findById(templateId, operator.tenantId)
  if (!template) throw AppError.notFound('模板不存在')

  const referencingCount = await stageTemplateModel.countReferencingProjects(templateId)
  if (referencingCount > 0) {
    throw AppError.conflict(
      `该模板已被 ${referencingCount} 个项目引用，无法删除。如需停止使用，可改为新建模板`,
      { detail: { referencingProjectCount: referencingCount } }
    )
  }

  if (template.is_default === 1) {
    throw AppError.conflict('默认模板不可删除，请先将其他模板设为默认')
  }

  await db.withTransaction(async (tx) => {
    await stageTemplateModel.softDelete(templateId, tx)
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.TEMPLATE_DELETE,
        targetType: 'stage_template',
        targetId: templateId,
        detail: { before: { name: template.name, isDefault: false, referencingProjectCount: 0 }, after: null },
      },
      tx
    )
  })

  return { id: templateId, deleted: true }
}

/**
 * 设为默认模板（§5.3）。
 *
 * 需求文档的功能清单里没有单列这个接口，但 §5.3 要求「系统始终保留至少一个
 * 默认模板」，而默认标记总得有地方改 —— 否则它永远只能是种子数据里那一个，
 * 管理员删不掉也换不了。
 */
async function setDefaultTemplate(operator, templateId) {
  const template = await stageTemplateModel.findById(templateId, operator.tenantId)
  if (!template) throw AppError.notFound('模板不存在')
  if (template.is_default === 1) throw AppError.conflict('该模板已是默认模板')

  // 先记下当前默认模板：clearDefault 之后就查不出「原来是谁」了，
  // 而「默认模板从哪一份换成了哪一份」正是这条日志要回答的问题
  const previousDefault = await stageTemplateModel.findDefault(operator.tenantId)

  await db.withTransaction(async (tx) => {
    await stageTemplateModel.clearDefault(operator.tenantId, tx)
    await stageTemplateModel.setDefault(templateId, operator.tenantId, tx)

    // 默认模板决定「建档时没选模板用哪一个」，换默认会影响之后所有新建项目，
    // 属于需要能追溯的变更（§5.3「系统始终保留至少一个默认模板」）
    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.TEMPLATE_SET_DEFAULT,
        targetType: 'stage_template',
        targetId: templateId,
        detail: {
          before: previousDefault ? { defaultTemplateId: previousDefault.id, name: previousDefault.name } : null,
          after: { defaultTemplateId: templateId, name: template.name },
        },
      },
      tx
    )
  })

  return { id: templateId, isDefault: true }
}

// ─────────────────────────────────────────────────────────────
// 校验
// ─────────────────────────────────────────────────────────────

/**
 * 规范化并校验模板结构。
 *
 * 关键约束（AC-AD64）：**至少 1 个阶段，且每个阶段至少 1 个工序**。
 * 空阶段在生成项目时会产生一个没有工序的阶段，而阶段完成度是各工序的加权平均 ——
 * 零个工序会让它永远算不出进度，阶段也就永远无法推进到 100% 去触发验收。
 *
 * seq 不在这里赋值：由 replaceStructure 按数组下标重写。
 * 让前端传 seq 意味着「数组顺序」与「seq 字段」两份顺序可能不一致，
 * 而 §5.3 说得很清楚 —— 顺序以保存时提交的数组为准。
 */
function normalizeStructure(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw AppError.badRequest('模板至少需要包含 1 个阶段')
  }
  if (stages.length > MAX_STAGES) {
    throw AppError.badRequest(`单个模板最多 ${MAX_STAGES} 个阶段`)
  }

  return stages.map((stage, stageIndex) => {
    const label = `第 ${stageIndex + 1} 个阶段`

    const name = typeof stage.name === 'string' ? stage.name.trim() : ''
    if (!name) throw AppError.badRequest(`${label}的名称不能为空`)
    if (name.length > 50) throw AppError.badRequest(`${label}的名称不能超过 50 字`)

    // AC-AD30：计划工期天数必填，仅接受正整数
    const planDays = Number(stage.planDays)
    if (!Number.isInteger(planDays) || planDays < 1) {
      throw AppError.badRequest(`${label}「${name}」的计划工期必须是正整数天数`)
    }

    if (!Array.isArray(stage.items) || stage.items.length === 0) {
      throw AppError.badRequest(`${label}「${name}」至少需要包含 1 个工序`)
    }
    if (stage.items.length > MAX_ITEMS_PER_STAGE) {
      throw AppError.badRequest(`${label}「${name}」最多 ${MAX_ITEMS_PER_STAGE} 个工序`)
    }

    return {
      name,
      planDays,
      weight: normalizeWeight(stage.weight, `${label}「${name}」的权重`),
      items: stage.items.map((item, itemIndex) => {
        const itemLabel = `${label}「${name}」的第 ${itemIndex + 1} 个工序`

        const itemName = typeof item.name === 'string' ? item.name.trim() : ''
        if (!itemName) throw AppError.badRequest(`${itemLabel}的名称不能为空`)
        if (itemName.length > 50) throw AppError.badRequest(`${itemLabel}的名称不能超过 50 字`)

        return {
          name: itemName,
          weight: normalizeWeight(item.weight, `${itemLabel}的权重`),
          checklist: normalizeChecklist(item.checklist, itemLabel),
        }
      }),
    }
  })
}

/**
 * 权重要么不传（未配置，系统按等权计算），要么是正数（AC-AD23）。
 * 传 0 或负数一律拒绝 —— 静默当作「未配置」会让管理员的输入石沉大海。
 */
function normalizeWeight(value, label) {
  if (value === null || value === undefined || value === '') return null

  const result = money.validate(value, { allowZero: false })
  if (!result.ok) throw AppError.badRequest(`${label}必须是正数：${result.reason}`)

  return result.value
}

/** 默认验收项清单（B-3.5 / AC-AD32）。纯文本列表，去掉空项与超长项 */
function normalizeChecklist(value, label) {
  if (value === null || value === undefined || value === '') return []
  if (!Array.isArray(value)) throw AppError.badRequest(`${label}的验收项清单必须是数组`)

  const items = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : entry && typeof entry.name === 'string' ? entry.name.trim() : ''))
    .filter(Boolean)

  for (const item of items) {
    if (item.length > 200) throw AppError.badRequest(`${label}的验收项不能超过 200 字：${item.slice(0, 20)}…`)
  }

  return items
}

module.exports = {
  MAX_STAGES,
  MAX_ITEMS_PER_STAGE,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  deleteTemplate,
  setDefaultTemplate,
  normalizeStructure,
  parseChecklist,
}
