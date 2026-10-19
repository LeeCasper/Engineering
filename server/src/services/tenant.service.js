'use strict'

/**
 * 租户生命周期（M13 / P3）。
 *
 * ── 为什么开通必须是一个事务 ──
 * 新租户要同时具备四样东西才算「可交付」：租户行、owner 账号、
 * 一套默认阶段模板、内容页骨架。少任一样，客户登录后都会撞上一个
 * 看起来像系统故障的空状态：没有模板就无法建档，没有 owner 就没人能配置。
 * 而分开创建失败时，留下的半成品租户无法用接口修复 —— 只能手工进库收拾。
 *
 * ── 平台运营能做什么、不能做什么 ──
 * 能做：开通、改配额/到期、停用/恢复、退租。
 * 不能做：进入租户业务数据（P1 的 `requireTenant` 已在路由层挡住）。
 * 本模块的日志 `tenant_id` 一律为 NULL —— 平台级事件不写进被操作租户的审计流。
 */

const AppError = require('../utils/AppError')
const db = require('../db/pool')
const datetime = require('../utils/datetime')
const password = require('../utils/password')
const tenantModel = require('../models/tenant.model')
const adminUserModel = require('../models/adminUser.model')
const stageTemplateModel = require('../models/stageTemplate.model')
const operationLog = require('./operationLog.service')
const { DEFAULT_STAGE_TEMPLATE, CONTENT_PAGE_SKELETONS } = require('../data/tenantDefaults')

const STATUSES = ['active', 'suspended', 'archived']
const STATUS_LABELS = { active: '正常', suspended: '已停用', archived: '已退租' }

/**
 * 状态流转表。**已退租是终态**：
 * 退租意味着合同结束、数据进入留存期，恢复一个已退租的租户会让
 * 「退租时到底承诺了什么」变得无法回答。要重新合作就新开一个租户。
 */
const TRANSITIONS = {
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: [],
}

function isExpired(row) {
  if (!row.expires_at) return false
  const expires = datetime.parse(row.expires_at)
  return Boolean(expires && expires.valueOf() < Date.now())
}

