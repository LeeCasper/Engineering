'use strict'

/**
 * 项目控制器。M3 只含「我的项目列表」与邀请确认，建档与状态机在 M4。
 */

const projectService = require('../services/project.service')

/** GET /projects —— 我的项目列表（C-1.2 ~ C-1.5） */
async function myProjects(req, res) {
  res.ok(await projectService.myProjects(req.auth.id, { tenantId: req.query.tenantId ? Number(req.query.tenantId) : undefined }))
}

/** GET /projects/:id —— 项目详情。非本人参与的项目返回 404（AC-P26） */
async function detail(req, res) {
  res.ok(await projectService.getProjectForMember(req.auth.id, Number(req.params.id)))
}

/** POST /invitations/:memberId/confirm —— 确认项目邀请（AC-AD18 → AC-AD19） */
async function confirmInvitation(req, res) {
  const memberId = Number(req.params.memberId)
  res.ok(await projectService.confirmInvitation(req.auth.id, memberId))
}

/** POST /invitations/:memberId/reject —— 拒绝项目邀请 */
async function rejectInvitation(req, res) {
  const memberId = Number(req.params.memberId)
  res.ok(await projectService.rejectInvitation(req.auth.id, memberId))
}

module.exports = { myProjects, detail, confirmInvitation, rejectInvitation }
