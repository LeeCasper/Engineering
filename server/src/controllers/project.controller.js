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

/**
 * GET /projects/:id/location —— 项目坐标与导航所需信息（§7.3）。
 *
 * 详情接口已经带了坐标，这个接口单独存在是为了让「单点导航」页面
 * 能只取导航所需的字段，也避免把静态地图 / 坐标能力耦合进项目详情响应。
 * 不返回地图 Key（AC-N13）。
 */
async function location(req, res) {
  const project = await projectService.getProjectForMember(req.auth.id, Number(req.params.id))
  res.ok({
    projectId: project.id,
    name: project.name,
    address: project.address,
    longitude: project.longitude,
    latitude: project.latitude,
    hasCoordinates: project.hasCoordinates,
  })
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

module.exports = { myProjects, detail, location, confirmInvitation, rejectInvitation }
