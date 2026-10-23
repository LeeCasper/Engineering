'use strict'

/**
 * B 端操作日志查询（B-1.9 / AC-AD09 读取侧）。
 *
 * 写入侧不在这里 —— 那是 `operationLog.service.record()`，由各业务 service
 * 在事务内显式调用（原因见该模块的文件头）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const datetime = require('../utils/datetime')
const AppError = require('../utils/AppError')
const operationLog = require('../services/operationLog.service')

/**
 * 日期只接受 `YYYY-MM-DD`。
 *
 * 刻意**不接受带时分秒**：审计场景的检索粒度是「天」，而允许传完整时刻
 * 就要回答「22:30:00 这一秒算不算在内」，那是个每次都要想一遍的问题
 * （`<=` 还是 `<`、有没有小数秒）。统一按自然日、左闭右闭，服务端换算成
 * 左闭右开的时间区间，调用方不必关心边界。
 */
const dateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
  .refine((value) => datetime.parse(value) !== null, '日期不存在')

const listQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  targetType: z.string().trim().max(64).optional(),
  targetId: z.coerce.number().int().positive().optional(),
  // action 用精确匹配，但**不校验是否在当前 ACTIONS 白名单内**：
  // operation_log 是只追加的历史表，里面可能存在早期版本用过、之后改名的动作。
  // 硬校验会让那些老记录永远筛不出来，而这恰恰是审计最需要它们的时候。
  // 代价是拼错动作名会得到空列表 —— 可接受，界面上的下拉本来就来自
  // /filters 接口，不会让用户手打。
  action: z.string().trim().max(64).optional(),
  module: z.string().trim().max(32).optional(),
  operatorType: z.enum(['admin', 'user', 'system']).optional(),
  operatorId: z.coerce.number().int().positive().optional(),
  from: dateField.optional(),
  to: dateField.optional(),
})

/** GET /admin/operation-logs —— 操作日志列表（AC-AD09） */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)

  // 模块名会被拼进 LIKE 模式，因此必须是已知模块。
  // 不校验的话，传 `module=%` 就是一次全表扫描 —— 不算越权，
  // 但把一个「按模块筛选」的接口变成了「无上限扫审计表」的入口
  if (query.module && !operationLog.isKnownModule(query.module)) {
    throw AppError.badRequest('未知的模块')
  }

  const filters = { ...query, ...normalizeRange(query) }

  const paging = parsePaging(req.query)
  const result = await operationLog.list(req.auth, filters, paging)

  res.page(result.list, result.total, paging)
}

/**
 * 把「自然日区间」换算成「左闭右开的时间区间」。
 *
 * `to` 当天必须**包含**在内，因此上界取次日零点 —— 写成 `to 23:59:59`
 * 也能用，但一旦哪天后端把 created_at 改成 DATETIME(3)，那一秒内
 * 最后 999 毫秒的记录就会被静默漏掉。
 *
 * 出参刻意叫 `before` 而不是 `to`：入参的 `to` 是「含当天」的上界，
 * 而这里给出的是「不含」的上界，两者语义相反。同名传下去，
 * 下一个读代码的人必然要在两处之间来回确认，索性让它一眼可辨。
 */
function normalizeRange({ from, to }) {
  const range = {}
  if (from) range.from = datetime.toDb(from)
  if (to) range.before = datetime.toDb(datetime.addDays(to, 1))
  return range
}

/** GET /admin/operation-logs/filters —— 筛选下拉的选项（模块与动作清单） */
async function filters(req, res) {
  res.ok({ modules: operationLog.listModules() })
}

/**
 * GET /admin/platform/logs/operation —— 平台日志中心的操作日志。
 *
 * 只返回 `tenant_id IS NULL` 的平台级事件：租户开通/停用、平台基础配置
 * 与基础内容页修改等。租户业务日志不在平台默认视野内，需要时走排障授权。
 */
async function platformList(req, res) {
  const query = validate(listQuerySchema, req.query)

  if (query.module && !operationLog.isKnownModule(query.module)) {
    throw AppError.badRequest('未知的模块')
  }

  const filters = { ...query, ...normalizeRange(query) }
  const paging = parsePaging(req.query)
  const result = await operationLog.listPlatform(filters, paging)

  res.page(result.list, result.total, paging)
}

/** GET /admin/platform/logs/operation/filters —— 平台操作日志的筛选项 */
async function platformFilters(req, res) {
  res.ok({ modules: operationLog.listModules() })
}

module.exports = { list, filters, platformList, platformFilters }
