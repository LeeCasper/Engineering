'use strict'

/**
 * acceptance / acceptance_item / acceptance_flow 数据访问层。
 *
 * ── 关于 acceptance_flow 是只追加表（§6.2 / AC-A14 / AC-A26）──
 * 「任何角色（含管理员）不得 UPDATE 或 DELETE」。MySQL 没有表级只读约束，
 * 因此本模块**刻意不导出**任何针对 acceptance_flow 的 update / delete 方法。
 *
 * 想改验收流转记录的人会在这里找不到入口 —— 那就对了。
 * 需要更正时应当新增一条记录并说明原因，而不是改历史（AC-N26 同理）。
 */

const db = require('../db/pool')

/** 非终态。同一阶段存在这些状态中任意一张单时，不允许重复发起（AC-A03） */
const OPEN_STATUSES = ['draft', 'pending_supervisor', 'pending_owner', 'pending_rectify']

// ─────────────────────────────────────────────────────────────
// 验收单
// ─────────────────────────────────────────────────────────────

/**
 * 查某阶段当前未终结的验收单（AC-A03）。
 *
 * `FOR UPDATE` 是必需的：两个并发请求同时发起验收时，若只做普通查询，
 * 双方都会读到「没有未终结单」并各自插入一张 —— 唯一索引在这里帮不上忙，
 * 因为「未终结」是个状态条件而非唯一键。§6.2 明确要求该校验在事务内加锁执行。
 */
async function findOpenByStageForUpdate(tx, stageId) {
  const rows = await tx.query(
    `SELECT id, status FROM acceptance
      WHERE project_stage_id = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(', ')})
        AND deleted_at IS NULL
      FOR UPDATE`,
    [stageId, ...OPEN_STATUSES]
  )
  return rows.length > 0 ? rows[0] : null
}

async function create(data, tx) {
  const result = await tx.query(
    `INSERT INTO acceptance
       (project_id, project_stage_id, project_item_id, type, status, submitter_id, current_step, description, signature_mode)
     VALUES (?, ?, ?, ?, 'draft', ?, 'self_check', ?, ?)`,
    [
      data.projectId,
      data.projectStageId ?? null,
      data.projectItemId ?? null,
      data.type,
      data.submitterId,
      data.description ?? null,
      data.signatureMode === 'provider' ? 'provider' : 'legacy',
    ]
  )
  return result.insertId
}

async function findById(id, tx = db) {
  return tx.queryOne(
    // photos 是迁移 010 新增的列。查询列表漏掉它不会报错，
    // 只会让「现场照片」在所有读取路径上静默变成空数组 ——
    // 而 AC-A18 要求报告 PDF 必须包含现场照片
    `SELECT id, project_id, project_stage_id, project_item_id, type, status, submitter_id,
            submitted_at, current_step, step_entered_at, resubmit_count, finished_at,
            signature_url, signature_key, signature_mode, esign_status, esign_task_id, esign_completed_at,
            report_pdf_url, report_pdf_key, report_pdf_private, report_pdf_sha256,
            report_pdf_source, report_pdf_status, report_pdf_error, report_no,
            post_pass_status, post_pass_error, post_pass_done_at, description, photos,
            created_at, updated_at
       FROM acceptance WHERE id = ? AND deleted_at IS NULL`,
    [id]
  )
}

