'use strict'

/**
 * 业务操作日志（B-1.9 / AC-AD09 / AC-L28）。
 *
 * ── 为什么由 service 显式调用，而不是挂一个自动中间件 ──
 * AC-AD09 与 AC-L28 都要求记录**变更前后值**（§6.2 约定 `detail = {before, after}`）。
 * 自动中间件只能在请求前后拿到 HTTP 层的东西：请求体、响应体、状态码；
 * 它既不知道这条流水改之前是什么样，也分不清「改成功」与「改失败」。
 * 硬要拿到 before 就得在中间件里再查一次库，那等于把业务逻辑复制一份到中间件里。
 *
 * 因此本模块只提供「写」的能力，**由业务代码在事务内显式调用** ——
 * 它就在改动发生的那一处，before/after 都是现成的。
 *
 * ── 不参与业务事务 ──
 * 日志写失败不该让业务失败。因此这里吞掉异常只记 warn：
 * 丢一条审计日志可以接受，让业主的一笔付款登记失败不行。
 * 调用方传 tx 时会跟着业务事务一起提交，那是更严格的做法；
 * 不传 tx 则独立写入 —— 两种都支持，由调用方按重要性选择。
 */

const db = require('../db/pool')
const logger = require('../utils/logger')
const dataScope = require('./dataScope.service')
const operationLogModel = require('../models/operationLog.model')

/** 常用动作名。集中定义避免各处拼错（`ledger.update` 与 `ledger.updte` 会变成两条统计） */
const ACTIONS = {
  LEDGER_CREATE: 'ledger.create',
  LEDGER_UPDATE: 'ledger.update',
  LEDGER_DELETE: 'ledger.delete',
  LEDGER_REVERSE: 'ledger.reverse',
  RECONCILIATION_CREATE: 'reconciliation.create',
  RECONCILIATION_CONFIRM: 'reconciliation.confirm',
  RECONCILIATION_DISPUTE: 'reconciliation.dispute',
  PAYMENT_NODE_UNLOCK: 'payment_node.unlock',
  PAYMENT_NODE_PAY: 'payment_node.pay',
  PAYMENT_NODE_CONFIRM: 'payment_node.confirm',
  PROJECT_CREATE: 'project.create',
  PROJECT_UPDATE: 'project.update',
  PROJECT_STATUS: 'project.status',
  PROJECT_DELETE: 'project.delete',
  PROJECT_ARCHIVE: 'project.archive',
  PROJECT_RESTORE: 'project.restore',
  MEMBER_INVITE: 'project_member.invite',
  MEMBER_REMOVE: 'project_member.remove',
  MEMBER_SET_PRIMARY: 'project_member.set_primary',
  ADMIN_USER_CREATE: 'admin_user.create',
  ADMIN_USER_STATUS: 'admin_user.status',
  ADMIN_USER_PASSWORD: 'admin_user.reset_password',
  ADMIN_USER_GRANT: 'admin_user.grant_projects',
  TEMPLATE_CREATE: 'stage_template.create',
  TEMPLATE_UPDATE: 'stage_template.update',
  TEMPLATE_DELETE: 'stage_template.delete',
  TEMPLATE_DUPLICATE: 'stage_template.duplicate',
  TEMPLATE_SET_DEFAULT: 'stage_template.set_default',
  SYS_CONFIG_UPDATE: 'sys_config.update',
  // M11（个人中心 / C-5.x）：账号注销是**不可逆**的动作，必须留痕；
  // 内容页与反馈处理是后台日常动作，同样要能回答「谁改的 / 谁处理的」
  ACCOUNT_DEACTIVATE: 'account.deactivate',
  SUBSCRIPTION_RECORD: 'subscription.record',
  FEEDBACK_SUBMIT: 'feedback.submit',
  FEEDBACK_HANDLE: 'feedback.handle',
  CONTENT_UPDATE: 'content.update',
  DOOR_CODE_CREATE: 'door_code.create',
  DOOR_CODE_UPDATE: 'door_code.update',
  DOOR_CODE_REVOKE: 'door_code.revoke',
  DOOR_CODE_READ: 'door_code.read',
  // M13（平台运营）：租户的开通、配置变更与启停是**不可逆或影响全租户**的动作，
  // 必须留痕。这三条日志的 tenant_id 为 NULL —— 它们是平台级事件，
  // 不属于被操作的那个租户的审计范围（CLAUDE.md 第 76 条）
  TENANT_CREATE: 'tenant.create',
  TENANT_UPDATE: 'tenant.update',
  TENANT_STATUS: 'tenant.status',
  // M13（P4）：排障授权的授予/撤销由**租户**发起，写进租户审计流；
  // 平台持授权访问的每一次请求也写进该租户 —— 租户有权知道谁在什么时候看了什么
  PLATFORM_GRANT_CREATE: 'platform_grant.create',
  PLATFORM_GRANT_REVOKE: 'platform_grant.revoke',
  PLATFORM_ACCESS_TENANT: 'platform.access_tenant',
}

