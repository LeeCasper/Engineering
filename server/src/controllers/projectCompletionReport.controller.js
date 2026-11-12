'use strict'

/**
 * 项目竣工总报告接口。
 *
 * 生成走 POST，查询状态走 GET；下载走**无登录态的签名链接**——
 * 与验收报告一致，报告要能转发给律师、物业等不在系统里的人。
 */

const AppError = require('../utils/AppError')
const storage = require('../storage')
const signedUrl = require('../utils/signedUrl')
const service = require('../services/projectCompletionReport.service')
const reportModel = require('../models/projectCompletionReport.model')

/** GET /projects/:id/completion-report —— C 端状态 */
async function miniState(req, res) {
  res.ok(await service.getMiniState(req.auth.id, Number(req.params.id)))
}

/** POST /projects/:id/completion-report —— C 端生成 / 重试 */
async function miniGenerate(req, res) {
  res.ok(
    await service.generateMini(req.auth.id, Number(req.params.id), {
      force: req.query.refresh === '1',
    })
  )
}

/** GET /admin/projects/:id/completion-report —— 后台状态 */
async function adminState(req, res) {
  res.ok(await service.getAdminState(req.auth, Number(req.params.id)))
}

/** POST /admin/projects/:id/completion-report —— 后台生成 / 重试 */
async function adminGenerate(req, res) {
  res.ok(
    await service.generateAdmin(req.auth, Number(req.params.id), {
      force: req.query.refresh === '1',
    })
  )
}

/**
 * GET /completion-reports/:projectId/report.pdf —— 签名下载。
 *
 * 不挂 requireMini：签名 URL 的目的就是让未登录的人也能打开。
 * 签名校验放在最前，未通过的人不触发任何查询。
 */
async function downloadPdf(req, res) {
  const projectId = Number(req.params.projectId)

  signedUrl.verify({
    resource: 'project-completion-report',
    id: projectId,
    expires: req.query.expires,
    signature: req.query.sig,
  })

  const row = await reportModel.findByProject(projectId)
  if (!row || row.status !== 'success' || (!row.file_url && !row.file_key)) {
    throw AppError.notFound('竣工总报告尚未生成')
  }

  // 新数据走私有存储；历史数据只有公开 file_url
  const buffer = row.file_key ? await storage.readPrivate(row.file_key) : await storage.read(row.file_url)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Disposition', `inline; filename="project-completion-${projectId}.pdf"`)
  res.send(buffer)
}

module.exports = { miniState, miniGenerate, adminState, adminGenerate, downloadPdf }
