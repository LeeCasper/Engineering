'use strict'

/**
 * 验收单状态机与流转（§4.3 / AC-A01 ~ AC-A26）。
 *
 * ── 状态机（§4.3.1）──
 *
 *   草稿 draft ──自检提交──→ 待监理审核 pending_supervisor ──通过──→ 待业主确认 pending_owner ──通过+签名──→ 已通过 passed（终态）
 *                                  │ 驳回                                        │ 驳回
 *                                  └──────→ 待整改 pending_rectify ←──────────────┘
 *                                                   │ 工长重新提交
 *                                                   └──→ 回到流程首环节
 *
 *   项目未配置监理时跳过监理环节：提交后直接进入 pending_owner（AC-A05）。
 *
 * ── 三处必须守住的边界 ──
 *   1. **终态不可再操作**（AC-A06）—— passed 之后任何 approve / reject 一律拒绝；
 *   2. **流转记录只追加**（AC-A14 / AC-A26）—— 驳回重提不覆盖历史，
 *      acceptance.model 刻意不导出任何修改流转记录的方法；
 *   3. **仅主工长可发起与重新提交**（Q11 / AC-A24）—— 不是「任意工长」。
 *      普通工长能汇报进度，但不能代表项目对外确认验收。
 */

const AppError = require('../utils/AppError')
const datetime = require('../utils/datetime')
const db = require('../db/pool')
const logger = require('../utils/logger')
const storage = require('../storage')
const watermark = require('../utils/watermark')
const signedUrl = require('../utils/signedUrl')
const { buildAcceptanceReportNo } = require('../utils/acceptanceReportNo')
const { collectRoundSignatures } = require('../utils/acceptanceSignatures')
const { OWNER_TYPE, assertPrimaryOwner, isPrimaryOwner } = require('../utils/ownerType')
const notificationService = require('./notification.service')
const sysConfigService = require('./sysConfig.service')
const acceptancePassService = require('./acceptancePass.service')
const esignService = require('./esign.service')
const esignConfig = require('./esign/config')
const acceptanceModel = require('../models/acceptance.model')
const projectModel = require('../models/project.model')
const projectStageModel = require('../models/projectStage.model')
const projectItemModel = require('../models/projectItem.model')
const projectMemberModel = require('../models/projectMember.model')
const reconciliationModel = require('../models/reconciliation.model')

const STATUS = {
  DRAFT: 'draft',
  PENDING_SUPERVISOR: 'pending_supervisor',
  PENDING_OWNER: 'pending_owner',
  PENDING_RECTIFY: 'pending_rectify',
  PASSED: 'passed',
}

const STEP = { SELF_CHECK: 'self_check', SUPERVISOR: 'supervisor', OWNER: 'owner' }

const STATUS_LABELS = {
  draft: '草稿',
  pending_supervisor: '待监理审核',
  pending_owner: '待业主确认',
  pending_rectify: '待整改',
  passed: '已通过',
}

/** 阶段结算单状态 → 用户可读文案（§4.7.1） */
const SETTLEMENT_STATUS_LABELS = {
  draft: '待工长提交',
  pending: '待主业主确认',
  disputed: '结算有异议',
  confirmed: '已结清',
}

const STEP_LABELS = { self_check: '自检', supervisor: '监理审核', owner: '业主确认' }

/**
 * 合法的状态迁移表。
 *
 * 逐条列出而不是用「有序数组 + 索引比较」：
 * 验收状态机**不是线性的**（驳回会回到 pending_rectify，重新提交又回到首环节），
 * 用序数比较会放行一批实际非法的跃迁（例如 pending_rectify 直接跳到 passed）。
 * AC-A04 明确要求非法跃迁返回 409，因此必须是一张精确的表。
 */
const TRANSITIONS = {
  [STATUS.DRAFT]: ['submit'],
  [STATUS.PENDING_SUPERVISOR]: ['approve', 'reject'],
  [STATUS.PENDING_OWNER]: ['approve', 'reject'],
  [STATUS.PENDING_RECTIFY]: ['resubmit'],
  // 终态：没有任何合法动作（AC-A06）
  [STATUS.PASSED]: [],
}

/**
 * 验收单相关接口统一的「查不到」文案。
 *
 * 「单子不存在」与「你不是本项目成员」必须返回**同一个**提示 ——
 * 否则两者一比就能探出某个 id 是否真实存在（AC-A25 / AC-P26 都要求不泄露）。
 */
const NOT_FOUND_MESSAGE = '验收单不存在'

/** 当前环节 → 谁该处理 */
const STEP_ROLE = {
  [STATUS.PENDING_SUPERVISOR]: 'supervisor',
  [STATUS.PENDING_OWNER]: 'owner',
}

function assertTransition(status, action) {
  const allowed = TRANSITIONS[status]
  if (!allowed || !allowed.includes(action)) {
    throw AppError.conflict(`当前状态「${STATUS_LABELS[status] || status}」不允许执行该操作`)
  }
}

// ─────────────────────────────────────────────────────────────
// 权限
// ─────────────────────────────────────────────────────────────

/**
 * 解析访问者在项目中的身份。
 *
 * 非参与成员一律 404（AC-P26 / AC-A25：跨项目操作返回 403 且不泄露项目是否存在，
 * 这里统一为 404 —— 与 C 端其他接口一致）。
 */
async function resolveViewer(userId, projectId) {
  const membership = await projectMemberModel.findActiveRole(projectId, userId)
  if (!membership) throw AppError.notFound('项目不存在')
  return membership
}

/** 仅主工长（Q11 / AC-A24）。普通工长能汇报进度，但不能发起验收 */
function assertPrimaryForeman(viewer) {
  if (viewer.role !== 'foreman') throw AppError.forbidden('仅该项目的工长可发起验收')
  if (viewer.is_primary !== 1) throw AppError.forbidden('仅主工长可发起验收与重新提交')
}

async function loadWritableProject(projectId) {
  const project = await projectModel.findByIdUnscoped(projectId)
  if (!project) throw AppError.notFound('项目不存在')
  if (project.status === 'archived') throw AppError.forbidden('项目已归档，全部数据只读')
  return project
}

/**
 * 事务内的可写校验（AC-AD25 / AC-AD57）。
 *
 * 必须在每个验收写事务的开头调用：上面那个非锁定版本只用于「省资源」的
 * 前置检查，真正防止「检查后归档」的竞态要靠 FOR UPDATE 锁住项目行。
 */
async function assertProjectWritable(projectId, tx) {
  const project = await tx.queryOne(
    'SELECT id, status FROM project WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
    [projectId]
  )
  if (!project) throw AppError.notFound('项目不存在')
  if (project.status === 'archived') throw AppError.forbidden('项目已归档，全部数据只读')
  return project
}

