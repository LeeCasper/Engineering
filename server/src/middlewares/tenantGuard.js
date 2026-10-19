'use strict'

/**
 * C 端「租户停用/到期后只读」守卫（M13 / P3）。
 *
 * ── 为什么 C 端不能像 B 端那样直接拒绝登录 ──
 * 一个微信账号可能同时属于多个租户（CLAUDE.md 第 74 条）。租户 A 停用时，
 * 用户仍然要能看自己在租户 B 的项目、给 B 的项目汇报；而 A 的项目数据
 * 只是不能再改。因此这里拦的是**写操作**，不是登录。
 *
 * ── 为什么挂在路由层而不是每个 service 里判断 ──
 * C 端写接口有二十多个（汇报、验收、记账、对账、门锁、邀请确认…）。
 * 在 service 里逐个加判断就是「记得加就安全」的约定 —— 漏一个就是一个
 * 停用租户仍能继续写数据的缺口，而且不会报错、只会安静地写进去。
 * 路由层每个写入路由组只挂一次，新增写接口时只要跟着现有分组走就自动受保护。
 *
 * ── 怎么拿到 project_id ──
 * 项目级路由（`/projects/:id/...`）直接用 `:id`；
 * 资源级路由（`/acceptances/:id/...`、`/reports/:id/...`）的 `:id`
 * 是资源主键，需要回表取 `project_id`。表名来自固定映射，
 * 不接受任何外部输入，因此不存在拼接注入的余地。
 */

const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')
const datetime = require('../utils/datetime')
const db = require('../db/pool')

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** resource → 用于反查 project_id 的表。`project` 表示 `:id` 本身就是项目 id */
const RESOURCE_TABLES = Object.freeze({
  project: null,
  progress_report: 'progress_report',
  acceptance: 'acceptance',
  reconciliation: 'reconciliation',
  project_door_code: 'project_door_code',
  project_member: 'project_member',
})

/**
 * @param {object} options
 * @param {keyof RESOURCE_TABLES} [options.resource='project']
 * @param {string} [options.param='id'] 路由参数名
 */
function tenantWriteGuard({ resource = 'project', param = 'id' } = {}) {
  if (!(resource in RESOURCE_TABLES)) {
    // 启动期就失败，而不是请求来了才发现映射写错 —— 后者会表现为
    // 「这个路由的写操作永远放行」，没有任何日志
    throw new Error(`tenantWriteGuard 未配置资源类型：${resource}`)
  }
  const table = RESOURCE_TABLES[resource]

  return asyncHandler(async (req, res, next) => {
    // 读操作一律放行：停用/到期只影响「能不能改」
    if (!WRITE_METHODS.has(req.method)) return next()

    const id = Number(req.params[param])
    if (!Number.isInteger(id) || id <= 0) {
      // 参数不合法交给业务层的参数校验去报错，不在这里改变原有语义
      return next()
    }

    let projectId = id
    if (table) {
      const row = await db.queryOne(
        `SELECT project_id FROM ${table} WHERE id = ? AND deleted_at IS NULL`,
        [id]
      )
      // 资源不存在 → 放行，让业务层按原有语义返回 404。
      // 在这里提前 403 会泄露「这个 id 是否存在」的差异
      if (!row) return next()
      projectId = row.project_id
    }

    const project = await db.queryOne(
      'SELECT tenant_id FROM project WHERE id = ? AND deleted_at IS NULL',
      [projectId]
    )
    if (!project) return next()

    const tenant = await db.queryOne(
      'SELECT status, expires_at FROM tenant WHERE id = ? AND deleted_at IS NULL',
      [project.tenant_id]
    )
    if (!tenant || tenant.status !== 'active') {
      throw AppError.forbidden('租户已停用，项目数据暂不可修改')
    }
    if (tenant.expires_at && datetime.parse(tenant.expires_at).valueOf() < Date.now()) {
      throw AppError.forbidden('租户服务已到期，项目数据暂不可修改')
    }

    return next()
  })
}

module.exports = { tenantWriteGuard }
