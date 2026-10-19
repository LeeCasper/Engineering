'use strict'

/**
 * 后台项目载入与数据权限判定。
 *
 * ── 为什么单独一个模块 ──
 * 项目相关的服务有三个（project / projectMember / paymentNode），
 * 每个都要「按 id 取项目 + 判权限 + 判归档只读」。若各自实现，
 * 迟早会出现某一条路径漏判 —— 那正是 AC-AD52 要防的越权。
 *
 * 放在独立模块而不是 project.service 里，是为了避免循环依赖：
 * project.service 已经依赖 projectMember.service，若反过来让
 * projectMember.service 依赖 project.service，就成环了。
 * 本模块只依赖 model 层与 dataScope，是依赖图的叶子。
 */

const AppError = require('../utils/AppError')
const dataScope = require('./dataScope.service')
const db = require('../db/pool')
const projectModel = require('../models/project.model')

/**
 * 取项目并判定数据权限。
 *
 * ── 404 与 403 的区分 ──
 * AC-AD52 明确要求「直接访问无权项目 ID 返回 403」，因此这里刻意**先不带过滤条件
 * 查一次**，再单独判权限。若把过滤条件塞进 WHERE（像 findByIdScoped 那样），
 * 无权项目会「查不到」，于是统一变成 404 —— 那不符合验收标准。
 *
 * 代价是 403 会透露「这个 id 确实存在一个项目」。这是刻意的取舍：
 * B 端服务的是内部人员，管理员报「我打不开某个项目」时，
 * 能立刻区分「不存在」还是「没权限」比隐藏存在性重要得多。
 * C 端则相反（AC-P26 要求不泄露是否存在），那条路径走
 * project.service 的 getProjectForMember，语义完全不同。
 *
 * @param {object} operator 后台操作者（req.auth）
 * @param {number} projectId
 * @param {object} [options]
 * @param {boolean} [options.requireWritable=false] 是否要求项目未归档（AC-AD25/57）
 * @returns {Promise<object>} 项目行
 */
async function load(operator, projectId, { requireWritable = false } = {}) {
  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')

  const scope = dataScope.buildFilter(operator)

  // 数据权限校验：查一次「这个项目在不在我的可见范围内」。
  // 复用同一段过滤条件，而不是另写一套判断 —— 两套判断一旦分叉，
  // 列表与详情就会对不上。
  //
  // **所有人都要过这一步**（包括租户 owner）：多租户下没有任何「不受限」角色，
  // 否则租户边界会跟着一起被跳过（见 dataScope 文件头的说明）。
  const reachable = await db.queryOne(
    `SELECT p.id FROM project p WHERE p.id = ? AND ${scope.clause}`,
    [projectId, ...scope.params]
  )
  if (!reachable) {
    // ── 跨租户一律 404，租户内无权才 403 ──
    // 403 与 404 的差异会让租户 A 的管理员按自增 id 遍历出「租户 B 有多少项目」。
    // 租户内部保留 403：那是同一家公司的人，能区分「不存在」与「没权限」
    // 才便于排查（AC-AD52）。
    if (scope.tenantId != null && Number(project.tenant_id) !== Number(scope.tenantId)) {
      throw AppError.notFound('项目不存在')
    }
    throw AppError.forbidden('无权访问该项目')
  }

  // 平台账号持的是**只读**授权：查障用的临时窗口不该能改客户数据
  if (operator.role === 'platform' && requireWritable) {
    throw AppError.forbidden('平台账号对租户数据仅可查看，不能修改')
  }

  if (requireWritable && project.status === 'archived') {
    throw AppError.forbidden('项目已归档，全部数据只读')
  }

  return project
}

/** 判断可达性而不抛错，供需要「是否可见」布尔值的场景使用 */
async function isReachable(operator, projectId) {
  try {
    await load(operator, projectId)
    return true
  } catch {
    return false
  }
}

module.exports = { load, isReachable }
