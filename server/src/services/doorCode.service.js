'use strict'

/**
 * 门锁密码管理（§4.8 / AC-K01 ~ AC-K16）。
 *
 * ════════════════════════════════════════════════════════════════════
 * 本模块处理的是**本项目敏感级别最高的数据**：能打开业主家门的凭证。
 * 它的处理规则与其余模块刻意不同。改动本文件前请先读完 §4.8.3 与
 * CLAUDE.md 第 44 条。
 * ════════════════════════════════════════════════════════════════════
 *
 * ── 五条硬约束（对应 AC-K06 ~ AC-K10）──
 * 1. **可逆加密**：AES-256-GCM。不能用 bcrypt —— 单向的，工长取不出明文。
 * 2. **密钥分离**：只从环境变量读，不进数据库 / 仓库 / 日志。
 * 3. **明文绝不进日志**：靠 `utils/logger.js` 的脱敏名单，不靠人记得。
 * 4. **不缓存**：含密码的响应带 `Cache-Control: no-store`。
 * 5. **读取留痕**：每条密码被读到就写一条 operation_log。
 *
 * ── 失效有三条路径，都在「既有流程里顺带处理」而不是新增校验入口 ──
 *   项目归档（AC-K12）、成员被移除（AC-K13）、业主手动失效（AC-K14）。
 * 前两条不是本模块主动触发的，而是归档与移人时**顺带**发生的 ——
 * 之前在设计上说得很清楚：多一个校验入口，就多一条漏掉的可能。
 * 本模块的可读性完全由「成员关系 + 项目状态 + 条目状态」三者派生，
 * 不维护任何自己的权限表。
 */

const config = require('../../config')
const AppError = require('../utils/AppError')
const logger = require('../utils/logger')
const crypto = require('../utils/crypto')
const db = require('../db/pool')
const doorCodeModel = require('../models/doorCode.model')
const operationLogModel = require('../models/operationLog.model')
const projectAccess = require('./projectAccess.service')
const projectMemberModel = require('../models/projectMember.model')
const notificationService = require('./notification.service')
const operationLog = require('./operationLog.service')

/** 可查看密码的角色：工长、监理、业主。**不含后台管理员**（AC-K02） */
const VIEWER_ROLES = ['foreman', 'supervisor', 'owner']

/** 可管理密码的角色：仅业主（AC-K01） */
const MANAGER_ROLE = 'owner'

const ROLE_LABELS = { foreman: '工长', supervisor: '监理', owner: '业主' }

/**
 * 取加密密钥。
 *
 * 惰性解析并缓存：解析本身是纯计算，但每次请求都做一遍 base64 解码没有意义。
 * **密钥只在这里出现**，不写进任何日志、不挂到 config 上供别处引用 ——
 * 挂上去之后，任何一次 `logger.debug(config)` 都会把密钥写进日志文件。
 */
let cachedKey = null

function getKey() {
  if (cachedKey) return cachedKey

  if (!config.doorCode.key) {
    if (config.isProd) {
      // 走不到这里：assertKeyConfigured 在启动时就退出了。
      // 留着是为了「有人绕过启动自检直接 require 本模块」的情形
      throw new Error('生产环境未配置 DOOR_CODE_KEY，拒绝加解密门锁密码')
    }
    logger.warn('未配置 DOOR_CODE_KEY，使用派生开发密钥 —— 生产环境会直接拒绝启动')
    cachedKey = crypto.deriveDevKey()
    return cachedKey
  }

  cachedKey = crypto.parseKey(config.doorCode.key)
  return cachedKey
}

/**
 * 启动期安全自检（AC-K10）。由 server.js 调用，失败则拒绝启动。
 *
 * ── 为什么生产环境「没有密钥」也要拒绝启动 ──
 * 一个自然的选择是「没有密钥就用开发派生密钥」，但那样部署到生产的人
 * 不会发现任何异常 —— 直到某天有人发现所有业主家的门锁密码都用了
 * 一个公开在源码里的密钥加密。
 * 把「缺密钥」变成「起不来」，与 WX_MOCK 的处理是同一个判断：
 * **危险配置必须是启动失败，不能是运行时的静默降级。**
 *
 * ── 为什么参数是显式传入而不是直接读 config ──
 * `config` 是深冻结的，测试改不动它 —— 而「生产把密钥配错」恰恰是最需要
 * 被测住的情形。因此这里做成接收参数的纯函数，与
 * `password.checkBcryptRounds(rounds)` 同一个模式（CLAUDE.md 第 46 条）。
 *
 * @param {{isProd?: boolean, key?: string}} [overrides] 仅测试使用
 */
