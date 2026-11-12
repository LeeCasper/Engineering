'use strict'

/**
 * 后台账号管理控制器（B-1.3 / B-1.4 / B-1.10）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const { parsePaging } = require('../utils/pagination')
const adminUserService = require('../services/adminUser.service')

const listQuerySchema = z.object({
  keyword: z.string().trim().max(50).optional(),
  role: z.enum(['owner', 'admin']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

// 限定字符集：用户名会出现在日志与 URL 里，放开会造成日志注入与转义麻烦。
// 创建与编辑共用同一份规则 —— 两边各写一份，迟早有一边被改漏
const usernameSchema = z
  .string()
  .trim()
  .min(1, '请输入用户名')
  .max(50, '用户名过长')
  .regex(/^[A-Za-z0-9_.@-]+$/, '用户名只能包含字母、数字与 _ . @ -')

const createSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, '请输入初始密码').max(72),
  role: z.enum(['admin', 'owner']).default('admin'),
})

/** 编辑账号基本信息。`admin_user` 只有用户名这一项可改（没有姓名 / 手机号字段） */
const updateSchema = z.object({
  username: usernameSchema,
})

const roleSchema = z.object({
  role: z.enum(['admin', 'owner'], { errorMap: () => ({ message: '角色只能为 admin 或 owner' }) }),
})

const statusSchema = z.object({
  status: z.enum(['active', 'disabled'], { errorMap: () => ({ message: '状态只能为 active 或 disabled' }) }),
})

const resetPasswordSchema = z.object({
  newPassword: z.string().min(1, '请输入新密码').max(72),
})

const grantSchema = z.object({
  projectIds: z.array(z.number().int().positive()).max(500, '一次最多授予 500 个项目').default([]),
})

/** GET /admin/admin-users */
async function list(req, res) {
  const query = validate(listQuerySchema, req.query)
  const paging = parsePaging(req.query)
  const result = await adminUserService.list(req.auth, { ...query, paging })
  res.page(result.list, result.total, { page: result.page, pageSize: result.pageSize })
}

/** POST /admin/admin-users */
async function create(req, res) {
  const input = validate(createSchema, req.body)
  res.ok(await adminUserService.create(req.auth, input))
}

/** PUT /admin/admin-users/:id —— 编辑基本信息 */
async function update(req, res) {
  const { username } = validate(updateSchema, req.body)
  res.ok(await adminUserService.updateAccount(req.auth, Number(req.params.id), { username }))
}

/** PUT /admin/admin-users/:id/role —— 修改角色 */
async function updateRole(req, res) {
  const { role } = validate(roleSchema, req.body)
  res.ok(await adminUserService.updateRole(req.auth, Number(req.params.id), role))
}

/** DELETE /admin/admin-users/:id —— 软删除账号 */
async function remove(req, res) {
  res.ok(await adminUserService.removeAccount(req.auth, Number(req.params.id)))
}

/** PUT /admin/admin-users/:id/status */
async function updateStatus(req, res) {
  const { status } = validate(statusSchema, req.body)
  res.ok(await adminUserService.updateStatus(req.auth, Number(req.params.id), status))
}

/** PUT /admin/admin-users/:id/password —— 重置他人密码 */
async function resetPassword(req, res) {
  const { newPassword } = validate(resetPasswordSchema, req.body)
  res.ok(await adminUserService.resetPassword(req.auth, Number(req.params.id), newPassword))
}

/** POST /admin/admin-users/:id/projects —— 授予项目数据权限范围 */
async function grantProjects(req, res) {
  const { projectIds } = validate(grantSchema, req.body)
  res.ok(await adminUserService.grantProjects(req.auth, Number(req.params.id), projectIds))
}

/** GET /admin/admin-users/:id/projects */
async function listGrantedProjects(req, res) {
  res.ok({ projectIds: await adminUserService.listGrantedProjects(req.auth, Number(req.params.id)) })
}

module.exports = {
  list,
  create,
  update,
  updateRole,
  remove,
  updateStatus,
  resetPassword,
  grantProjects,
  listGrantedProjects,
}
