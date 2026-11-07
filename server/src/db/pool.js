'use strict'

/**
 * MySQL 连接池。mysql2 + 手写参数化 SQL，不引 ORM —— §6.2 要的
 * SELECT ... FOR UPDATE 行锁、条件唯一索引、生成列，ORM 表达不了或表达失真。
 * 查询一律用 `?` 占位符，不提供把用户输入拼进 SQL 的接口。
 *
 * 数值与时间的返回形式是这里最不能随手改的地方，详见 createPool 内的注释。
 */

const mysql = require('mysql2/promise')
const config = require('../../config')
const logger = require('../utils/logger')

let pool = null

/**
 * 获取（惰性创建）连接池。
 * 惰性创建是为了让单测在不碰数据库时不会建立连接 —— 否则 `npm test`
 * 会因为没有 MySQL 环境而整体挂掉。
 */
function getPool() {
  if (pool) return pool

  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4_general_ci',

    waitForConnections: true,
    connectionLimit: config.db.poolLimit,
    queueLimit: 0,
    // 连接空闲过久被 MySQL 断开的经典坑：拿到的连接实际已死，
    // 报错是 "Connection lost: The server closed the connection"。
    // 开启保活并由驱动自动重连。
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,

    timezone: config.db.timezone,

    // ── 数值类型的返回形式，三者配合的结果必须精确记住 ──
    // decimalNumbers: false  → DECIMAL 恒以**字符串**返回（AC-L11 的前提）
    // supportBigNumbers: true + bigNumberStrings: false
    //                        → BIGINT 在 JS 安全整数范围内给 Number，超出才给字符串
    //
    // 为什么 bigNumberStrings 不能设 true：它会把**所有** BIGINT 变成字符串，
    // 包括自增主键与 COUNT(*)。于是 `project.id` 是 '1' 而不是 1，
    // 全项目到处出现 `if (a.id === b.id)` 为 false 的诡异 bug。
    // 主键是自增的，远不会触及 2^53，给 Number 更实用；
    // 真要出现超范围的值，mysql2 会自动降级为字符串，不会静默丢精度。
    decimalNumbers: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    // 关掉多语句：sql 注入即便发生，也拿不到「一次注入执行多条语句」的放大效果。
    // 迁移脚本另建连接开启。
    multipleStatements: false,
  })

  return pool
}

async function query(sql, params = []) {
  const started = Date.now()
  try {
    const [rows] = await getPool().query(sql, params)
    return rows
  } catch (err) {
    // 慢查询与失败查询都要留痕：AC-AD43 要求 500 项目下看板 ≤ 3s，
    // 上线后靠这条日志定位需要加索引的查询
    // 不要记录 params 与原始 err.message：MySQL 的 ER_DUP_ENTRY 等错误消息
    // 会回显冲突值，而 params 里有手机号、真实姓名、反馈正文、账目备注等 PII。
    // 只记 SQL 形状、参数个数、错误码与堆栈，足够定位问题。
    logger.error('SQL 执行失败', {
      sql: normalizeSql(sql),
      paramCount: Array.isArray(params) ? params.length : 0,
      durationMs: Date.now() - started,
      errCode: err && err.code,
      errStack: err && err.stack,
    })
    throw err
  }
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}

/** 传 'FROM project WHERE deleted_at IS NULL AND status = ?' 这样的片段，本函数包一层 COUNT(*) */
async function count(fromAndWhere, params = []) {
  const row = await queryOne(`SELECT COUNT(*) AS total ${fromAndWhere}`, params)
  // COUNT(*) 是 BIGINT，已在连接层以字符串返回
  return row ? Number(row.total) : 0
}

/**
 * 在事务中执行一段逻辑。§6.2 要求事务 + 行锁的场景必须走本函数：
 * AC-A03 的重复验收并发校验、AC-S08 的「阶段置 settled 与下一阶段解锁」原子提交、
 * 门禁的 SELECT ... FOR UPDATE、一个阶段只能有一张未终结结算单。
 *
 * 回调拿到的 tx 绑定在**同一条连接**上 —— 这是行锁生效的前提：
 * 用连接池的 query 会随机取连接，FOR UPDATE 锁住的连接可能不是后续 UPDATE 的那条。
 */
async function withTransaction(fn) {
  const connection = await getPool().getConnection()
  const tx = {
    connection,
    query: async (sql, params = []) => {
      const [rows] = await connection.query(sql, params)
      return rows
    },
    queryOne: async (sql, params = []) => {
      const [rows] = await connection.query(sql, params)
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
    },
    count: async (fromAndWhere, params = []) => {
      const [rows] = await connection.query(`SELECT COUNT(*) AS total ${fromAndWhere}`, params)
      return rows.length > 0 ? Number(rows[0].total) : 0
    },
  }

  try {
    await connection.beginTransaction()
    const result = await fn(tx)
    await connection.commit()
    return result
  } catch (err) {
    try {
      await connection.rollback()
    } catch (rollbackErr) {
      // 回滚失败说明连接可能已断，记录但不覆盖原始异常 ——
      // 原始异常才是排查依据
      logger.error('事务回滚失败', { err: rollbackErr })
    }
    throw err
  } finally {
    connection.release()
  }
}

/**
 * 把 SQL 压成单行并截断，避免日志被超长 IN 列表刷屏。
 * 只用于日志，不参与执行。
 */
function normalizeSql(sql) {
  const flat = String(sql).replace(/\s+/g, ' ').trim()
  return flat.length > 500 ? `${flat.slice(0, 500)}…` : flat
}

/** 探活，供健康检查与启动自检使用 */
async function ping() {
  const row = await queryOne('SELECT 1 AS ok')
  return Boolean(row && Number(row.ok) === 1)
}

/** 关闭连接池（进程退出、测试 teardown 用） */
async function close() {
  if (!pool) return
  await pool.end()
  pool = null
}

module.exports = { getPool, query, queryOne, count, withTransaction, ping, close }
