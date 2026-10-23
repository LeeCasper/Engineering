'use strict'

/**
 * 系统配置读取（B-5.1 ~ B-5.9）。
 *
 * §6.2 约定 `sys_config.config_value` 统一以字符串存储，由应用层按配置项定义解析类型。
 * 本模块就是那个「应用层」，对外只暴露带类型的读取方法，业务代码不该看到裸字符串。
 *
 * ── 缓存策略 ──
 * 配置读得极其频繁（每次提交汇报都要读「照片上限」），但改得极少。
 * 因此进程内缓存 60 秒，且**接受最多 60 秒的不一致** —— §5.5 明确要求
 * 「配置变更只对新产生的数据生效，不回溯改写历史记录」，所以哪怕缓存旧值，
 * 影响范围也只是这 60 秒内新产生的数据，与「不回溯」的原则不冲突。
 *
 * 不用 Redis：配置是全局且极小的，放本进程内存里最快，也少一次网络往返。
 * 代价是多实例部署下各进程的 60 秒窗口不同步 —— 对配置项来说可以接受。
 */

const db = require('../db/pool')
const logger = require('../utils/logger')
const AppError = require('../utils/AppError')
const sysConfigModel = require('../models/sysConfig.model')
const operationLog = require('./operationLog.service')

const CACHE_TTL_MS = 60_000

/** @type {Map<string, {value: string|null, loadedAt: number}>} */
const cache = new Map()

/** 全部全局配置的键名 → 默认值。默认值必须与种子数据一致（scripts/seed.js） */
const DEFAULTS = {
  sign_in_distance_threshold: '500',
  stale_report_days: '3',
  acceptance_timeout_hours: '48',
  big_expense_ratio: '0.1',
  report_max_images: '9',
  report_max_videos: '1',
  report_max_video_seconds: '60',
  route_max_points: '10',
  operation_log_retention: 'forever',
  gate_strength: 'standard',
  support_contact: '',
}

/**
 * 取配置原始字符串。
 *
 * ── 必须带 tenantId ──
 * 多租户之后每个租户有自己的一套配置。少了租户参数会取到**任意一个租户**的值，
 * 而症状极其隐蔽：租户 B 的照片上限突然变成租户 A 设的 3 张，
 * 用户只会以为「系统坏了」，排查时也想不到是配置串了。
 *
 * ── 缓存键也是 `${tenantId}:${key}` ──
 * 这是本文件最容易出事的一处：缓存原来只按 key 存，加了租户却不改键，
 * 租户 A 的值会直接命中租户 B 的查询 —— **缓存把串号变成了必然**，
 * 而不是偶发。改成复合键之后，同一个键在不同租户下是两个独立的条目。
 *
 * 数据库里没有该键时回落到 DEFAULTS —— 这样即使新租户还没初始化配置，
 * 系统也用文档规定的默认值工作，而不是拿到 undefined 后算出 NaN。
 *
 * @param {number|null} tenantId 租户；平台级默认值用 null
 * @param {string} key
 * @returns {Promise<string>}
 */
