'use strict'

/**
 * 意见反馈控制器（C-5.7 / AC-U18）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const AppError = require('../utils/AppError')
const { normalizeFiles } = require('../middlewares/upload')
const feedbackService = require('../services/feedback.service')

const submitSchema = z.object({
  content: z.string().trim().min(5, '请至少填写 5 个字说明问题').max(1000, '反馈内容不超过 1000 字'),
  // 可选：说明是在哪个项目下遇到的问题。不校验成员身份 ——
  // 反馈是**报问题**的通道，若因「你已不是该项目成员」而拒收，
  // 那恰好把最该被听到的声音挡在了门外
  projectId: z.coerce.number().int().positive().optional(),
  contact: z.string().trim().max(100).optional(),
  // 跨租户用户必须指定；只属于一个租户时可省略
  tenantId: z.coerce.number().int().positive().optional(),
})

/**
 * `mediaIds` 可能来自三种形态：
 *   - JSON 请求体里的数组：[12, 13]
 *   - multipart 表单里的 JSON 字符串：'[12,13]'
 *   - 兼容旧调试方式的逗号分隔：'12,13'
 *
 * 归一化之后再校验整数，与 report.controller 的 parseMediaIds 同构。
 */
function parseMediaIds(value) {
  if (value === undefined || value === null || value === '') return []

  let list
  if (Array.isArray(value)) {
    list = value
  } else if (typeof value === 'string') {
    const text = value.trim()
    if (text.startsWith('[')) {
      try {
        list = JSON.parse(text)
      } catch {
        throw AppError.badRequest('mediaIds 格式不正确')
      }
    } else {
      list = text.split(',')
    }
  } else {
    list = [value]
  }

  if (!Array.isArray(list)) throw AppError.badRequest('mediaIds 格式不正确')

  const ids = list.map((item) => Number(item))
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw AppError.badRequest('mediaIds 必须是正整数数组')
  }
  if (new Set(ids).size !== ids.length) {
    throw AppError.badRequest('图片 ID 不能重复')
  }
  return ids
}

/** POST /feedback —— 提交反馈（文字 + 图片） */
async function submit(req, res) {
  const input = validate(submitSchema, req.body)
  const files = normalizeFiles(req.files)
  res.ok(
    await feedbackService.submit(
      req.auth.id,
      input,
      files,
      req.auth,
      parseMediaIds(req.body.mediaIds)
    )
  )
}

/** POST /feedback/media —— 单张图片暂存（微信一次只能传一个文件） */
async function stageMedia(req, res) {
  const files = normalizeFiles(req.files)
  if (files.length > 1) throw AppError.badRequest('一次只能上传一张图片')
  res.ok(await feedbackService.stageMedia(req.auth.id, files[0]))
}

module.exports = { submit, stageMedia }