/**
 * 保存手写签名图片。
 *
 * 走**私有存储**：签名是姓名笔迹，属于纠纷时的关键证据，不能被
 * express.static 公开访问。返回 storage key，阅读侧统一经 2 小时签名 URL 展示
 * （`GET /api/v1/files`），PDF 渲染直接读私有文件。
 *
 * 历史数据里只有 `signature_url`（公开地址），阅读侧按「有 key 用 key，
 * 无 key 用旧 URL」兼容，不做数据迁移。
 */
async function saveSignature(file) {
  if (!file) return null
  if (file.type !== 'image') throw AppError.badRequest('签名必须是图片')
  const saved = await storage.savePrivate(file.buffer, { category: 'signatures', ext: file.ext })
  return saved.key
}

/** 把签名 key / 历史公开 URL 统一转成前端可用的地址 */
function signatureViewUrl(row) {
  if (!row) return null
  if (row.signature_key) return signedUrl.buildPrivateFileUrl(row.signature_key)
  return row.signature_url || null
}

// ─────────────────────────────────────────────────────────────
// 发起验收
// ─────────────────────────────────────────────────────────────

/**
 * 发起验收（C-3.2 / C-3.4 / AC-A01 / AC-A03 / AC-A24 / AC-S10）。
 *
 * 校验顺序刻意如此：权限 → 项目可写 → 目标存在且属于本项目 → 进度满 100%
 * → 门禁未锁定 → 无未终结单（加锁）。越靠前的失败越省资源，
 * 而最后一步必须加锁（见 acceptance.model 的说明）。
 */
async function createAcceptance(userId, projectId, input) {
  const viewer = await resolveViewer(userId, projectId)
  assertPrimaryForeman(viewer)
  await loadWritableProject(projectId)

  const target = await resolveTarget(projectId, input)

  // AC-A01 / C-3.4：阶段进度未达 100% 时禁止发起
  if (Number(target.progress) < 100) {
    throw AppError.conflict(`「${target.name}」的进度为 ${target.progress}%，未达 100%，暂不可发起验收`)
  }

  // AC-S10 / C-3.13：上一阶段未结清时本阶段锁定，发起验收返回 409
  if (target.gateStatus === 'locked') {
    throw AppError.conflict(`「${target.name}」的上一阶段尚未结清，暂不可发起验收`)
  }

  // AC-A01 的第二层：已验收过的阶段不必再验收
  if (target.gateStatus === 'accepted' || target.gateStatus === 'settled') {
    throw AppError.conflict(`「${target.name}」已验收通过，无需重复发起`)
  }

  // 现场照片（C-3.2）。与进度汇报一样，图片由服务端叠加水印后另存
  const photos = input.files && input.files.length > 0 ? await persistPhotos(input.files, target) : []

  const acceptanceId = await db.withTransaction(async (tx) => {
    // AC-A03：同一阶段存在未终结验收单时重复发起返回 409。
    // 必须 FOR UPDATE —— 唯一索引在这里帮不上忙（「未终结」是状态条件而非唯一键），
    // 两个并发请求会双双读到「没有」并各插一张
    const open = await acceptanceModel.findOpenByStageForUpdate(tx, target.stageId)
    if (open) {
      throw AppError.conflict(
        `该阶段已有一张「${STATUS_LABELS[open.status]}」的验收单，请先处理完再发起`,
        { detail: { acceptanceId: open.id, status: open.status } }
      )
    }

    const id = await acceptanceModel.create(
      {
        projectId,
        projectStageId: target.stageId,
        projectItemId: target.itemId ?? null,
        type: target.itemId ? 'item' : 'stage',
        submitterId: userId,
        description: input.description ?? null,
        signatureMode: esignConfig.isRequired() ? 'provider' : 'legacy',
      },
      tx
    )

    // 自检清单从工序的 checklist 带入（B-3.5 / AC-AD32）。
    // 阶段级验收取该阶段下全部工序清单的并集 —— 逐个工序列出来，
    // 让自检时能一眼看出哪一项属于哪个工序
    const checklist = await buildChecklist(projectId, target, tx)
    await acceptanceModel.createItems(id, checklist, tx)

    if (photos.length > 0) {
      await tx.query('UPDATE acceptance SET photos = ? WHERE id = ?', [JSON.stringify(photos), id])
    }

    return id
  })

  return getDetail(userId, acceptanceId)
}

/**
 * 解析验收对象：阶段级还是工序级（C-3.2 的「选择阶段或工序」）。
 *
 * 工序级验收时，其所属阶段同样要满足进度与门禁条件 ——
 * 否则会出现「阶段还锁着，但某个工序已经验收通过」的矛盾状态。
 */
async function resolveTarget(projectId, input) {
  if (input.itemId) {
    const item = await projectItemModel.findById(input.itemId)
    if (!item) throw AppError.notFound('工序不存在')

    const stage = await projectStageModel.findById(item.project_stage_id)
    if (!stage || Number(stage.project_id) !== Number(projectId)) throw AppError.notFound('工序不存在')

    if (Number(item.progress) < 100) {
      throw AppError.conflict(`工序「${item.name}」的进度为 ${item.progress}%，未达 100%，暂不可发起验收`)
    }

    return {
      stageId: stage.id,
      itemId: item.id,
      name: item.name,
      progress: item.progress,
      gateStatus: stage.gate_status,
      stageName: stage.name,
    }
  }

  if (input.stageId) {
    const stage = await projectStageModel.findById(input.stageId)
    if (!stage || Number(stage.project_id) !== Number(projectId)) throw AppError.notFound('阶段不存在')

    return {
      stageId: stage.id,
      itemId: null,
      name: stage.name,
      progress: stage.progress,
      gateStatus: stage.gate_status,
      stageName: stage.name,
    }
  }

  throw AppError.badRequest('请选择要验收的阶段或工序')
}

/**
 * 组装自检清单。
 *
 * 来源是 `project_item.checklist`（建档时由模板的 `default_checklist` 带入，
 * 见 AC-AD32）。若工序没有配置清单，用「工序名 + 完成」兜底 ——
 * 空清单会让 AC-A07 的「逐项勾选」变成零项，自检环节直接失去意义。
 */