function assertKeyConfigured(overrides = {}) {
  const isProd = overrides.isProd ?? config.isProd
  const key = overrides.key ?? config.doorCode.key

  if (!isProd) return

  if (!key) {
    throw new Error(
      '生产环境必须配置 DOOR_CODE_KEY（门锁密码加密密钥）。' +
        '生成方式：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"。' +
        '注意：密钥丢失 = 所有已存的门锁密码永久不可恢复'
    )
  }

  // 格式错误同样当场退出：等到第一个业主设置密码时才报错，
  // 那时错误会以一个 500 的形式出现在用户面前，而不是在部署日志里
  crypto.parseKey(key)
}

// ─────────────────────────────────────────────────────────────
// 权限：全部由「项目成员关系 + 项目状态」派生，不维护自己的权限表
// ─────────────────────────────────────────────────────────────

/**
 * 取当前用户在本项目中的成员记录，并要求其为可查看者。
 *
 * ── 非成员返回 404 且提示与「项目不存在」完全相同（AC-K04）──
 * 这里刻意不区分「项目不存在」与「我不是这个项目的成员」：
 * 门锁密码的存在本身就是敏感信息（等于告诉对方「这个门牌号有人住」）。
 */
async function loadMember(userId, projectId) {
  const member = await projectMemberModel.findActiveRole(projectId, userId)
  if (!member) throw AppError.notFound('项目不存在')
  return member
}

/**
 * 断言可以**查看**密码（AC-K02 / AC-K05 / AC-K12）。
 *
 * 三条判断缺一不可：
 *   1. 角色在工长 / 监理 / 业主之内（pending 成员没有 active 记录，天然被挡住）；
 *   2. 项目未归档 —— 归档后全链路只读，门锁密码也不例外（AC-K12）；
 *   3. 项目未被软删除。
 *
 * 这里**不查后台管理员**：本模块的接口都挂在 C 端（`/projects/...`），
 * 后台 token 的 audience 不同，在鉴权中间件就被拒了 —— 也就是说
 * 「管理员查看门锁密码」这件事在到达本函数之前就不可能发生。
 */
async function assertCanView(userId, projectId) {
  const member = await loadMember(userId, projectId)
  if (!VIEWER_ROLES.includes(member.role)) {
    throw AppError.forbidden('无权查看门锁密码')
  }

  const project = await db.queryOne('SELECT id, status, deleted_at FROM project WHERE id = ? AND deleted_at IS NULL', [
    projectId,
  ])
  if (!project) throw AppError.notFound('项目不存在')
  if (project.status === 'archived') {
    // AC-K12 明确要求 403 而不是「列表为空」：空列表会让业主以为
    // 「我设的密码怎么没了」，而 403 说清了原因
    throw AppError.forbidden('项目已归档，门锁密码不可查看')
  }

  return { member, project }
}

/** 断言可以**管理**密码（AC-K01）。仅业主 */
async function assertCanManage(userId, projectId) {
  const member = await loadMember(userId, projectId)
  if (member.role !== MANAGER_ROLE) {
    throw AppError.forbidden('仅业主可管理门锁密码')
  }

  const project = await db.queryOne(
    "SELECT id, status, name FROM project WHERE id = ? AND deleted_at IS NULL",
    [projectId]
  )
  if (!project) throw AppError.notFound('项目不存在')
  // 归档后全链路只读（AC-AD25）。业主也不能再改密码 ——
  // 「归档」的语义就是项目结束了，此时还能改门锁密码会让这个状态失去意义
  if (project.status === 'archived') throw AppError.forbidden('项目已归档，无法修改门锁密码')

  return { member, project }
}

// ─────────────────────────────────────────────────────────────
// 读：列表与访问记录
// ─────────────────────────────────────────────────────────────

/**
 * 密码列表（AC-K02 / AC-K11）。
 *
 * ── 每条被解密出来的密码都要写一条访问日志（AC-K09）──
 * 「同一次请求连续读两次记两条」—— 日志的粒度是**条目**而不是请求。
 * 因此循环里逐条 record，不能在循环外写一条汇总的。
 *
 * ── 只查 active 的条目 ──
 * 已失效的密码不出现在列表里（AC-K14）。业主若想看「我失效过哪些」，
 * 走访问记录接口 —— 那条路径同时告诉他「谁曾经看过」。
 */