/** 加锁读取，供状态流转使用（§6.2 要求行锁） */
async function lockById(tx, id) {
  const rows = await tx.query(
    `SELECT id, project_id, project_stage_id, project_item_id, type, status, submitter_id,
            submitted_at, current_step, step_entered_at, resubmit_count, finished_at,
            signature_url, signature_key, signature_mode, esign_status, esign_task_id, esign_completed_at,
            report_pdf_url, report_pdf_key, report_pdf_private, report_pdf_sha256,
            report_pdf_source, report_pdf_status, report_pdf_error, report_no
       FROM acceptance WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
    [id]
  )
  return rows.length > 0 ? rows[0] : null
}

/**
 * 流转到下一个状态。
 *
 * `submitted_at` 只在这里首次写入 —— 它是「首次提交时刻」，永不变更（G-01）。
 * 更新语句里用 `COALESCE(submitted_at, NOW())` 而不是 `NOW()`：
 * 驳回后重新提交时，submitted_at 必须保持第一次的值，
 * 否则 AC-A22 的 48 小时超时与 AC-AD39 的平均验收周期都会被最后一次重提的时间重置。
 */
async function transition(id, { status, currentStep, stepEnteredAt, isFirstSubmit = false, resubmitIncrement = false }, tx) {
  const sets = ['status = ?', 'current_step = ?', 'step_entered_at = ?']
  const params = [status, currentStep ?? null, stepEnteredAt ?? null]

  if (isFirstSubmit) sets.push('submitted_at = COALESCE(submitted_at, NOW())')
  if (resubmitIncrement) sets.push('resubmit_count = resubmit_count + 1')

  params.push(id)
  await tx.query(`UPDATE acceptance SET ${sets.join(', ')} WHERE id = ?`, params)
}

/** 验收通过：终态 + 签名 + 完成时间。条件更新防止并发回调把已驳回的单子改成 passed。 */
async function markPassed(id, { signatureUrl, signatureKey, finishedAt, esignTaskId, esignStatus, esignCompletedAt }, tx) {
  const result = await tx.query(
    `UPDATE acceptance
        SET status = 'passed', current_step = NULL, step_entered_at = NULL,
            signature_url = ?, signature_key = ?, finished_at = ?,
            esign_task_id = COALESCE(?, esign_task_id),
            esign_status = COALESCE(?, esign_status),
            esign_completed_at = COALESCE(?, esign_completed_at),
            post_pass_status = 'pending'
      WHERE id = ? AND status = 'pending_owner'`,
    [
      signatureUrl ?? null,
      signatureKey ?? null,
      finishedAt,
      esignTaskId ?? null,
      esignStatus ?? null,
      esignCompletedAt ?? null,
      id,
    ]
  )
  return result.affectedRows
}

/** 更新 PDF 生成/归档状态（AC-A19：失败要有可重试入口，但不能阻断状态流转） */
async function updatePdfState(
  id,
  { status, url, error, key, private: isPrivate, sha256, source, reportNo },
  tx = db
) {
  await tx.query(
    `UPDATE acceptance
        SET report_pdf_status = ?, report_pdf_url = ?, report_pdf_key = ?,
            report_pdf_private = ?, report_pdf_sha256 = ?, report_pdf_source = ?,
            report_pdf_error = ?, report_no = COALESCE(?, report_no)
      WHERE id = ?`,
    [
      status,
      url ?? null,
      key ?? null,
      isPrivate ? 1 : 0,
      sha256 ?? null,
      source ?? 'generated',
      error ?? null,
      reportNo ?? null,
      id,
    ]
  )
}

async function updateEsignState(id, { status, taskId, completedAt }, tx = db) {
  const sets = ['esign_status = ?']
  const params = [status]
  if (taskId !== undefined) {
    sets.push('esign_task_id = ?')
    params.push(taskId)
  }
  if (completedAt !== undefined) {
    sets.push('esign_completed_at = ?')
    params.push(completedAt)
  }
  params.push(id)
  await tx.query(`UPDATE acceptance SET ${sets.join(', ')} WHERE id = ? AND status <> 'passed'`, params)
}

async function updatePostPassState(id, { status, error, doneAt }, tx = db) {
  const sets = ['post_pass_status = ?']
  const params = [status]
  if (error !== undefined) {
    sets.push('post_pass_error = ?')
    params.push(error)
  }
  if (doneAt !== undefined) {
    sets.push('post_pass_done_at = ?')
    params.push(doneAt)
  }
  params.push(id)
  await tx.query(`UPDATE acceptance SET ${sets.join(', ')} WHERE id = ?`, params)
}


async function updateDescription(id, description, tx = db) {
  await tx.query('UPDATE acceptance SET description = ? WHERE id = ?', [description, id])
}

// ─────────────────────────────────────────────────────────────
// 验收项（自检清单）
// ─────────────────────────────────────────────────────────────

async function createItems(acceptanceId, names, tx) {
  for (const [index, name] of names.entries()) {
    await tx.query('INSERT INTO acceptance_item (acceptance_id, seq, name) VALUES (?, ?, ?)', [
      acceptanceId,
      index + 1,
      name,
    ])
  }
}

async function listItems(acceptanceId, tx = db) {
  return tx.query(
    'SELECT id, seq, name, result, remark FROM acceptance_item WHERE acceptance_id = ? AND deleted_at IS NULL ORDER BY seq',
    [acceptanceId]
  )
}

/**
 * 批量写入自检结果。
 *
 * @param {Array<{id: number, result: 'pass'|'fail'|null, remark?: string}>} results
 */
async function saveItemResults(acceptanceId, results, tx) {
  for (const row of results) {
    // 带上 acceptance_id 条件：itemId 是自增主键、可被枚举，
    // 少了它就能改别的验收单的自检项
    await tx.query('UPDATE acceptance_item SET result = ?, remark = ? WHERE id = ? AND acceptance_id = ?', [
      row.result,
      row.remark ?? null,
      row.id,
      acceptanceId,
    ])
  }
}

// ─────────────────────────────────────────────────────────────
// 流转记录（只追加 —— 本模块不提供任何修改方法）
// ─────────────────────────────────────────────────────────────

/**
 * 追加一条流转记录。
 *
 * 这是本模块对 acceptance_flow **唯一**的写操作。不要新增 update / delete ——
 * AC-A14 要求「此前流转记录不被覆盖或删除」，AC-A26 要求「对任何角色只读」。
 * 数据库层管不了这件事（MySQL 没有表级只读约束），只能靠这里不提供入口。
 */
async function appendFlow(
  { acceptanceId, round, step, operatorId, action, reason, images, esignTaskId, signatureUrl, signatureKey },
  tx = db
) {
  const result = await tx.query(
    `INSERT INTO acceptance_flow
       (acceptance_id, round, step, operator_id, action, reason, images, esign_task_id, signature_url, signature_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      acceptanceId,
      round,
      step,
      operatorId,
      action,
      reason ?? null,
      images ? JSON.stringify(images) : null,
      esignTaskId ?? null,
      signatureUrl ?? null,
      signatureKey ?? null,
    ]
  )
  return result.insertId
}