async function buildChecklist(projectId, target, tx) {
  const items = target.itemId
    ? [await projectItemModel.findById(target.itemId, tx)]
    : await projectItemModel.listByStage(target.stageId, tx)

  const names = []
  for (const item of items) {
    let checklist = item.checklist
    if (typeof checklist === 'string') {
      try {
        checklist = JSON.parse(checklist)
      } catch {
        checklist = null
      }
    }

    if (Array.isArray(checklist) && checklist.length > 0) {
      for (const entry of checklist) {
        const name = typeof entry === 'string' ? entry : entry && entry.name
        // 阶段级验收时把工序名拼进验收项，否则几十条散项看不出归属
        if (name) names.push(target.itemId ? String(name) : `${item.name}：${name}`)
      }
    } else {
      names.push(target.itemId ? `${item.name}已完成` : `${item.name}已完成`)
    }
  }

  // 去重但保持顺序
  return [...new Set(names)]
}

/** 现场照片落盘 + 服务端水印（复用进度汇报那一套，理由同 AC-P12） */
async function persistPhotos(files, target) {
  const photos = []
  for (const file of files) {
    const original = await storage.save(file.buffer, { category: 'acceptances', ext: file.ext })
    let watermarkUrl = null

    if (file.type === 'image') {
      const marked = await watermark.apply(file.buffer, {
        lines: [datetime.format(), target.stageName, `验收：${target.name}`],
      })
      watermarkUrl = (await storage.save(marked, { category: 'acceptances', ext: file.ext })).url
    }

    photos.push({ url: original.url, watermarkUrl })
  }
  return photos
}

// ─────────────────────────────────────────────────────────────
// 草稿与自检
// ─────────────────────────────────────────────────────────────

/** 保存草稿（AC-A08：可稍后继续编辑；草稿不计入任何角色的待办数与红点） */
async function saveDraft(userId, acceptanceId, input) {
  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)
  assertPrimaryForeman(viewer)
  assertTransition(acceptance.status, 'submit') // 草稿保留在可提交状态
  await loadWritableProject(acceptance.project_id)

  await db.withTransaction(async (tx) => {
    await assertProjectWritable(acceptance.project_id, tx)
    if (input.description !== undefined) {
      await acceptanceModel.updateDescription(acceptanceId, input.description, tx)
    }
    if (Array.isArray(input.items)) {
      await acceptanceModel.saveItemResults(acceptanceId, input.items, tx)
    }
  })

  return getDetail(userId, acceptanceId)
}

/**
 * 提交自检（C-3.3 / AC-A07 / AC-A09）。
 *
 * AC-A07 要求「须逐项勾选全部自检清单，存在未勾选项时提交按钮不可用并高亮缺失项」。
 * 服务端同样必须校验 —— 前端按钮置灰拦不住直接调接口的人，
 * 而一条自检项没勾就流到监理那里，等于把检查责任推给了下游。
 */
async function submitSelfCheck(userId, acceptanceId, input) {
  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)
  assertPrimaryForeman(viewer)
  assertTransition(acceptance.status, 'submit')
  await loadWritableProject(acceptance.project_id)

  // 工长是三方签署的第一方：提交自检就是「我确认现场已按清单完成」。
  // 缺少签名时在进事务前就拒绝，避免为一个必然失败的请求跑完整个事务。
  if (!input.signatureFile) throw AppError.badRequest('请先完成工长签名再提交自检')

  const trimmedDescription = input.description !== undefined ? input.description : acceptance.description

  return db.withTransaction(async (tx) => {
    await assertProjectWritable(acceptance.project_id, tx)
    if (input.description !== undefined) {
      await acceptanceModel.updateDescription(acceptanceId, input.description, tx)
    }
    if (Array.isArray(input.items)) {
      await acceptanceModel.saveItemResults(acceptanceId, input.items, tx)
    }

    // 全部勾选校验：任何一项 result 为空都拒绝
    const items = await acceptanceModel.listItems(acceptanceId, tx)
    const missing = items.filter((item) => !item.result)
    if (missing.length > 0) {
      throw AppError.badRequest(`还有 ${missing.length} 项自检未勾选，请逐项确认后再提交`, {
        detail: {
          missingItems: missing.map((item) => ({ id: item.id, name: item.name })),
        },
      })
    }

    // 自检项被标记为不合格时不应放行 —— 那说明工长自己知道有问题，
    // 此时该先整改而不是把单子推给监理
    const failed = items.filter((item) => item.result === 'fail')
    if (failed.length > 0) {
      throw AppError.conflict(`有 ${failed.length} 项自检未通过，请先整改后再提交`, {
        detail: { failedItems: failed.map((item) => ({ id: item.id, name: item.name })) },
      })
    }

    const nextStatus = await nextStatusAfterSubmit(tx, acceptance.project_id)
    const round = acceptanceModel.currentRound(acceptance)

    // 自检项全部通过后才写文件：校验失败时不留下孤立签名
    const signatureKey = await saveSignature(input.signatureFile)

    await acceptanceModel.appendFlow(
      {
        acceptanceId,
        round,
        step: STEP.SELF_CHECK,
        operatorId: userId,
        action: 'submit',
        reason: trimmedDescription ? '工长自检完成' : null,
        signatureKey,
      },
      tx
    )

    // isFirstSubmit：`submitted_at` 只在首次写入（G-01）。
    // 它永不更新是 AC-A22 的 48 小时超时与 AC-AD39 的平均验收周期能成立的前提
    await acceptanceModel.transition(
      acceptanceId,
      {
        status: nextStatus,
        currentStep: nextStatus === STATUS.PENDING_SUPERVISOR ? STEP.SUPERVISOR : STEP.OWNER,
        stepEnteredAt: datetime.format(),
        isFirstSubmit: acceptance.submitted_at === null,
      },
      tx
    )

    return nextStatus
  }).then(async (nextStatus) => {
    await notifyStepHandlers(acceptance.project_id, acceptanceId, nextStatus, acceptance.project_stage_id)
    return getDetail(userId, acceptanceId)
  })
}

/**
 * 提交后进入哪个状态。
 *
 * AC-A05：项目未配置监理（或监理全部未确认）时跳过监理环节，直接进入待业主确认。
 * 只统计 active 成员 —— pending 的监理还没确认邀请，不计入任何权限判定（AC-AD18），
 * 若把他算进去，工长的验收单会卡在一个永远不会有人处理的状态上。
 */
async function nextStatusAfterSubmit(tx, projectId) {
  const supervisorCount = await tx.count(
    "FROM project_member WHERE project_id = ? AND role = 'supervisor' AND status = 'active' AND deleted_at IS NULL",
    [projectId]
  )
  return supervisorCount > 0 ? STATUS.PENDING_SUPERVISOR : STATUS.PENDING_OWNER
}

// ─────────────────────────────────────────────────────────────
// 审核与驳回
// ─────────────────────────────────────────────────────────────

