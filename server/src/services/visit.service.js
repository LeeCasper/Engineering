'use strict'

/**
 * 现场签到（§4.6 / C-6.13 ~ C-6.20 / AC-N17 ~ N28）。
 *
 * ── 三个必须守住的边界 ──
 * 1. 只有项目内 active 的工长 / 监理能签到；业主、管理员一律拒绝。
 * 2. 照片必须由**服务端**叠加水印，且水印里的坐标是提交时最终确定的坐标。
 * 3. 签到记录只追加；同一项目同一人当日只能有一条（数据库唯一键兜底）。
 *
 * ── 照片为什么先暂存 ──
 * 微信小程序的 uni.uploadFile 一次只能带一个文件，而一次签到要 1–3 张。
 * 前端逐张传到 `/visits/media` 拿到 mediaId，提交时在同一个事务里消费。
 * 暂存阶段只存原图，提交时才读原图、生成水印图并写 visit_media。
 *
 * ── 阈值快照 ──
 * `threshold_m` 必须随记录保存。只存 `is_abnormal` 的话，后台改阈值后
 * 历史记录就只能看到结论、看不到「当时按什么标准判的」（AC-N21）。
 */

const AppError = require('../utils/AppError')
const db = require('../db/pool')
const storage = require('../storage')
const watermark = require('../utils/watermark')
const datetime = require('../utils/datetime')
const logger = require('../utils/logger')
const { haversineMeters } = require('../utils/routeOptimizer')
const visitUtil = require('../utils/visit')
const sysConfigService = require('./sysConfig.service')
const mapService = require('./map.service')
const adminNotification = require('./adminNotification.service')
const projectMemberModel = require('../models/projectMember.model')
const projectModel = require('../models/project.model')
const visitRecordModel = require('../models/visitRecord.model')
const visitMediaStagingModel = require('../models/visitMediaStaging.model')
const routePlanModel = require('../models/routePlan.model')

const CHECKIN_ROLES = new Set(['foreman', 'supervisor'])
const MAX_PHOTOS = 3
/**
 * 暂存上限比 3 高：用户可能上传后反悔、网络超时重试，或者提交失败后重试。
 * 提交时仍然严格限制 1–3 张，暂存只是「还没归属的文件」，不是业务记录。
 */
const MAX_STAGED_PHOTOS = 9

const ROLE_LABELS = { foreman: '工长', supervisor: '监理', owner: '业主' }

const REASON_TEXT = {
  ROLE_NOT_ALLOWED: '仅工长与监理可现场签到',
  PROJECT_ARCHIVED: '项目已归档，全部数据只读',
  NO_COORDINATES: '项目尚未设置坐标，请联系管理员补全地址',
  ALREADY_CHECKED_IN: '今日已签到',
}

function hasCoordinates(project) {
  return project.longitude !== null && project.latitude !== null
}

/**
 * 读签到上下文（写入口专用）。
 *
 * 只有工长 / 监理能签到；业主看时间轴 / 今日状态走 `getMeta`，不走这里。
 * 这样写入口只有一套权限判断，不会出现「调用方忘了传 requireRole」的缺口。
 */
async function loadCheckinContext(userId, projectId) {
  const membership = await projectMemberModel.findActiveRole(projectId, userId)
  if (!membership) throw AppError.notFound('项目不存在')

  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')

  if (!CHECKIN_ROLES.has(membership.role)) {
    throw AppError.forbidden('仅工长与监理可签到')
  }
  if (project.status === 'archived') {
    throw AppError.forbidden('项目已归档，全部数据只读')
  }
  if (!hasCoordinates(project)) {
    throw AppError.badRequest('项目尚未设置坐标，请联系管理员补全地址')
  }

  return { project, membership }
}

function mediaView(row) {
  return {
    id: Number(row.id),
    type: row.type,
    // 前端优先展示带水印版本（AC-N18）；原图只在需要时提供
    url: row.watermark_url || row.url,
    originalUrl: row.watermark_url ? row.url : null,
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
  }
}

function toVisitView(row, mediaRows) {
  return {
    id: Number(row.id),
    projectId: Number(row.project_id),
    projectName: row.project_name || undefined,
    signer: {
      id: Number(row.user_id),
      nickname: row.nickname || null,
      avatar: row.avatar || null,
      role: row.user_role || null,
      roleLabel: ROLE_LABELS[row.user_role] || null,
    },
    checkinAt: row.checkin_at,
    latitude: Number(row.checkin_lat),
    longitude: Number(row.checkin_lng),
    distanceM: Number(row.distance_m),
    thresholdM: Number(row.threshold_m),
    isAbnormal: Boolean(row.is_abnormal),
    abnormalReason: row.abnormal_reason || null,
    remark: row.remark || null,
    route:
      row.route_plan_id === null || row.route_plan_id === undefined
        ? null
        : { planId: Number(row.route_plan_id), seqInPlan: Number(row.seq_in_plan) },
    media: (mediaRows || []).map(mediaView),
  }
}