/**
 * 写一条操作日志。
 *
 * @param {object} params
 * @param {'admin'|'user'|'system'} params.operatorType
 * @param {number|null} [params.operatorId] system 产生的日志（定时任务）为 null
 * @param {string} params.action ACTIONS 之一
 * @param {string} [params.targetType] 目标对象类型，如 ledger、project
 * @param {number} [params.targetId]
 * @param {number} [params.projectId] 冗余项目归属，便于按项目查日志
 * @param {{before?: object, after?: object}} [params.detail] §6.2 约定为 `{before, after}`
 * @param {string} [params.ip]
 * @param {string} [params.requestId]
 * @param {object} [params.tx] 传入则跟着业务事务一起提交
 */
async function record(params, tx) {
  const executor = tx || db

  try {
    // ── 租户归属：能推就推，推不出才是 null ──
    // 后台账号自带 tenantId；C 端用户没有（一个人可能属于多个租户），
    // 但他们的操作都发生在某个项目里，因此按 projectId 反查。
    //
    // 不在这里补的话，C 端记账、读门锁密码这些日志会写成 tenant_id = NULL，
    // 而租户管理员的日志查询是 `tenant_id = ?` —— 那些日志会**永久不可见**，
    // 恰恰是最需要审计的那一批。
    let tenantId = params.tenantId ?? null
    if (!tenantId && params.projectId) {
      const row = await executor.queryOne('SELECT tenant_id FROM project WHERE id = ?', [params.projectId])
      tenantId = row ? row.tenant_id : null
    }

    await operationLogModel.insert({ ...params, tenantId }, executor)
  } catch (err) {
    // 审计日志写失败不阻断业务（见文件头说明）。
    // 但要记 error 级：它意味着审计链出现了缺口，运维应当知道
    logger.error('写入操作日志失败（业务已继续）', {
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      message: err.message,
    })
  }
}

/**
 * 从请求上下文里取日志所需的公共字段。
 *
 * controller 层组装，避免每个 service 方法都要接收 ip / requestId。
 * operatorType 由 token 类型决定（req.auth.type）。
 */
function contextFrom(req) {
  return fromOperator(req && req.auth)
}

/**
 * 从 service 层已经拿到的 `operator`（就是 `req.auth`）组装日志公共字段。
 *
 * ── 为什么要有这个函数 ──
 * 各 service 的入参就是 `operator`，而 `req.auth` 上已经带了 ip 与
 * requestId（见 middlewares/adminAuth.js 的说明）。有了它，给一个新的
 * service 方法补审计日志只需要一行 `operationLog.record({ ...ctx, ... })`，
 * 不必改方法签名、也不必透传 req —— 后者会让 service 层被迫知道 HTTP。
 *
 * ── operatorType 的映射只有这一处 ──
 * `req.auth.type` 是 'admin' / 'mini'，而 `operation_log.operator_type`
 * 的枚举是 'admin' / 'user' / 'system'。两套名字不能靠记忆对齐：
 * mini 对应的值叫 `user` 而不是 `mini`，写错的话 MySQL 会**静默**把
 * ENUM 截断成空串（只报 WARN_DATA_TRUNCATED），日志看着写进去了、
 * 按操作人却永远筛不出来。
 */
function fromOperator(operator) {
  if (!operator || !operator.id) {
    return { operatorType: 'system', operatorId: null, ip: null, requestId: null }
  }
  return {
    operatorType: operator.type === 'admin' ? 'admin' : 'user',
    operatorId: operator.id,
    // 后台账号带租户；C 端用户没有单一租户（可跨租户），由调用方按项目补
    tenantId: operator.tenantId ?? null,
    ip: operator.ip ?? null,
    requestId: operator.requestId ?? null,
  }
}

// ─────────────────────────────────────────────────────────────
// 读取侧（AC-AD09）
// ─────────────────────────────────────────────────────────────