async function list(userId, projectId, { ip, requestId }) {
  const { member } = await assertCanView(userId, projectId)

  const rows = await doorCodeModel.listByProject(projectId)
  const key = getKey()

  const operator = { type: 'mini', id: userId, ip, requestId }
  const list = []

  for (const row of rows) {
    let code = null
    try {
      code = crypto.decrypt(row.code_cipher, key)
    } catch (err) {
      // ── 解密失败绝不能让整个列表 500，也不能返回空串 ──
      // 空串会让工长以为「密码是空的」，站在门口反复试；
      // 抛错则会让**一条**坏数据的代价变成「所有人都看不了任何密码」。
      // 折中是：这一条标记为不可用，其余照常返回，并留下 error 级日志
      logger.error('门锁密码解密失败，该条目已标记为不可用', {
        doorCodeId: row.id,
        projectId,
        message: err.message,
      })
    }

    if (code !== null) {
      // AC-K09：**每条**被读到的密码都留痕。operator_type='user' 由 fromOperator 映射
      await operationLog.record(
        {
          ...operationLog.fromOperator(operator),
          action: operationLog.ACTIONS.DOOR_CODE_READ,
          targetType: 'door_code',
          targetId: row.id,
          projectId,
        },
        undefined,
        // AC-K09 的读审计是这条链路唯一的留痕：写不进去就不能返回明文
        { strict: true }
      )
    }

    list.push({
      id: row.id,
      name: row.name,
      // 解密失败时为 null 而不是空串，前端据此显示「该密码暂不可用，请联系业主重新设置」
      code,
      available: code !== null,
      remark: row.remark,
      createdAt: row.created_at,
    })
  }

  return {
    projectId,
    myRole: member.role,
    // 只有业主能改，前端据此决定要不要展示「修改 / 失效」按钮。
    // 这只是 UI 提示，真正的拦截在 assertCanManage
    canManage: member.role === MANAGER_ROLE,
    list,
    // AC-U12 同口径的能力边界，必须同时回给前端展示给用户看
    disclaimer:
      '本功能仅用于装修期间临时保管门锁密码，不是安防方案。' +
      '系统无法阻止拿到密码的人开门，也无法感知有人开门；' +
      '「失效」只作用于本系统内的可见性，不改变实体锁上的密码。' +
      '如需更高安全性，请使用智能门锁自带的临时密码功能。',
  }
}

/**
 * 访问记录（AC-K03 / AC-K06 的「谁看过」）。
 *
 * 只有业主能看。这不是防着工长 —— 而是给业主的**对等保障**：
 * 既然密码对工长与监理直接可见，业主就有权知道谁看过。
 */
async function accessLog(userId, projectId, paging) {
  // loadMember 直接返回成员行，不包一层 —— 早先写成 `const { member } = ...`
  // 拿到的是 undefined，于是「业主查看访问记录」变成了 500。
  // 这类解构错误不会在类型层面暴露（JS 没有类型），只能靠测试覆盖到
  const member = await loadMember(userId, projectId)
  if (member.role !== MANAGER_ROLE) throw AppError.forbidden('仅业主可查看密码访问记录')

  const { total, rows } = await operationLogModel.listAccessLog({
    projectId,
    action: operationLog.ACTIONS.DOOR_CODE_READ,
    offset: paging.offset,
    limit: paging.limit,
  })

  return {
    list: rows.map((row) => ({
      id: row.id,
      userId: row.operator_id,
      userName: row.operator_name,
      roleLabel: null,
      codeName: row.code_name,
      // 记录的是「读取动作」，不含密码本身 —— 访问日志里出现明文密码
      // 等于给密码又开了一条泄露路径
      viewedAt: row.created_at,
      ip: row.ip,
    })),
    total,
  }
}

// ─────────────────────────────────────────────────────────────
// 写：新增 / 修改 / 失效 —— 仅业主
// ─────────────────────────────────────────────────────────────

