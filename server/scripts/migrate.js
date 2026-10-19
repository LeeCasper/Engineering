#!/usr/bin/env node
'use strict'

/**
 * 数据库迁移执行器。
 *
 * 手写而不用 knex / sequelize-cli / prisma：§6.2 的模型依赖条件唯一索引（用生成列实现）、
 * 生成列、行锁等 MySQL 专有特性，现成框架表达不了，最后仍要写 raw SQL ——
 * 那就只剩「多一层配置、多一份 schema 定义」的成本。因此约定
 * **db/migrations/*.sql 是数据库结构的唯一权威**，没有第二处 schema 定义。
 *
 * 已执行过的迁移文件被改动时本脚本报错退出。不校验的后果是：本地改了 .sql 重跑成功，
 * 但服务器上那个文件早已执行过、不会重跑，两边结构悄悄不一致且没有任何征兆。
 *
 *   node scripts/migrate.js            # 执行未应用的迁移
 *   node scripts/migrate.js --status   # 只看状态，不改库
 *   node scripts/migrate.js --fresh    # 删库重建（非生产环境可用）
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const mysql = require('mysql2/promise')

const config = require('../config')

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'db', 'migrations')
const LEDGER_TABLE = 'schema_migrations'

/** multipleStatements 开启（一个迁移文件含多条 DDL），业务连接则刻意关掉它 */
function createConnection(overrides = {}) {
  return mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
    charset: 'utf8mb4_general_ci',
    ...overrides,
  })
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/** 读取迁移目录，按文件名升序返回 */
function readMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const fullPath = path.join(MIGRATIONS_DIR, name)
      const sql = fs.readFileSync(fullPath, 'utf8')
      return { name, fullPath, sql, checksum: sha256(sql) }
    })
}