/**
 * 当前环节通过（C-3.5 / C-3.6 / AC-A10 / AC-A15 / AC-A16 / AC-A21）。
 *
 * 同一个接口按当前状态判定该由谁操作：pending_supervisor → 监理，
 * pending_owner → 业主。调用方无需知道自己正在扮演哪个环节 ——
 * 让前端传「我是以监理身份操作」反而是个可以伪造的参数。
 */
async function approve(userId, acceptanceId, { signatureFile } = {}) {
  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)
  assertTransition(acceptance.status, 'approve')

  const expectedRole = STEP_ROLE[acceptance.status]
  if (viewer.role !== expectedRole) {
    // AC-A10：对非本环节的验收单操作返回 403
    throw AppError.forbidden(`当前处于「${STATUS_LABELS[acceptance.status]}」，仅该项目${roleLabel(expectedRole)}可处理`)
  }
  if (expectedRole === 'owner') assertPrimaryOwner(viewer, '确认验收')
  await loadWritableProject(acceptance.project_id)

  const step = expectedRole === 'supervisor' ? STEP.SUPERVISOR : STEP.OWNER

  // 监理 / 业主的「通过」都必须是签名与确认同一个动作。
  // - 监理：始终手写签名（即使启用了可靠电子签，监理也保留手写确认）；
  // - 业主：启用可靠电子签时只接受服务商签署，手写图片一律拒绝；
  //         未启用时接受手写签名（仅项目内部确认，不具备法律效力）。
  if (step === STEP.SUPERVISOR) {
    if (!signatureFile) throw AppError.badRequest('请先完成监理签名再确认审核')
  } else {
    if (esignConfig.isRequired()) {
      throw AppError.conflict('请使用可靠电子签名完成验收')
    }
    if (!esignConfig.legacyAllowed()) {
      throw AppError.serviceUnavailable('当前未开启验收签名能力')
    }
    await esignService.assertNoActiveTask(acceptanceId)
    if (!signatureFile) throw AppError.badRequest('请先完成业主签名再确认验收')
  }

  const isFinal = step === STEP.OWNER

  await db.withTransaction(async (tx) => {
    await assertProjectWritable(acceptance.project_id, tx)
    // 同一环节的通过/驳回是并发写：先锁行，再按最新状态重新校验。
    // 没有这一步，两个主管同时操作会各写一条 flow，最后一次 UPDATE 覆盖前一次。
    const locked = await acceptanceModel.lockById(tx, acceptanceId)
    if (!locked || locked.status !== acceptance.status) {
      throw AppError.conflict('验收状态已变化，请刷新后重试')
    }
    const round = acceptanceModel.currentRound(acceptance)

    // 锁行并复核状态后再写文件，避免并发竞争失败时留下孤立签名
    const signatureKey = await saveSignature(signatureFile)

    await acceptanceModel.appendFlow(
      { acceptanceId, round, step, operatorId: userId, action: 'approve', signatureKey },
      tx
    )

    if (isFinal) {
      // AC-A17：签名与验收单一并归档
      const affected = await acceptanceModel.markPassed(
        acceptanceId,
        {
          signatureKey,
          finishedAt: datetime.format(),
          esignStatus: 'legacy',
          esignCompletedAt: datetime.format(),
        },
        tx
      )
      if (affected === 0) throw AppError.conflict('验收状态已变化，请刷新后重试')

      // §4.7.1：验收通过后阶段门禁进入 accepted（待结算）。
      // 注意**不是**直接 settled —— 结算要等业主对账无异议（AC-S08），
      // 两件事分开才能让「验收通过」与「款已结清」各自可追溯。
      //
      // 同时把**展示状态**也写成 accepted：`status` 是派生字段，
      // 但它是落库的，只改 gate_status 会让阶段在时间轴上仍显示「已完成」——
      // 而 AC-P02 要求的展示值就是「已验收」。派生逻辑在 progress.service，
      // 这里直接写是因为验收通过是它唯一不由进度触发的情形
      await tx.query("UPDATE project_stage SET gate_status = 'accepted', status = 'accepted' WHERE id = ?", [
        acceptance.project_stage_id,
      ])
    } else {
      await acceptanceModel.transition(
        acceptanceId,
        { status: STATUS.PENDING_OWNER, currentStep: STEP.OWNER, stepEnteredAt: datetime.format() },
        tx
      )
    }
  })

  // AC-A21：验收通过后解锁关联付款节点并生成通知。
  // 放在事务**外**：解锁失败不该让「验收通过」这个事实回滚 ——
  // 门禁已经推进，回滚会让阶段卡在一个说不清的状态。失败可重试（见 unlockPaymentNodes）
  if (isFinal) {
    await finalizeAfterPass(acceptance, userId).catch((err) => {
      logger.error('验收通过后的联动处理失败，需要人工介入', { acceptanceId, err })
    })
  } else {
    await notifyStepHandlers(acceptance.project_id, acceptanceId, STATUS.PENDING_OWNER, acceptance.project_stage_id)
  }

  return getDetail(userId, acceptanceId)
}

/**
 * 驳回（C-3.5 / C-3.6 / AC-A11 / AC-A12 / AC-A13）。
 *
 * AC-A11 要求驳回原因必填。这不只是表单校验 ——
 * 驳回是「不接受当前成果」的判断，没有理由的驳回让工长无从整改，
 * 而这条记录还是日后争议时的关键材料。
 */
