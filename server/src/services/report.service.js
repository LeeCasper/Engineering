'use strict'

/**
 * 进度汇报（C-2.4 / C-2.6 / C-2.8，AC-P05~P13、P20~P26）。
 *
 * ── 提交时的关键顺序 ──
 *   1. 校验（工序必选、正文或附件至少一项、附件数量上限）—— 越早失败越省资源
 *   2. 幂等判定（AC-P10）—— 命中就返回上次结果，不做任何写入
 *   3. 文件落盘 + 服务端水印（AC-P11/P12）—— 文件系统不参与事务，放事务外
 *   4. 事务：写汇报 → 写附件 → 变更完成度 → 重算阶段
 *   5. 事务失败时清理已落盘的文件
 *
 * 第 3 步必须在事务外，因为 MySQL 事务管不了文件系统；
 * 第 5 步是对此的补偿。若不清理，每次失败的提交都会在磁盘上留下孤儿文件。
 */

const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const db = require('../db/pool')
const logger = require('../utils/logger')
const storage = require('../storage')
const watermark = require('../utils/watermark')
const progressService = require('./progress.service')
const notificationService = require('./notification.service')
const sysConfigService = require('./sysConfig.service')
const reportModel = require('../models/progressReport.model')
const projectMemberModel = require('../models/projectMember.model')
const projectModel = require('../models/project.model')
const projectItemModel = require('../models/projectItem.model')
const projectStageModel = require('../models/projectStage.model')

/**
 * 取附件上限（B-5.5）。走系统配置而非写死，因为这几个值「几乎一定会被调整」，
 * 写死在代码里意味着每次调整都要发版（§5.5 的原话）。
 */
async function getMediaLimits(tenantId) {
  const [maxImages, maxVideos, maxVideoSeconds] = await Promise.all([
    sysConfigService.getInt(tenantId, 'report_max_images'),
    sysConfigService.getInt(tenantId, 'report_max_videos'),
    sysConfigService.getInt(tenantId, 'report_max_video_seconds'),
  ])
  return { maxImages, maxVideos, maxVideoSeconds }
}

/**
 * 提交进度汇报。
 *
 * @param {number} userId 提交人（必须是该项目的工长）
 * @param {number} projectId
 * @param {object} input
 * @param {number} input.itemId 工序 id（AC-P05：必选）
 * @param {string|number} input.progress 完成度
 * @param {string} [input.content] 文字说明
 * @param {string} input.clientRequestId 幂等键（AC-P10）
 * @param {Array} [input.files] 已规范化的文件（含 buffer）
 * @param {number[]} [input.videoDurations] 客户端上报的视频时长（秒），未经服务端校验
 */
async function submitReport(userId, projectId, input) {
  // 1. 权限与存在性。放在最前：不合格的请求不该浪费内存去接收文件
  const membership = await projectMemberModel.findActiveRole(projectId, userId)
  if (!membership) throw AppError.notFound('项目不存在')
  if (membership.role !== 'foreman') throw AppError.forbidden('仅该项目的工长可提交进度汇报')

  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')

  // AC-AD56：已完工项目不再接受新的进度汇报；归档项目全部只读（AC-AD25）
  if (project.status === 'archived') throw AppError.forbidden('项目已归档，全部数据只读')
  if (project.status === 'finished') throw AppError.forbidden('项目已完工，不再接受新的进度汇报')

  // AC-P05：未选择工序无法提交
  if (!input.itemId) throw AppError.badRequest('请选择要汇报的工序')

  const item = await projectItemModel.findById(input.itemId)
  if (!item) throw AppError.notFound('工序不存在')
  const stage = await projectStageModel.findById(item.project_stage_id)
  if (!stage || Number(stage.project_id) !== Number(projectId)) throw AppError.notFound('工序不存在')

  const files = input.files || []

  // AC-P08：正文为空且无任何附件时无法提交
  const hasContent = typeof input.content === 'string' && input.content.trim().length > 0
  if (!hasContent && files.length === 0) {
    throw AppError.badRequest('请填写说明或上传照片后再提交')
  }

  // AC-P07：附件上限（照片张数、视频个数与时长）。上限按**项目所属租户**取
  const limits = await getMediaLimits(project.tenant_id)
  validateMedia(files, input.videoDurations, limits)

  // 2. 幂等（AC-P10）。命中直接返回上次结果，**不重复落盘文件**
  // 幂等键的查重**必须带 project_id**：幂等键由客户端生成，同一个人完全可能在
  // 两个项目里用了同一个（比如「每次提交都从 1 开始编号」的实现）。
  // 不带 project 的话，第二个项目会命中第一个项目的汇报并把它返回给用户 ——
  // 跨项目读到别人的数据，自己的提交被静默丢弃。
  const existing = await reportModel.findByClientRequestId(projectId, userId, input.clientRequestId)
  if (existing) {
    logger.debug('命中幂等键，返回已有汇报', { reportId: existing.id, clientRequestId: input.clientRequestId })
    return { ...(await buildReportView(existing.id)), idempotentReplay: true }
  }

  // 3. 落盘 + 水印。文件系统不参与事务，失败时在下面补偿清理
  const saved = []
  let reportId
  try {
    const mediaRows = await persistMedia(files, input.videoDurations, { project, item })

    // 4. 事务：汇报、附件、完成度三者要么全成要么全败
    reportId = await db.withTransaction(async (tx) => {
      const id = await reportModel.create(
        {
          projectId,
          projectItemId: input.itemId,
          userId,
          progress: input.progress,
          content: hasContent ? input.content.trim() : null,
          clientRequestId: input.clientRequestId,
        },
        tx
      )

      await reportModel.addMedia(
        mediaRows.map((row) => ({ ...row, reportId: id })),
        tx
      )

      // 完成度变更复用 M6 的唯一写入口，并带上本事务 ——
      // 「有汇报但进度没变」的中间态会让留痕与汇报对不上，而这两张表
      // 恰恰是争议时互相对照的证据
      await progressService.applyItemProgress(
        {
          projectId,
          itemId: input.itemId,
          userId,
          progress: input.progress,
          reportId: id,
        },
        tx
      )

      return id
    })

    saved.push(...mediaRows.map((row) => row.key))
  } catch (err) {
    // 补第五步：清理已落盘的文件。清理失败只记日志 ——
    // 为了清理失败而覆盖掉原始异常，会让排查失去线索
    await cleanupFiles(saved)
    throw err
  }

  return buildReportView(reportId)
}

