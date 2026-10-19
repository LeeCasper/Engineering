'use strict'

/**
 * 入参校验（zod）。
 *
 * 校验失败时 zod 抛 ZodError，由 errorHandler 统一转成 400 + 字段级 issues，
 * 前端可直接回填到表单项。因此这里只做「解析并返回」，不再包一层 try/catch ——
 * 包了反而会把字段信息压成一句笼统的提示。
 *
 * 用 `.strip()`（zod 对象默认行为）丢弃未声明的字段：
 * 客户端多传的字段不该悄悄流进 service，尤其是 `role`、`status` 这类
 * 一旦能透传就等于提权的字段。
 */

// 副作用式安装 zod 的中文错误映射。必须在任何 schema 解析之前 require，
// 否则校验失败时会抛出英文提示，而 validate() 会把单条错误直接作为
// 面向用户的 message 返回 —— 用户就会看到 "Array must contain at least 1 element"
require('./zodLocale')

const AppError = require('./AppError')

/**
 * @param {import('zod').ZodTypeAny} schema
 * @param {*} data
 * @returns {*} 解析后的数据（已应用默认值与类型转换）
 * @throws {AppError} 校验失败时抛 400，detail.issues 为字段级问题列表
 */
function validate(schema, data) {
  const result = schema.safeParse(data)
  if (result.success) return result.data

  const issues = result.error.issues.map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path),
    message: issue.message,
  }))

  // 只有一个字段出错时，直接把它的话放到 message 里。
  // message 是面向人的可读文案，让用户看到「计划竣工日期不得早于开工日期」
  // 而不是笼统的「参数校验失败」，同时也省得 curl / 冒烟脚本
  // 每次都要去 data.issues 里挖具体原因。
  // 多个字段出错时仍用通用文案 —— 挑一条展示反而会掩盖其他问题，
  // 那种情况前端本来就该把 issues 逐条回填到表单项（AC-AD12）。
  const message = issues.length === 1 ? issues[0].message : '参数校验失败'

  throw AppError.badRequest(message, { detail: { issues } })
}

module.exports = { validate }