/** 对外形状。用量与「是否到期」都由服务端算好，前端不再各算一遍 */
function shape(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    plan: row.plan,
    maxProjects: Number(row.max_projects),
    maxAdminUsers: Number(row.max_admin_users),
    trialEndsAt: row.trial_ends_at,
    expiresAt: row.expires_at,
    // 到期但还没被改成 suspended 的租户，列表上要能一眼看出来
    expired: isExpired(row),
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    remark: row.remark,
    usage: {
      projectCount: Number(row.project_count ?? 0),
      adminCount: Number(row.admin_count ?? 0),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ─────────────────────────────────────────────────────────────
// 查询
// ─────────────────────────────────────────────────────────────

async function list(operator, query, paging) {
  const { total, rows } = await tenantModel.list({
    status: query.status,
    keyword: query.keyword,
    offset: paging.offset,
    limit: paging.limit,
  })

  return {
    list: rows.map(shape),
    total,
    page: paging.page,
    pageSize: paging.pageSize,
  }
}

async function detail(operator, tenantId) {
  const tenant = await tenantModel.findById(tenantId)
  if (!tenant) throw AppError.notFound('租户不存在')

  const usage = await tenantModel.usage(tenantId)
  return shape({
    ...tenant,
    project_count: usage.projectCount,
    admin_count: usage.adminCount,
  })
}

// ─────────────────────────────────────────────────────────────
// 开通
// ─────────────────────────────────────────────────────────────

/** 把共享的默认模板数据拍成 `replaceStructure` 需要的完整形状 */
function buildDefaultStructure() {
  return DEFAULT_STAGE_TEMPLATE.stages.map((stage) => ({
    name: stage.name,
    planDays: stage.planDays,
    weight: null,
    items: stage.items.map((item) =>
      typeof item === 'string'
        ? { name: item, weight: null, checklist: [] }
        : { name: item.name, weight: null, checklist: item.checklist ?? [] }
    ),
  }))
}

/**
 * 开通租户。
 *
 * @param {object} operator 平台账号（req.auth）
 * @param {object} input 见 platformTenant.controller 的 createSchema
 */
async function provision(operator, input) {
  // ── 前置校验（在事务外，失败不必占用连接）──
  const existing = await tenantModel.findByCode(input.code)
  if (existing) throw AppError.conflict('租户标识已被使用')

  const policy = password.validatePolicy(input.owner.password)
  if (!policy.ok) throw AppError.badRequest(policy.reason)

  // 密码哈希在事务外算：bcrypt 是 CPU 密集的，放进事务会拉长持锁时间
  const passwordHash = await password.hash(input.owner.password)
  const structure = buildDefaultStructure()

  const result = await db.withTransaction(async (tx) => {
    const tenantId = await tenantModel.create(
      {
        name: input.name,
        code: input.code,
        plan: input.plan,
        maxProjects: input.maxProjects,
        maxAdminUsers: input.maxAdminUsers,
        trialEndsAt: input.trialEndsAt,
        expiresAt: input.expiresAt,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        remark: input.remark,
      },
      tx
    )

    // ── owner 账号 ──
    // 租户内唯一即可；与其他租户同名是允许的（登录时靠 tenantCode 区分，
    // 不带租户标识的同名登录会明确返回 400，绝不猜）
    const ownerId = await adminUserModel.create(
      {
        tenantId,
        username: input.owner.username,
        passwordHash,
        role: 'owner',
        createdBy: operator.id,
        // AC-AD06：首次登录强制改密。开通接口返回的初始密码只应被使用一次
        mustChangePassword: 1,
      },
      tx
    )

    // ── 默认阶段模板 ──
    // 新租户没有任何模板，不灌入的话第一次建档就会报「没有默认模板」
    const templateId = await stageTemplateModel.create(
      { tenantId, name: DEFAULT_STAGE_TEMPLATE.name, isDefault: true, createdBy: ownerId },
      tx
    )
    await stageTemplateModel.replaceStructure(templateId, structure, tx)

    // ── 内容页骨架（未发布）──
    for (const page of CONTENT_PAGE_SKELETONS) {
      await tx.query(
        `INSERT INTO content_page (tenant_id, page_key, title, content, updated_by)
         VALUES (?, ?, ?, ?, ?)`,
        [tenantId, page.key, page.title, page.content, ownerId]
      )
    }

    // ── 初始配置 ──
    // **刻意不插入任何 sys_config 行。**
    // 读取侧在缺行时回落到代码里的 DEFAULTS（§5.5），值完全一样；
    // 而插一份与默认值相同的行会让后台把它们显示成「已配置」，
    // 运维就再也分不清「我们调过这个阈值」与「这是出厂值」。
    // 平台级的默认值能力目前也落在代码里（sys_config.tenant_id 是 NOT NULL，
    // 没有平台行这一层），见 CLAUDE.md 关于 M13 的说明。

    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.TENANT_CREATE,
        targetType: 'tenant',
        targetId: tenantId,
        detail: {
          after: {
            name: input.name,
            code: input.code,
            plan: input.plan ?? 'basic',
            maxProjects: input.maxProjects ?? 20,
            maxAdminUsers: input.maxAdminUsers ?? 5,
            expiresAt: input.expiresAt ?? null,
            ownerUsername: input.owner.username,
            defaultTemplateId: templateId,
          },
        },
      },
      tx
    )

    return { tenantId, ownerId, templateId }
  })

  return {
    tenant: await detail(operator, result.tenantId),
    owner: {
      id: result.ownerId,
      username: input.owner.username,
      mustChangePassword: true,
    },
    defaultTemplateId: result.templateId,
    // 平台把这个短标识交给客户，登录页带上它才能在同名账号之间定位到这家公司
    tenantCode: input.code,
  }
}

// ─────────────────────────────────────────────────────────────
// 变更
// ─────────────────────────────────────────────────────────────