/**
 * 通过后联动失败的验收单（付款解锁/通知补偿）。
 * 只取 passed 且 pending/failed 的；done 的不再扫。
 */
async function listPostPassPending(limit = 100) {
  return db.query(
    // `type` 必须带上：finalizeAfterPass 靠它判断「阶段验收要补生成阶段结算草稿」。
    // 之前只选了阶段 id，补跑时 type 恒为 undefined，草稿生成被静默跳过却仍标记 done。
    `SELECT id, type, project_id, project_stage_id, signature_mode, report_pdf_status
       FROM acceptance
      WHERE status = 'passed' AND deleted_at IS NULL
        AND post_pass_status IN ('pending', 'failed')
      ORDER BY id ASC LIMIT ?`,
    [limit]
  )
}

/**
 * 某验收单的完整流转记录（AC-A09：按时间正序，可读成一条故事线）
 */
async function listFlow(acceptanceId) {
  return db.query(
    `SELECT f.id, f.round, f.step, f.operator_id, f.action, f.reason, f.images, f.esign_task_id,
            f.signature_url, f.signature_key, f.operated_at, u.nickname, u.real_name
       FROM acceptance_flow f
       LEFT JOIN user u ON u.id = f.operator_id
      WHERE f.acceptance_id = ?
      ORDER BY f.round ASC, f.operated_at ASC, f.id ASC`,
    [acceptanceId]
  )
}

/**
 * 某验收单当前是第几轮。
 *
 * ── 用 `resubmit_count + 1`，**不要**用 `MAX(round) + 1` ──
 * 后者看似等价，实际是错的：同一轮里插入第二条记录时，
 * `MAX(round)` 已经等于当前轮次，于是第二条起每条都被算成新的一轮 ——
 * 一次「提交 + 驳回」会被拆成两轮，流程记录读起来完全错乱。
 *
 * `resubmit_count` 是「这张单被重新提交过几次」，它在一轮内是**恒定**的，
 * 只有再次重新提交才递增。这正是轮次的定义。
 */
function currentRound(acceptance) {
  return Number(acceptance.resubmit_count || 0) + 1
}

/** 是否有过驳回（AC-AD39 的驳回率统计口径） */
async function hasRejection(acceptanceId) {
  return db.count('FROM acceptance_flow WHERE acceptance_id = ? AND action = ?', [acceptanceId, 'reject'])
}

// ─────────────────────────────────────────────────────────────
// 列表（AC-A23 的分组依据）
// ─────────────────────────────────────────────────────────────

/**
 * 某项目下的验收单，含阶段名与提交人。
 *
 * 不分页：一个项目的验收单数量与阶段数同量级（几十条以内），
 * 而列表要按「待我处理 / 进行中 / 已完成」分组统计角标 ——
 * 分页会让分组计数变得没有意义（每页各算一次）。
 */
