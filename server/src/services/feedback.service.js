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
const feedbackMediaStagingModel = require('../models/feedbackMediaStaging.model')
const projectMemberModel = require('../models/projectMember.model')
const operationLog = require('./operationLog.service')

/**
 * 单条反馈最多几张图。
 *
 * 与汇报附件（可配的 9 张）分开：反馈是「顺手截个图」的场景，
 * 3 张足够说清一个问题，而放开到 9 张只会让运维花更多时间看无关截图。
 * 不放进 sys_config：它没有需要运营调整的理由。
 */
const MAX_IMAGES = 3

/**
 * 允许同时在途（已暂存、还没提交）的图片数。
 *
 * 微信一次只能传一个文件，用户选满 3 张就是 3 次上传；给 3 倍的余量，
 * 既够「换掉两张重选」，又不至于让一个人无限往磁盘上堆图。
 */
const MAX_STAGED_IMAGES = MAX_IMAGES * 3

const HANDLE_STATUS = ['processing', 'resolved']

const STATUS_LABELS = { new: '待处理', processing: '处理中', resolved: '已处理' }

/**
 * 单张图片暂存（实现补充）。
 *
 * 微信小程序的 `uni.uploadFile` 一次只能带一个文件，而 AC-U18 允许最多 3 张。
 * 前端逐张传到本接口拿到 `mediaId`，提交反馈时用 `mediaIds` 一次性消费 ——
 * 与进度汇报、现场签到照片走同一套模式。
 *
 * @param {number} userId
 * @param {object} file multer 归一化后的单个文件
 */
async function stageMedia(userId, file) {
  if (!file) throw AppError.badRequest('请选择要上传的图片')
  if (file.type !== 'image') throw AppError.badRequest('意见反馈只支持上传图片')

  const staged = await feedbackMediaStagingModel.countStaged(userId)
  if (staged >= MAX_STAGED_IMAGES) {
    throw AppError.badRequest('未提交的图片过多，请先提交本次反馈或稍后再试')
  }

  const saved = await storage.save(file.buffer, { category: 'feedback', ext: file.ext })

  let mediaId
  try {
    mediaId = await feedbackMediaStagingModel.create({
      userId,
      ext: file.ext,
      url: saved.url,
      sizeBytes: saved.sizeBytes,
    })
  } catch (err) {
    // 元数据没写成功，文件不能留在盘上
    await storage.remove(saved.key)
    throw err
  }

  return { mediaId, url: saved.url, maxImages: MAX_IMAGES }
}

/**
 * 提交反馈（AC-U18）。
 *
 * @param {number} userId
 * @param {object} input content / projectId / contact
 * @param {Array} files multer 归一化后的文件（兼容「一次 multipart 带齐」的老调用方）
 * @param {object} operator 审计上下文
 * @param {Array<number>} mediaIds 逐张暂存的图片 ID（小程序传图走这条）
 */
