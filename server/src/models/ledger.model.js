'use strict'

/**
 * ledger（账目流水）数据访问层。
 *
 * ── 两条贯穿本模块的规则 ──
 * 1. **金额一律以字符串进出**。`DECIMAL(12,2)` 在连接层关掉了 `decimalNumbers`，
 *    因此这里读出来的就是两位小数字符串，不经 JS Number（AC-L11）。
 * 2. **`locked = 1` 的流水禁止 UPDATE**（AC-L20）。这个约束由服务层拦截，
 *    但本模块的方法名也刻意做成「改了会出事」的样子（updateUnlocked / softDeleteUnlocked），
 *    让绕过它的人至少得先看见这个名字。
 */

const db = require('../db/pool')

/** 列表字段。金额保持字符串原样返回 */
const COLUMNS = `
  l.id, l.project_id, l.project_stage_id, l.type, l.category, l.amount, l.occurred_at,
  l.remark, l.payment_node_id, l.receipt_images, l.created_by, l.locked,
  l.is_reversal, l.reversal_of_id, l.reversed_by_id, l.created_at
`

async function create(data, tx = db) {
  const result = await tx.query(
    `INSERT INTO ledger
       (project_id, project_stage_id, type, category, amount, occurred_at, remark,
        payment_node_id, receipt_images, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.projectId,
      data.projectStageId,
      data.type,
      data.category ?? null,
      data.amount,
      data.occurredAt,
      data.remark ?? null,
      data.paymentNodeId ?? null,
      data.receiptImages ? JSON.stringify(data.receiptImages) : null,
      data.createdBy,
    ]
  )
  return result.insertId
}

async function findById(id, tx = db) {
  return tx.queryOne(`SELECT ${COLUMNS} FROM ledger l WHERE l.id = ? AND l.deleted_at IS NULL`, [id])
}

/** 加锁读取，供修改/删除/红冲使用（§6.2 要求行锁） */
async function lockById(tx, id) {
  const rows = await tx.query(
    `SELECT ${COLUMNS} FROM ledger l WHERE l.id = ? AND l.deleted_at IS NULL FOR UPDATE`,
    [id]
  )
  return rows.length > 0 ? rows[0] : null
}

/**
 * 按付款节点查已有的收入流水（AC-L05 的友好提示）。
 *
 * 数据库层的条件唯一索引（`uk_ledger_payment_node_income`）是真正的兜底，
 * 这里只是为了让用户看到「该节点已登记付款」而不是一个唯一键冲突。
 * **两者都不能省**：只靠这条查询，并发下会穿透；只靠索引，提示看不懂。
 */
async function findIncomeByPaymentNode(paymentNodeId, tx = db) {
  return tx.queryOne(
    // `reversed_by_id IS NULL` 必须带上，且必须与条件唯一索引**完全一致** ——
    // 索引（迁移 011）已把「已冲销」的行排除出约束，这条查询若不带同样的条件，
    // 就会出现「红冲后数据库允许重新登记，但服务层预检把它拦下」的自相矛盾。
    // 两处条件必须同进同退
    `SELECT ${COLUMNS} FROM ledger l
      WHERE l.payment_node_id = ? AND l.type = 'income'
        AND l.reversed_by_id IS NULL AND l.deleted_at IS NULL`,
    [paymentNodeId]
  )
}

/**
 * 流水列表（C-4.2 / AC-L29）。
 *
 * 强制分页：§8.1 要求列表类接口一页 20 条，AC-L29 进一步要求 1000 条流水时
 * 首屏 ≤ 1.5s —— 靠 `idx_ledger_project_time` 这个复合索引。
 */
async function list({ projectId, filters = {}, offset, limit }) {
  const where = ['l.project_id = ?', 'l.deleted_at IS NULL']
  const params = [projectId]

  if (filters.type) {
    where.push('l.type = ?')
    params.push(filters.type)
  }
  if (filters.category) {
    where.push('l.category = ?')
    params.push(filters.category)
  }
  if (filters.stageId) {
    where.push('l.project_stage_id = ?')
    params.push(filters.stageId)
  }
  if (filters.startDate) {
    where.push('l.occurred_at >= ?')
    params.push(filters.startDate)
  }
  if (filters.endDate) {
    where.push('l.occurred_at <= ?')
    params.push(filters.endDate)
  }

  // ── JOIN 必须在 WHERE 之前 ──
  // 拼成 `FROM ... WHERE ... LEFT JOIN ...` 是语法错误。
  // 这是本项目**第二次**踩同一个坑（上一次在 progressReport.model），
  // 所以把 FROM+JOIN 与 WHERE 分成两个变量维护，改条件时不容易再接错位置
  const fromClause = `FROM ledger l
       LEFT JOIN project_stage s ON s.id = l.project_stage_id
       LEFT JOIN payment_node pn ON pn.id = l.payment_node_id`
  const whereClause = `WHERE ${where.join(' AND ')}`

  const total = await db.count(`${fromClause} ${whereClause}`, params)

  const rows = await db.query(
    `SELECT ${COLUMNS}, s.name AS stage_name, pn.name AS payment_node_name
       ${fromClause}
       ${whereClause}
      ORDER BY l.occurred_at DESC, l.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return { total, rows }
}

/**
 * 按类型汇总（AC-L07）。
 *
 * **不带任何筛选条件**：AC-L10 明确要求「汇总卡片始终反映全量未删除流水，
 * 不随列表筛选条件变化」。因此这个函数只接受 projectId，
 * 将来若有人想给它加筛选参数，先回去读 AC-L10。
 */
async function sumByType(projectId, tx = db) {
  const rows = await tx.query(
    // 红冲记录**取负计入**：它的金额与原记录同号正数（金额列不允许负数，AC-L03），
    // 冲销语义由 `is_reversal` 表达。漏掉这个 CASE，账面上会凭空多出一倍的钱
    `SELECT type, COALESCE(SUM(CASE WHEN is_reversal = 1 THEN -amount ELSE amount END), 0) AS total
       FROM ledger
      WHERE project_id = ? AND deleted_at IS NULL
      GROUP BY type`,
    [projectId]
  )

  const result = { income: '0.00', expense: '0.00' }
  for (const row of rows) {
    // SUM(DECIMAL) 在连接层同样是字符串，原样带出，不做 Number 转换
    result[row.type] = row.total
  }
  return result
}

/** 按分类汇总支出（C-4.5 的饼图 / 条形图） */
async function sumExpenseByCategory({ projectId, startDate, endDate }, tx = db) {
  const where = ["project_id = ?", "type = 'expense'", 'deleted_at IS NULL']
  const params = [projectId]

  if (startDate) {
    where.push('occurred_at >= ?')
    params.push(startDate)
  }
  if (endDate) {
    where.push('occurred_at <= ?')
    params.push(endDate)
  }

  const rows = await tx.query(
    // 同样对红冲取负：否则「材料费支出」会把冲掉的金额也算进去
    `SELECT category,
             COALESCE(SUM(CASE WHEN is_reversal = 1 THEN -amount ELSE amount END), 0) AS total,
             COUNT(*) AS count
       FROM ledger
      WHERE ${where.join(' AND ')}
      GROUP BY category`,
    params
  )

  return rows.map((row) => ({ category: row.category, total: row.total, count: Number(row.count) }))
}

/** 按月汇总支出（C-4.5 的「支持按月查看」） */
async function sumExpenseByMonth({ projectId }, tx = db) {
  return tx.query(
    `SELECT DATE_FORMAT(occurred_at, '%Y-%m') AS month,
            COALESCE(SUM(CASE WHEN is_reversal = 1 THEN -amount ELSE amount END), 0) AS total,
            COUNT(*) AS count
       FROM ledger
      WHERE project_id = ? AND type = 'expense' AND deleted_at IS NULL
      GROUP BY month
      ORDER BY month`,
    [projectId]
  )
}

/**
 * 按阶段汇总（C-4.12 阶段账目视图）。
 *
 * 一次查询拿回全部阶段的三项金额（应收来自付款节点、已收与支出来自流水），
 * 而不是逐阶段查 —— 阶段数虽然不多，但这是列表页，N+1 是习惯性错误。
 */
async function sumByProjectGrouped(projectId, tx = db) {
  const rows = await tx.query(
    // 红冲取负 —— 按阶段汇总同样要净额，否则被冲掉的收支仍然挂在阶段上
    `SELECT project_stage_id,
            COALESCE(SUM(CASE WHEN type = 'income'  THEN IF(is_reversal = 1, -amount, amount) END), 0) AS income,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN IF(is_reversal = 1, -amount, amount) END), 0) AS expense,
            COUNT(*) AS entry_count
       FROM ledger
      WHERE project_id = ? AND deleted_at IS NULL
      GROUP BY project_stage_id`,
    [projectId]
  )
  return rows
}

async function listByStage(projectId, stageId, tx = db) {
  return tx.query(
    `SELECT ${COLUMNS} FROM ledger l
      WHERE l.project_id = ? AND l.project_stage_id = ? AND l.deleted_at IS NULL
      ORDER BY l.occurred_at DESC, l.id DESC`,
    [projectId, stageId]
  )
}

/**
 * 修改**未锁定**的流水。
 *
 * 方法名里的 `Unlocked` 是刻意的：AC-L20 要求已对账的流水不可修改，
 * 调用方必须先确认这一点。服务层仍会再判一次，这里只是让绕过的人
 * 至少得先看见「我在改一条可能与对账状态不符的记录」。
 */
async function updateUnlocked(id, fields, tx = db) {
  const columns = []
  const params = []
  const mapping = {
    category: 'category',
    amount: 'amount',
    occurred_at: 'occurred_at',
    remark: 'remark',
    project_stage_id: 'project_stage_id',
    receipt_images: 'receipt_images',
  }

  for (const [key, column] of Object.entries(mapping)) {
    if (fields[key] !== undefined) {
      columns.push(`${column} = ?`)
      params.push(key === 'receipt_images' ? JSON.stringify(fields[key]) : fields[key])
    }
  }
  if (columns.length === 0) return

  params.push(id)
  await tx.query(`UPDATE ledger SET ${columns.join(', ')} WHERE id = ?`, params)
}

/** 软删除（AC-L12：软删除的流水不计入列表与所有汇总数值） */
async function softDeleteUnlocked(id, tx = db) {
  await tx.query('UPDATE ledger SET deleted_at = NOW() WHERE id = ?', [id])
}

/** 标记为已对账（AC-L20：业主确认后该周期内全部流水 locked 置 1） */
async function lockMany(ids, tx = db) {
  if (ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(', ')
  const result = await tx.query(
    `UPDATE ledger SET locked = 1 WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    ids
  )
  return result.affectedRows
}

/**
 * 写一条红冲记录（AC-L23）。
 *
 * 红冲不是「修改原记录」，而是**新增一条反向金额的记录**，
 * 并让两条记录互相指向 —— 这样账目永远只增不减，
 * 任何时候回看都能看出「当时记了什么、后来为什么冲掉」。
 */
async function createReversal(data, tx) {
  const result = await tx.query(
    `INSERT INTO ledger
       (project_id, project_stage_id, type, category, amount, occurred_at, remark,
        payment_node_id, receipt_images, created_by, is_reversal, reversal_of_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      data.projectId,
      data.projectStageId,
      data.type,
      data.category ?? null,
      data.amount,
      data.occurredAt,
      data.remark ?? null,
      // 红冲记录**不占用付款节点的唯一收入位**：
      // 条件唯一索引只对 `type='income' AND deleted_at IS NULL` 生效，
      // 而红冲记录带着 reversal_of_id，语义上是冲销而非一笔新的收款。
      // 若把原节点的 id 也写进去，会与「该节点只能有一条收入」冲突
      null,
      null,
      data.createdBy,
      data.reversalOfId,
    ]
  )
  return result.insertId
}

/** 把原记录指向红冲记录，完成双向追溯 */
async function linkReversal(originalId, reversalId, tx) {
  await tx.query('UPDATE ledger SET reversed_by_id = ? WHERE id = ?', [reversalId, originalId])
}

/** 某项目在给定周期内的未删除流水（对账发起时圈定范围，AC-L20） */
async function listInPeriod({ projectId, startDate, endDate }, tx = db) {
  return tx.query(
    `SELECT ${COLUMNS} FROM ledger l
      WHERE l.project_id = ? AND l.deleted_at IS NULL
        AND l.occurred_at >= ? AND l.occurred_at <= ?
      ORDER BY l.occurred_at, l.id`,
    [projectId, startDate, endDate]
  )
}

/** 未锁定流水的数量，用于「能否再次发起对账」的判断 */
async function countUnlocked(projectId, tx = db) {
  return tx.count('FROM ledger WHERE project_id = ? AND locked = 0 AND deleted_at IS NULL', [projectId])
}

module.exports = {
  COLUMNS,
  create,
  findById,
  lockById,
  findIncomeByPaymentNode,
  list,
  sumByType,
  sumExpenseByCategory,
  sumExpenseByMonth,
  sumByProjectGrouped,
  listByStage,
  listInPeriod,
  updateUnlocked,
  softDeleteUnlocked,
  lockMany,
  createReversal,
  linkReversal,
  countUnlocked,
}