async function listByProject(projectId) {
  return db.query(
    `SELECT a.id, a.project_id, a.project_stage_id, a.project_item_id, a.type, a.status,
            a.submitter_id, a.submitted_at, a.current_step, a.step_entered_at, a.resubmit_count,
            a.finished_at, a.signature_url, a.signature_key, a.signature_mode, a.esign_status,
            a.report_pdf_status, a.report_pdf_error, a.report_no, a.created_at,
            s.name AS stage_name, i.name AS item_name,
            u.nickname AS submitter_nickname, u.real_name AS submitter_real_name,
            (SELECT COUNT(*) FROM acceptance_flow f WHERE f.acceptance_id = a.id AND f.action = 'reject') AS reject_count
       FROM acceptance a
       LEFT JOIN project_stage s ON s.id = a.project_stage_id
       LEFT JOIN project_item i ON i.id = a.project_item_id
       LEFT JOIN user u ON u.id = a.submitter_id
      WHERE a.project_id = ? AND a.deleted_at IS NULL
      ORDER BY a.id DESC`,
    [projectId]
  )
}

/**
 * 跨项目验收收件箱（C-3.1）。
 *
 * 按「当前用户是该项目 active 成员」聚合，而不是按单个项目查 ——
 * 一个监理/业主可能同时参与多个项目，验收 tab 必须一次看到所有待办。
 *
 * 同时带出 `pm.role / pm.is_primary`：角色虽是账号级固定的，
 * 但「待我处理」仍要确认用户在这个项目里是 active 成员，以及是否主工长 ——
 * 成员关系可能被移除，不能只看账号角色。
 */
async function listInboxForUser(userId) {
  return db.query(
    `SELECT a.id, a.project_id, a.project_stage_id, a.project_item_id, a.type, a.status,
            a.submitter_id, a.submitted_at, a.current_step, a.step_entered_at,
            a.resubmit_count, a.finished_at, a.signature_url, a.signature_key, a.signature_mode, a.esign_status,
            a.report_pdf_status, a.created_at,
            p.tenant_id, t.name AS tenant_name,
            p.name AS project_name, p.address AS project_address, p.status AS project_status,
            s.name AS stage_name, s.seq AS stage_seq, s.progress AS stage_progress,
            s.gate_status AS stage_gate_status,
            i.name AS item_name,
            u.nickname AS submitter_nickname, u.real_name AS submitter_real_name,
            fu.nickname AS foreman_nickname, fu.real_name AS foreman_real_name, fu.phone AS foreman_phone,
            pm.role AS my_role, pm.is_primary AS my_primary, pm.owner_type AS my_owner_type,
            (SELECT COUNT(*) FROM acceptance_flow f WHERE f.acceptance_id = a.id AND f.action = 'reject') AS reject_count
       FROM acceptance a
       JOIN project p ON p.id = a.project_id AND p.deleted_at IS NULL
       JOIN tenant t ON t.id = p.tenant_id AND t.deleted_at IS NULL
       JOIN project_member pm ON pm.project_id = a.project_id AND pm.user_id = ?
            AND pm.status = 'active' AND pm.deleted_at IS NULL
       LEFT JOIN project_stage s ON s.id = a.project_stage_id
       LEFT JOIN project_item i ON i.id = a.project_item_id
       LEFT JOIN user u ON u.id = a.submitter_id
       LEFT JOIN project_member fpm ON fpm.project_id = a.project_id AND fpm.role = 'foreman'
            AND fpm.is_primary = 1 AND fpm.status = 'active' AND fpm.deleted_at IS NULL
       LEFT JOIN user fu ON fu.id = fpm.user_id
      WHERE a.deleted_at IS NULL
      ORDER BY COALESCE(a.step_entered_at, a.created_at) DESC, a.id DESC`,
    [userId]
  )
}

/**
 * 主工长可以发起验收的阶段（首页/验收收件箱的「可发起验收」）。
 *
 * 条件必须与 `acceptance.service.createAcceptance` 的校验一致：
 * 阶段进度 100% + 门禁 pending_acceptance + 没有未终结验收单。
 * 少查一个条件，前端就会给出一个点进去必然 409 的按钮。
 */
async function listInitiablesForUser(userId) {
  const openPlaceholders = OPEN_STATUSES.map(() => '?').join(', ')

  return db.query(
    `SELECT ps.id AS stage_id, ps.project_id, ps.name AS stage_name, ps.seq AS stage_seq,
            ps.progress AS stage_progress, ps.gate_status AS stage_gate_status,
            p.tenant_id, t.name AS tenant_name,
            p.name AS project_name, p.address AS project_address, p.status AS project_status,
            u.nickname AS foreman_nickname, u.real_name AS foreman_real_name, u.phone AS foreman_phone
       FROM project_stage ps
       JOIN project p ON p.id = ps.project_id AND p.deleted_at IS NULL
       JOIN tenant t ON t.id = p.tenant_id AND t.deleted_at IS NULL
       JOIN project_member pm ON pm.project_id = ps.project_id AND pm.user_id = ?
            AND pm.status = 'active' AND pm.deleted_at IS NULL
            AND pm.role = 'foreman' AND pm.is_primary = 1
       JOIN user u ON u.id = pm.user_id
      WHERE ps.deleted_at IS NULL
        AND t.status = 'active'
        AND (t.expires_at IS NULL OR t.expires_at > NOW())
        AND ps.gate_status = 'pending_acceptance'
        AND ps.progress >= 100
        AND p.status <> 'archived'
        AND NOT EXISTS (
          SELECT 1 FROM acceptance a
           WHERE a.project_stage_id = ps.id AND a.deleted_at IS NULL
             AND a.status IN (${openPlaceholders})
        )
      ORDER BY ps.id DESC`,
    [userId, ...OPEN_STATUSES]
  )
}