async function reject(userId, acceptanceId, { reason, files }) {
  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)
  assertTransition(acceptance.status, 'reject')

  const expectedRole = STEP_ROLE[acceptance.status]
  if (viewer.role !== expectedRole) {
    throw AppError.forbidden(`当前处于「${STATUS_LABELS[acceptance.status]}」，仅该项目${roleLabel(expectedRole)}可处理`)
  }
  if (expectedRole === 'owner') assertPrimaryOwner(viewer, '驳回验收')
  if (expectedRole === 'owner' && acceptance.esign_status === 'signed') {
    throw AppError.conflict('电子签名已完成，不能驳回')
  }
  if (expectedRole === 'owner') await esignService.assertNoActiveTask(acceptanceId)
  await loadWritableProject(acceptance.project_id)

  const text = String(reason || '').trim()
  if (!text) throw AppError.badRequest('驳回原因必填')
  if (text.length > 500) throw AppError.badRequest('驳回原因不超过 500 字')

  // AC-A12：驳回可附照片，随流转记录一并保存
  const images = []
  for (const file of files || []) {
    const original = await storage.save(file.buffer, { category: 'acceptances', ext: file.ext })
    let watermarkUrl = null
    if (file.type === 'image') {
      const marked = await watermark.apply(file.buffer, {
        lines: [datetime.format(), '驳回凭证', text.slice(0, 40)],
      })
      watermarkUrl = (await storage.save(marked, { category: 'acceptances', ext: file.ext })).url
    }
    images.push({ url: original.url, watermarkUrl })
  }

  const step = expectedRole === 'supervisor' ? STEP.SUPERVISOR : STEP.OWNER

  await db.withTransaction(async (tx) => {
    await assertProjectWritable(acceptance.project_id, tx)
    const locked = await acceptanceModel.lockById(tx, acceptanceId)
    if (!locked || locked.status !== acceptance.status) {
      throw AppError.conflict('验收状态已变化，请刷新后重试')
    }
    const round = acceptanceModel.currentRound(acceptance)

    await acceptanceModel.appendFlow(
      { acceptanceId, round, step, operatorId: userId, action: 'reject', reason: text, images },
      tx
    )

    // AC-A13：任一环节驳回后进入待整改，回到工长手上
    await acceptanceModel.transition(
      acceptanceId,
      { status: STATUS.PENDING_RECTIFY, currentStep: STEP.SELF_CHECK, stepEnteredAt: datetime.format() },
      tx
    )
  })

  await notifyRectify(acceptance, text)

  return getDetail(userId, acceptanceId)
}

/**
 * 重新提交（C-3.8 / AC-A14）。
 *
 * 「回到流程首环节」—— 有监理就重新走监理审核，没有就直接到业主。
 * **此前的流转记录不被覆盖或删除**：新记录 round + 1，
 * 旧记录原样保留，`listFlow` 会把多轮拼成一条完整的故事线。
 */
async function resubmit(userId, acceptanceId, input = {}) {
  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)
  assertPrimaryForeman(viewer)
  assertTransition(acceptance.status, 'resubmit')
  await loadWritableProject(acceptance.project_id)

  // 新一轮仍然要工长签名：旧轮次的签名不能沿用到整改后的结果上
  if (!input.signatureFile) throw AppError.badRequest('请先完成工长签名再重新提交')

  const nextStatus = await db.withTransaction(async (tx) => {
    await assertProjectWritable(acceptance.project_id, tx)
    if (input.description !== undefined) {
      await acceptanceModel.updateDescription(acceptanceId, input.description, tx)
    }
    if (Array.isArray(input.items)) {
      await acceptanceModel.saveItemResults(acceptanceId, input.items, tx)
      const items = await acceptanceModel.listItems(acceptanceId, tx)
      const missing = items.filter((item) => !item.result || item.result === 'fail')
      if (missing.length > 0) {
        throw AppError.badRequest(`有 ${missing.length} 项自检未通过，请整改后再提交`)
      }
    }

    const next = await nextStatusAfterSubmit(tx, acceptance.project_id)

    // 本次重新提交**开启新的一轮**，因此要 +1。
    // `currentRound(acceptance)` 读的是递增前的 resubmit_count，
    // 给出的是「刚刚结束的那一轮」的编号 —— 直接用会把新一轮的记录
    // 错误地归到上一轮里，流程记录读起来就像没重新提交过
    const round = acceptanceModel.currentRound(acceptance) + 1

    const signatureKey = await saveSignature(input.signatureFile)

    await acceptanceModel.appendFlow(
      {
        acceptanceId,
        round,
        step: STEP.SELF_CHECK,
        operatorId: userId,
        action: 'submit',
        reason: '工长整改完成，重新提交',
        signatureKey,
      },
      tx
    )

    await acceptanceModel.transition(
      acceptanceId,
      {
        status: next,
        currentStep: next === STATUS.PENDING_SUPERVISOR ? STEP.SUPERVISOR : STEP.OWNER,
        stepEnteredAt: datetime.format(),
        // 重新提交只递增计数，**不动 submitted_at**（G-01）
        resubmitIncrement: true,
      },
      tx
    )

    return next
  })

  await notifyStepHandlers(acceptance.project_id, acceptanceId, nextStatus, acceptance.project_stage_id)

  return getDetail(userId, acceptanceId)
}

// ─────────────────────────────────────────────────────────────
// 通过后的联动
// ─────────────────────────────────────────────────────────────

/**
 * 验收通过后的联动：解锁付款节点 + 生成 PDF + 通知（AC-A21 / AC-A18）。
 *
 * 三件事都**不参与**「验收通过」那个事务：验收通过是既成事实，
 * 下游任何一步失败都不该把它回滚。各自失败各自记录，可重试。
 */
async function finalizeAfterPass(acceptance, operatorId) {
  return acceptancePassService.finalizeAfterPass(acceptance, operatorId)
}

/** 通知某个状态的下一个处理人 */
async function notifyStepHandlers(projectId, acceptanceId, status, stageId) {
  const role = STEP_ROLE[status]
  if (!role) return

  // 业主环节只催主业主：临时业主没有处理权限，发给他只会制造「点进去 403」
  const targets = await db.query(
    `SELECT DISTINCT user_id FROM project_member
      WHERE project_id = ? AND role = ? AND status = 'active' AND deleted_at IS NULL
        AND (role <> 'owner' OR owner_type = 'primary')`,
    [projectId, role]
  )
  if (targets.length === 0) return

  const stage = stageId ? await projectStageModel.findById(stageId) : null
  const title = `有一张验收单待你${STEP_LABELS[role === 'supervisor' ? STEP.SUPERVISOR : STEP.OWNER]}`

  for (const { user_id: userId } of targets) {
    await notificationService
      .notify({
        userId,
        projectId,
        type: notificationService.TYPES.ACCEPTANCE,
        title,
        content: stage ? `「${stage.name}」的验收单等待处理` : '验收单等待处理',
        refType: 'acceptance',
        refId: acceptanceId,
      })
      .catch((err) => logger.warn('验收待办通知发送失败', { acceptanceId, err }))
  }
}

/** 驳回后通知工长（含主工长与普通工长 —— 整改是所有人都能做的） */
async function notifyRectify(acceptance, reason) {
  const targets = await db.query(
    `SELECT DISTINCT user_id FROM project_member
      WHERE project_id = ? AND role = 'foreman' AND status = 'active' AND deleted_at IS NULL`,
    [acceptance.project_id]
  )

  for (const { user_id: userId } of targets) {
    await notificationService
      .notify({
        userId,
        projectId: acceptance.project_id,
        type: notificationService.TYPES.ACCEPTANCE,
        title: '验收被驳回，需要整改',
        content: reason.slice(0, 100),
        refType: 'acceptance',
        refId: acceptance.id,
      })
      .catch((err) => logger.warn('驳回通知发送失败', { acceptanceId: acceptance.id, err }))
  }
}

