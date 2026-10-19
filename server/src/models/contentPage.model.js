'use strict'

/**
 * content_page 数据访问层（AC-U17 / C-5.8）。
 */

const db = require('../db/pool')

/** 全部页面（后台列表用，含未发布的草稿） */
async function listAll(tenantId) {
  const scope = tenantId == null ? 'tenant_id IS NULL' : 'tenant_id = ?'
  const params = tenantId == null ? [] : [tenantId]

  return db.query(
    `SELECT id, page_key, title, version, published_at, updated_by, updated_at,
            CHAR_LENGTH(content) AS content_length
       FROM content_page
      WHERE ${scope} AND deleted_at IS NULL
      ORDER BY page_key`,
    params
  )
}

/**
 * 取单个页面。
 *
 * `requirePublished` 是**接口级别的分界**：C 端只能看到已发布的，
 * 后台能看草稿。把它做成参数而不是两个函数，是为了让调用点必须显式表态 ——
 * 少写一次的话，草稿用户协议就直接泄给终端用户了。
 */
async function findByKey(tenantId, pageKey, { requirePublished = false } = {}) {
  const where = ['page_key = ?', 'deleted_at IS NULL']
  const params = [pageKey]

  // tenantId 为 null = 平台默认版本（C 端未登录时读它）
  if (tenantId == null) {
    where.push('tenant_id IS NULL')
  } else {
    where.push('tenant_id = ?')
    params.push(tenantId)
  }
  if (requirePublished) where.push('published_at IS NOT NULL')

  return db.queryOne(
    `SELECT id, page_key, title, content, version, published_at, updated_by, updated_at
       FROM content_page WHERE ${where.join(' AND ')}`,
    params
  )
}

/**
 * 写入或更新页面内容。
 *
 * 与 sys_config 同样是 upsert：页面键是固定的几个，管理员第一次编辑时
 * 库里大概率还没有该行。用 ON DUPLICATE KEY 而不是「先查再插」，
 * 避免两个管理员同时保存时的竞态。
 */
async function upsert({ tenantId, pageKey, title, content, version, publishedAt, updatedBy }, tx = db) {
  await tx.query(
    `INSERT INTO content_page (tenant_id, page_key, title, content, version, published_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title        = VALUES(title),
       content      = VALUES(content),
       version      = VALUES(version),
       published_at = VALUES(published_at),
       updated_by   = VALUES(updated_by),
       deleted_at   = NULL`,
    [tenantId ?? null, pageKey, title, content, version ?? null, publishedAt ?? null, updatedBy ?? null]
  )
}

module.exports = { listAll, findByKey, upsert }
