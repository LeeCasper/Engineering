'use strict'

/**
 * 静态内容页（C-5.8 / AC-U17）。
 *
 * 「关于我们 / 用户协议 / 隐私政策」的内容由后台维护，C 端只读。
 * 页面清单写死在服务端而不是让后台自由新建：这三页是**合规要求**下的固定入口
 * （隐私政策必须可访问），允许后台随意删改会导致某个版本里入口凭空消失。
 * 新增页面 = 加一行注册表，不涉及数据库迁移。
 */

const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const contentPageModel = require('../models/contentPage.model')
const operationLog = require('./operationLog.service')

/**
 * 页面注册表。`required` 标记的页面在 C 端必须有内容 ——
 * 未发布时前端要么展示占位、要么隐藏入口，不能出现「点了打不开」。
 */
const PAGES = {
  about: { label: '关于我们', required: false },
  agreement: { label: '用户协议', required: true },
  privacy: { label: '隐私政策', required: true },
}

function assertKnownKey(pageKey) {
  if (!PAGES[pageKey]) throw AppError.notFound('页面不存在')
}

/** 后台：全部页面（含未发布的草稿），未创建的也要出现，否则后台不知道有哪几页可维护 */
async function listAll(tenantId) {
  const rows = await contentPageModel.listAll(tenantId)
  const stored = new Map(rows.map((r) => [r.page_key, r]))

  // 租户列表要同时看到平台基础版本：本租户没发布时 C 端实际显示的是它。
  // 不展示这一层，管理员会误以为「我没发过，所以 C 端什么都没有」。
  const platformRows = tenantId == null ? rows : await contentPageModel.listAll(null)
  const platformStored = new Map(platformRows.map((r) => [r.page_key, r]))

  return Object.entries(PAGES)
    .map(([pageKey, meta]) => {
      const row = stored.get(pageKey)
      const platformRow = platformStored.get(pageKey)

      // 与 C 端读取顺序完全一致：本租户已发布 → 平台已发布 → 都没有
      let effectiveSource = 'none'
      if (row && row.published_at) effectiveSource = tenantId == null ? 'platform' : 'tenant'
      else if (platformRow && platformRow.published_at) effectiveSource = 'platform'

      return {
        pageKey,
        label: meta.label,
        required: meta.required,
        title: row ? row.title : meta.label,
        version: row ? row.version : null,
        publishedAt: row ? row.published_at : null,
        // 只回长度不回正文：后台列表要展示「隐私政策 · 3240 字」，
        // 而把两三页完整法律文本塞进一个列表响应，纯属浪费
        contentLength: row ? row.content_length : 0,
        exists: Boolean(row),
        // 本租户还没创建覆盖版本，但平台已有可继承的已发布版本
        inheritsPlatform: tenantId != null && (!row || !row.published_at) && Boolean(platformRow && platformRow.published_at),
        platformPublishedAt: tenantId != null && platformRow ? platformRow.published_at : null,
        effectiveSource,
        updatedAt: row ? row.updated_at : null,
      }
    })
    .sort((a, b) => a.pageKey.localeCompare(b.pageKey))
}

/** 后台：单个页面详情（含正文，编辑器用） */
async function getForAdmin(tenantId, pageKey) {
  assertKnownKey(pageKey)
  const row = await contentPageModel.findByKey(tenantId, pageKey)

  return {
    pageKey,
    label: PAGES[pageKey].label,
    required: PAGES[pageKey].required,
    title: row ? row.title : PAGES[pageKey].label,
    content: row ? row.content : null,
    version: row ? row.version : null,
    publishedAt: row ? row.published_at : null,
    updatedAt: row ? row.updated_at : null,
  }
}

/**
 * C 端：读取已发布的内容页。
 *
 * 未发布（或从未创建）时返回 404 而不是空内容。空内容会让小程序渲染出一个
 * 白屏页面，用户以为「App 坏了」；404 则让前端能退回到「该页面暂不可用」的提示。
 */