async function updateTerms(operator, tenantId, input) {
  const before = await tenantModel.findById(tenantId)
  if (!before) throw AppError.notFound('租户不存在')

  await tenantModel.updateTerms(tenantId, {
    plan: input.plan,
    maxProjects: input.maxProjects,
    maxAdminUsers: input.maxAdminUsers,
    trialEndsAt: input.trialEndsAt,
    expiresAt: input.expiresAt,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    remark: input.remark,
  })

  const after = await tenantModel.findById(tenantId)

  // 只记真正发生变化的字段。把未改动的字段也写进日志，
  // 会让一次「只延长到期时间」的操作看起来像改了七八项，
  // 真正需要审计的那一项反而淹没在里面
  const beforeChanged = {}
  const afterChanged = {}
  const mapping = {
    plan: 'plan',
    max_projects: 'maxProjects',
    max_admin_users: 'maxAdminUsers',
    trial_ends_at: 'trialEndsAt',
    expires_at: 'expiresAt',
    contact_name: 'contactName',
    contact_phone: 'contactPhone',
    remark: 'remark',
  }
  for (const [column, key] of Object.entries(mapping)) {
    if (String(before[column] ?? '') !== String(after[column] ?? '')) {
      beforeChanged[key] = before[column]
      afterChanged[key] = after[column]
    }
  }

  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.TENANT_UPDATE,
    targetType: 'tenant',
    targetId: tenantId,
    detail: { before: beforeChanged, after: afterChanged },
  })

  return detail(operator, tenantId)
}

async function updateStatus(operator, tenantId, { status, reason }) {
  if (!STATUSES.includes(status)) throw AppError.badRequest('租户状态不合法')

  const before = await tenantModel.findById(tenantId)
  if (!before) throw AppError.notFound('租户不存在')
  if (before.status === status) throw AppError.conflict(`租户已是「${STATUS_LABELS[status]}」状态`)

  const allowed = TRANSITIONS[before.status] || []
  if (!allowed.includes(status)) {
    throw AppError.conflict(
      before.status === 'archived'
        ? '已退租的租户不能恢复；需要继续合作请新开一个租户'
        : `租户不能从「${STATUS_LABELS[before.status]}」变更为「${STATUS_LABELS[status]}」`
    )
  }

  await tenantModel.updateStatus(tenantId, status)

  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.TENANT_STATUS,
    targetType: 'tenant',
    targetId: tenantId,
    detail: {
      before: { status: before.status },
      after: { status, reason: reason ?? null },
    },
  })

  return detail(operator, tenantId)
}

// ─────────────────────────────────────────────────────────────
// 配额
// ─────────────────────────────────────────────────────────────

/**
 * 断言还能再建一个项目，否则 403。
 *
 * **必须在创建项目的事务里调用**，并且传入 tx：它会对 tenant 行加
 * `FOR UPDATE` 锁。两个并发建档请求若都先 COUNT 再 INSERT，会双双看到
 * 「还剩 1 个名额」然后各插一条 —— 配额被静默突破，而报表上只会显示
 * 「怎么多了两个项目」。
 */
async function assertProjectQuota(tenantId, tx) {
  const tenant = await tenantModel.lockById(tenantId, tx)
  if (!tenant) throw AppError.forbidden('租户不存在或已退租')

  // 0 = 不限（租户表注释与种子数据都约定过这个语义）
  if (Number(tenant.max_projects) === 0) return

  const count = await tenantModel.countProjects(tenantId, tx)
  if (count >= Number(tenant.max_projects)) {
    throw AppError.forbidden(
      `项目数量已达当前套餐上限（${tenant.max_projects} 个），请联系服务商调整配额`
    )
  }
}

/** 同上，约束后台账号数。owner 自己也占一个名额 */
async function assertAdminQuota(tenantId, tx) {
  const tenant = await tenantModel.lockById(tenantId, tx)
  if (!tenant) throw AppError.forbidden('租户不存在或已退租')

  if (Number(tenant.max_admin_users) === 0) return

  const count = await tenantModel.countAdminUsers(tenantId, tx)
  if (count >= Number(tenant.max_admin_users)) {
    throw AppError.forbidden(
      `后台账号数已达当前套餐上限（${tenant.max_admin_users} 个），请联系服务商调整配额`
    )
  }
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  TRANSITIONS,
  list,
  detail,
  provision,
  updateTerms,
  updateStatus,
  assertProjectQuota,
  assertAdminQuota,
}
