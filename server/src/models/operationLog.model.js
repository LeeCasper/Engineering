'use strict'

/**
 * operation_log 数据访问层（B-1.9 / AC-AD09 / AC-L28）。
 *
 * ── 为什么查询侧要 JOIN 三张表 ──
 * 日志表存的是 `operator_type + operator_id`，那是外键而不是「人」。
 * 直接把它丢给界面，管理员看到的是一列 `admin/3`、`user/7` 的编号 ——
 * 审计界面看不懂编号就等于没有。因此这里把操作人名称与项目名一次取出来。
 *
 * ── JOIN 条件必须写在 ON 上，不能写进 WHERE ──
 * `LEFT JOIN admin_user au ON au.id = ol.operator_id AND ol.operator_type = 'admin'`
 * 的 `operator_type` 若挪到 WHERE，LEFT JOIN 会退化成 INNER JOIN，
 * 整张表里 `operator_type='user'` 的记录会被静默丢掉。
 * 更要命的是 id 会串号：admin#5 与 user#5 是两个人，
 * 少了类型条件 `au.id = ol.operator_id` 会把 user#5 的操作显示成 admin#5 干的。
 */

const db = require('../db/pool')

/**
 * 写入一条日志。
 *
 * 注意本模块**不导出 update / delete**：operation_log 是只追加的审计表，
 * 虽然数据库层拦不住，但仓储层不提供入口 —— 与 acceptance_flow / visit_record
 * 的处理方式一致（CLAUDE.md 第 10 条）。
 */