async function loadVisitView(visitId) {
  const row = await visitRecordModel.findDetailRow(visitId)
  if (!row) throw AppError.notFound('签到记录不存在')

  const mediaMap = await visitRecordModel.loadMedia([row.id])
  return toVisitView(row, mediaMap.get(Number(row.id)) || [])
}

/**
 * 签到页引导信息。
 *
 * meta 对业主也开放：业主点进时间轴 / 今日记录时需要知道「今天是否已签到」，
 * 但 `canCheckin` 会是 false。真正提交时仍然由 submitVisit 抛 403。
 */
async function getMeta(userId, projectId) {
  const membership = await projectMemberModel.findActiveRole(projectId, userId)
  if (!membership) throw AppError.notFound('项目不存在')

  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')

  // B-5.1：项目可单独覆盖阈值。这里必须用项目视角读取 ——
  // 只读租户配置的话，项目把阈值调到 300 米后签到页仍会提示 500 米，
  // 而服务端判定却按项目值走，界面与判定各说各话
  const thresholdM = await sysConfigService.getIntForProject(
    projectId,
    project.tenant_id,
    'sign_in_distance_threshold'
  )

  const todayRow = await visitRecordModel.findByProjectUserDate(
    projectId,
    userId,
    datetime.formatDate()
  )
  const todayVisit = todayRow ? await loadVisitView(todayRow.id) : null

  let reason = null
  if (!CHECKIN_ROLES.has(membership.role)) reason = 'ROLE_NOT_ALLOWED'
  else if (project.status === 'archived') reason = 'PROJECT_ARCHIVED'
  else if (!hasCoordinates(project)) reason = 'NO_COORDINATES'
  else if (todayVisit) reason = 'ALREADY_CHECKED_IN'

  return {
    projectId: Number(project.id),
    projectName: project.name,
    address: project.address,
    latitude: project.latitude === null ? null : Number(project.latitude),
    longitude: project.longitude === null ? null : Number(project.longitude),
    hasCoordinates: hasCoordinates(project),
    myRole: membership.role,
    canCheckin: reason === null,
    reason,
    reasonText: reason ? REASON_TEXT[reason] || '暂不可签到' : null,
    thresholdM,
    maxPhotos: MAX_PHOTOS,
    serverTime: datetime.format(),
    todayVisit,
  }
}

/**
 * 单文件暂存。
 *
 * 暂存阶段不生成水印：水印需要「签到坐标」，而坐标在提交时才最终确定。
 * 如果这里用水印，用户提交时的坐标可能已经被 GPS 刷新，水印内容与记录就不一致了。
 */
