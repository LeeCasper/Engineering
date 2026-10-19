'use strict'

/**
 * 后台项目数据权限（§5.1，AC-AD37 / AC-AD44 / AC-AD52）。
 *
 * ── 需求文档的原话 ──
 * §6.2：「后台数据权限过滤须收敛到**统一的服务层中间件**，而非各接口各写一遍 ——
 * 漏掉一处就是越权漏洞。这是本项目最容易出错的地方之一。」
 *
 * 因此本模块是唯一的过滤来源，且刻意做了两层防呆：
 *
 *   1. 过滤条件只能由 `buildFilter()` 产出，不允许各接口手写 WHERE；
 *   2. 项目查询方法（project.model.js）**强制要求**传入 scope，缺失直接抛错。
 *      这比「记得加过滤」可靠 —— 忘了传是一个立刻报出来的 500，
 *      而不是一个安静地把别人的项目返回给你的 200。
 *
 * ── 规则（§5.1 数据权限模型，Q10 已定）──
 *   超级管理员：全部项目，无过滤。
 *   项目管理员：自己创建的 ∪ 被 `project_admin_scope` 授权的。
 */

const db = require('../db/pool')
const AppError = require('../utils/AppError')

/** scope 对象的标记，用于校验传入的东西确实是 buildFilter 的产物 */
const SCOPE_MARK = Symbol('projectDataScope')

/**
 * 构造项目查询的过滤条件（三层：平台 → 租户 → 项目）。
 *
 * ── 没有任何角色是 unrestricted ──
 * 早先超级管理员返回 `1 = 1` 并带 `unrestricted: true`，`projectAccess.load`
 * 靠它跳过校验。多租户下这条旁路必须拆掉：租户 owner「在租户内不受项目限制」，
 * 但它仍然受**租户**限制。若继续用 unrestricted 放行，load 会连租户校验一起跳过，
 * 租户 A 的 owner 就能打开租户 B 的项目。
 * 现在所有人都走同一条 SQL 校验，差别只在 clause 的内容。
 *
 * @param {{type: string, id: number, role: string, tenantId: number|null, grantedTenantId: number|null}} auth
 * @returns {{clause: string, params: Array, tenantId: number|null, [SCOPE_MARK]: true}}
 */
function buildFilter(auth) {
  if (!auth || auth.type !== 'admin') {
    // 只有后台账号参与后台数据权限。C 端的项目可见性由 project_member 决定，
    // 走的是另一套（见 mini 侧的 requireMini + 成员查询）
    throw new Error('buildFilter 只接受后台账号身份')
  }

  // ── 平台账号：默认拒绝 ──
  // 没有任何授权时返回 `1 = 0`（看得见 0 个项目），而不是 `1 = 1`。
  // 平台想看一眼租户数据，必须由租户 owner 显式开一个时间窗 —— 见 P4。
  if (auth.role === 'platform') {
    if (!auth.grantedTenantId) {
      return make({ clause: '1 = 0', params: [], tenantId: null })
    }
    return make({ clause: 'p.tenant_id = ?', params: [auth.grantedTenantId], tenantId: auth.grantedTenantId })
  }

  if (!auth.tenantId) {
    // 租户账号没有 tenantId 属于数据异常，不能当成「全租户」放行
    throw new Error('租户账号缺少 tenantId，拒绝查询（否则会跨租户泄露）')
  }

  // ── 租户管理员：本租户全部项目 ──
  if (auth.role === 'owner') {
    return make({ clause: 'p.tenant_id = ?', params: [auth.tenantId], tenantId: auth.tenantId })
  }

  // ── 项目管理员：本租户 + 被授权的项目 ──
  // 用 EXISTS 子查询而不是 JOIN：列表查询里再 JOIN 一张表会与分页的
  // LIMIT 相互干扰（一对多会让行数翻倍），而 project_admin_scope 对
  // (admin_user_id, project_id) 是唯一的，用 EXISTS 语义最清晰也最快
  return make({
    clause: `(p.tenant_id = ? AND (p.created_by = ? OR EXISTS (
                SELECT 1 FROM project_admin_scope pas
                 WHERE pas.project_id = p.id
                   AND pas.admin_user_id = ?
                   AND pas.deleted_at IS NULL
              )))`,
    params: [auth.tenantId, auth.id, auth.id],
    tenantId: auth.tenantId,
  })
}

function make(scope) {
  return { ...scope, [SCOPE_MARK]: true }
}

/**
 * 校验一个 scope 是不是本模块产出的。
 * project.model 的查询方法用它做防呆检查。
 */
function assertValid(scope) {
  if (!scope || scope[SCOPE_MARK] !== true) {
    throw new Error(
      '项目查询必须传入 dataScope.buildFilter(auth) 的返回值。' +
        '缺少数据权限过滤会让项目管理员看到无权项目（AC-AD52），因此这里直接报错而不是放行。'
    )
  }
  return scope
}