async function insert(params, executor = db) {
  return executor.query(
    `INSERT INTO operation_log
       (tenant_id, operator_type, operator_id, action, target_type, target_id, project_id, detail, ip, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      // 可为 null：跨租户事件（一个账号同时属于 A、B 两个租户时注销）
      // 与系统级操作不归属任何单一租户
      params.tenantId ?? null,
      params.operatorType,
      params.operatorId ?? null,
      params.action,
      params.targetType ?? null,
      params.targetId ?? null,
      params.projectId ?? null,
      params.detail ? JSON.stringify(params.detail) : null,
      params.ip ?? null,
      params.requestId ?? null,
    ]
  )
}

/**
 * 日志查询（AC-AD09 读取侧）。
 *
 * @param {object} params
 * @param {{clause: string, params: Array}} params.scope 由 dataScope.buildOperationLogFilter 产出
 * @param {object} params.filters 业务筛选条件
 * @param {{offset: number, limit: number}} params.paging
 * @returns {Promise<{total: number, rows: Array}>}
 */
async function list({ scope, filters = {}, paging }) {
  // ── fromClause / whereClause 分开维护 ──
  // 见 CLAUDE.md 第 47 条：揉成一个变量之后再想加 JOIN 就只能接在 WHERE 后面，
  // 拼出 `FROM ... WHERE ... LEFT JOIN ...` 这种语法错误。
  //
  // 计数不需要 JOIN（它只数行数），带 JOIN 去数还会因为一对多把数字放大，
  // 因此两份 from 分开写。
  const countFrom = 'FROM operation_log ol'
  const rowFrom = `FROM operation_log ol
      LEFT JOIN admin_user au ON au.id = ol.operator_id AND ol.operator_type = 'admin'
      LEFT JOIN user u ON u.id = ol.operator_id AND ol.operator_type = 'user'
      LEFT JOIN project prj ON prj.id = ol.project_id`

  const where = ['ol.deleted_at IS NULL', `(${scope.clause})`]
  const params = [...scope.params]

  addEquals(where, params, 'ol.project_id', filters.projectId)
  addEquals(where, params, 'ol.target_type', filters.targetType)
  addEquals(where, params, 'ol.target_id', filters.targetId)
  addEquals(where, params, 'ol.action', filters.action)
  addEquals(where, params, 'ol.operator_type', filters.operatorType)
  addEquals(where, params, 'ol.operator_id', filters.operatorId)

  if (filters.module) {
    // 用 LIKE 是因为「按模块」要匹配 `ledger.create` / `ledger.update` 一整个前缀。
    // 通配符在这里由服务端拼，pattern 里的 `_` 与 `%` 都只可能来自 module ——
    // 而 module 是服务端从 ACTIONS 里推导出的白名单（见 operationLog.service），
    // `ledger` 这类值不含通配符，因此不存在「用户传 % 扫全表」的余地
    where.push('ol.action LIKE ?')
    params.push(`${filters.module}.%`)
  }

  // 时间范围，左闭右开：`from <= created_at < before`。
  //
  // 用左闭右开而不是 `BETWEEN` + `23:59:59`：DATETIME 无小数秒时
  // `<= 23:59:59` 恰好够用，但一旦精度改成 DATETIME(3)，
  // 当天最后一秒内的记录就会静默少掉几条 —— 而「日志少了几条」不会有人发现。
  // `before` 由 controller 从「含当天的 to」加一天算出来，命名刻意与 `to` 区分。
  if (filters.from) {
    where.push('ol.created_at >= ?')
    params.push(filters.from)
  }
  if (filters.before) {
    where.push('ol.created_at < ?')
    params.push(filters.before)
  }

  const whereClause = `WHERE ${where.join(' AND ')}`

  const total = await db.count(`${countFrom} ${whereClause}`, params)

  const rows = await db.query(
    `SELECT ol.id, ol.operator_type, ol.operator_id,
            CASE ol.operator_type
              WHEN 'admin' THEN au.username
              WHEN 'user'  THEN COALESCE(u.nickname, u.phone)
              ELSE NULL
            END AS operator_name,
            ol.action, ol.target_type, ol.target_id, ol.project_id,
            prj.name AS project_name,
            ol.detail, ol.ip, ol.request_id, ol.created_at
       ${rowFrom} ${whereClause}
      ORDER BY ol.id DESC LIMIT ? OFFSET ?`,
    [...params, paging.limit, paging.offset]
  )

  return { total, rows }
}

/** 可选等值条件的小工具：值为空就跳过，避免每处都写一遍 if */
function addEquals(where, params, column, value) {
  if (value === undefined || value === null || value === '') return
  where.push(`${column} = ?`)
  params.push(value)
}

/**
 * 门锁密码的访问记录（AC-K03 / AC-K09）。
 *
 * ── 为什么放在 operation_log 而不是单开一张表 ──
 * AC-K09 要求「每次读取密码写入 operation_log」。复用已有的只追加审计表，
 * 就不必再为「谁看过」建一套同样只增不改的机制 —— 而两套机制并存时，
 * 很容易出现「一边记了一边没记」。
 *
 * ── JOIN user 而不是 admin_user ──
 * 能读密码的只有工长 / 监理 / 业主，都是 C 端用户；后台管理员在这里
 * 一律 403（AC-K02），因此日志里的 operator_type 只可能是 'user'。
 * 仍然带上 `operator_type = 'user'` 条件：两套自增 id 空间会撞号
 * （CLAUDE.md 第 61 条），少了它会把 admin#5 的操作显示成 user#5 干的。
 */
async function listAccessLog({ projectId, action, offset, limit }) {
  const where = ['ol.deleted_at IS NULL', 'ol.project_id = ?', 'ol.action = ?', "ol.operator_type = 'user'"]
  const params = [projectId, action]

  const countFrom = 'FROM operation_log ol'
  const rowFrom = `FROM operation_log ol
      LEFT JOIN user u ON u.id = ol.operator_id AND ol.operator_type = 'user'
      LEFT JOIN project_door_code dc ON dc.id = ol.target_id`

  const whereClause = `WHERE ${where.join(' AND ')}`
  const total = await db.count(`${countFrom} ${whereClause}`, params)

  const rows = await db.query(
    `SELECT ol.id, ol.operator_id, ol.target_id, ol.created_at, ol.ip,
            COALESCE(u.nickname, '（已注销用户）') AS operator_name,
            u.anonymized_at IS NOT NULL AS operator_anonymized,
            -- JOIN 条件上刻意不加 dc.deleted_at IS NULL：条目后来被软删除时，
            -- 这一行仍应显示它当时的名字（「入户门」），而不是一律变成
            -- 「已删除的条目」—— 后者会让业主看不出「到底是谁看了哪个门的密码」，
            -- 而访问记录的全部价值就在于回答这个问题。
            -- COALESCE 只是防 target_id 对不上行（理论上不该发生）时的兜底。
            -- 注意本行注释里不能出现反引号：整段 SQL 是一个模板字符串，
            -- 反引号会把它提前截断（这个错误刚踩过一次）
            COALESCE(dc.name, '（已删除的密码条目）') AS code_name
       ${rowFrom} ${whereClause}
      ORDER BY ol.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return { total, rows }
}

module.exports = { insert, list, listAccessLog }