async function stageMedia(userId, projectId, { file }) {
  const { project } = await loadCheckinContext(userId, projectId)

  if (!file) throw AppError.badRequest('请选择要上传的照片')
  if (file.type !== 'image') throw AppError.badRequest('签到只支持上传照片')

  const staged = await visitMediaStagingModel.countStaged({ userId, projectId })
  if (staged >= MAX_STAGED_PHOTOS) {
    throw AppError.badRequest('未提交的照片过多，请先完成本次签到或稍后再试')
  }

  const saved = await storage.save(file.buffer, {
    category: 'visits',
    ext: file.ext,
  })

  let mediaId
  try {
    mediaId = await visitMediaStagingModel.create({
      projectId: project.id,
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

  return {
    mediaId,
    type: 'image',
    url: saved.url,
    maxPhotos: MAX_PHOTOS,
  }
}

async function cleanupKeys(keys) {
  for (const key of keys) {
    await storage.remove(key)
  }
}

function assertMediaIds(mediaIds) {
  const ids = Array.isArray(mediaIds) ? mediaIds.map(Number) : []
  if (ids.length === 0) throw AppError.badRequest('请至少上传 1 张现场照片')
  if (ids.length > MAX_PHOTOS) {
    throw AppError.badRequest(`现场照片最多 ${MAX_PHOTOS} 张`)
  }
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw AppError.badRequest('照片 ID 不合法')
  }
  if (new Set(ids).size !== ids.length) {
    throw AppError.badRequest('照片不能重复')
  }
  return ids
}

function indexStaged(rows) {
  return new Map(rows.map((row) => [Number(row.id), row]))
}

function validateStagedRows(rows, ids, { projectId, userId }) {
  if (rows.length !== ids.length) {
    throw AppError.badRequest('照片不存在或已失效，请重新上传')
  }
  const byId = indexStaged(rows)
  const ordered = []

  for (const id of ids) {
    const row = byId.get(Number(id))
    if (
      !row ||
      Number(row.project_id) !== Number(projectId) ||
      Number(row.user_id) !== Number(userId) ||
      row.status !== 'staged'
    ) {
      throw AppError.badRequest('照片不存在或已失效，请重新上传')
    }
    ordered.push(row)
  }

  return ordered
}

async function resolveRoutePoint({ userId, projectId, routePlanId, seqInPlan }) {
  const hasPlan = routePlanId !== undefined && routePlanId !== null && routePlanId !== ''
  const hasSeq = seqInPlan !== undefined && seqInPlan !== null && seqInPlan !== ''

  if (hasPlan !== hasSeq) {
    throw AppError.badRequest('考察计划与站点序号必须同时提供')
  }
  if (!hasPlan) return null

  const planId = Number(routePlanId)
  const seq = Number(seqInPlan)
  if (!Number.isInteger(planId) || planId <= 0 || !Number.isInteger(seq) || seq <= 0) {
    throw AppError.badRequest('考察计划参数不合法')
  }

  const point = await routePlanModel.findOwnedPoint({
    planId,
    ownerId: userId,
    seq,
  })
  if (!point) throw AppError.badRequest('考察计划中没有该站点')
  if (Number(point.project_id) !== Number(projectId)) {
    throw AppError.badRequest('签到项目与考察计划不匹配')
  }

  return { planId, seq }
}

async function notifyAbnormal({ project, visit }) {
  const signerName = visit.signer.nickname || '项目成员'
  const content =
    `「${project.name}」${signerName} 于 ${visit.checkinAt} 签到，` +
    `距项目 ${Math.round(visit.distanceM)} 米（阈值 ${Math.round(visit.thresholdM)} 米）。` +
    `说明：${visit.abnormalReason || '未填写'}`

  await adminNotification
    .notifyProjectAdmin({
      projectId: project.id,
      title: '异常签到提醒',
      content: content.slice(0, 500),
      refType: 'visit',
      refId: visit.id,
    })
    .catch((err) => {
      // 通知失败不影响签到本身，但必须留下日志
      logger.error('异常签到通知发送失败', {
        visitId: visit.id,
        projectId: project.id,
        message: err.message,
      })
    })
}

/**
 * 提交签到。
 *
 * @param {number} userId
 * @param {number} projectId
 * @param {object} input
 * @param {object} [options]
 * @param {object} [options.now] 测试注入时间，生产不传
 */
async function submitVisit(userId, projectId, input, { now = datetime.now() } = {}) {
  const { project } = await loadCheckinContext(userId, projectId)
  const coords = visitUtil.normalizeCoordinates(input)
  const mediaIds = assertMediaIds(input.mediaIds)
  const routePoint = await resolveRoutePoint({
    userId,
    projectId,
    routePlanId: input.routePlanId,
    seqInPlan: input.seqInPlan,
  })

  // B-5.1：项目覆盖 > 租户配置 > 平台基础 > 默认值。
  // 判定的阈值同时写进 `visit_record.threshold_m` 快照（AC-N21），
  // 后续改配置不会回溯改写这条记录
  const thresholdM = await sysConfigService.getIntForProject(
    projectId,
    project.tenant_id,
    'sign_in_distance_threshold'
  )
  const distanceM = haversineMeters(
    { latitude: project.latitude, longitude: project.longitude },
    coords
  )
  const isAbnormal = visitUtil.isAbnormalDistance(distanceM, thresholdM)

  const abnormalReason = String(input.abnormalReason || '').trim()
  const remark = String(input.remark || '').trim()

  if (isAbnormal && !abnormalReason) {
    throw AppError.badRequest(
      `签到位置与项目地址偏差约 ${Math.round(distanceM)} 米，超过 ${thresholdM} 米阈值，请填写说明`,
      { detail: { distance: Number(distanceM.toFixed(2)), threshold: thresholdM } }
    )
  }

  const checkinAt = datetime.toDb(now)
  const dateKey = datetime.formatDate(now)

  // 预检：命中直接 409，不生成水印、不浪费 CPU。
  // 真正的并发兜底仍然是 uk_visit_daily，见下面的 ER_DUP_ENTRY 处理。
  const existing = await visitRecordModel.findByProjectUserDate(projectId, userId, dateKey)
  if (existing) {
    throw AppError.conflict('今日已签到', { detail: { visitId: Number(existing.id) } })
  }

  const stagedRows = await visitMediaStagingModel.findByIds(mediaIds)
  const ordered = validateStagedRows(stagedRows, mediaIds, { projectId, userId })

  // 水印里除了坐标，还要有「签到位置」的文字地址。
  // 逆地理编码失败时不编造地址：保留坐标，水印写「实时地址未解析」。
  let locationAddress = null
  try {
    locationAddress = await mapService.reverseGeocode(coords)
  } catch (err) {
    logger.warn('签到位置逆地理编码失败，水印保留坐标', { message: err.message })
  }

  // ── 事务外生成水印文件 ──
  // sharp 处理 1–3 张图可能要几百毫秒；放进事务会长时间持有暂存行锁。
  // 失败时把已经生成的文件删掉，暂存原图保持 staged，用户可以原样重试。
  const prepared = []
  const createdKeys = []
  try {
    for (const row of ordered) {
      let buffer
      try {
        buffer = await storage.read(row.url)
      } catch (err) {
        throw AppError.badRequest('照片已失效，请重新上传')
      }

      const marked = await watermark.apply(buffer, {
        lines: visitUtil.buildWatermarkLines({
          checkinAt,
          address: project.address,
          locationAddress,
          latitude: coords.latitude,
          longitude: coords.longitude,
        }),
      })
      const saved = await storage.save(marked, {
        category: 'visits',
        ext: row.ext || visitUtil.extractExtension(row.url),
      })
      createdKeys.push(saved.key)

      prepared.push({
        url: row.url,
        watermarkUrl: saved.url,
        sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
        width: null,
        height: null,
      })
    }
  } catch (err) {
    await cleanupKeys(createdKeys)
    throw err
  }

  let visitId
  try {
    visitId = await db.withTransaction(async (tx) => {
      // 重新加锁并校验：从生成水印到进入事务之间，可能已经有另一个请求
      // 消费了同一批照片，或者清理任务把它们认领成了 expired。
      const lockedRows = await visitMediaStagingModel.findByIdsForUpdate(tx, mediaIds)
      validateStagedRows(lockedRows, mediaIds, { projectId, userId })

      const id = await visitRecordModel.create(
        {
          projectId,
          userId,
          routePlanId: routePoint ? routePoint.planId : null,
          seqInPlan: routePoint ? routePoint.seq : null,
          checkinAt,
          checkinLat: coords.latitude,
          checkinLng: coords.longitude,
          distanceM: distanceM.toFixed(2),
          thresholdM: Number(thresholdM).toFixed(2),
          isAbnormal,
          abnormalReason: isAbnormal ? abnormalReason : null,
          remark: remark || null,
        },
        tx
      )

      await visitRecordModel.addMedia(
        prepared.map((item) => ({
          visitId: id,
          url: item.url,
          watermarkUrl: item.watermarkUrl,
          sizeBytes: item.sizeBytes,
          width: item.width,
          height: item.height,
        })),
        tx
      )

      const used = await visitMediaStagingModel.markUsed(tx, mediaIds, id)
      if (used !== mediaIds.length) {
        throw AppError.conflict('照片状态已变化，请重新上传后再提交')
      }

      if (routePoint) {
        await routePlanModel.markPointVisited(
          {
            planId: routePoint.planId,
            seq: routePoint.seq,
            projectId,
            visitedAt: checkinAt,
          },
          tx
        )
      }

      return id
    })
  } catch (err) {
    await cleanupKeys(createdKeys)

    // 并发下两个请求都通过了预检，数据库唯一键会拦住后一个。
    // 这里只翻译 uk_visit_daily，其他唯一键冲突照常交给全局错误处理。
    const message = String(err.sqlMessage || err.message || '')
    if (
      (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) &&
      message.includes('uk_visit_daily')
    ) {
      throw AppError.conflict('今日已签到')
    }
    throw err
  }

  const visit = await loadVisitView(visitId)
  if (isAbnormal) {
    await notifyAbnormal({ project, visit })
  }
  return visit
}

/** 项目考察记录列表（任何 active 成员可读，包含业主） */
async function listVisits(userId, projectId, { paging }) {
  const membership = await projectMemberModel.findActiveRole(projectId, userId)
  if (!membership) throw AppError.notFound('项目不存在')

  const { total, rows } = await visitRecordModel.listByProject({
    projectId,
    offset: paging.offset,
    limit: paging.limit,
  })
  const mediaMap = await visitRecordModel.loadMedia(rows.map((row) => row.id))

  return {
    list: rows.map((row) => toVisitView(row, mediaMap.get(Number(row.id)) || [])),
    total,
    page: paging.page,
    pageSize: paging.pageSize,
  }
}

/** 单条签到记录。按记录反查项目后校验成员，非成员与不存在同一句提示 */
async function getVisit(userId, visitId) {
  const row = await visitRecordModel.findById(visitId)
  if (!row) throw AppError.notFound('签到记录不存在')

  const membership = await projectMemberModel.findActiveRole(row.project_id, userId)
  if (!membership) throw AppError.notFound('签到记录不存在')

  return loadVisitView(visitId)
}

module.exports = {
  getMeta,
  stageMedia,
  submitVisit,
  listVisits,
  getVisit,
  MAX_PHOTOS,
  MAX_STAGED_PHOTOS,
}
