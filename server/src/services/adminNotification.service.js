'use strict'

/**
 * 管理员消息（后台站内消息）。
 *
 * ── 与 C 端 notification.service 的分工 ──
 * 两者结构相似但**接收人主体不同**：这里发给 `admin_user`，那边发给 `user`。
 * 混用会把消息发给毫不相干的人（见迁移 012 的说明）。
 *
 * 这里也没有「微信订阅消息」这一路：后台是 Web 端，用户不在微信里，
 * 推送渠道完全不同（邮件 / 站内）。当前只做站内。
 */

const logger = require('../utils/logger')
const db = require('../db/pool')
const adminNotificationModel = require('../models/adminNotification.model')

/** 消息分类。注意与 C 端 `notification.type` 是**两套枚举**，不可混用 */
const TYPES = {
  PROJECT: 'project',
  ACCOUNT: 'account',
  EXPORT: 'export',
  SYSTEM: 'system',
}

/**
 * 发一条管理员消息。
 *
 * 与 C 端的 `notify` 一样：**失败不抛错**。管理员消息是辅助信息，
 * 不该让「项目导出完成」这类主流程因为它而失败。
 */
async function notify(params, tx) {
  try {
    const id = await adminNotificationModel.create(
      {
        tenantId: params.tenantId ?? null,
        adminUserId: params.adminUserId,
        type: params.type,
        title: params.title,
        content: params.content,
        refType: params.refType,
        refId: params.refId,
      },
      tx
    )
    return { id }
  } catch (err) {
    logger.error('写入管理员消息失败（业务流程已继续）', {
      adminUserId: params.adminUserId,
      type: params.type,
      message: err.message,
    })
    return { id: null }
  }
}

/** 批量发给多个管理员（去重后逐个发，单个失败不影响其他） */
async function notifyMany(adminUserIds, params, tx) {
  const results = []
  for (const adminUserId of [...new Set(adminUserIds)].filter(Boolean)) {
    results.push(await notify({ ...params, adminUserId }, tx))
  }
  return results
}

/**
 * 通知某个项目的后台管理员。
 *
 * ── 「这个项目的管理员」= `project.created_by` ──
 * 项目管理员的数据权限是「按项目隔离」（§5.1），因此通知给创建者最贴合
 * 「这个项目归谁管」。**不通知超级管理员**：系统里所有项目都归他管，
 * 全发一遍等于制造噪音，而这个提醒的价值恰恰在于它稀少到值得一看。
 *
 * ── 自己查 project 而不是让调用方传 ──
 * 早先这个逻辑散在定时任务里，调用方需要自己 SELECT `created_by` 再传进来。
 * 漏 SELECT 那一列时，`if (!created_by) return` 会**静默**跳过整条通知
 * （CLAUDE.md 第 55 条就是这么踩到的：日志一片干净，用户什么都没收到）。
 * 把查询收进本函数，调用方就没有「忘了查某一列」的余地了。
 */
async function notifyProjectAdmin({ projectId, title, content, refType = 'project', refId = null }, tx) {
  const project = await db.queryOne(
    'SELECT id, name, tenant_id, created_by FROM project WHERE id = ? AND deleted_at IS NULL',
    [projectId]
  )

  // 项目已被删除（软删）时不再通知：此时管理员多半是刚删掉它的人
  if (!project) return { id: null }

  // ── 收件人从「项目创建者」扩成「租户管理员 ∪ 项目创建者」──
  // 多租户下 created_by 可能是一个已经调岗/被删的项目管理员，
  // 而**租户 owner 才是对项目负最终责任的人**。只发给创建者会出现
  // 「提醒发给了已经不负责这个项目的人」。
  const owners = await db.query(
    "SELECT id FROM admin_user WHERE tenant_id = ? AND role = 'owner' AND status = 'active' AND deleted_at IS NULL",
    [project.tenant_id]
  )

  const recipients = [...new Set([...owners.map((o) => o.id), project.created_by].filter(Boolean))]
  if (recipients.length === 0) return { id: null }

  await notifyMany(
    recipients,
    {
      tenantId: project.tenant_id,
      type: TYPES.PROJECT,
      title,
      content,
      refType,
      refId: refId ?? project.id,
    },
    tx
  )

  return { id: recipients[0] }
}

/**
 * 消息列表与未读数（后台消息铃铛用）。
 *
 * 入参是控制层解析好的 `paging`（`{ page, pageSize, offset, limit }`），
 * 而不是散开的 offset/limit —— 后者要求每个调用点自己拆一遍分页对象，
 * 漏拆一次就是 `LIMIT undefined` 那种 SQL 错误。
 */
async function list(adminUserId, tenantId, { onlyUnread, paging }) {
  const { total, unread, rows } = await adminNotificationModel.list({
    adminUserId,
    tenantId,
    onlyUnread,
    offset: paging.offset,
    limit: paging.limit,
  })

  return {
    list: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      refType: row.ref_type,
      refId: row.ref_id,
      isRead: row.is_read === 1,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
    total,
    unread,
  }
}

/** 标记已读（传 ids 则只标这些，不传则全部） */
async function markRead(adminUserId, ids) {
  const affected = await adminNotificationModel.markRead({ adminUserId, ids })
  return { affected, unread: await adminNotificationModel.countUnread(adminUserId) }
}

module.exports = { TYPES, notify, notifyMany, notifyProjectAdmin, list, markRead }
