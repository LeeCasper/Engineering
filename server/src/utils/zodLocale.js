'use strict'

/**
 * zod 的中文错误映射。
 *
 * ── 为什么必须有这个文件 ──
 * zod 内置的默认报错是英文的（"Array must contain at least 1 element"、
 * "Required"、"Invalid input"）。而 `utils/validate.js` 会把**单条**校验错误
 * 直接作为面向用户的 `message` 返回，于是这些英文文案会原样出现在前端提示里。
 *
 * 只给每个 schema 逐条写 message 是治标的：漏掉一处就漏一句英文，
 * 而 schema 会不断增加。这里做一次全局映射，把兜底补上；
 * 业务上需要更精确的措辞时，再在具体字段上写 message（那会覆盖本映射）。
 *
 * 在 validate.js 里 `require` 本文件即完成安装 —— zod 的 errorMap 是全局的。
 */

const { z } = require('zod')

/** 类型名 → 中文，用于「期望是 X」这类提示 */
const TYPE_LABELS = {
  string: '文本',
  number: '数字',
  integer: '整数',
  boolean: '布尔值',
  array: '列表',
  object: '对象',
  date: '日期',
  bigint: '整数',
  null: 'null',
  undefined: 'undefined',
}

/** 长度类限制的单位名 */
const SIZE_LABELS = {
  string: { min: '个字', max: '个字' },
  number: { min: '', max: '' },
  array: { min: '项', max: '项' },
  set: { min: '项', max: '项' },
  date: { min: '', max: '' },
}

function labelOf(type) {
  return TYPE_LABELS[type] || type
}

const errorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      // 值为空却要求必填时，zod 报的是 invalid_type + received 'undefined'。
      // 对用户来说「必填」比「期望文本，收到 undefined」有用得多
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: '该项为必填' }
      }
      return { message: `应为${labelOf(issue.expected)}，实际收到${labelOf(issue.received)}` }

    case z.ZodIssueCode.invalid_literal:
      return { message: `只能是 ${JSON.stringify(issue.expected)}` }

    case z.ZodIssueCode.unrecognized_keys:
      return { message: `包含不支持的字段：${issue.keys.join('、')}` }

    case z.ZodIssueCode.invalid_union:
      return { message: '格式不正确' }

    case z.ZodIssueCode.invalid_enum_value:
      return { message: `只能是以下取值之一：${issue.options.join('、')}` }

    case z.ZodIssueCode.invalid_arguments:
    case z.ZodIssueCode.invalid_return_type:
      return { message: '格式不正确' }

    case z.ZodIssueCode.invalid_date:
      return { message: '日期格式不正确' }

    case z.ZodIssueCode.invalid_string: {
      const checks = {
        email: '邮箱格式不正确',
        url: '链接格式不正确',
        uuid: 'UUID 格式不正确',
        regex: '格式不正确',
        datetime: '日期时间格式不正确',
        ip: 'IP 地址格式不正确',
      }
      return { message: checks[issue.validation] || '格式不正确' }
    }

    case z.ZodIssueCode.too_small: {
      // 空列表是最常见的一种，单独给一句人话
      if (issue.type === 'array' && issue.inclusive && issue.minimum === 1) {
        return { message: '不能为空' }
      }
      const unit = (SIZE_LABELS[issue.type] || {}).min || ''
      return {
        message: issue.inclusive ? `不得少于 ${issue.minimum}${unit}` : `必须大于 ${issue.minimum}${unit}`,
      }
    }

    case z.ZodIssueCode.too_big: {
      const unit = (SIZE_LABELS[issue.type] || {}).max || ''
      const bound = issue.inclusive ? `不得超过 ${issue.maximum}${unit}` : `必须小于 ${issue.maximum}${unit}`
      return { message: bound }
    }

    case z.ZodIssueCode.not_multiple_of:
      return { message: `必须是 ${issue.multipleOf} 的整数倍` }

    case z.ZodIssueCode.not_finite:
      return { message: '必须是有限数值' }

    case z.ZodIssueCode.custom:
      // 自定义 refine 一般都写了自己的 message，走到这里说明没写；
      // ctx.defaultError 此时是英文的 "Invalid input"，比它更没信息量，
      // 因此给一句通用的中文
      return { message: ctx.defaultError === 'Invalid input' ? '不符合要求' : ctx.defaultError }

    default:
      return { message: ctx.defaultError }
  }
}

z.setErrorMap(errorMap)

module.exports = { errorMap }
