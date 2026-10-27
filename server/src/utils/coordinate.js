'use strict'

/**
 * 经纬度入参校验（GCJ-02，数据库列 DECIMAL(10,7)）。
 *
 * **不能复用 money.validate**：它对金额限制「最多两位小数」，而坐标需要
 * 到小数点后 7 位。用它会同时犯两个错 —— 拒绝合法的 `121.4737010`，
 * 以及把精度截断成 `121.47`（约 1 公里误差，CLAUDE.md 第 20 条）。
 *
 * 校验要求：
 *   - 整数位不超过 3 位（DECIMAL(10,7) 扣掉 7 位小数只剩 3 位）；
 *   - 小数位不超过 7 位；
 *   - 落在合理区间内。范围之外的输入一定是坐标系搞错了（AC-N03）。
 *
 * 返回值保持**字符串**，不转 Number —— 只有字符串才能原样保住 7 位小数。
 */

const { z } = require('zod')

const COORDINATE_PATTERN = /^-?\d{1,3}(\.\d{1,7})?$/

function coordinateField(label, min, max) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => COORDINATE_PATTERN.test(value), `${label}格式不正确（最多 7 位小数）`)
    .refine((value) => Number(value) >= min && Number(value) <= max, `${label}必须在 ${min} ~ ${max} 之间`)
}

/**
 * 经纬度必须成对出现。
 *
 * 只传经度或只传纬度没有任何业务含义：后端无法猜另一个值，
 * 静默忽略又会让前端以为坐标已保存。因此成对校验放在 schema 层。
 */
function refineCoordinatePair(schema) {
  return schema.refine(
    (data) => (data.longitude === undefined) === (data.latitude === undefined),
    { message: '经度与纬度必须同时提供', path: ['longitude'] }
  )
}

module.exports = { COORDINATE_PATTERN, coordinateField, refineCoordinatePair }
