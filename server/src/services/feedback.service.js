'use strict'

/**
 * 意见反馈（C-5.7 / AC-U18）。
 *
 * ── 两个刻意的取舍 ──
 * 1. **图片不加服务端水印**。进度汇报的照片加水印（AC-P12）是因为它们
 *    是现场施工的证据；反馈截图恰恰相反 —— 用户是来报问题的，
 *    水印压在截图内容上会让「这里按钮点不动」这类问题看不清楚。
 *    水印的适用边界是「证明某时某地发生了什么」，不是「所有用户上传的图」。
 * 2. **图片落盘在写库之前，失败要补偿删除**。文件系统不参与事务，
 *    先写库再存文件则文件失败会留下一条指不到图的记录；
 *    先存文件再写库，写库失败时要手动清理（见 cleanupFiles）。
 */

const config = require('../../config')
const logger = require('../utils/logger')
const AppError = require('../utils/AppError')
const storage = require('../storage')
const db = require('../db/pool')
const feedbackModel = require('../models/feedback.model')
const operationLog = require('./operationLog.service')

/**
 * 单条反馈最多几张图。
 *
 * 与汇报附件（可配的 9 张）分开：反馈是「顺手截个图」的场景，
 * 3 张足够说清一个问题，而放开到 9 张只会让运维花更多时间看无关截图。
 * 不放进 sys_config：它没有需要运营调整的理由。
 */
const MAX_IMAGES = 3

const HANDLE_STATUS = ['processing', 'resolved']

const STATUS_LABELS = { new: '待处理', processing: '处理中', resolved: '已处理' }

/**
 * 提交反馈（AC-U18）。
 *
 * @param {number} userId
 * @param {object} input content / projectId / contact
 * @param {Array} files multer 归一化后的文件
 * @param {object} operator 审计上下文
 */
async function submit(userId, input, files, operator) {
  // 反馈归属的租户：带了项目就按项目定；否则按用户所属租户。
  // 两者都没有（不属于任何租户的用户）才落成平台级反馈。
  let tenantId = null
  if (input.projectId) {
    const row = await db.queryOne('SELECT tenant_id FROM project WHERE id = ? AND deleted_at IS NULL', [
      input.projectId,
    ])
    tenantId = row ? row.tenant_id : null
  } else {
    const { resolveTenant } = require('./subscription.service')
    // 用户只属于一个租户时自动归属；属于多个时要求显式传 tenantId
    tenantId = await resolveTenant(userId, input.tenantId).catch(() => null)
  }

  const images = files.filter((f) => f.type === 'image')
  if (images.length > MAX_IMAGES) {
    throw AppError.badRequest(`最多上传 ${MAX_IMAGES} 张图片`)
  }

  const saved = []
  try {
    for (const file of images) {
      const result = await storage.save(file.buffer, { category: 'feedback', ext: file.ext })
      saved.push({ url: result.url })
    }
  } catch (err) {
    // 第 2 张失败时第 1 张已经落盘了。不补偿删除的话，每次失败都在磁盘上
    // 留一批永远不会被引用的孤儿文件
    await cleanup(saved)
    throw err
  }

  try {
    const id = await feedbackModel.createFeedback({
      userId,
      // 有项目就归项目的租户；没有则是提给平台的（tenant_id 为 null）
      tenantId: tenantId ?? null,
      projectId: input.projectId ?? null,
      content: input.content,
      images: saved,
      contact: input.contact ?? null,
    })

    await operationLog.record({
      ...operationLog.fromOperator(operator),
      action: operationLog.ACTIONS.FEEDBACK_SUBMIT,
      targetType: 'feedback',
      targetId: id,
      projectId: input.projectId ?? null,
      // 只记长度，不记正文：反馈内容由用户撰写，可能含联系方式、地址等个人信息，
      // 而 operation_log 的可见范围比反馈列表还宽
      detail: { after: { contentLength: input.content.length, imageCount: saved.length, hasContact: Boolean(input.contact) } },
    })

    return { id, imageCount: saved.length }
  } catch (err) {
    await cleanup(saved)
    throw err
  }
}

/** 补偿删除已落盘的文件。失败只记日志 —— 原始错误才是排查依据 */
async function cleanup(saved) {
  for (const item of saved) {
    await storage.remove(item.url).catch((err) => {
      logger.warn('清理反馈图片失败（会留下孤儿文件）', { url: item.url, message: err.message })
    })
  }
}

/** 后台反馈列表 */
async function list(operator, filters, paging) {
  const { total, rows } = await feedbackModel.listFeedback({
    // 租户账号看本租户；平台持排障授权时 `tenantId` 已被解析为目标租户
    // （见 middlewares/adminAuth.requireTenant）。平台在授权窗口内只读，
    // 因此这里只需要处理读路径。
    tenantId: operator.tenantId ?? null,
    status: filters.status,
    projectId: filters.projectId,
    userId: filters.userId,
    offset: paging.offset,
    limit: paging.limit,
  })

  return {
    list: rows.map(shape),
    total,
  }
}

function shape(row) {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    content: row.content,
    images: normalizeJson(row.images) || [],
    contact: row.contact,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    reply: row.reply,
    handledBy: row.handled_by,
    handledAt: row.handled_at,
    createdAt: row.created_at,
  }
}

/** images 是 JSON 列。mysql2 一般已解析成对象，但列类型一旦变成 TEXT 就是字符串 */
function normalizeJson(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return value
}

/**
 * 处理反馈（后台）。
 *
 * 只允许 `new → processing → resolved`，**不允许退回**：
 * 「已处理」被改回「待处理」在实践中意味着上一次处理被推翻，
 * 而那种情况真正需要的是再提一条反馈或直接在回执里修正说明。
 * 留着退回的口子，统计「待处理数量」时就会出现一条永远在两边跳的记录。
 */
async function handle(id, { status, reply }, operator) {
  if (!HANDLE_STATUS.includes(status)) {
    throw AppError.badRequest('反馈状态只能置为处理中或已处理')
  }

  // 按租户取：不带的话，租户 A 的管理员可以按 id 处理租户 B 的反馈。
  // 平台账号的写操作在 requireTenant 已被拦下，走不到这里
  const scopeTenant = operator.tenantId ?? null
  const before = await feedbackModel.findFeedback(id, scopeTenant)
  if (!before) throw AppError.notFound('反馈不存在')
  if (before.status === 'resolved') throw AppError.conflict('该反馈已处理完毕，无法再次变更')

  const affected = await feedbackModel.handleFeedback({ id, status, reply, handledBy: operator.id })
  if (affected === 0) throw AppError.notFound('反馈不存在')

  await operationLog.record({
    ...operationLog.fromOperator(operator),
    action: operationLog.ACTIONS.FEEDBACK_HANDLE,
    targetType: 'feedback',
    targetId: id,
    projectId: before.project_id,
    detail: { before: { status: before.status }, after: { status, hasReply: Boolean(reply) } },
  })

  return shape(await feedbackModel.findFeedback(id, scopeTenant))
}

module.exports = { MAX_IMAGES, STATUS_LABELS, HANDLE_STATUS, submit, list, handle }