/**
 * 动作名 → 模块名的标签。
 *
 * ── 为什么要有标签 ──
 * 筛选下拉里出现 `ledger.update` 这种东西，除了写代码的人没人选得对。
 * 审计界面是给运营看的，得写「记账」。
 *
 * ── 为什么标签表可以是「不全」的 ──
 * 模块清单由 ACTIONS **推导**（见 listModules），标签只是给它配中文。
 * 新加一个模块忘了配标签时，界面退化成显示模块原名，而不是让这个新模块
 * 从下拉里消失 —— 那种「加了功能但筛不出来」的缺口没人会去测。
 */
const MODULE_LABELS = {
  tenant: '租户',
  platform_grant: '排障授权',
  platform: '平台访问',
  admin_user: '后台账号',
  account: '账号',
  project: '项目',
  project_member: '项目成员',
  stage_template: '阶段模板',
  ledger: '记账',
  reconciliation: '对账',
  payment_node: '付款节点',
  sys_config: '系统配置',
  subscription: '订阅消息',
  feedback: '意见反馈',
  content: '内容页',
  door_code: '门锁密码',
}

/** 动作名里点号前的部分即模块名（`ledger.create` → `ledger`） */
function moduleOf(action) {
  return action.split('.')[0]
}

/**
 * 可筛选的模块与各自的动作清单。
 *
 * 由 ACTIONS 推导而不是手写一份：手写的清单会在每次新增动作时悄悄过期，
 * 表现是「日志里明明有这条操作，筛选下拉里却没有」。
 */
function listModules() {
  const grouped = new Map()

  for (const action of Object.values(ACTIONS)) {
    const module = moduleOf(action)
    if (!grouped.has(module)) grouped.set(module, [])
    grouped.get(module).push(action)
  }

  return [...grouped.entries()]
    .map(([module, actions]) => ({
      module,
      label: MODULE_LABELS[module] || module,
      actions: actions.sort(),
    }))
    .sort((a, b) => a.module.localeCompare(b.module))
}

/** 模块名白名单。筛选用它校验，避免把用户输入当 LIKE 模式 */
function isKnownModule(module) {
  return Object.values(ACTIONS).some((action) => moduleOf(action) === module)
}

/** 日志行 → 接口出参。detail 是 JSON 列，取出即对象 */
function shapeLog(row) {
  return {
    id: row.id,
    operatorType: row.operator_type,
    operatorId: row.operator_id,
    // 「谁做的」。system 的日志（定时任务）没有操作人，为 null，前端显示为「系统」
    operatorName: row.operator_name,
    action: row.action,
    module: moduleOf(row.action),
    targetType: row.target_type,
    targetId: row.target_id,
    projectId: row.project_id,
    projectName: row.project_name,
    // §6.2 约定 `{before, after}`。两个字段都可能缺：
    // 新增没有 before、删除没有 after，前端要按缺省渲染而不是等一个空对象
    detail: normalizeDetail(row.detail),
    ip: row.ip,
    requestId: row.request_id,
    createdAt: row.created_at,
  }
}

/**
 * detail 兼容两种形态。
 *
 * mysql2 会把 JSON 列解析成对象，但**只有识别出列类型为 JSON 时**才这么做；
 * 一旦将来有谁把该列改成 TEXT（或走了别的驱动配置），拿到的就是字符串。
 * 那种情况下若不解析，接口会返回一个被 JSON.stringify 二次转义的字符串，
 * 前端 `detail.before` 永远是 undefined，而界面上看起来「就是没有变更内容」。
 */
function normalizeDetail(detail) {
  if (detail === null || detail === undefined) return null
  if (typeof detail === 'string') {
    try {
      return JSON.parse(detail)
    } catch {
      return null
    }
  }
  return detail
}

/**
 * 查操作日志（AC-AD09）。
 *
 * 数据权限在**服务层**施加，调用方（controller）拿不到「不传 scope」的选项 ——
 * 与项目查询强制要求 scope 同一思路：忘了加过滤是一个立刻报出来的错误，
 * 而不是一个安静地把别人的操作记录返回给你的 200（§5.1、AC-AD52）。
 *
 * @param {{type: string, id: number, role: string}} auth
 * @param {object} filters projectId / targetType / targetId / action /
 *   module / operatorType / operatorId / from / to
 * @param {{offset: number, limit: number}} paging
 */
async function list(auth, filters = {}, paging) {
  const scope = dataScope.buildOperationLogFilter(auth)
  const { total, rows } = await operationLogModel.list({ scope, filters, paging })

  return { list: rows.map(shapeLog), total }
}

module.exports = {
  ACTIONS,
  MODULE_LABELS,
  record,
  contextFrom,
  fromOperator,
  list,
  listModules,
  isKnownModule,
  moduleOf,
}