async function create(userId, projectId, input, ctx) {
  const { project } = await assertCanManage(userId, projectId)

  const code = normalizeCode(input.code)
  const cipher = crypto.encrypt(code, getKey())

  const id = await doorCodeModel.create({
    projectId,
    name: input.name,
    codeCipher: cipher,
    remark: input.remark,
    createdBy: userId,
  })

  // 日志里只记条目 id 与名称，**绝不记密码**。
  // 写日志的调用方很容易顺手把 input 整个塞进 detail —— 那正是这里要避免的
  await operationLog.record({
    ...operationLog.fromOperator({ type: 'mini', id: userId, ip: ctx.ip, requestId: ctx.requestId }),
    action: operationLog.ACTIONS.DOOR_CODE_CREATE,
    targetType: 'door_code',
    targetId: id,
    projectId,
    detail: { after: { name: input.name, hasRemark: Boolean(input.remark) } },
  })

  // AC-K11：设置成功后，本项目**已确认**的工长与监理立即可以查看，
  // 无需业主再次操作。这里不发「授权」，只是通知他们「可以去看了」——
  // 可见性本身由成员关系决定，不需要任何显式授权动作（那正是 C-8.4 的意思）
  await notifyViewers(projectId, userId, {
    title: '业主已设置门锁密码',
    content: `「${project.name}」的业主设置了门锁密码「${input.name}」，可在项目详情中查看。`,
    refType: 'project',
    refId: projectId,
  })

  return { id, name: input.name }
}

async function update(userId, doorCodeId, input, ctx) {
  const existing = await doorCodeModel.findById(doorCodeId)
  if (!existing) throw AppError.notFound('门锁密码不存在')

  await assertCanManage(userId, existing.project_id)

  if (existing.status !== 'active') {
    // 失效是不可逆的：让已失效的条目「复活」意味着
    // 已经按失效通知做过处置的人（比如以为可以换锁了）被静默推翻
    throw AppError.conflict('该密码已失效，无法修改。请新增一条')
  }

  await doorCodeModel.updateActive(doorCodeId, {
    name: input.name,
    codeCipher: input.code === undefined ? undefined : crypto.encrypt(normalizeCode(input.code), getKey()),
    remark: input.remark,
  })

  await operationLog.record({
    ...operationLog.fromOperator({ type: 'mini', id: userId, ip: ctx.ip, requestId: ctx.requestId }),
    action: operationLog.ACTIONS.DOOR_CODE_UPDATE,
    targetType: 'door_code',
    targetId: doorCodeId,
    projectId: existing.project_id,
    detail: {
      before: { name: existing.name, remark: existing.remark },
      after: { name: input.name ?? existing.name, remark: input.remark ?? existing.remark },
      // **只记「密码是否变了」，不记任何一版密码**
      codeChanged: input.code !== undefined,
    },
  })

  return { id: doorCodeId }
}

/**
 * 失效（AC-K14）。
 *
 * ── 失效之后发生什么，才是这个功能的重点 ──
 * 「不可查看」只是系统内的事，而**已经记下密码的人仍然能一直开门**。
 * 因此失效时必须：
 *   1. 清掉本地缓存的提示 —— 通过给所有可查看者发一条「密码已失效」通知；
 *   2. 让业主知道「你还需要做什么」—— 也就是换锁。这一点在通知文案里写明，
 *      否则业主会以为点了失效就安全了。**这是本模块最容易造成实际损失的地方。**
 */
async function revoke(userId, doorCodeId, ctx) {
  const existing = await doorCodeModel.findById(doorCodeId)
  if (!existing) throw AppError.notFound('门锁密码不存在')

  const { project } = await assertCanManage(userId, existing.project_id)
  if (existing.status !== 'active') throw AppError.conflict('该密码已失效')

  await doorCodeModel.revoke(doorCodeId, { revokedBy: userId })

  await operationLog.record({
    ...operationLog.fromOperator({ type: 'mini', id: userId, ip: ctx.ip, requestId: ctx.requestId }),
    action: operationLog.ACTIONS.DOOR_CODE_REVOKE,
    targetType: 'door_code',
    targetId: doorCodeId,
    projectId: existing.project_id,
    detail: { before: { status: 'active', name: existing.name }, after: { status: 'revoked' } },
  })

  await notifyViewers(existing.project_id, null, {
    title: '门锁密码已失效',
    content:
      `「${project.name}」的业主已失效门锁密码「${existing.name}」。` +
      '若你此前记录过该密码，请立即删除记录 —— 它已不能在本系统中查看。',
    refType: 'project',
    refId: existing.project_id,
  })

  return { id: doorCodeId, status: 'revoked' }
}

// ─────────────────────────────────────────────────────────────
// 辅助
// ─────────────────────────────────────────────────────────────