/**
 * 扫描超时未处理的验收单（AC-A22：进入「待我处理」超过 48 小时）。
 *
 * 用 `step_entered_at` 而不是 `submitted_at` 作为起点 ——
 * 重新提交会刷新前者，后者永不变化。超时提醒应该以「进入当前环节」为准，
 * 否则一张被驳回过、重新提交的单会立刻被判为超时。
 */
async function listTimeoutCandidates() {
  return db.query(
    // `resubmit_count` 必须带上：调用方要用它算「第几轮」，
    // 漏掉会得到 undefined + 1 = NaN，而去重键里的 NaN 会变成一个
    // 看起来合法、实际恒定不变的字符串（acceptance_rNaN）——
    // 于是所有轮次共用同一个键，第二轮的提醒被静默判定为「已发过」
    // JOIN project 取租户：超时时长是**按租户**配置的，没有租户就不知道该用哪套阈值
    // `project_stage_id` 也必须选出来：超时提醒的文案要带阶段名。
    // 漏选它不会报错，只会让每条提醒都写成「验收单」——
    // 收件人无法判断到底是哪个阶段卡住了（CLAUDE.md 第 55 条：少 SELECT 一列
    // 的症状就是「安静地少做一件事」）
    `SELECT a.id, a.project_id, a.project_stage_id, p.tenant_id, a.status, a.current_step,
            a.step_entered_at, a.submitter_id, a.resubmit_count, a.esign_status
       FROM acceptance a
       JOIN project p ON p.id = a.project_id AND p.deleted_at IS NULL
       JOIN tenant t ON t.id = p.tenant_id AND t.deleted_at IS NULL
      WHERE a.status IN ('pending_supervisor', 'pending_owner')
        AND a.deleted_at IS NULL
        AND a.step_entered_at IS NOT NULL
        -- 停用/到期租户的用户做不了任何处理（C 端只读），继续催办
        -- 只会制造噪音；等租户恢复后下一轮扫描会自然补上
        AND t.status = 'active'
        AND (t.expires_at IS NULL OR t.expires_at > NOW())`
  )
}

/**
 * 某项目全部已通过的验收单（竣工总报告用）。
 *
 * 只取 passed，不包含草稿与流转中的单子 —— 总报告是归档材料，
 * 未通过的验收不应被当成「已验收」写进去。
 * 阶段名 / 工序名一并带出，避免服务层逐条再查。
 */
async function listPassedByProject(projectId) {
  return db.query(
    `SELECT a.id, a.type, a.project_stage_id, a.project_item_id, a.status,
            a.resubmit_count, a.submitted_at, a.finished_at,
            a.signature_mode, a.signature_url, a.signature_key, a.esign_status,
            a.report_pdf_status,
            s.name AS stage_name, s.seq AS stage_seq,
            i.name AS item_name
       FROM acceptance a
       LEFT JOIN project_stage s ON s.id = a.project_stage_id AND s.deleted_at IS NULL
       LEFT JOIN project_item i ON i.id = a.project_item_id AND i.deleted_at IS NULL
      WHERE a.project_id = ? AND a.status = 'passed' AND a.deleted_at IS NULL
      ORDER BY s.seq, a.finished_at, a.id`,
    [projectId]
  )
}

module.exports = {
  OPEN_STATUSES,
  listPassedByProject,
  findOpenByStageForUpdate,
  create,
  findById,
  lockById,
  transition,
  markPassed,
  updatePdfState,
  updateEsignState,
  updatePostPassState,
  updateDescription,
  createItems,
  listItems,
  saveItemResults,
  appendFlow,
  listFlow,
  currentRound,
  hasRejection,
  listByProject,
  listInboxForUser,
  listInitiablesForUser,
  listTimeoutCandidates,
  listPostPassPending,
}
