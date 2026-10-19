'use strict'

/**
 * 测试夹具。
 *
 * 直接写库而不是调接口：夹具的职责是**准备状态**，若用待测接口准备，
 * 一条链路坏掉会连带另一片用例全红，排查时反而更费劲。
 */

const db = require('../../../src/db/pool')

/** 集成测试的默认租户 id，与迁移 016 的存量归属一致 */
const DEFAULT_TENANT_ID = 1

/**
 * 建一个阶段模板。
 *
 * @param {object} options
 * @param {string} [options.name='测试模板']
 * @param {boolean} [options.isDefault=false] 默认模板不可删除（AC-AD33）
 * @param {Array} [options.stages] 每项 { name, planDays, weight, items: [{name, weight, checklist}] }
 * @param {number} [options.createdBy=1]
 */
async function createTemplate({
  name = '测试模板',
  isDefault = false,
  stages,
  createdBy = 1,
  tenantId = DEFAULT_TENANT_ID,
} = {}) {
  const stageList = stages || [
    {
      name: '开工准备',
      planDays: 2,
      items: [{ name: '现场交底' }, { name: '成品保护' }, { name: '原始状态拍照' }],
    },
    {
      name: '水电工程',
      planDays: 10,
      items: [
        { name: '强电布线', checklist: ['强弱电分管分槽，间距 ≥ 30cm', '线管固定牢固，无松动'] },
        { name: '水路改造' },
      ],
    },
  ]

  return db.withTransaction(async (tx) => {
    const tpl = await tx.query(
      'INSERT INTO stage_template (tenant_id, name, is_default, created_by) VALUES (?, ?, ?, ?)',
      [tenantId, name, isDefault ? 1 : 0, createdBy]
    )

    for (const [stageIndex, stage] of stageList.entries()) {
      const s = await tx.query(
        'INSERT INTO stage_template_stage (template_id, name, seq, plan_days, weight) VALUES (?, ?, ?, ?, ?)',
        [tpl.insertId, stage.name, stageIndex + 1, stage.planDays ?? 1, stage.weight ?? null]
      )

      for (const [itemIndex, item] of (stage.items || []).entries()) {
        await tx.query(
          'INSERT INTO stage_template_item (template_stage_id, name, seq, weight, default_checklist) VALUES (?, ?, ?, ?, ?)',
          [
            s.insertId,
            typeof item === 'string' ? item : item.name,
            itemIndex + 1,
            (item && item.weight) ?? null,
            item && item.checklist ? JSON.stringify(item.checklist.map((n) => ({ name: n }))) : null,
          ]
        )
      }
    }

    return tpl.insertId
  })
}

/** 授予以项目数据权限（project_admin_scope） */
async function grantProjectScope(adminUserId, projectId, grantedBy = 1) {
  await db.query(
    'INSERT INTO project_admin_scope (admin_user_id, project_id, granted_by) VALUES (?, ?, ?)',
    [adminUserId, projectId, grantedBy]
  )
}

/**
 * 清空全部业务表。集成测试的 beforeEach 用。
 *
 * ── 为什么是「枚举全部表」而不是手写清单 ──
 * 这里原本是一份手写的表名数组，结果是：每加一张新表就要记得补进去，
 * 而忘记的代价很隐蔽 —— 数据在用例之间累积，「查询返回几条」这类断言
 * 会读到上一个用例的残留，报出的却是「期望 1 条实际 13 条」这种
 * 看起来像业务算错了的错误，排查方向完全被带偏。
 * 这件事在本项目里已经发生过两次（progress_log、progress_report）。
 *
 * 因此改为直接问数据库有哪些表：新增表自动被覆盖，不会再漏。
 * 唯一排除的是迁移记录表 —— 清掉它会让下一次 migrate 重复执行建表语句。
 *
 * ── 为什么用 DELETE 而不是 TRUNCATE ──
 * TRUNCATE 在 InnoDB 上会**删掉并重建表空间**，实测每张表 90–134ms，
 * 31 张表合计约 2.8 秒 —— 而它在每个用例的 beforeEach 里都要跑一次。
 * 换成 DELETE 后同样的 31 张表只要 **4ms**（快约 700 倍）。
 * 本函数是全套测试里最值得优化的一个点，改这一处就把集成测试的时间
 * 从十几分钟压到几分钟。
 *
 * 代价是 **AUTO_INCREMENT 不重置**，自增 id 会随测试累积而增大。
 * 这是可接受的：测试本来就不该依赖「新建的项目一定 id=1」——
 * 那种依赖在用例顺序变化时会莫名其妙地失败。原先只有一处这样的假设，
 * 已改为使用接口返回的 id。
 */
async function resetBusinessTables() {
  const rows = await db.query(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'`
  )

  await db.query('SET FOREIGN_KEY_CHECKS = 0')
  try {
    for (const { name } of rows) {
      await db.query(`DELETE FROM \`${name}\``)
    }
  } finally {
    await db.query('SET FOREIGN_KEY_CHECKS = 1')
  }

  // `tenant` 也被上面的枚举清空了。多租户之后**几乎每条数据都要带 tenant_id**，
  // 因此每个用例开始前必须保证租户 #1 存在 —— 否则所有 fixture 都会插空。
  // 用固定 id=1，与迁移 016 里「存量数据归入租户 #1」保持一致。
  await ensureDefaultTenant()
}

/** 确保租户 #1 存在（幂等）。所有测试默认在这个租户里工作 */
async function ensureDefaultTenant() {
  await db.query(
    `INSERT INTO tenant (id, name, code, status, plan, max_projects, max_admin_users, remark)
     VALUES (1, '测试租户', 'default', 'active', 'basic', 0, 0, '集成测试默认租户')
     ON DUPLICATE KEY UPDATE deleted_at = NULL, status = 'active'`,
    []
  )
  return DEFAULT_TENANT_ID
}

/** 建一个额外租户，用于跨租户隔离测试 */
async function createTenant({ name = '另一个租户', code, status = 'active' } = {}) {
  const finalCode = code || `t${Date.now()}${Math.floor(Math.random() * 1000)}`
  const result = await db.query(
    `INSERT INTO tenant (name, code, status, plan, max_projects, max_admin_users)
     VALUES (?, ?, ?, 'basic', 0, 0)`,
    [name, finalCode, status]
  )
  return result.insertId
}


module.exports = { DEFAULT_TENANT_ID, createTemplate, createTenant, ensureDefaultTenant, grantProjectScope, resetBusinessTables }
