'use strict'

/**
 * 意见反馈控制器（C-5.7 / AC-U18）。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
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

/** POST /feedback —— 提交反馈（文字 + 图片） */
async function submit(req, res) {
  const input = validate(submitSchema, req.body)
  res.ok(
    await feedbackService.submit(req.auth.id, input, normalizeFiles(req.files), req.auth)
  )
}

module.exports = { submit }
