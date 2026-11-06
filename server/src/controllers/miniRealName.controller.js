'use strict'

/**
 * C 端实名认证控制器。
 *
 * 请求体里的身份证号**不写日志、不回显**；错误响应只带校验码与中文提示。
 */

const { z } = require('zod')
const { validate } = require('../utils/validate')
const identityService = require('../services/identity.service')

const verifySchema = z.object({
  realName: z
    .string()
    .trim()
    .min(2, '真实姓名至少 2 个字符')
    .max(50, '真实姓名最多 50 个字符'),
  idCardNo: z
    .string()
    .trim()
    .min(18, '身份证号应为 18 位')
    .max(18, '身份证号应为 18 位'),
  // 必须显式同意，不能靠前端默认勾选后省略该字段
  consent: z.literal(true, {
    errorMap: () => ({ message: '请先阅读并同意实名认证授权说明' }),
  }),
})

/** GET /auth/real-name —— 当前认证状态 */
async function status(req, res) {
  res.ok(await identityService.getStatus(req.auth.id))
}

/** POST /auth/real-name/verify —— 提交姓名 + 身份证号 */
async function verify(req, res) {
  const input = validate(verifySchema, req.body)
  res.ok(
    await identityService.verify(req.auth.id, input, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.id,
    })
  )
}

module.exports = { status, verify }