async function submit(userId, input, files, operator, mediaIds = []) {
  // 反馈归属的租户：带了项目就按项目定；否则按用户所属租户。
  // 两者都没有（不属于任何租户的用户）才落成平台级反馈。
  let tenantId = null
  if (input.projectId) {
    // 项目 id 不能直接决定租户：先确认调用者是该项目的 active 成员。
    // 否则任何微信用户都能把反馈和 feedback.submit 审计写进别人的租户。
    const membership = await projectMemberModel.findActiveRole(input.projectId, userId)
    if (!membership) throw AppError.forbidden('无权对该项目提交反馈')
    const row = await db.queryOne('SELECT tenant_id FROM project WHERE id = ? AND deleted_at IS NULL', [
      input.projectId,
    ])
    tenantId = row ? row.tenant_id : null
  } else {
    const { resolveTenant } = require('./subscription.service')
    // 用户只属于一个租户时自动归属；属于多个时要求显式传 tenantId
    tenantId = await resolveTenant(userId, input.tenantId).catch(() => null)
  }

  const directImages = files.filter((f) => f.type === 'image')
  // 两种方式互斥：同时存在时无法判断「以哪一份为准」，
  // 静默二选一会让调用方以为自己的图片被采纳了
  if (directImages.length > 0 && mediaIds.length > 0) {
    throw AppError.badRequest('图片文件与 mediaIds 只能二选一')
  }
  if (mediaIds.length > MAX_IMAGES) {
    throw AppError.badRequest(`最多上传 ${MAX_IMAGES} 张图片`)
  }
  if (directImages.length > MAX_IMAGES) {
    throw AppError.badRequest(`最多上传 ${MAX_IMAGES} 张图片`)
  }

  // 逐张上传路径：图片在提交前就已经落盘，先把文件存好，
  // 写库失败时要补偿删除（文件系统不参与事务）
  const saved = []
  if (mediaIds.length === 0) {
    try {
      for (const file of directImages) {
        const result = await storage.save(file.buffer, { category: 'feedback', ext: file.ext })
        saved.push({ url: result.url })
      }
    } catch (err) {
      // 第 2 张失败时第 1 张已经落盘了。不补偿删除的话，每次失败都在磁盘上
      // 留一批永远不会被引用的孤儿文件
      await cleanup(saved)
      throw err
    }
  }

  try {
    const id = await db.withTransaction(async (tx) => {
      // 暂存图片：在事务内重读并加行锁，确认仍是本人、仍是 staged。
      // 不加锁的话，同一条暂存行可能被两个并发提交同时消费。
      const images = mediaIds.length
        ? await pickStagedImages(tx, userId, mediaIds)
        : saved

      const feedbackId = await feedbackModel.createFeedback(
        {
          userId,
          // 有项目就归项目的租户；没有则是提给平台的（tenant_id 为 null）
          tenantId: tenantId ?? null,
          projectId: input.projectId ?? null,
          content: input.content,
          images,
          contact: input.contact ?? null,
        },
        tx
      )

      if (mediaIds.length > 0) {
        const used = await feedbackMediaStagingModel.markUsed(tx, mediaIds, feedbackId)
        if (used !== mediaIds.length) {
          // 有行在这期间不再是 staged —— 整笔回滚，让用户重新选择图片
          throw AppError.conflict('图片已失效或被使用，请重新选择')
        }
      }

      return feedbackId
    })

    await operationLog.record({
      ...operationLog.fromOperator(operator),
      action: operationLog.ACTIONS.FEEDBACK_SUBMIT,
      targetType: 'feedback',
      targetId: id,
      projectId: input.projectId ?? null,
      // 只记长度，不记正文：反馈内容由用户撰写，可能含联系方式、地址等个人信息，
      // 而 operation_log 的可见范围比反馈列表还宽
      detail: {
        after: {
          contentLength: input.content.length,
          imageCount: mediaIds.length || saved.length,
          hasContact: Boolean(input.contact),
        },
      },
    })

    return { id, imageCount: mediaIds.length || saved.length }
  } catch (err) {
    // 只有「本次调用亲自落盘」的文件才需要补偿删除；
    // 暂存图片属于用户，失败后还要能重试，不能顺手删掉
    await cleanup(saved)
    throw err
  }
}

/**
 * 读取并校验暂存图片，按**用户选择顺序**返回。
 *
 * 数据库按 id 升序返回，直接拿来用会把用户挑选的顺序打乱；
 * 反馈截图的顺序本身就是描述问题的一部分。
 */
async function pickStagedImages(tx, userId, mediaIds) {
  const rows = await feedbackMediaStagingModel.findByIdsForUpdate(tx, mediaIds)
  if (rows.length !== mediaIds.length) {
    throw AppError.badRequest('部分图片已失效，请重新选择')
  }

  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  return mediaIds.map((id) => {
    const row = byId.get(Number(id))
    // 归属校验与状态校验放在同一次读取里：任何一条不满足都拒绝整笔提交，
    // 否则会出现「3 张里只有 2 张落库」的静默丢图
    if (!row || Number(row.user_id) !== Number(userId) || row.status !== 'staged') {
      throw AppError.badRequest('图片已失效，请重新选择')
    }
    return { url: row.url }
  })
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
    // 后台前端声明的是 `images: string[]`，直接 `:src="image"` 渲染。
    // 库里存的是 `[{ url }]`（与验收照片等一致），在这里转成纯 URL ——
    // 不转的话列表拿到的是对象，ElImage 的 src 会变成 "[object Object]"
    images: imageUrls(row.images),
    contact: row.contact,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    reply: row.reply,
    handledBy: row.handled_by,
    handledAt: row.handled_at,
    createdAt: row.created_at,
  }
}

function imageUrls(value) {
  const list = normalizeJson(value) || []
  return list
    .map((item) => (typeof item === 'string' ? item : item && item.url))
    .filter(Boolean)
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

module.exports = {
  MAX_IMAGES,
  MAX_STAGED_IMAGES,
  STATUS_LABELS,
  HANDLE_STATUS,
  stageMedia,
  submit,
  list,
  handle,
}
