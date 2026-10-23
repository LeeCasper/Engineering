#!/usr/bin/env node
'use strict'

/**
 * 种子数据。
 *
 * **幂等**：可以反复执行，已存在的数据不会重复插入，也不会被覆盖。
 * 这一点很重要 —— 冒烟脚本与本地开发都会反复跑 seed，
 * 一个会「每次都插一份重复数据」的种子脚本会让唯一索引冲突变成日常噪音。
 *
 * 灌入三样东西：
 *   1. 内置默认阶段模板（需求文档 §11.1 / §11.2），AC-AD33 要求开箱即用；
 *   2. 一个超级管理员账号（首次登录强制改密，AC-AD06）；
 *   3. 系统配置默认值（§5.5 的 B-5.1 ~ B-5.9）。
 *
 * 用法：node scripts/seed.js
 */

const db = require('../src/db/pool')
const config = require('../config')
const password = require('../src/utils/password')
// 默认模板与内容页骨架与「平台开通租户」共用同一份数据（见 src/data/tenantDefaults.js）
const { DEFAULT_STAGE_TEMPLATE, CONTENT_PAGE_SKELETONS } = require('../src/data/tenantDefaults')

/** 超管初始密码。生产环境务必通过环境变量覆盖，并在首次登录后立即修改 */
const DEFAULT_SUPER_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin123456'
const DEFAULT_SUPER_USERNAME = process.env.SEED_ADMIN_USERNAME || 'admin'

/**
 * 平台运营账号（M13）。`tenant_id` 为 NULL，不属于任何租户。
 *
 * 本机开发与冒烟脚本需要它来验证「开通租户 / 停用 / 排障授权」这条链路。
 * 生产环境如果没有平台运营的需求，可以不保留这个账号 ——
 * 它同样带 `must_change_password=1`，首次登录必须改密。
 */
const DEFAULT_PLATFORM_PASSWORD = process.env.SEED_PLATFORM_PASSWORD || 'Platform123456'
const DEFAULT_PLATFORM_USERNAME = process.env.SEED_PLATFORM_USERNAME || 'platform'

/**
 * 系统配置默认值（§5.5）。
 * 全部以字符串存储，由应用层按配置项定义解析类型（§6.2）。
 */
const DEFAULT_CONFIGS = [
  ['sign_in_distance_threshold', '500', '签到偏差阈值（米），B-5.1'],
  ['stale_report_days', '3', '工长未汇报提醒天数，B-5.2'],
  ['acceptance_timeout_hours', '48', '验收超时提醒时长（小时），B-5.3'],
  ['big_expense_ratio', '0.1', '大额支出提醒比例（占合同额），B-5.4'],
  ['report_max_images', '9', '单次汇报照片上限，B-5.5'],
  ['report_max_videos', '1', '单次汇报视频上限，B-5.5'],
  ['report_max_video_seconds', '60', '单次汇报视频时长上限（秒），B-5.5'],
  ['route_max_points', '10', '单次路线规划途经点上限，B-5.6'],
  ['operation_log_retention', 'forever', '操作日志保留时长，B-5.8'],
  // B-5.9：默认「标准」的理由见需求文档 §4.7.3 —— 卡汇报没有收益只有副作用，
  // 一旦进度时间轴失真，本产品最核心的价值（进度透明、纠纷留证）就被摧毁了
  ['gate_strength', 'standard', '阶段推进门禁强度（strict/standard/loose），B-5.9'],
  // C-1.5：未被分配到任何项目时，小程序展示引导页与管理员联系方式。
  // 留空时前端只展示引导文案，不展示联系方式
  ['support_contact', '', 'C 端未分配项目时展示的管理员联系方式，C-1.5'],
]

/**
 * 确保租户 #1 存在。
 *
 * seed 是给「本机开发 / 演示」用的，因此固定落在一个默认租户里。
 * 真正的 SaaS 多租户由平台开通（P3），不走 seed。
 */