/**
 * 规范化并校验密码明文。
 *
 * ── 只 trim，不做任何其它变换 ──
 * 密码的每一位都可能有意义（前导零、空格）。把 `0123` 当成 `123` 处理，
 * 业主设的密码与工长看到的就不是同一个 —— 而这没有任何办法当场发现，
 * 只能等工长站在门口打不开门。
 *
 * 反过来，首尾空白几乎必然是复制粘贴带来的，因此 trim 是安全的；
 * 但**中间**的空格必须原样保留（有些智能锁的管理密码带空格）。
 */
function normalizeCode(raw) {
  const value = String(raw ?? '')
  if (value.trim() === '') throw AppError.badRequest('请输入门锁密码')

  const trimmed = value.trim()
  if (trimmed.length > config.doorCode.maxLength) {
    throw AppError.badRequest(`门锁密码不超过 ${config.doorCode.maxLength} 位`)
  }
  return trimmed
}

/**
 * 通知本项目所有可查看者（工长 / 监理）。
 *
 * `excludeUserId` 用于排除操作者自己 —— 业主改完自己的密码不必再收一条通知。
 *
 * ── 用 `notifyEach` 而不是 `notifyMany` ──
 * 后者是**带去重**的（每个事件只提醒一次）。而「设置了密码」「密码失效」
 * 这类通知是**每次都该说一次**的事件：改了三次密码就要发三条，
 * 用带去重的那条通道会让第二次之后的修改悄无声息地没人知道 ——
 * 而工长恰好最需要知道「密码换了」。
 */
async function notifyViewers(projectId, excludeUserId, { title, content, refType, refId }) {
  const rows = await db.query(
    `SELECT DISTINCT pm.user_id
       FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pm.project_id = ?
        AND pm.role IN ('foreman', 'supervisor')
        AND pm.status = 'active'
        AND pm.deleted_at IS NULL`,
    [projectId]
  )

  const targets = rows.map((r) => r.user_id).filter((id) => id !== excludeUserId)
  if (targets.length === 0) return

  await notificationService.notifyEach(targets, {
    type: notificationService.TYPES.SYSTEM,
    title,
    content,
    projectId,
    refType,
    refId,
  })
}

/**
 * 项目归档 / 成员被移除时的业主提醒（AC-K15）。
 *
 * ── 为什么由本模块提供，而不是让归档与移人的代码各写一遍 ──
 * 两处触发点（`project.service.archiveProject` 与
 * `projectMember.service.removeMember`）都要「顺带」做这件事。
 * 把文案、去重键、收件人判断收在这里，两处调用点各自只有一行 ——
 * 若让它们各写一遍，两边的文案与去重口径迟早不一致。
 *
 * ── 去重靠 `reminder_log` 的唯一键，`refId` 是**事件标识**而不是项目 id ──
 * 用项目 id 做 refId 的话，一个项目一辈子只会提醒一次：
 * 第一次移除成员时提醒过，之后归档就再也不会提醒了 —— 而那是两次独立的风险事件。
 * 因此调用方传入事件标识（成员 id / 归档时间戳）。
 *
 * @param {number} projectId
 * @param {string} refType 事件类型：project_member / project
 * @param {number} refId 事件标识
 * @param {string} reason 触发原因，写进通知正文
 */
async function warnOwnerToChangeLock(projectId, { refType, refId, reason }) {
  // 没有任何生效中的密码时不必打扰业主 —— 「建议更换门锁密码」
  // 对没设过密码的项目毫无意义，而这种噪音会让真正的提醒被忽略
  if ((await doorCodeModel.countActive(projectId)) === 0) return { sent: false, reason: 'no_active_code' }

  const owners = await db.query(
    `SELECT DISTINCT pm.user_id
       FROM project_member pm
       JOIN user u ON u.id = pm.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pm.project_id = ? AND pm.role = 'owner' AND pm.status = 'active' AND pm.deleted_at IS NULL`,
    [projectId]
  )

  if (owners.length === 0) return { sent: false, reason: 'no_owner' }

  const results = await notificationService.notifyMany(
    owners.map((o) => o.user_id),
    {
      projectId,
      reminderType: 'door_code_risk',
      type: notificationService.TYPES.SYSTEM,
      refType,
      refId,
      title: '建议更换门锁密码',
      content: `${reason}，此前获得门锁密码的成员已无法在系统中查看。若密码曾被对方记录，建议更换实体门锁密码。`,
    }
  )

  return { sent: results.some((r) => r.sent) }
}

module.exports = {
  VIEWER_ROLES,
  MANAGER_ROLE,
  assertKeyConfigured,
  list,
  accessLog,
  create,
  update,
  revoke,
  warnOwnerToChangeLock,
  normalizeCode,
}
