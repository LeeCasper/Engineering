'use strict'

/**
 * C 端首屏聚合（BZGGCB-12）。
 *
 * ── 为什么要聚合 ──
 * 项目详情页进入一次并发 9 个细粒度接口，记账页 6 个；`onShow` 回来还会整组重拉。
 * 每次请求都要过一遍鉴权、租户守卫与限流桶，请求数本身就是成本（BZGGCB-11 正是
 * 在这条路径上撞了 60 次/分钟）。聚合只解决「首屏要发多少次」，不改变任何数据口径。
 *
 * ── 权限口径必须与原接口一致 ──
 * 本模块**不自己写 SQL**，每个数据集都调用原来那个 service 函数取数：
 * 成员校验、角色判定、租户隔离、归档只读、脱敏与签名 URL 规则都留在原处。
 * 这样聚合接口不可能比细粒度接口多看到一行数据 —— 一旦绕过，越权就不是
 * 「换了个入口」而是新增了一条没人审过的查询。
 *
 * ── 细粒度接口全部保留 ──
 * `/projects/:id/stages`、`/reports`、`/ledger/summary` 等继续存在，供增量刷新
 * 与其它端复用；聚合接口只服务首屏。
 */

const logger = require('../utils/logger')
const projectService = require('./project.service')
const acceptanceService = require('./acceptance.service')
const reportService = require('./report.service')
const ledgerService = require('./ledger.service')
const profileService = require('./profile.service')
const visitService = require('./visit.service')
const completionReportService = require('./projectCompletionReport.service')
const reconciliationService = require('./reconciliation.service')

/**
 * 项目详情页首屏只展示**最新一条**汇报（`reports[0]`），原来却拉了 20 条。
 * 聚合接口按首屏真实用量取 1 条，完整列表仍走 `GET /projects/:id/reports`。
 */
const REPORT_PREVIEW_LIMIT = 1

/** 考察记录卡片首屏展示 3 条（与原有调用一致） */
const VISIT_PREVIEW_LIMIT = 3

function paging(page, pageSize) {
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize }
}

/**
 * 非首屏主数据：无权限或不存在时返回 null，与前端原来逐个 `.catch(() => null)` 一致。
 * 403/404 是可预期的（监理没有账目/联系方式权限、项目未完工没有竣工报告），
 * 只把其它异常记 warn —— 真正的故障不该被静默吞掉。
 */
async function optionalData(label, projectId, loader) {
  try {
    return await loader()
  } catch (err) {
    if (err.status !== 403 && err.status !== 404) {
      logger.warn('首屏聚合的附属数据集读取失败，降级为 null', {
        label,
        projectId,
        message: err.message,
      })
    }
    return null
  }
}

/**
 * 项目详情页首屏（C-2.1 / C-2.2 / C-3.1 / C-4.x / C-5.6 / C-6.x / V2.14）。
 *
 * 详情本身（含阶段工序树）是主数据，取不到就让整个请求失败；
 * 其余数据集并行拉取，附属项按原前端行为降级为 null。
 */
async function getProjectOverview(userId, projectId) {
  // 所有数据集**同时**开跑：详情本身也要跑同一套成员校验，先 await 它再加
  // 一层串行只会让首屏多等一个往返（实测约 +400ms），聚合就失去了意义。
  // 非参与项目时各 service 都会拒绝，Promise.all 直接失败，仍是 404（AC-P26）。
  const [project, acceptances, reports, paymentNodes, ledgerSummary, contacts, visits, completionReport] =
    await Promise.all([
      projectService.getProjectForMember(userId, projectId),
      acceptanceService.listAcceptances(userId, projectId),
      reportService.listReports(userId, projectId, {
        paging: paging(1, REPORT_PREVIEW_LIMIT),
      }),
      optionalData('payment-nodes', projectId, () =>
        ledgerService.listPaymentNodes(userId, projectId)
      ),
      optionalData('ledger-summary', projectId, () => ledgerService.getSummary(userId, projectId)),
      optionalData('contacts', projectId, () => profileService.getContacts(userId, projectId)),
      visitService.listVisits(userId, projectId, { paging: paging(1, VISIT_PREVIEW_LIMIT) }),
      optionalData('completion-report', projectId, () =>
        completionReportService.getMiniState(userId, projectId)
      ),
    ])

  return {
    project,
    // 阶段树随详情一起下发（getProjectForMember 已带 stages），
    // 不再单独请求 /projects/:id/stages
    stages: project.stages || [],
    acceptances,
    reports,
    paymentNodes,
    ledgerSummary,
    contacts,
    visits,
    completionReport,
  }
}

/**
 * 记账页首屏（C-4.1 / C-4.5 / C-4.6 / C-4.12 / AC-L22）。
 *
 * 监理不参与记账（AC-L27）：原页面的做法是「先取项目详情，判到监理就跳走，
 * 记账接口一个都不调」。聚合接口保持同一行为 —— 返回 `ledgerAccess: false`
 * 与全 null 的数据集，不返回任何账目字段，由前端沿用原来的跳转逻辑。
 */
async function getLedgerOverview(userId, projectId) {
  // 同样的道理：角色判定与五个账目数据集并行发起，不串行等待。
  // 用 allSettled 是因为要先拿到角色才能区分「监理」与「真失败」：
  // 监理原本就不会调用这些接口，403 是预期结果；业主/工长遇到 403 才是要报错的。
  const settle = (loader) =>
    loader().then(
      (value) => ({ ok: true, value }),
      (reason) => ({ ok: false, reason })
    )

  const [projectResult, summaryResult, nodesResult, stageResult, breakdownResult, recResult] =
    await Promise.all([
      settle(() => projectService.getProjectForMember(userId, projectId)),
      settle(() => ledgerService.getSummary(userId, projectId)),
      settle(() => ledgerService.listPaymentNodes(userId, projectId)),
      settle(() => ledgerService.getStageLedger(userId, projectId)),
      settle(() => ledgerService.getExpenseBreakdown(userId, projectId)),
      settle(() => reconciliationService.list(userId, projectId)),
    ])

  // 非参与项目：与原详情接口同一句 404（AC-P26）
  if (!projectResult.ok) throw projectResult.reason

  const project = projectResult.value
  const canViewLedger = project.myRole === 'owner' || project.myRole === 'foreman'

  if (!canViewLedger) {
    return {
      project,
      ledgerAccess: false,
      summary: null,
      paymentNodes: null,
      stageLedger: null,
      breakdown: null,
      reconciliations: null,
    }
  }

  // 与原页面一致：这几项任一失败（如项目已归档）就让整页进入错误态，
  // 不降级成「部分数据」，否则财务数字缺一块比报错更危险。
  for (const result of [summaryResult, nodesResult, stageResult, breakdownResult, recResult]) {
    if (!result.ok) throw result.reason
  }

  const summary = summaryResult.value
  const paymentNodes = nodesResult.value
  const stageLedger = stageResult.value
  const breakdown = breakdownResult.value
  const reconciliations = recResult.value

  return {
    project,
    ledgerAccess: true,
    summary,
    paymentNodes,
    stageLedger,
    breakdown,
    reconciliations,
  }
}

module.exports = { getProjectOverview, getLedgerOverview }