/** 验收通过后通知工长与业主 */
// ─────────────────────────────────────────────────────────────
// 读取
// ─────────────────────────────────────────────────────────────

async function getDetail(userId, acceptanceId) {
  const { acceptance, viewer } = await loadForAction(userId, acceptanceId)

  const [items, flow, stage, item, project, supervisorCount, settlement] = await Promise.all([
    acceptanceModel.listItems(acceptanceId),
    acceptanceModel.listFlow(acceptanceId),
    acceptance.project_stage_id ? projectStageModel.findById(acceptance.project_stage_id) : null,
    acceptance.project_item_id ? projectItemModel.findById(acceptance.project_item_id) : null,
    projectModel.findByIdUnscoped(acceptance.project_id),
    projectMemberModel.countByRole(acceptance.project_id, 'supervisor'),
    acceptance.project_stage_id
      ? reconciliationModel.findByStage(acceptance.project_id, acceptance.project_stage_id)
      : null,
  ])

  const photos = parseJson(acceptance.photos) || []
  const esign = await esignService.describe(acceptance, viewer)
  const currentRound = acceptanceModel.currentRound(acceptance)

  // 三方签署摘要：详情与 PDF 共用同一个纯函数，避免「详情说签了、PDF 说没签」
  const signatures = collectRoundSignatures(flow, {
    round: currentRound,
    hasSupervisor: supervisorCount > 0,
    providerMode: acceptance.signature_mode === 'provider' || Boolean(esign && esign.required),
    providerSigned: acceptance.esign_status === 'signed',
    ownerFallback:
      acceptance.signature_url || acceptance.signature_key
        ? {
            // 新数据只有私有 key；历史数据只有公开 URL。两者都不下发原始值，
            // 由 signatureViewUrl 统一换成带时效的地址 / 保留旧 URL。
            signatureUrl: acceptance.signature_key ? null : acceptance.signature_url,
            signatureKey: acceptance.signature_key || null,
            signedAt: acceptance.finished_at,
          }
        : null,
    status: acceptance.status,
  })

  return {
    id: acceptance.id,
    projectId: acceptance.project_id,
    projectName: project ? project.name : null,
    projectAddress: project ? project.address : null,
    projectStatus: project ? project.status : null,
    type: acceptance.type,
    status: acceptance.status,
    statusLabel: STATUS_LABELS[acceptance.status],
    currentStep: acceptance.current_step,
    currentStepLabel: acceptance.current_step ? STEP_LABELS[acceptance.current_step] : null,
    stageId: acceptance.project_stage_id,
    stageName: stage ? stage.name : null,
    stageProgress: stage ? stage.progress : null,
    stageGateStatus: stage ? stage.gate_status : null,
    stageStatus: stage ? stage.status : null,
    // 阶段结算单可能尚未生成（历史数据）；前端据此决定是否显示「去结算」
    stageSettlement: settlement
      ? {
          id: settlement.id,
          status: settlement.status,
          statusLabel: SETTLEMENT_STATUS_LABELS[settlement.status] || settlement.status,
        }
      : null,
    itemId: acceptance.project_item_id,
    itemName: item ? item.name : null,
    // 无监理时前端要把「监理审核」显示为「已跳过」，不能画成一个真实环节
    hasSupervisor: supervisorCount > 0,
    round: currentRound,
    description: acceptance.description,
    photos: photos.map((p) => ({ url: p.watermarkUrl || p.url, originalUrl: p.watermarkUrl ? p.url : null })),
    submitterId: acceptance.submitter_id,
    submittedAt: acceptance.submitted_at,
    stepEnteredAt: acceptance.step_entered_at,
    waitingHours: waitingHours(acceptance.step_entered_at, acceptance.status),
    resubmitCount: acceptance.resubmit_count,
    finishedAt: acceptance.finished_at,
    signatureUrl: signatureViewUrl(acceptance),
    reportPdf: {
      status: acceptance.report_pdf_status,
      // 不再下发 `url`：报告已改私有存储，这里如果继续返回永久公开地址，
      // 签名 URL 的 2 小时时效就形同虚设（历史旧报告仍可由签名路径下载）。
      source: acceptance.report_pdf_source || 'generated',
      sha256: acceptance.report_pdf_sha256 || null,
      error: acceptance.report_pdf_error,
      // AC-A20：通过带签名的临时 URL 访问。**每次读取都重新签发**，
      // 因此过期后重新获取即可正常下载
      signedPath:
        acceptance.status === 'passed' && acceptance.report_pdf_status === 'success'
          ? signedUrl.buildPath({
              resource: 'acceptance-report',
              id: acceptance.id,
              path: `/api/v1/acceptances/${acceptance.id}/report.pdf`,
            })
          : null,
    },
    items: items.map((row) => ({
      id: row.id,
      seq: row.seq,
      name: row.name,
      result: row.result,
      remark: row.remark,
    })),
    flow: flow.map(toFlowView),
    myRole: viewer.role,
    ownerType: viewer.owner_type ?? null,
    isPrimaryOwner: isPrimaryOwner(viewer),
    esign,
    // 当前轮次的三方签署状态（工长 / 监理 / 业主）
    signatures,
    // 当前访问者在这张单子上能做什么 —— 前端据此决定按钮的可用性，
    // 但**服务端仍然独立校验**（AC-A10/A15/A24），前端只是体验层的提示
    myActions: buildMyActions(acceptance, viewer, esign),
  }
}

function toFlowView(row) {
  return {
    id: row.id,
    round: row.round,
    step: row.step,
    stepLabel: STEP_LABELS[row.step] || row.step,
    operatorId: row.operator_id,
    operator: row.real_name || row.nickname || `用户${row.operator_id}`,
    action: row.action,
    actionLabel: { submit: '提交', approve: '通过', reject: '驳回' }[row.action] || row.action,
    reason: row.reason,
    esignTaskId: row.esign_task_id ?? null,
    signatureUrl: signatureViewUrl(row),
    images: (parseJson(row.images) || []).map((img) => ({
      url: img.watermarkUrl || img.url,
      originalUrl: img.watermarkUrl ? img.url : null,
    })),
    operatedAt: row.operated_at,
  }
}

/**
 * 当前访问者可执行的动作。
 *
 * 与 approve/reject 里的角色校验是**同一套判据**，这里只是把它提前告诉前端。
 * 两处若分叉，会出现「按钮可点但接口 403」这种最难解释的现象 ——
 * 因此判据都来自 STEP_ROLE 与 assertPrimaryForeman 的同样条件。
 */