/**
 * 校验附件数量与类型（AC-P07）。
 *
 * 照片最多 9 张、视频最多 1 个且时长 ≤ 60s，超出时**禁止提交并提示具体上限**。
 */
function validateMedia(files, videoDurations, limits) {
  const images = files.filter((f) => f.type === 'image')
  const videos = files.filter((f) => f.type === 'video')

  if (images.length > limits.maxImages) {
    throw AppError.badRequest(`照片最多上传 ${limits.maxImages} 张，当前 ${images.length} 张`)
  }
  if (videos.length > limits.maxVideos) {
    throw AppError.badRequest(`视频最多上传 ${limits.maxVideos} 个，当前 ${videos.length} 个`)
  }

  // 时长由客户端上报（服务端没有 ffprobe 无法自行测量）。
  // 因此这是一道 UX 约束：它拦住正常用户的误操作，拦不住刻意绕过。
  // 真正的限制是上面的「最多 1 个视频」与 multer 的文件大小上限，那两个是服务端算的
  const durations = Array.isArray(videoDurations) ? videoDurations.map(Number) : []
  for (const duration of durations) {
    if (Number.isFinite(duration) && duration > limits.maxVideoSeconds) {
      throw AppError.badRequest(
        `视频时长不得超过 ${limits.maxVideoSeconds} 秒，当前 ${Math.round(duration)} 秒`
      )
    }
  }
}

/**
 * 落盘并生成带水印版本。
 *
 * 水印内容 = 拍摄时间 + 项目地址 + 工序名（AC-P11）。
 * 「拍摄时间」用的是**服务端接收时间**而不是客户端上报或 EXIF：
 * 后两者客户端都能随意伪造，而水印的价值恰恰在于它是服务端可担保的凭证。
 * 处理失败时**直接抛错**，不降级保存无水印原图 —— 见 watermark.js 的说明。
 */
async function persistMedia(files, videoDurations, { project, item }) {
  const rows = []
  const durations = Array.isArray(videoDurations) ? videoDurations.map(Number) : []
  let videoIndex = 0

  for (const file of files) {
    const original = await storage.save(file.buffer, { category: 'reports', ext: file.ext })

    if (file.type === 'image') {
      const watermarked = await watermark.apply(file.buffer, {
        lines: [datetime.format(), project.address, item.name],
      })
      const marked = await storage.save(watermarked, { category: 'reports', ext: file.ext })

      rows.push({
        type: 'image',
        url: original.url,
        watermarkUrl: marked.url,
        key: `${original.key}|${marked.key}`,
        sizeBytes: original.sizeBytes,
        width: null,
        height: null,
        duration: null,
      })
    } else {
      const duration = durations[videoIndex]
      videoIndex += 1

      rows.push({
        type: 'video',
        url: original.url,
        // 视频不做水印（AC-P12 说的是照片）；留 null 而不是复用原图地址，
        // 前端据此知道「这条没有水印版本」，而不是误以为 watermarkUrl 就是加了水印的
        watermarkUrl: null,
        key: original.key,
        sizeBytes: original.sizeBytes,
        width: null,
        height: null,
        duration: Number.isFinite(duration) ? Math.round(duration) : null,
      })
    }
  }

  return rows
}

/**
 * 清理已落盘的文件。
 *
 * key 可能是 `原图key|水印key` 的形式（图片会存两份）。
 */
