'use strict'

const { z } = require('zod')
const { validate } = require('../utils/validate')
const signedUrl = require('../utils/signedUrl')
const esignService = require('../services/esign.service')

const createSchema = z.object({
  consentVersion: z.string().trim().max(64).optional(),
  consentAccepted: z.boolean(),
  idempotencyKey: z.string().trim().max(64).optional(),
})

async function create(req, res) {
  const body = validate(createSchema, req.body)
  const data = await esignService.createTask(req.auth.id, Number(req.params.id), {
    ...body,
    ip: req.auth.ip || req.ip,
    userAgent: req.get('user-agent') || null,
    requestId: req.id,
  })
  res.ok(data)
}

async function status(req, res) {
  res.ok(await esignService.getStatus(req.auth.id, Number(req.params.id)))
}

async function sync(req, res) {
  res.ok(await esignService.sync(req.auth.id, Number(req.params.id)))
}

async function cancel(req, res) {
  res.ok(await esignService.cancel(req.auth.id, Number(req.params.id)))
}

async function downloadDocument(req, res) {
  const file = await esignService.getSignedDocument(req.auth.id, Number(req.params.id))
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Disposition', `attachment; filename="acceptance-${req.params.id}.pdf"`)
  res.send(file.buffer)
}

/**
 * 证据报告下载。
 *
 * 走短时签名 URL（和 report.pdf 一样），因为报告可能被转发给律师/鉴定机构；
 * 链接只由主业主/项目管理员在详情接口里按需签发。
 */
async function downloadEvidence(req, res) {
  const id = Number(req.params.id)
  signedUrl.verify({
    resource: 'acceptance-esign-evidence',
    id,
    expires: req.query.expires,
    signature: req.query.sig,
  })

  const file = await esignService.getEvidence(id)
  await esignService.recordEvidenceDownload(id, req.auth ? req.auth.id : null)

  res.setHeader('Content-Type', file.ext === 'json' ? 'application/json' : 'application/pdf')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Disposition', `attachment; filename="acceptance-${id}-evidence.${file.ext}"`)
  res.send(file.buffer)
}

async function callback(req, res) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '')
  const ack = await esignService.handleCallback(req.params.provider, req.headers, rawBody)
  res.status(ack.status || 200).json(ack.body || { code: 0, message: 'success' })
}

module.exports = { create, status, sync, cancel, downloadDocument, downloadEvidence, callback }