async function seedTenant() {
  const existing = await db.queryOne('SELECT id FROM tenant WHERE id = 1')
  if (existing) {
    console.log('  · 默认租户已存在，跳过')
    return 1
  }

  await db.query(
    `INSERT INTO tenant (id, name, code, status, plan, max_projects, max_admin_users, remark)
     VALUES (1, ?, 'default', 'active', 'basic', 0, 0, '本机开发与演示用的默认租户')`,
    [process.env.SEED_TENANT_NAME || '示例装修公司']
  )
  console.log('  ✔ 已创建默认租户（code=default）')
  return 1
}

/** 插入租户管理员。已存在则跳过，不覆盖密码 —— 避免反复 seed 把线上密码重置回默认值 */
async function seedSuperAdmin(tenantId) {
  const existing = await db.queryOne(
    'SELECT id FROM admin_user WHERE username = ? AND tenant_id = ? AND deleted_at IS NULL',
    [DEFAULT_SUPER_USERNAME, tenantId]
  )
  if (existing) {
    console.log(`  · 超管账号 ${DEFAULT_SUPER_USERNAME} 已存在，跳过`)
    return existing.id
  }

  const passwordHash = await password.hash(DEFAULT_SUPER_PASSWORD)
  const rows = await db.query(
    `INSERT INTO admin_user (tenant_id, username, password_hash, role, must_change_password)
     VALUES (?, ?, ?, 'owner', 1)`,
    [tenantId, DEFAULT_SUPER_USERNAME, passwordHash]
  )

  console.log(`  ✔ 已创建租户管理员：${DEFAULT_SUPER_USERNAME} / ${DEFAULT_SUPER_PASSWORD}`)
  console.log('    ⚠ 首次登录将强制修改密码（AC-AD06）')
  return rows.insertId
}

/**
 * 插入平台运营账号。
 *
 * 已存在则跳过，不覆盖密码 —— 与租户 owner 一样，
 * 反复执行 seed 不应把线上密码重置回默认值。
 */
async function seedPlatformAdmin() {
  const existing = await db.queryOne(
    'SELECT id FROM admin_user WHERE username = ? AND tenant_id IS NULL AND deleted_at IS NULL',
    [DEFAULT_PLATFORM_USERNAME]
  )
  if (existing) {
    console.log(`  · 平台账号 ${DEFAULT_PLATFORM_USERNAME} 已存在，跳过`)
    return existing.id
  }

  const passwordHash = await password.hash(DEFAULT_PLATFORM_PASSWORD)
  const rows = await db.query(
    `INSERT INTO admin_user (tenant_id, username, password_hash, role, must_change_password)
     VALUES (NULL, ?, ?, 'platform', 1)`,
    [DEFAULT_PLATFORM_USERNAME, passwordHash]
  )

  console.log(
    `  ✔ 已创建平台运营账号：${DEFAULT_PLATFORM_USERNAME} / ${DEFAULT_PLATFORM_PASSWORD}（tenant_id 为 NULL）`
  )
  console.log('    ⚠ 首次登录将强制修改密码；生产环境请通过环境变量覆盖初始密码')
  return rows.insertId
}

/** 插入默认模板。模板名已存在即视为已灌入，整体跳过 */
async function seedDefaultTemplate(tenantId, adminId) {
  const existing = await db.queryOne(
    'SELECT id FROM stage_template WHERE tenant_id = ? AND name = ? AND deleted_at IS NULL',
    [tenantId, 
    DEFAULT_STAGE_TEMPLATE.name,
  ])
  if (existing) {
    console.log(`  · 默认模板「${DEFAULT_STAGE_TEMPLATE.name}」已存在，跳过`)
    return existing.id
  }

  return db.withTransaction(async (tx) => {
    const tplResult = await tx.query(
      'INSERT INTO stage_template (tenant_id, name, is_default, created_by) VALUES (?, ?, 1, ?)',
      [tenantId, DEFAULT_STAGE_TEMPLATE.name, adminId]
    )
    const templateId = tplResult.insertId

    for (const [stageIndex, stage] of DEFAULT_STAGE_TEMPLATE.stages.entries()) {
      const stageResult = await tx.query(
        'INSERT INTO stage_template_stage (template_id, name, seq, plan_days) VALUES (?, ?, ?, ?)',
        [templateId, stage.name, stageIndex + 1, stage.planDays]
      )
      const stageId = stageResult.insertId

      for (const [itemIndex, item] of stage.items.entries()) {
        // 兼容两种写法：纯字符串，或 { name, checklist }
        const name = typeof item === 'string' ? item : item.name
        const checklist = typeof item === 'string' ? null : item.checklist

        await tx.query(
          'INSERT INTO stage_template_item (template_stage_id, name, seq, default_checklist) VALUES (?, ?, ?, ?)',
          [stageId, name, itemIndex + 1, checklist ? JSON.stringify(checklist.map((n) => ({ name: n }))) : null]
        )
      }
    }

    const stageCount = DEFAULT_STAGE_TEMPLATE.stages.length
    const itemCount = DEFAULT_STAGE_TEMPLATE.stages.reduce((sum, s) => sum + s.items.length, 0)
    console.log(`  ✔ 已创建默认模板「${DEFAULT_STAGE_TEMPLATE.name}」：${stageCount} 个阶段 / ${itemCount} 个工序`)
    return templateId
  })
}