/**
 * C 端读取已发布内容。
 *
 * `tenantId` 为 null 时读**平台默认版本** —— C 端在登录前就要能读用户协议，
 * 那时还不知道用户属于哪个租户。进入某个租户的项目后，前端带上 tenantId
 * 再读一次该租户的版本。
 */
async function getPublished(tenantId, pageKey) {
  assertKnownKey(pageKey)

  // 租户已发布 → 平台基础已发布 → 404。
  //
  // 平台基础版本是登录前唯一能读到的版本（那时没有租户上下文），
  // 也是租户尚未发布时的兜底。少了这一层，共享小程序在登录页
  // 根本打不开用户协议 —— 而隐私政策是合规必需入口。
  let row = null
  if (tenantId != null) {
    row = await contentPageModel.findByKey(tenantId, pageKey, { requirePublished: true })
  }
  if (!row) {
    row = await contentPageModel.findByKey(null, pageKey, { requirePublished: true })
  }
  if (!row) throw AppError.notFound('页面尚未发布')

  return {
    pageKey: row.page_key,
    title: row.title,
    content: row.content,
    version: row.version,
    publishedAt: row.published_at,
  }
}

/**
 * 后台保存内容（AC-U17「内容由后台可维护」）。
 *
 * `publish` 决定是否置 `published_at`：
 *   - 传 true → 立即发布（首次或更新都会刷新发布时间的语义由前端确认，这里只在未发布时置值）
 *   - 不传   → 存草稿，`published_at` 保持原值（已发布的页面改完仍是已发布）
 *
 * 「改完仍是已发布」是刻意的：把已上线页面的编辑动作默认变成「下架」，
 * 会让一次错别字修正把隐私政策从 C 端整体下掉，而没人会立刻发现。
 */
async function save(pageKey, input, operator) {
  assertKnownKey(pageKey)

  // 平台运营改的是平台基础版本（tenant_id IS NULL），租户管理员改自己的覆盖版本。
  // 平台持排障授权进入租户时 tenantId 非空、role 仍是 platform —— 写操作
  // 在 requireTenant 就被拦下了，这里再拒绝一次，避免服务被别的调用方误用。
  const targetTenantId =
    operator.role === 'platform' && operator.tenantId == null ? null : operator.tenantId
  if (operator.role === 'platform' && operator.tenantId != null) {
    throw AppError.forbidden('平台排障窗口内只能查看内容页')
  }
  if (targetTenantId == null && operator.role !== 'platform') {
    throw AppError.forbidden('缺少租户信息，无法保存内容页')
  }

  const before = await contentPageModel.findByKey(targetTenantId, pageKey)

  // 已发布的页面，`published_at` 不再变化 —— 它记录的是「这一版什么时候上线的」，
  // 每次编辑都刷新会让「用户当时同意的是哪一版」这个问题失去答案
  let publishedAt = before ? before.published_at : null
  if (input.publish && !publishedAt) publishedAt = datetime.format()

  const title = input.title || (before ? before.title : PAGES[pageKey].label)
  const content = input.content ?? (before ? before.content : null)

  await contentPageModel.upsert({
    tenantId: targetTenantId,
    pageKey,
    title,
    content,
    version: input.version ?? (before ? before.version : null),
    publishedAt,
    updatedBy: operator.id,
  })

  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.CONTENT_UPDATE,
    targetType: 'content_page',
    // 内容页没有自增 id 可引用（upsert 前可能还不存在），用键名定位
    targetId: null,
    detail: {
      scope: targetTenantId == null ? 'platform' : 'tenant',
      // **只记长度与版本，不记正文**：正文动辄数千字，写进 operation_log
      // 会让审计表迅速膨胀，且它本身不是「变更前后值」这类需要逐字比对的东西。
      // 需要留证时靠 version 字段（后台填写的版本号）回溯
      before: before ? { title: before.title, version: before.version, contentLength: (before.content || '').length } : null,
      after: {
        title,
        version: input.version ?? (before ? before.version : null),
        contentLength: (content || '').length,
        published: Boolean(publishedAt),
      },
    },
  })

  return getForAdmin(targetTenantId, pageKey)
}

module.exports = { PAGES, listAll, getForAdmin, getPublished, save }