async function ensureLedger(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename      VARCHAR(255)    NOT NULL COMMENT '迁移文件名，按字典序执行',
      checksum      CHAR(64)        NOT NULL COMMENT '文件内容的 sha256，用于检测已执行迁移被篡改',
      statement_count INT UNSIGNED  NOT NULL DEFAULT 0,
      duration_ms   INT UNSIGNED    NOT NULL DEFAULT 0,
      executed_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_schema_migrations_filename (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='迁移执行记录'
  `)
}

async function loadApplied(conn) {
  const [rows] = await conn.query(`SELECT filename, checksum FROM ${LEDGER_TABLE}`)
  return new Map(rows.map((row) => [row.filename, row.checksum]))
}

/**
 * 按分号切分 SQL 语句。
 *
 * 不能直接 split(';')：注释与字符串字面量里的分号会把语句切坏，而本项目的迁移
 * 含大量中文 COMMENT。因此做一个最小词法扫描，跳过引号包裹的内容与 --、块注释。
 */
function splitStatements(sql) {
  const statements = []
  let current = ''
  let i = 0
  const len = sql.length

  while (i < len) {
    const ch = sql[i]
    const next = sql[i + 1]

    // 行注释
    if (ch === '-' && next === '-') {
      while (i < len && sql[i] !== '\n') i += 1
      continue
    }
    // 块注释
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    // 字符串 / 标识符：整体吃掉，避免其中的分号与注释符号干扰
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      current += ch
      i += 1
      while (i < len) {
        current += sql[i]
        if (sql[i] === '\\') {
          // 转义：连同下一个字符一起吞掉
          i += 1
          if (i < len) current += sql[i]
          i += 1
          continue
        }
        if (sql[i] === quote) {
          // 连续两个引号表示一个字面量引号（SQL 标准写法）
          if (sql[i + 1] === quote) {
            current += sql[i + 1]
            i += 2
            continue
          }
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    // 语句结束
    if (ch === ';') {
      const trimmed = current.trim()
      if (trimmed) statements.push(trimmed)
      current = ''
      i += 1
      continue
    }

    current += ch
    i += 1
  }

  const tail = current.trim()
  if (tail) statements.push(tail)
  return statements
}

async function runFresh(conn) {
  // 生产环境一律禁止：这条命令会 DROP DATABASE。
  // 开发环境放行是因为它确实有用 —— DDL 在 MySQL 中隐式提交、无法回滚，
  // 一个写到一半失败的迁移会把库留在半成品状态（部分表已建、schema_migrations
  // 里没记录），此时重建比手工删表逐个对齐可靠得多。
  if (config.isProd) {
    throw new Error('--fresh 会删除数据库，生产环境禁止执行')
  }
  console.log(`[migrate] --fresh：删除并重建数据库 ${config.db.database}`)
  await conn.query(`DROP DATABASE IF EXISTS \`${config.db.database}\``)
  await conn.query(
    `CREATE DATABASE \`${config.db.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
  )
  await conn.query(`USE \`${config.db.database}\``)
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const statusOnly = args.has('--status')
  const fresh = args.has('--fresh')

  console.log(`[migrate] 目标库 ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`)

  const conn = await createConnection()
  try {
    if (fresh) await runFresh(conn)
    await ensureLedger(conn)

    const files = readMigrationFiles()
    const applied = await loadApplied(conn)

    if (files.length === 0) {
      console.log('[migrate] db/migrations 下没有 .sql 文件')
      return
    }

    // 先做一致性检查，再执行任何东西：宁可整体不动，也不要执行到一半发现历史被改过
    const drifted = files.filter((f) => applied.has(f.name) && applied.get(f.name) !== f.checksum)
    if (drifted.length > 0) {
      console.error('\n[migrate] 检测到已执行的迁移文件被修改：')
      for (const f of drifted) console.error(`  - ${f.name}`)
      console.error(
        '\n已执行的迁移不可修改（服务器上不会重跑，会导致本地与线上结构静默不一致）。\n' +
          '请改为新增一个迁移文件来做变更。'
      )
      process.exitCode = 1
      return
    }

    const pending = files.filter((f) => !applied.has(f.name))

    if (statusOnly) {
      console.log('\n迁移状态：')
      for (const f of files) {
        console.log(`  ${applied.has(f.name) ? '✔ 已执行' : '· 待执行'}  ${f.name}`)
      }
      console.log(`\n共 ${files.length} 个，待执行 ${pending.length} 个`)
      return
    }

    if (pending.length === 0) {
      console.log('[migrate] 数据库结构已是最新')
      return
    }

    for (const file of pending) {
      const statements = splitStatements(file.sql)
      const started = Date.now()
      console.log(`[migrate] 执行 ${file.name}（${statements.length} 条语句）`)

      // DDL 在 MySQL 中会隐式提交，因此无法用事务包住整个文件回滚。
      // 出错的处置方式是：修好 SQL、删掉库重建（开发）或手工补执行（生产）。
      // 为此把每条语句单独执行，让报错能定位到具体哪一条。
      for (let index = 0; index < statements.length; index += 1) {
        const statement = statements[index]
        try {
          await conn.query(statement)
        } catch (err) {
          const preview = statement.replace(/\s+/g, ' ').slice(0, 160)
          console.error(`\n[migrate] ${file.name} 第 ${index + 1} 条语句执行失败：`)
          console.error(`  ${preview}…`)
          console.error(`  ${err.code || ''} ${err.message}\n`)
          throw err
        }
      }

      const durationMs = Date.now() - started
      await conn.query(
        `INSERT INTO ${LEDGER_TABLE} (filename, checksum, statement_count, duration_ms) VALUES (?, ?, ?, ?)`,
        [file.name, file.checksum, statements.length, durationMs]
      )
      console.log(`[migrate]   ✔ 完成，用时 ${durationMs}ms`)
    }

    console.log(`[migrate] 全部完成，本次执行 ${pending.length} 个迁移`)
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error('[migrate] 失败：', err.message)
  process.exitCode = 1
})