async function getRaw(tenantId, key) {
  const cacheKey = `${tenantId ?? 'platform'}:${key}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.value === null ? DEFAULTS[key] ?? '' : cached.value
  }

  let row = null
  try {
    row = await loadConfigRow(tenantId, key)
  } catch (err) {
    // 配置表读不到不该让业务接口挂掉：回落到默认值并留痕。
    // 这与「缓存不可用时放行」是同一个判断：配置是辅助信息，不是业务数据
    logger.error('读取系统配置失败，回落到默认值', { tenantId, key, err })
  }

  const value = row ? row.config_value : null
  cache.set(cacheKey, { value, loadedAt: Date.now() })
  return value === null ? DEFAULTS[key] ?? '' : value
}

/**
 * 读取一行配置：租户覆盖 → 平台基础 → null（调用方再回落到代码默认值）。
 *
 * `tenantId = null` 时只读平台基础行。
 *
 * 注意「租户没有行」与「租户显式配置了空字符串」是两件事：
 * 前者继承平台，后者是一个有效的覆盖值（例如客服联系方式留空）。
 * 因此这里用「行是否存在」判断，而不是 `config_value` 是否为空。
 */
async function loadConfigRow(tenantId, key) {
  const base =
    "SELECT config_value, description FROM sys_config WHERE config_key = ? AND scope = 'global' AND deleted_at IS NULL"

  if (tenantId == null) {
    return db.queryOne(`${base} AND tenant_id IS NULL`, [key])
  }

  // 平台专属配置（如微信公众号订阅消息模板 ID）不接受租户覆盖。
  // 即使历史库里残留了租户行，也直接读平台值 —— 否则租户会看到「配了但没用」。
  if (SCHEMA[key] && SCHEMA[key].platformOnly) {
    return db.queryOne(`${base} AND tenant_id IS NULL`, [key])
  }

  const tenantRow = await db.queryOne(`${base} AND tenant_id = ?`, [key, tenantId])
  if (tenantRow) return tenantRow

  return db.queryOne(`${base} AND tenant_id IS NULL`, [key])
}

/** 取整数配置。非法值回落默认值并告警 —— 配置写错不该让接口 500 */
async function getInt(tenantId, key) {
  const raw = await getRaw(tenantId, key)
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    logger.warn('系统配置不是合法整数，已回落默认值', { key, raw, fallback: DEFAULTS[key] })
    return Number.parseInt(DEFAULTS[key], 10)
  }
  return parsed
}

/** 取小数配置（如大额支出比例 0.1） */
async function getFloat(tenantId, key) {
  const raw = await getRaw(tenantId, key)
  const parsed = Number.parseFloat(raw)
  if (Number.isNaN(parsed)) {
    logger.warn('系统配置不是合法数字，已回落默认值', { key, raw, fallback: DEFAULTS[key] })
    return Number.parseFloat(DEFAULTS[key])
  }
  return parsed
}

/** 取枚举配置，不在白名单内时回落默认值 */
async function getEnum(tenantId, key, allowed) {
  const raw = await getRaw(tenantId, key)
  if (allowed.includes(raw)) return raw
  logger.warn('系统配置不在允许取值内，已回落默认值', { key, raw, allowed })
  return DEFAULTS[key]
}

/** 阶段推进门禁强度（B-5.9）。默认 standard，理由见需求文档 §4.7.3 */
function getGateStrength(tenantId) {
  return getEnum(tenantId, 'gate_strength', ['strict', 'standard', 'loose'])
}

/**
 * 配置项注册表：每一项的类型、取值范围、展示文案（§5.5 的表格落到代码里）。
 *
 * ── 为什么需要它，而不是只留上面的 DEFAULTS ──
 * AC-AD65 要求「系统配置项校验合理区间（阈值为正、比例 0–100% 等），非法值被拒绝」。
 * 没有这份定义就只能在校验处写一堆 if，而每个新配置项都要记得去补一处，
 * 漏掉的那项从此可以被写入任意值 —— 更糟的是没人会发现。
 * 定义集中在这里之后，新增配置项时**必须**同时写清楚它的合法范围。
 *
 * ── `effective` 字段是诚实性要求 ──
 * `sign_in_distance_threshold` 属于尚未交付的现场签到模块，
 * `operation_log_retention` 对应的清理任务也还没写。这些值改完**不会立即生效**。
 * 若接口一律显示「保存成功」，管理员会以为自己调好了阈值而实际什么都没发生 ——
 * 那种「配置项存在但没人读」的界面比没有这个界面更糟。因此这里显式标注，
 * 由接口透出给前端，让界面能如实说明。
 */
const SCHEMA = {
  sign_in_distance_threshold: {
    type: 'int',
    min: 50,
    max: 5000,
    unit: 'm',
    label: '签到偏差阈值',
    requirement: 'B-5.1',
    effective: false,
    note: '现场签到模块（V1.2）上线后生效',
  },
  stale_report_days: {
    type: 'int',
    min: 1,
    max: 30,
    unit: '天',
    label: '未汇报提醒天数',
    requirement: 'B-5.2',
  },
  acceptance_timeout_hours: {
    type: 'int',
    min: 1,
    max: 720,
    unit: '小时',
    label: '验收超时提醒时长',
    requirement: 'B-5.3',
  },
  big_expense_ratio: {
    type: 'ratio',
    min: 0,
    max: 1,
    label: '大额支出提醒比例',
    requirement: 'B-5.4',
    note: '合同额的比例，0.1 表示 10%',
  },
  report_max_images: {
    type: 'int',
    // 上限 10 而不是随便给个大数：传输层一次请求最多收 MAX_FILES=12 个文件
    // （见 middlewares/upload.js），配置上限超过它就永远调不到 ——
    // 管理员会把值设成 15，然后发现第 11 张照片就报「文件过多」，
    // 而那句错误看起来像是客户端的问题
    min: 1,
    max: 10,
    unit: '张',
    label: '单次汇报照片上限',
    requirement: 'B-5.5',
  },
  report_max_videos: {
    type: 'int',
    // 0 + 10 ≤ 12，与 photos 的上限共同受 MAX_FILES 约束
    min: 0,
    max: 2,
    unit: '个',
    label: '单次汇报视频上限',
    requirement: 'B-5.5',
  },
  report_max_video_seconds: {
    type: 'int',
    min: 5,
    max: 300,
    unit: '秒',
    label: '单个视频时长上限',
    requirement: 'B-5.5',
    note: '客户端上报的时长，服务端无 ffprobe 无法自行测量（CLAUDE.md 第 34 条）',
  },
  route_max_points: {
    type: 'int',
    min: 2,
    max: 20,
    unit: '个',
    label: '单次路线规划途经点上限',
    requirement: 'B-5.6',
    note: '按租户配置；新的规划请求立即使用新上限，历史考察计划不受影响',
  },
  operation_log_retention: {
    type: 'enum',
    allowed: ['forever', '365d', '180d'],
    label: '操作日志保留时长',
    requirement: 'B-5.8',
    effective: false,
    note: '日志清理任务尚未实现，当前一律永久保留',
  },
  gate_strength: {
    type: 'enum',
    allowed: ['strict', 'standard', 'loose'],
    label: '阶段推进门禁强度',
    requirement: 'B-5.9',
    note: '严格=未结清阻断汇报与验收；标准=仅阻断验收；宽松=仅提醒',
  },
  support_contact: {
    type: 'string',
    maxLength: 100,
    label: '客服联系方式',
    requirement: 'C-5.7',
  },
}

/**
 * 订阅消息模板 ID（B-5.7）逐业务各一项。
 *
 * ── 为什么显式列出这五个键，而不是从 notification.service 的枚举推导 ──
 * 推导会在两个模块之间形成**循环依赖**：notification.service 现在要读配置
 * （`resolveTemplateId` 走 getRaw 以复用缓存与默认值回落），而这边要读它的枚举。
 * Node 对循环 require 的处理是返回一个「还没填好」的 exports，
 * 表现为某个方法在运行时突然是 undefined —— 且只在特定加载顺序下复现，
 * 是那种「本地好好的、线上偶发」的问题。
 *
 * ── 那怎么保证两边不漂移 ──
 * 靠测试，不靠运行时引用：`tests/unit/configLimits.test.js` 拿
 * `notificationService.FILTERABLE_TYPES` 的真实取值逐个核对本清单。
 * 枚举一变，测试就红，而不是等到某类消息的模板 ID 永远配不上。
 */
const SUBSCRIBE_TEMPLATE_TYPES = ['acceptance', 'progress', 'payment', 'comment', 'system']

for (const type of SUBSCRIBE_TEMPLATE_TYPES) {
  SCHEMA[`subscribe_template_${type}`] = {
    type: 'string',
    maxLength: 64,
    label: `订阅消息模板 ID（${type}）`,
    requirement: 'B-5.7',
    // ── 平台统一配置，租户只读 ──
    // 模板 ID 来自微信公众平台的小程序后台。本项目是**一个小程序服务多个租户**，
    // 小程序的主体是平台，租户没有这个小程序的登录权限，根本申请不到模板 ID。
    // 让租户配置只会得到一串永远不生效的值，因此这里从根上禁止租户覆盖。
    platformOnly: true,
    // 模板 ID 要从微信后台申请审核通过后才有，没配就是走纯站内消息（AC-U12）
    note: '由平台统一配置（模板 ID 来自微信公众平台）；留空表示该类消息只发站内信',
  }
  // 默认值由注册表补全，而不是要求改代码的人记得去上面那个 DEFAULTS 字面量里再写一行。
  // 漏写的后果很隐蔽：`getRaw` 会对没有默认值的键返回空串，于是「未配置」
  // 与「配置成了空值」在代码里无法区分
  if (DEFAULTS[`subscribe_template_${type}`] === undefined) DEFAULTS[`subscribe_template_${type}`] = ''
}

/** 数值型配置的展示精度：比例保留两位，其余按整数 */
function formatValue(key, value) {
  const spec = SCHEMA[key]
  if (!spec) return value
  if (spec.type === 'ratio') return Number(value).toFixed(2)
  return String(value)
}

/**
 * 校验并规范化一个待写入的配置值（AC-AD65）。
 *
 * @returns {string} 可直接入库的字符串（config_value 统一存字符串，§6.2）
 * @throws {AppError} 非法值
 */
function normalizeValue(key, value) {
  const spec = SCHEMA[key]
  if (!spec) throw AppError.badRequest('未知的配置项')

  if (spec.type === 'int') {
    const n = Number(value)
    if (!Number.isInteger(n)) throw AppError.badRequest(`${spec.label}必须是整数`)
    if (n < spec.min || n > spec.max) {
      throw AppError.badRequest(`${spec.label}应在 ${spec.min}–${spec.max}${spec.unit || ''} 之间`)
    }
    return String(n)
  }

  if (spec.type === 'ratio') {
    const n = Number(value)
    if (!Number.isFinite(n)) throw AppError.badRequest(`${spec.label}必须是数字`)
    // 区间按「0–100%」理解：比例大于 1 意味着大额支出的门槛比合同额还高，
    // 那条提醒就永远不会触发，属于典型的「填错了但系统照单全收」
    if (n <= spec.min || n > spec.max) {
      throw AppError.badRequest(`${spec.label}应大于 0 且不超过 100%（如 0.1 表示 10%）`)
    }
    return String(n)
  }

  if (spec.type === 'enum') {
    if (!spec.allowed.includes(String(value))) {
      throw AppError.badRequest(`${spec.label}只能是：${spec.allowed.join(' / ')}`)
    }
    return String(value)
  }

  // string：模板 ID 之类。trim 之后存，避免从微信后台复制时带上首尾空格 ——
  // 那种空格看不见，但会让模板 ID 匹配失败
  const text = String(value ?? '').trim()
  if (text.length > spec.maxLength) throw AppError.badRequest(`${spec.label}不超过 ${spec.maxLength} 个字符`)
  return text
}

/**
 * 配置清单（B-5.5 的后台配置页）。
 *
 * 逐项返回**生效值**：数据库有就用库里的，没有就用默认值。
 * 只返回数据库里已有的行是不够的 —— 刚部署完数据库是空的，
 * 配置页会一片空白，管理员不知道有哪些项可配。
 */
async function describeAll(tenantId) {
  const rows = await sysConfigModel.listGlobal(tenantId)
  const stored = new Map(rows.map((r) => [r.config_key, r]))

  // 租户视角还要读平台基础版本：它决定「没有覆盖时实际生效的是什么」，
  // 也是「恢复平台默认」按钮的目标值。
  const platformRows =
    tenantId == null ? rows : await sysConfigModel.listGlobal(null)
  const platformStored = new Map(platformRows.map((r) => [r.config_key, r]))

  return Object.entries(SCHEMA)
    .map(([key, spec]) => {
      // 平台专属配置忽略租户行：数据库里即便有历史覆盖值，读取与展示都不能用它，
      // 否则界面会出现「租户覆盖」而实际读的是平台值，运维会被误导。
      const storedRow = stored.get(key)
      const row = spec.platformOnly && tenantId != null ? undefined : storedRow
      const platformRow = platformStored.get(key)

      // source 是这次改造新增的语义：
      //   tenant   = 该租户显式覆盖
      //   platform = 继承平台基础版本
      //   default  = 连平台也没配，使用代码内置默认值
      let source
      if (row) source = tenantId == null ? 'platform' : 'tenant'
      else if (tenantId != null && platformRow) source = 'platform'
      else source = 'default'

      const value =
        row
          ? row.config_value
          : platformRow
            ? platformRow.config_value
            : DEFAULTS[key] ?? ''
      const sourceRow = row || (tenantId != null ? platformRow : null)

      return {
        key,
        label: spec.label,
        requirement: spec.requirement,
        type: spec.type,
        unit: spec.unit ?? null,
        note: spec.note ?? null,
        // 未落库时说明这是默认值而不是「有人配过」——两者的运维含义完全不同
        isDefault: source === 'default',
        // 租户视角下 inherited=true 表示当前值不是本租户配的
        inherited: tenantId != null && source !== 'tenant',
        source,
        // 平台专属项：租户后台只读，平台后台可编辑
        platformOnly: Boolean(spec.platformOnly),
        value: formatValue(key, value),
        // 平台基础值始终单独给一份，前端可以展示「平台：6 张 / 本租户：9 张」
        platformValue:
          tenantId == null
            ? null
            : formatValue(
                key,
                platformRow ? platformRow.config_value : DEFAULTS[key] ?? ''
              ),
        updatedAt: sourceRow ? sourceRow.updated_at : null,
        updatedBy: sourceRow ? sourceRow.updated_by : null,
        effective: spec.effective !== false,
        // 前端据此选择控件与取值范围；不返回这些字段，界面就只能
        // 把规则再抄一份，抄漏的那项会在提交时突然被服务端拒绝
        min: spec.min ?? null,
        max: spec.max ?? null,
        allowed: spec.allowed ?? null,
        maxLength: spec.maxLength ?? null,
      }
    })
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** 取某项的定义（含默认值与当前生效值），供更新前后留痕与回显 */
async function describe(tenantId, key) {
  if (!SCHEMA[key]) throw AppError.badRequest('未知的配置项')
  const all = await describeAll(tenantId)
  return all.find((item) => item.key === key)
}

/**
 * 更新一项配置（AC-AD65 / AC-AD66 / AC-AD67）。
 *
 * ── 变更必须立刻对**新**数据生效 ──
 * §5.5 的「不回溯」指的是不改写历史记录的判定结果，而不是「配置改了先别生效」。
 * 60 秒的进程内缓存（见文件头）会让新值延迟最久 60 秒被读到，
 * 因此写库之后必须 `invalidate()`：管理员的预期是「保存完立刻生效」。
 *
 * ── 权限 ──
 * AC-AD67 要求「项目管理员修改系统配置返回 403」。该判断放在路由层
 * （requireTenantOwner），因为它是**角色级**的，与目标数据无关；
 * service 层再判一次是因为将来若有别的调用方（定时任务、脚本），
 * 它们不该绕过这条规则。
 */
async function update(key, value, operator) {
  const targetTenantId = resolveTargetTenant(operator)

  const spec = SCHEMA[key]
  if (!spec) throw AppError.badRequest('未知的配置项')

  if (spec.platformOnly && targetTenantId != null) {
    throw AppError.forbidden(`${spec.label}由平台统一配置，租户不能修改`)
  }

  const before = await describe(targetTenantId, key)
  const normalized = normalizeValue(key, value)

  if (before.value === normalized) {
    // 值没变就不写库、也不记日志：否则日志里会堆满「改了但改成了同一个值」，
    // 而这类记录会掩盖真正的变更
    return { key, value: normalized, changed: false, source: before.source }
  }

  await db.withTransaction(async (tx) => {
    await sysConfigModel.upsertGlobal(
      { tenantId: targetTenantId, key, value: normalized, description: spec.label, updatedBy: operator.id },
      tx
    )

    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.SYS_CONFIG_UPDATE,
        targetType: 'sys_config',
        detail: {
          // scope 明确这次改的是平台基线还是租户覆盖。
          // 平台改动会影响所有未覆盖的租户，审计里必须能一眼区分。
          scope: targetTenantId == null ? 'platform' : 'tenant',
          before: { key, value: before.value },
          after: { key, value: normalized },
        },
      },
      tx
    )
  })

  // 平台基础值被改时，继承它的租户缓存也必须失效；
  // 只改某个租户时不能顺手清掉别的租户的缓存。
  invalidate(targetTenantId ?? undefined)

  return { key, value: normalized, changed: true, source: targetTenantId == null ? 'platform' : 'tenant' }
}

/**
 * 恢复平台默认：删除本租户的覆盖行，重新继承平台基础版本。
 *
 * 只对租户 owner 开放。平台基础配置本身没有「恢复默认」的语义 ——
 * 平台就是基线，删掉它只会让所有租户一起回落到代码默认值，
 * 那不应该是一个普通按钮能触发的事。
 */
async function reset(key, operator) {
  if (!operator || operator.type !== 'admin') throw AppError.forbidden('仅后台账号可恢复配置')
  if (operator.role !== 'owner' || operator.tenantId == null) {
    throw AppError.forbidden('仅租户管理员可恢复配置')
  }

  const spec = SCHEMA[key]
  if (!spec) throw AppError.badRequest('未知的配置项')

  if (spec.platformOnly) {
    throw AppError.forbidden(`${spec.label}由平台统一配置，没有租户覆盖可恢复`)
  }

  const before = await describe(operator.tenantId, key)
  if (before.source !== 'tenant') {
    return { key, value: before.value, changed: false, source: before.source }
  }

  // 恢复后会读到平台基础值或代码默认值。提前算出来供审计日志使用：
  // 事务里再调用 describe() 会走另一条连接，看不到尚未提交的软删除。
  const platformRow = await db.queryOne(
    "SELECT config_value FROM sys_config WHERE config_key = ? AND scope = 'global' AND tenant_id IS NULL AND deleted_at IS NULL",
    [key]
  )
  const afterValue = formatValue(
    key,
    platformRow ? platformRow.config_value : DEFAULTS[key] ?? ''
  )

  await db.withTransaction(async (tx) => {
    await sysConfigModel.softDeleteGlobalOverride(
      { tenantId: operator.tenantId, key, updatedBy: operator.id },
      tx
    )

    await operationLog.record(
      {
        ...operationLog.fromOperator(operator),
        action: operationLog.ACTIONS.SYS_CONFIG_RESET,
        targetType: 'sys_config',
        detail: {
          scope: 'tenant',
          before: { key, value: before.value },
          after: { key, value: afterValue },
        },
      },
      tx
    )
  })

  invalidate(operator.tenantId)
  const after = await describe(operator.tenantId, key)

  return { key, value: after.value, changed: true, source: after.source }
}

/**
 * 解析一次配置写入的目标作用域。
 *
 * - 平台运营（tenantId 为 null）只能改平台基础配置；
 * - 租户 owner 只能改自己租户的覆盖值；
 * - 平台持排障授权进入租户时 `tenantId` 会被写成目标租户，但角色仍是 platform，
 *   因此这里必须拒绝 —— 排障窗口只读，不能借 `operator.tenantId` 改客户配置。
 */
function resolveTargetTenant(operator) {
  if (!operator || operator.type !== 'admin') {
    throw AppError.forbidden('仅后台账号可修改系统配置')
  }

  if (operator.role === 'platform') {
    if (operator.tenantId != null) {
      throw AppError.forbidden('平台排障窗口内只能查看租户配置')
    }
    return null
  }

  if (operator.role === 'owner' && operator.tenantId != null) {
    return operator.tenantId
  }

  throw AppError.forbidden('仅租户管理员或平台运营可修改系统配置')
}

/** 清空进程内缓存。改配置后调用，使变更立即生效（管理后台改配置时用） */
/**
 * 清缓存。
 *
 * 传 tenantId 只清该租户的条目；不传则全清（测试与运维用）。
 * 按租户清是为了避免「改 A 公司的配置把 B 公司的缓存也清掉」——
 * 多实例部署下那只是浪费一次回源，但会让「谁改了配置」这类排查变难。
 */
function invalidate(tenantId) {
  if (tenantId === undefined) {
    cache.clear()
    return
  }
  const prefix = `${tenantId}:`
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

module.exports = {
  DEFAULTS,
  SCHEMA,
  getRaw,
  getInt,
  getFloat,
  getEnum,
  getGateStrength,
  describeAll,
  describe,
  update,
  reset,
  normalizeValue,
  invalidate,
}