/** 插入系统配置默认值。逐项检查，已存在的保留现值（不回溯覆盖，符合 §5.5 的「不回溯」原则） */
async function seedConfigs(tenantId, adminId) {
  let inserted = 0
  for (const [key, value, description] of DEFAULT_CONFIGS) {
    const existing = await db.queryOne(
      "SELECT id FROM sys_config WHERE tenant_id = ? AND config_key = ? AND scope = 'global' AND deleted_at IS NULL",
      [tenantId, key]
    )
    if (existing) continue

    await db.query(
      "INSERT INTO sys_config (tenant_id, config_key, config_value, scope, description, updated_by) VALUES (?, ?, ?, 'global', ?, ?)",
      [tenantId, key, value, description, adminId]
    )
    inserted += 1
  }
  console.log(inserted > 0 ? `  ✔ 已写入 ${inserted} 项系统配置` : '  · 系统配置已齐全，跳过')
}


/**
 * 写入内容页骨架。已存在则跳过，不覆盖运营已经改好的正文。
 *
 * `tenantId === null` 写入的是平台基础版本（登录前与租户未发布时的兜底）。
 * 平台骨架同样保持「未发布」——占位文本不能当成正式法律文本发布。
 */
async function seedContentPages(tenantId, adminId) {
  let inserted = 0

  for (const page of CONTENT_PAGE_SKELETONS) {
    const existing =
      tenantId == null
        ? await db.queryOne(
            'SELECT id FROM content_page WHERE tenant_id IS NULL AND page_key = ? AND deleted_at IS NULL',
            [page.key]
          )
        : await db.queryOne(
            'SELECT id FROM content_page WHERE tenant_id = ? AND page_key = ? AND deleted_at IS NULL',
            [tenantId, page.key]
          )
    if (existing) continue

    await db.query(
      `INSERT INTO content_page (tenant_id, page_key, title, content, updated_by) VALUES (?, ?, ?, ?, ?)`,
      [tenantId ?? null, page.key, page.title, page.content, adminId]
    )
    inserted += 1
  }

  console.log(
    inserted > 0
      ? `  ✔ 已写入 ${inserted} 个内容页骨架（**未发布**，需在后台填写正式文本后发布）`
      : '  · 内容页已存在，跳过'
  )
}

async function main() {
  console.log(`[seed] 目标库 ${config.db.user}@${config.db.host}/${config.db.database}`)

  const tenantId = await seedTenant()
  const adminId = await seedSuperAdmin(tenantId)
  const platformId = await seedPlatformAdmin()
  await seedDefaultTemplate(tenantId, adminId)
  await seedConfigs(tenantId, adminId)
  await seedContentPages(tenantId, adminId)
  // 平台基础内容页：登录前可读的兜底版本，租户未发布时也用它
  await seedContentPages(null, platformId)

  console.log('[seed] 完成')
}

main()
  .catch((err) => {
    console.error('[seed] 失败：', err.message)
    process.exitCode = 1
  })
  .finally(() => db.close())