/**
 * 判断操作者是否有权访问某个项目。
 *
 * @returns {Promise<boolean>}
 */
async function canAccess(auth, projectId) {
  const scope = buildFilter(auth)
  // 复用同一段过滤条件，避免「列表过滤了但详情没过滤」这种最典型的越权
  const row = await db.queryOne(
    `SELECT p.id FROM project p WHERE p.id = ? AND p.deleted_at IS NULL AND ${scope.clause}`,
    [projectId, ...scope.params]
  )
  return Boolean(row)
}

/**
 * 断言有权访问，否则 403。
 *
 * 注意返回 403 而不是 404 的取舍：AC-AD52 明确要求「直接访问无权项目 ID 返回 403」。
 * C 端则相反（AC-P26 要求 403/404 且不泄露项目是否存在），因为 C 端面对的是
 * 外部用户，后台管理员是内部人员，直接告知「无权」有助于排查。
 */
async function assertAccess(auth, projectId) {
  if (!(await canAccess(auth, projectId))) {
    throw AppError.forbidden('无权访问该项目')
  }
}

/** 被授权的项目 ID 列表（供「授权范围」界面回显） */
async function listGrantedProjectIds(adminUserId) {
  const rows = await db.query(
    'SELECT project_id FROM project_admin_scope WHERE admin_user_id = ? AND deleted_at IS NULL',
    [adminUserId]
  )
  return rows.map((r) => r.project_id)
}

/**
 * 操作日志的数据权限（§5.1 能力边界表：「操作日志查看 —— 超级管理员：全部；
 * 项目管理员：仅本人相关」，AC-AD09）。
 *
 * ── 「本人相关」取什么 ──
 * 两层含义都算，缺一不可：
 *   1. **自己做的操作**（哪怕它没有项目归属，如 `admin_user.create`）；
 *   2. **自己可见项目上发生的操作** —— 项目管理员要能审计本项目里工长登记的
 *      每一笔支出（AC-L28 把 C 端记账也写进 operation_log），只看自己的操作
 *      等于把最需要审计的那批记录挡在门外。
 *
 * ── 为什么 `operator_id = ?` 必须带 `operator_type = 'admin'` ──
 * C 端 `user.id` 与后台 `admin_user.id` 是**两套自增空间**，id 撞车是常态。
 * 只写 `operator_id = 5` 会让「admin#5」看到「user#5」的记账操作 ——
 * 那是数据串号，不是「多看到几条」。这与 CLAUDE.md 第 54 条
 * （notification 与 admin_notification 混用）是同一类错误的两个面。
 *
 * @param {{type: string, id: number, role: string}} auth
 * @param {string} alias operation_log 在 SQL 中的别名，默认 ol
 * @returns {{clause: string, params: Array}}
 */
function buildOperationLogFilter(auth, alias = 'ol') {
  if (!auth || auth.type !== 'admin') {
    throw new Error('buildOperationLogFilter 只接受后台账号身份')
  }

  // 平台账号：与项目查询同一套默认拒绝。日志里包含合同金额相关的动作名，
  // 不属于「可以随便看」的运维信息
  if (auth.role === 'platform') {
    if (!auth.grantedTenantId) return { clause: '1 = 0', params: [] }
    return { clause: `${alias}.tenant_id = ?`, params: [auth.grantedTenantId] }
  }

  if (!auth.tenantId) throw new Error('租户账号缺少 tenantId，拒绝查询操作日志')

  // ── 为什么这里不再拼「项目子查询」──
  // 日志表自己带 tenant_id（审计事件必然发生在某个租户内），
  // 直接按它过滤比「我可见项目上的日志」更准：
  //   - 模板、账号、配置这类**没有 project_id** 的日志也能被 owner 看到；
  //   - 跨租户事件（注销一个同属两个租户的账号）写在 tenant_id IS NULL，
  //     任何租户都看不到，只有平台能看 —— 这正是期望的。
  // 项目管理员仍只看自己相关的：自己做的，或自己可见项目上的。
  if (auth.role === 'owner') {
    return { clause: `${alias}.tenant_id = ?`, params: [auth.tenantId] }
  }

  const projectScope = buildFilter(auth)
  return {
    clause: `(${alias}.tenant_id = ?
              AND ((${alias}.operator_type = 'admin' AND ${alias}.operator_id = ?)
                   OR ${alias}.project_id IN (
                        SELECT p.id FROM project p
                         WHERE p.deleted_at IS NULL AND ${projectScope.clause}
                      )))`,
    params: [auth.tenantId, auth.id, ...projectScope.params],
  }
}

module.exports = {
  buildFilter,
  buildOperationLogFilter,
  assertValid,
  canAccess,
  assertAccess,
  listGrantedProjectIds,
  SCOPE_MARK,
}