function buildMyActions(acceptance, viewer, esign) {
  const actions = []
  if (acceptance.status === STATUS.PASSED) return actions

  const expectedRole = STEP_ROLE[acceptance.status]
  const esignActive = esign && ['creating', 'pending', 'archiving'].includes(esign.status)

  if (expectedRole && viewer.role === expectedRole) {
    if (expectedRole === 'owner') {
      // 主业主：可靠电子签开启时只给「去签署」；关闭时给手写「通过并签名」。
      if (esign && esign.canSign) actions.push('esign')
      // 签署前仍允许驳回；一旦有进行中/已完成任务就不能驳回
      if (isPrimaryOwner(viewer) && !esignActive && (!esign || esign.status !== 'signed')) {
        actions.push('reject')
      }
      const legacyAllowed =
        isPrimaryOwner(viewer) &&
        esignConfig.legacyAllowed() &&
        (!esign || ['none', 'legacy'].includes(esign.status))
      if (legacyAllowed && !esignActive) actions.push('approve', 'reject')
    } else {
      actions.push('approve', 'reject')
    }
  }

  if (viewer.role === 'foreman' && viewer.is_primary === 1) {
    if (acceptance.status === STATUS.DRAFT) actions.push('submit')
    if (acceptance.status === STATUS.PENDING_RECTIFY) actions.push('resubmit')
  }

  if (viewer.role === 'foreman' && acceptance.status === STATUS.DRAFT) {
    actions.push('saveDraft')
  }

  return [...new Set(actions)]
}

/**
 * 验收列表（C-3.1 / AC-A23）。
 *
 * 按「待我处理 / 进行中 / 已完成」分组，各组数量与 tab 红点角标一致 ——
 * 因此分组计数与返回的列表**必须来自同一次查询**，各自算一遍就会不一致。
 *
 * 草稿不计入任何角色的待办（AC-A08）：它只是工长自己没写完的东西。
 */
async function listAcceptances(userId, projectId) {
  const viewer = await resolveViewer(userId, projectId)
  const rows = await acceptanceModel.listAllByProject(projectId)

  const views = rows.map((row) => ({
    id: row.id,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    type: row.type,
    stageId: row.project_stage_id,
    stageName: row.stage_name,
    itemId: row.project_item_id,
    itemName: row.item_name,
    submitter: row.submitter_real_name || row.submitter_nickname,
    submittedAt: row.submitted_at,
    stepEnteredAt: row.step_entered_at,
    resubmitCount: row.resubmit_count,
    finishedAt: row.finished_at,
    rejectCount: Number(row.reject_count),
    hasSignature: Boolean(row.signature_url || row.signature_key) || row.esign_status === 'signed',
    esignStatus: row.esign_status || null,
    reportPdfStatus: row.report_pdf_status,
    reportNo:
      row.report_no || (row.status === STATUS.PASSED ? buildAcceptanceReportNo(row) : null),
    // 报告库页面直接在这里拿签名链接，避免为每个已通过验收单再请求一次详情
    reportPdf:
      row.status === STATUS.PASSED && row.report_pdf_status === 'success'
        ? {
            status: row.report_pdf_status,
            signedPath: signedUrl.buildPath({
              resource: 'acceptance-report',
              id: row.id,
              path: `/api/v1/acceptances/${row.id}/report.pdf`,
            }),
            error: row.report_pdf_error || null,
          }
        : {
            status: row.report_pdf_status,
            signedPath: null,
            error: row.report_pdf_error || null,
          },
    ownerType: viewer.owner_type ?? null,
    isPrimaryOwner: isPrimaryOwner(viewer),
    // 是否为「待我处理」—— 由当前访问者的角色与单子所处环节共同决定
    isMine: isAwaitingMe(row, viewer),
  }))

  const todo = views.filter((v) => v.isMine)
  const done = views.filter((v) => v.status === STATUS.PASSED)
  const inProgress = views.filter((v) => !v.isMine && v.status !== STATUS.PASSED)

  return {
    groups: [
      { key: 'todo', label: '待我处理', count: todo.length, items: todo },
      { key: 'inProgress', label: '进行中', count: inProgress.length, items: inProgress },
      { key: 'done', label: '已完成', count: done.length, items: done },
    ],
    total: views.length,
    // tab 红点角标 = 待我处理数，与上面的 count 同源
    todoCount: todo.length,
    myRole: viewer.role,
    ownerType: viewer.owner_type ?? null,
    isPrimaryOwner: isPrimaryOwner(viewer),
    isPrimaryForeman: viewer.role === 'foreman' && viewer.is_primary === 1,
  }
}

/**
 * 跨项目验收收件箱（C-3.1）。
 *
 * 这是验收 tab 的默认视图：一个监理/业主可能同时参与多个项目，
 * 不能要求他先选项目再看待办。所有项目混排，项目名只作为卡片归属信息。
 *
 * 返回的 `items` 同时包含两类对象：
 *   - 已有验收单（kind = 'acceptance'）
 *   - 主工长可以发起的阶段（kind = 'stage'，canInitiate = true）
 *
 * 四类 tab 的数量由同一份 items 计算，避免「tab 数字和列表条数不一致」
 * （AC-A23 的同一口径要求）。
 */
