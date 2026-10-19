'use strict'

/**
 * 集成测试的数据库准备。
 *
 * 每个测试文件开始时重建整库。集成测试要断言的正是「真实 MySQL 下的行为」——
 * 唯一索引是否真拦住重复插入、生成列实现的条件唯一索引是否生效、软删除后约束是否释放，
 * 这些都无法靠「造完再回滚」验证（生成列与 DDL 行为不在事务语义内），
 * 而上一个文件残留的数据会让「唯一键冲突」类断言假阳性。
 *
 * 代价是每个文件多花约 0.5s，换来断言可信。这也是集成测试必须
 * --no-file-parallelism 的原因：并行跑多个文件会同时 DROP 同一个库。
 */

const { execFileSync } = require('node:child_process')
const path = require('node:path')

const SERVER_ROOT = path.resolve(__dirname, '..', '..', '..')

/** 复用 scripts/migrate.js，保证测试库与开发库由**同一份 SQL** 产生；测试自建表迟早分叉 */
function prepareDatabase() {
  execFileSync(process.execPath, [path.join(SERVER_ROOT, 'scripts', 'migrate.js'), '--fresh'], {
    cwd: SERVER_ROOT,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe',
  })
}

/** 清空业务数据但保留表结构（同一文件内多个 describe 之间复用） */
async function truncateAll(db) {
  const tables = await db.query(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'`
  )
  if (tables.length === 0) return

  await db.query('SET FOREIGN_KEY_CHECKS = 0')
  try {
    for (const { name } of tables) {
      await db.query(`TRUNCATE TABLE \`${name}\``)
    }
  } finally {
    await db.query('SET FOREIGN_KEY_CHECKS = 1')
  }
}

module.exports = { prepareDatabase, truncateAll, SERVER_ROOT }