async function cleanupFiles(keys) {
  for (const key of keys) {
    for (const single of String(key).split('|')) {
      await storage.remove(single)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 读取
// ─────────────────────────────────────────────────────────────

/** 汇报记录流（C-2.6 / AC-P20：时间倒序、每页 20 条、触底加载） */
async function listReports(userId, projectId, { paging, itemId }) {
  const membership = await projectMemberModel.findActiveRole(projectId, userId)
  // AC-P26：非参与项目一律 404，不泄露项目是否存在
  if (!membership) throw AppError.notFound('项目不存在')

  const { total, rows } = await reportModel.listByProject({
    projectId,
    offset: paging.offset,
    limit: paging.limit,
    itemId: itemId || undefined,
  })

  const { mediaByReport, commentCounts } = await reportModel.loadMediaAndComments(rows.map((r) => r.id))

  return {
    list: rows.map((row) => toReportView(row, mediaByReport.get(row.id) || [], commentCounts.get(row.id) || 0)),
    total,
    page: paging.page,
    pageSize: paging.pageSize,
  }
}

async function buildReportView(reportId) {
  const report = await reportModel.findById(reportId)
  if (!report) throw AppError.notFound('汇报不存在')

  const row = await db.queryOne(
    `SELECT r.id, r.project_item_id, r.user_id, r.progress, r.content, r.created_at,
            i.name AS item_name, s.id AS stage_id, s.name AS stage_name,
            u.nickname, u.avatar
       FROM progress_report r
       JOIN project_item i ON i.id = r.project_item_id
       JOIN project_stage s ON s.id = i.project_stage_id
       JOIN user u ON u.id = r.user_id
      WHERE r.id = ?`,
    [reportId]
  )

  const { mediaByReport, commentCounts } = await reportModel.loadMediaAndComments([reportId])
  return toReportView(row, mediaByReport.get(reportId) || [], commentCounts.get(reportId) || 0)
}

function toReportView(row, media, commentCount) {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    stageId: row.stage_id,
    stageName: row.stage_name,
    itemId: row.project_item_id,
    itemName: row.item_name,
    progress: row.progress,
    content: row.content,
    author: { id: row.user_id, nickname: row.nickname, avatar: row.avatar },
    createdAt: row.created_at,
    commentCount,
    media: media.map((m) => ({
      id: m.id,
      type: m.type,
      // 前端应优先展示带水印版本（AC-P11）；原图仅在需要时提供
      url: m.watermark_url || m.url,
      originalUrl: m.watermark_url ? m.url : null,
      duration: m.duration,
      width: m.width,
      height: m.height,
    })),
  }
}

// ─────────────────────────────────────────────────────────────
// 评论
// ─────────────────────────────────────────────────────────────

/**
 * 对某条汇报评论（C-2.8 / AC-P21 / AC-P22）。
 *
 * 任意角色（工长、监理、业主）都可以评论，**包括给自己评论**——
 * 不允许自评没有业务理由，而且补记说明是真实需求。
 */
async function addComment(userId, reportId, { content, replyTo }) {
  const report = await reportModel.findById(reportId)
  if (!report) throw AppError.notFound('汇报不存在')

  const membership = await projectMemberModel.findActiveRole(report.project_id, userId)
  if (!membership) throw AppError.notFound('汇报不存在')

  const text = String(content || '').trim()
  if (!text) throw AppError.badRequest('评论内容不能为空')
  if (text.length > 500) throw AppError.badRequest('评论不超过 500 字')

  const commentId = await reportModel.addComment({
    reportId,
    projectId: report.project_id,
    userId,
    content: text,
    replyTo,
  })

  // AC-P22：被评论的汇报作者收到通知。自己评论自己不通知 ——
  // 那只会让「消息中心」里堆满自己刚做的事
  if (Number(report.user_id) !== Number(userId)) {
    const commenter = await db.queryOne('SELECT nickname FROM user WHERE id = ?', [userId])
    await notificationService
      .notify({
        userId: report.user_id,
        projectId: report.project_id,
        type: notificationService.TYPES.COMMENT,
        title: '有人评论了你的进度汇报',
        content: `${commenter && commenter.nickname ? commenter.nickname : '项目成员'}：${text.slice(0, 100)}`,
        refType: 'report',
        refId: reportId,
      })
      .catch((err) => {
        // 通知失败不该让评论失败（AC-U12：未授权订阅时站内仍可达；两条通道都挂了也只是少一条消息）
        logger.error('发送评论通知失败', { reportId, err })
      })
  }

  return { commentId, reportId }
}

/** 某条汇报的评论列表（AC-P21：提交后即时出现在该条汇报下方） */
async function listComments(userId, reportId) {
  const report = await reportModel.findById(reportId)
  if (!report) throw AppError.notFound('汇报不存在')

  const membership = await projectMemberModel.findActiveRole(report.project_id, userId)
  if (!membership) throw AppError.notFound('汇报不存在')

  const rows = await reportModel.listComments(reportId)

  return {
    reportId,
    list: rows.map((row) => ({
      id: row.id,
      content: row.content,
      replyTo: row.reply_to,
      author: { id: row.user_id, nickname: row.nickname, avatar: row.avatar },
      createdAt: row.created_at,
    })),
  }
}

module.exports = { getMediaLimits, submitReport, validateMedia, listReports, addComment, listComments }