async function inbox(userId) {
  const [rows, initiables] = await Promise.all([
    acceptanceModel.listInboxForUser(userId),
    acceptanceModel.listInitiablesForUser(userId),
  ])

  const acceptanceItems = rows.map((row) => {
    const viewer = { role: row.my_role, is_primary: row.my_primary, owner_type: row.my_owner_type }
    return {
      kind: 'acceptance',
      id: row.id,
      projectId: row.project_id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      projectName: row.project_name,
      projectAddress: row.project_address,
      projectStatus: row.project_status,
      stageId: row.project_stage_id,
      stageName: row.stage_name,
      itemId: row.project_item_id,
      itemName: row.item_name,
      type: row.type,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status],
      round: acceptanceModel.currentRound(row),
      isMine: isAwaitingMe(row, viewer),
      canInitiate: false,
      submittedAt: row.submitted_at,
      stepEnteredAt: row.step_entered_at,
      waitingHours: waitingHours(row.step_entered_at, row.status),
      finishedAt: row.finished_at,
      rejectCount: Number(row.reject_count),
      hasSignature: Boolean(row.signature_url || row.signature_key) || row.esign_status === 'signed',
      esignStatus: row.esign_status || null,
      reportPdfStatus: row.report_pdf_status,
      stageProgress: row.stage_progress,
      stageGateStatus: row.stage_gate_status,
      foremanName:
        row.foreman_real_name || memberDisplayName(row.foreman_nickname, row.foreman_phone, '待分配'),
      submitterName: row.submitter_real_name || row.submitter_nickname || null,
      myRole: row.my_role,
      ownerType: row.my_owner_type ?? null,
      isPrimaryOwner: row.my_role === 'owner' && row.my_owner_type === OWNER_TYPE.PRIMARY,
    }
  })

  const initiateItems = initiables.map((row) => ({
    kind: 'stage',
    id: null,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    projectName: row.project_name,
    projectAddress: row.project_address,
    projectStatus: row.project_status,
    stageId: row.stage_id,
    stageName: row.stage_name,
    itemId: null,
    itemName: null,
    type: 'stage',
    status: 'can_initiate',
    statusLabel: '可发起验收',
    round: null,
    // 「可发起」本身就是主工长待办的一种，计入「待我处理」
    isMine: true,
    canInitiate: true,
    submittedAt: null,
    stepEnteredAt: null,
    waitingHours: null,
    finishedAt: null,
    rejectCount: 0,
    hasSignature: false,
    reportPdfStatus: null,
    stageProgress: row.stage_progress,
    stageGateStatus: row.stage_gate_status,
    foremanName:
      row.foreman_real_name || memberDisplayName(row.foreman_nickname, row.foreman_phone, '待分配'),
    submitterName: null,
    myRole: 'foreman',
  }))

  const items = [...acceptanceItems, ...initiateItems].sort(compareInboxItems)

  const counts = {
    all: items.length,
    todo: items.filter((item) => item.canInitiate || item.isMine).length,
    inProgress: items.filter(
      (item) => !item.canInitiate && !item.isMine && item.status !== STATUS.PASSED
    ).length,
    done: items.filter((item) => item.status === STATUS.PASSED).length,
  }

  // 筛选面板的项目来源。项目名只能出现在筛选里，不能占据主分类行
  const projectMap = new Map()
  for (const item of items) {
    const entry = projectMap.get(item.projectId) || {
      id: item.projectId,
      name: item.projectName,
      total: 0,
      todo: 0,
    }
    entry.total += 1
    if (item.canInitiate || item.isMine) entry.todo += 1
    projectMap.set(item.projectId, entry)
  }

  return {
    items,
    counts,
    projects: [...projectMap.values()].sort((a, b) => a.id - b.id),
  }
}

/** 收件箱排序：待我处理 → 可发起 → 进行中 → 已完成；同优先级按进入环节时间倒序 */
function compareInboxItems(a, b) {
  const priority = (item) => {
    if (item.canInitiate) return 1
    if (item.status === STATUS.PASSED) return 3
    if (item.isMine) return 0
    return 2
  }

  const diff = priority(a) - priority(b)
  if (diff !== 0) return diff

  return String(b.stepEnteredAt || '').localeCompare(String(a.stepEnteredAt || ''))
}

/**
 * 进入当前环节已等待的小时数。
 * 草稿与已通过没有「等待某个角色处理」的语义，返回 null。
 */
function waitingHours(stepEnteredAt, status) {
  if (!stepEnteredAt || status === STATUS.DRAFT || status === STATUS.PASSED) return null
  const hours = datetime.diffHours(stepEnteredAt, datetime.now())
  return Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : null
}

/** 成员展示名：昵称优先，其次脱敏手机号，最后回落到占位文案 */
function memberDisplayName(nickname, phone, fallback) {
  if (nickname) return nickname
  return phone ? maskPhone(phone) : fallback
}

function maskPhone(phone) {
  if (!phone) return null
  const value = String(phone)
  if (value.length === 11) return `${value.slice(0, 3)}****${value.slice(-4)}`
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(1, value.length - 4))}${value.slice(-2)}`
}

/**
 * 是否「待我处理」。
 *
 * 草稿只对提交者本人算待办吗？**不算** —— AC-A08 明确「草稿不计入任何角色的
 * 待办数与红点」，因为它是还没写完的东西，计入待办会变成一个催自己交作业的提醒。
 */
function isAwaitingMe(row, viewer) {
  if (row.status === STATUS.DRAFT || row.status === STATUS.PASSED) return false

  if (row.status === STATUS.PENDING_RECTIFY) {
    return viewer.role === 'foreman'
  }

  const expectedRole = STEP_ROLE[row.status]
  if (!expectedRole || viewer.role !== expectedRole) return false
  return expectedRole !== 'owner' || isPrimaryOwner(viewer)
}

/** 流转记录（C-3.9 / AC-A26：对任何角色只读） */
async function getFlow(userId, acceptanceId) {
  const { acceptance } = await loadForAction(userId, acceptanceId)

  const rows = await acceptanceModel.listFlow(acceptanceId)

  // 按轮次分组，前端可以直接渲染成「第 1 轮 / 第 2 轮」的时间线
  const rounds = []
  for (const row of rows) {
    let bucket = rounds.find((r) => r.round === row.round)
    if (!bucket) {
      bucket = { round: row.round, entries: [] }
      rounds.push(bucket)
    }
    bucket.entries.push(toFlowView(row))
  }

  return { acceptanceId, status: acceptance.status, rounds }
}

function roleLabel(role) {
  return { supervisor: '监理', owner: '业主', foreman: '工长' }[role] || role
}

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * 取验收单并做可见性校验，返回 { acceptance, viewer }。
 *
 * ── 「不存在」与「无权访问」必须给出**同一个**提示 ──
 * AC-A25 与 AC-P26 都要求不泄露资源是否存在。若「不是本项目成员」返回
 * 「项目不存在」而「单子不存在」返回「验收单不存在」，两者一比就能探出
 * 某个 id 是否真实存在 —— 正是这类提示差异把「不泄露」变成了空话。
 */
async function loadForAction(userId, acceptanceId) {
  const acceptance = await acceptanceModel.findById(acceptanceId)
  if (!acceptance) throw AppError.notFound(NOT_FOUND_MESSAGE)

  const viewer = await projectMemberModel.findActiveRole(acceptance.project_id, userId)
  if (!viewer) throw AppError.notFound(NOT_FOUND_MESSAGE)

  return { acceptance, viewer }
}


module.exports = {
  STATUS,
  STEP,
  STATUS_LABELS,
  STEP_LABELS,
  TRANSITIONS,
  assertTransition,
  createAcceptance,
  saveDraft,
  submitSelfCheck,
  approve,
  reject,
  resubmit,
  getDetail,
  listAcceptances,
  inbox,
  getFlow,
  resolveViewer,
  assertPrimaryForeman,
  isAwaitingMe,
}
