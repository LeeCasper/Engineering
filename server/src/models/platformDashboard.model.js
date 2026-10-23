'use strict'

/**
 * 平台数据看板的数据访问层。
 *
 * ── 为什么按租户取数，再在 service 里聚合 ──
 * 租户、项目、后台账号是三个一对多维度。直接 JOIN 后 COUNT 会把行数相乘，
 * 除非每个计数都写 COUNT(DISTINCT)，那既不直观也不便宜。
 * 这里用「每个租户一行 + 两个相关子查询」的形状：不会放大行数，
 * 汇总、省份、城市、未分配地区全部从同一份数据算出来，口径天然一致。
 *
 * 租户规模在可预期的未来是「几十到几千」，一次取回后在内存里分组足够快。
 * 如果将来上万租户，再引入缓存或按省下推聚合。
 */

const db = require('../db/pool')

/**
 * 取看板基础数据。`scope` 可选：
 * - `{ provinceCode }`：某省
 * - `{ provinceCode, cityCode }`：某市
 * - `{ unassigned: true }`：未分配地区
 * - 不传：全国
 */
async function tenantStats(scope = {}) {
  const where = ['t.deleted_at IS NULL']
  const params = []

  if (scope.unassigned) {
    where.push('t.province_code IS NULL')
  } else if (scope.cityCode) {
    where.push('t.province_code = ?', 't.city_code = ?')
    params.push(scope.provinceCode, scope.cityCode)
  } else if (scope.provinceCode) {
    where.push('t.province_code = ?')
    params.push(scope.provinceCode)
  }

  return db.query(
    `SELECT t.id, t.name, t.code, t.status, t.plan,
            t.province_code, t.province_name, t.city_code, t.city_name,
            t.created_at,
            (SELECT COUNT(*) FROM project p
              WHERE p.tenant_id = t.id AND p.deleted_at IS NULL) AS project_count,
            (SELECT COUNT(*) FROM admin_user au
              WHERE au.tenant_id = t.id AND au.deleted_at IS NULL) AS admin_count
       FROM tenant t
      WHERE ${where.join(' AND ')}
      ORDER BY t.id DESC`,
    params
  )
}

module.exports = { tenantStats }
