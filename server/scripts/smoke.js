#!/usr/bin/env node
'use strict'

/**
 * 端到端冒烟脚本。
 *
 * ── 与集成测试的分工 ──
 * 集成测试打的是进程内的 app（supertest），验的是「单个接口在真实数据库下的行为」。
 * 冒烟脚本打的是**真实运行中的服务**（走 HTTP、走过完整的中间件与静态资源），
 * 验的是「这条业务链路整体能不能跑通」—— 它能发现集成测试发现不了的问题：
 * 路由挂载错、静态资源没服务、启动自检把服务拦住了、端口配置不对。
 *
 * ── 两条硬性要求 ──
 * 1. **可重复执行**：脚本自己造数据、自己清理，跑十遍结果一样，
 *    不依赖库里已有的任何东西。
 * 2. **状态无关**：不假定数据库是空的，也不留下影响下次运行的垃圾。
 *    因此所有业务对象都带一个本次运行的随机后缀。
 *
 * 用法：
 *   node scripts/smoke.js                          # 打 http://127.0.0.1:3000
 *   SMOKE_BASE_URL=http://host:port node scripts/smoke.js
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const API = `${BASE}/api/v1`

/** 本次运行的唯一后缀，保证并发/重复执行时数据不互相干扰 */
const RUN_ID = Math.random().toString(36).slice(2, 8)

/**
 * 手机号后 8 位。
 *
 * **必须全是数字** —— 手机号校验是 `/^1[3-9]\d{9}$/`，
 * 而 RUN_ID 由字母数字混合组成，直接截取会造出 `139ab12...` 这种非法号码。
 * 这里另取一串纯数字，与 RUN_ID 的用途分开。
 */
const PHONE_SUFFIX = String(Math.floor(Math.random() * 100000000)).padStart(8, '0')

/**
 * 冒烟脚本使用的固定超管密码。
 *
 * 用**固定值**而不是运行期随机的：seed 出来的超管带着 `mustChangePassword`，
 * 第一次跑会把它改掉；若改成每次不同的值，第二次跑就登不进去了 ——
 * 而「可重复执行」是冒烟脚本的硬性要求。
 */
const SMOKE_ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || 'Smoke123456'

/**
 * 平台运营账号。由 seed 创建（tenant_id 为 NULL，首登强制改密）。
 * 与超管一样用两个密码做「首次跑 / 重复跑」的兼容。
 */
const SEED_PLATFORM_USERNAME = process.env.SEED_PLATFORM_USERNAME || 'platform'
const SEED_PLATFORM_PASSWORD = process.env.SEED_PLATFORM_PASSWORD || 'Platform123456'
// 租户管理员的登录必须带租户标识（v2.4 的专属登录地址）。
// 不用「全局按用户名查」——多租户下可能与别家的 admin 撞名。
const SEED_TENANT_CODE = process.env.SEED_TENANT_CODE || 'default'
const SMOKE_PLATFORM_PASSWORD = process.env.SMOKE_PLATFORM_PASSWORD || 'SmokePlatform123456'

let passed = 0
let failed = 0
const failures = []

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    failures.push({ label, detail })
    console.log(`  ✗ ${label}${detail ? `  → ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

/**
 * 统一的请求封装：非 2xx 不抛错，把状态码交给调用方判断。
 *
 * ── 429 自动退避重试 ──
 * 一次完整运行会发一百多个请求，而后台账号的限流是 60 次/分钟（§8.2）。
 * 也就是说**连跑两次必然撞限流**，表现为一片登录相关断言集体失败 ——
 * 看起来像功能坏了，实际只是跑得太快。而「可重复执行」是冒烟脚本的硬要求。
 *
 * 重试是安全的：429 意味着请求在业务代码之前就被拒了，没有任何副作用。
 * 代价是撞限流时脚本会变慢（每次退避 10 秒），但那比「随机看一片红」好得多。
 */
// 限流窗口是 60 秒，而「连跑两次」时第二次启动时窗口已经用满了。
// 因此重试总时长必须超过一个完整窗口（5 次 × 10s 只有 50s，会在窗口
// 结束前就放弃，表现为某一条断言拿到 429 而失败）。9 次留出足够余量。
const RETRY_ON_429_MAX = 10
const RETRY_BACKOFF_MS = 10_000

async function http(method, path, { token, body, headers = {} } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`

  for (let attempt = 1; ; attempt += 1) {
    const init = { method, headers: { ...headers } }

    if (token) init.headers.Authorization = `Bearer ${token}`
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    const res = await fetch(url, init)
    const text = await res.text()

    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }

    if (res.status === 429 && attempt < RETRY_ON_429_MAX) {
      console.log(`  · 触发限流（${method} ${path}），等待 ${RETRY_BACKOFF_MS / 1000}s 后重试`)
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS))
      continue
    }

    return { status: res.status, body: parsed, headers: res.headers }
  }
}

/**
 * 从图形验证码接口拿 id 与答案（开发环境会回显答案）。
 *
 * 429 由上面的 http() 统一退避重试，这里只负责校验返回值。
 */
async function fetchCaptcha() {
  const res = await http('GET', '/admin/auth/captcha')
  const data = res.body && res.body.data

  if (!data || !data.captchaId) {
    throw new Error(`获取验证码失败：${JSON.stringify(res.body).slice(0, 200)}`)
  }
  if (!data.debugAnswer) {
    throw new Error(
      '验证码接口未回显答案 —— 冒烟脚本需要 NODE_ENV=development（该字段只在开发环境存在）。' +
        '若服务跑在测试或生产模式，请改用集成测试。'
    )
  }
  return { captchaId: data.captchaId, answer: data.debugAnswer }
}

/**
 * 后台登录。账号不存在时先建一个（通过超管接口）。
 * 冒烟脚本会自己收拾干净，不长期占用账号。
 */
async function adminFlow() {
  section('一、B 端认证与建档')

  // 健康检查：先确认服务真的活着，否则后面所有失败都是噪音
  const health = await http('GET', `${BASE}/api/v1/health`)
  check('就绪探针返回 database/cache 均可用', health.status === 200 && health.body.data.checks.database === true)

  const adminUsername = process.env.SEED_ADMIN_USERNAME || 'admin'
  const seedPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin123456'

  /** 用某个密码尝试登录一次 */
  const tryLogin = async (password) => {
    const captcha = await fetchCaptcha()
    return http('POST', '/admin/auth/login', {
      body: {
        username: adminUsername,
        password,
        captchaId: captcha.captchaId,
        captchaAnswer: captcha.answer,
        // 租户管理员从专属入口登录，带上租户标识
        tenantCode: SEED_TENANT_CODE,
        portal: 'tenant',
      },
    })
  }

  // 先试 seed 密码，失败再试冒烟专用密码 ——
  // 第一次跑会把初始密码改掉，之后各次都要用改后的那个。
  // 这样脚本既能跑在刚 seed 完的库上，也能重复执行
  let login = await tryLogin(seedPassword)
  let usedPassword = seedPassword

  if (login.status !== 200) {
    login = await tryLogin(SMOKE_ADMIN_PASSWORD)
    usedPassword = SMOKE_ADMIN_PASSWORD
  }

  if (login.status !== 200) {
    throw new Error(
      `超管登录失败（${login.status}：${login.body.message}）。` +
        '请先执行 npm run seed 建号；' +
        '若此前跑过冒烟脚本，密码已被改为 SMOKE_ADMIN_PASSWORD（默认 Smoke123456）。'
    )
  }

  check('超管可以登录', login.status === 200)
  let token = login.body.data.token

  // 首登强制改密：seed 出来的超管带着这个标记，必须先改密才能用其他接口
  if (login.body.data.mustChangePassword) {
    const changed = await http('POST', '/admin/auth/change-password', {
      token,
      body: { oldPassword: usedPassword, newPassword: SMOKE_ADMIN_PASSWORD },
    })
    check('首登强制改密生效', changed.status === 200)

    login = await tryLogin(SMOKE_ADMIN_PASSWORD)
    token = login.body.data.token
  }

  // 登录响应里带出租户 —— 内容页与系统配置都按租户读写
  const tenantId = login.body.data.admin.tenantId

  // ── 阶段模板 ──
  const template = await http('POST', '/admin/stage-templates', {
    token,
    body: {
      name: `冒烟模板-${RUN_ID}`,
      stages: [
        { name: '开工准备', planDays: 2, items: [{ name: '现场交底', checklist: ['已交底'] }] },
        { name: '水电工程', planDays: 10, items: [{ name: '强电布线', checklist: ['分管分槽', '固定牢固'] }] },
      ],
    },
  })
  check('创建阶段模板', template.status === 200 && template.body.data.stages.length === 2)
  const templateId = template.body.data.id

  // ── 项目建档 ──
  const project = await http('POST', '/admin/projects', {
    token,
    body: {
      name: `冒烟项目-${RUN_ID}`,
      address: '上海市浦东新区世纪大道 100 号',
      contractAmount: '200000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
      templateId,
    },
  })
  check(
    '建档并按模板生成阶段与工序',
    // 模板是 2 个阶段、每阶段 1 个工序 → 共 2 个工序
    project.status === 200 && project.body.data.stageCount === 2 && project.body.data.itemCount === 2
  )
  const projectId = project.body.data.id

  const detail = await http('GET', `/admin/projects/${projectId}`, { token })
  check('项目详情可读（含阶段工序树）', detail.status === 200 && detail.body.data.stages.length === 2)

  const stageId = detail.body.data.stages[0].id
  const itemId = detail.body.data.stages[0].items[0].id

  // ── 付款节点 ──
  const nodes = await http('PUT', `/admin/projects/${projectId}/payment-nodes`, {
    token,
    body: {
      nodes: [{ name: '水电验收款', amount: '60000.00', triggerType: 'stage_acceptance', triggerStageId: stageId }],
    },
  })
  check('配置付款节点', nodes.status === 200 && nodes.body.data.nodesTotal === '60000.00')

  // tenantId 从登录响应里带出来 —— 内容页、配置都是按租户读写的
  return { token, tenantId, projectId, stageId, itemId, templateId }
}

/**
 * C 端：登录、绑定手机号、确认邀请、汇报、验收。
 *
 * 走的是真实的微信登录接口 —— 开发环境开着 WX_MOCK，
 * 由 code 派生稳定 openid，因此同一个 code 永远是同一个账号。
 */
async function clientFlow(ctx) {
  section('二、C 端：成员、汇报、验收')

  const foreman = await http('POST', '/auth/login', { body: { code: `smoke-foreman-${RUN_ID}` } })
  check('工长静默登录', foreman.status === 200 && Boolean(foreman.body.data.token))
  const foremanToken = foreman.body.data.token

  const owner = await http('POST', '/auth/login', { body: { code: `smoke-owner-${RUN_ID}` } })
  check('业主静默登录', owner.status === 200)
  const ownerToken = owner.body.data.token

  const supervisor = await http('POST', '/auth/login', { body: { code: `smoke-supervisor-${RUN_ID}` } })
  check('监理静默登录', supervisor.status === 200)
  const supervisorToken = supervisor.body.data.token

  // ── 邀请三名成员 ──
  // 号段固定、后 8 位随机，保证每次运行都是合法且互不冲突的号码
  const phones = {
    foreman: `139${PHONE_SUFFIX}`,
    owner: `138${PHONE_SUFFIX}`,
    supervisor: `137${PHONE_SUFFIX}`,
  }

  for (const [role, phone] of Object.entries(phones)) {
    const res = await http('POST', `/admin/projects/${ctx.projectId}/members`, {
      token: ctx.token,
      body: { phone, role },
    })
    check(`邀请${role}（占用手机号 ${phone}）`, res.status === 200)
  }

  // 冒烟环境下被邀请人还没有账号，因此成员是 pending。
  // 直接确认成员关系（真实流程是小程序里点确认，冒烟脚本跳过这一步的 UI）
  const members = await http('GET', `/admin/projects/${ctx.projectId}/members`, { token: ctx.token })
  check('成员列表包含三人', members.status === 200 && members.body.data.members.length === 3)

  // 把工长与业主的手机号绑到刚才登录的账号上（模拟「被邀请人绑定手机号」）
  // 这一步会触发占位账号合并
  const bindForeman = await http('POST', '/auth/bind-phone', {
    token: foremanToken,
    body: { phone: phones.foreman },
  })
  check('工长绑定被邀请的手机号（触发占位账号合并）', bindForeman.status === 200)

  const foremanFinalToken = bindForeman.body.data.token || foremanToken

  const bindOwner = await http('POST', '/auth/bind-phone', {
    token: ownerToken,
    body: { phone: phones.owner },
  })
  const ownerFinalToken = bindOwner.body.data.token || ownerToken

  const bindSupervisor = await http('POST', '/auth/bind-phone', {
    token: supervisorToken,
    body: { phone: phones.supervisor },
  })
  const supervisorFinalToken = bindSupervisor.body.data.token || supervisorToken

  // 确认邀请 → 成员转为 active。
  // V2.16 起被邀请人必须先完成实名认证，否则确认接口返回 409。
  for (const [token, label] of [
    [foremanFinalToken, '工长'],
    [ownerFinalToken, '业主'],
    [supervisorFinalToken, '监理'],
  ]) {
    const verified = await http('POST', '/auth/real-name/verify', {
      token,
      body: { realName: `冒烟${label}`, idCardNo: '310101199001011234', consent: true },
    })
    check(`完成${label}实名认证`, verified.status === 200)

    const invitations = await http('GET', '/projects', { token })
    const pending = invitations.body.data.pendingInvitations || []
    if (pending.length > 0) {
      const confirmed = await http('POST', `/invitations/${pending[0].memberId}/confirm`, { token })
      check(`确认${label}的项目邀请`, confirmed.status === 200)
    } else {
      check(`确认${label}的项目邀请`, false, '未查到待确认邀请')
    }
  }

  const afterConfirm = await http('GET', '/projects', { token: foremanFinalToken })
  check('确认后项目出现在工长的项目列表', afterConfirm.status === 200 && afterConfirm.body.data.total === 1)

  // ── 进度汇报 ──
  const report = await http('POST', `/projects/${ctx.projectId}/reports`, {
    token: foremanFinalToken,
    body: {
      itemId: String(ctx.itemId),
      progress: '100',
      content: `冒烟汇报-${RUN_ID}`,
      clientRequestId: `smoke-${RUN_ID}-1`,
    },
  })
  check('提交进度汇报', report.status === 200 && report.body.data.progress === '100.00')

  // AC-P10：同一幂等键重复提交不产生第二条
  const replay = await http('POST', `/projects/${ctx.projectId}/reports`, {
    token: foremanFinalToken,
    body: {
      itemId: String(ctx.itemId),
      progress: '100',
      content: `冒烟汇报-${RUN_ID}`,
      clientRequestId: `smoke-${RUN_ID}-1`,
    },
  })
  check('幂等键重复提交返回同一条汇报', replay.body.data.id === report.body.data.id)

  const stages = await http('GET', `/projects/${ctx.projectId}/stages`, { token: foremanFinalToken })
  check('阶段完成度随汇报更新', stages.body.data.stages[0].progress === '100.00')

  // ── 验收 ──
  const acceptance = await http('POST', `/projects/${ctx.projectId}/acceptances`, {
    token: foremanFinalToken,
    body: { stageId: String(ctx.stageId), description: `冒烟验收-${RUN_ID}` },
  })
  check('主工长发起验收', acceptance.status === 200)
  const acceptanceId = acceptance.body.data.id

  const items = acceptance.body.data.items.map((i) => ({ id: i.id, result: 'pass' }))
  const selfCheck = await http('POST', `/acceptances/${acceptanceId}/self-check`, {
    token: foremanFinalToken,
    body: { items },
  })
  check('提交自检后进入待监理审核', selfCheck.body.data.status === 'pending_supervisor')

  const approveSupervisor = await http('POST', `/acceptances/${acceptanceId}/approve`, {
    token: supervisorFinalToken,
  })
  check('监理审核通过', approveSupervisor.body.data.status === 'pending_owner')

  // 业主确认需要电子签名（multipart），冒烟脚本用一张 1x1 的 PNG
  const signature = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  const form = new FormData()
  form.append('signature', new Blob([signature], { type: 'image/png' }), 'sign.png')

  const approveOwner = await fetch(`${API}/acceptances/${acceptanceId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerFinalToken}` },
    body: form,
  })
  const approveOwnerBody = await approveOwner.json()
  check('业主签名确认，验收通过', approveOwner.status === 200 && approveOwnerBody.data.status === 'passed')

  const paymentNode = await http('GET', `/projects/${ctx.projectId}/payment-nodes`, { token: foremanFinalToken })
  check(
    '验收通过后付款节点自动解锁',
    paymentNode.body.data.nodes[0].status === 'unlocked'
  )

  return { foremanToken: foremanFinalToken, ownerToken: ownerFinalToken, supervisorToken: supervisorFinalToken }
}

/** 记账与对账 */
async function ledgerFlow(ctx, clients) {
  section('三、记账与对账')

  const expense = await http('POST', `/projects/${ctx.projectId}/ledger`, {
    token: clients.foremanToken,
    body: {
      type: 'expense',
      amount: '1234.56',
      category: 'material',
      occurredAt: '2026-03-01',
      stageId: String(ctx.stageId),
      remark: `冒烟支出-${RUN_ID}`,
    },
  })
  check('登记支出', expense.status === 200 && expense.body.data.amount === '1234.56')

  const income = await http('POST', `/projects/${ctx.projectId}/ledger`, {
    token: clients.foremanToken,
    body: {
      type: 'income',
      amount: '60000.00',
      occurredAt: '2026-03-05',
      stageId: String(ctx.stageId),
      paymentNodeId: (await http('GET', `/projects/${ctx.projectId}/payment-nodes`, { token: clients.foremanToken }))
        .body.data.nodes[0].id,
    },
  })
  check('登记收入', income.status === 200)

  const summary = await http('GET', `/projects/${ctx.projectId}/ledger/summary`, { token: clients.foremanToken })
  check(
    '账目总览：已收 / 已支 / 待收 / 余额',
    summary.body.data.totalIncome === '60000.00' &&
      summary.body.data.totalExpense === '1234.56' &&
      summary.body.data.pendingAmount === '140000.00' &&
      summary.body.data.balance === '58765.44'
  )

  // 对账
  const reconciliation = await http('POST', `/projects/${ctx.projectId}/reconciliations`, {
    token: clients.foremanToken,
    body: { periodStart: '2026-03-01', periodEnd: '2026-03-31' },
  })
  check('发起对账', reconciliation.status === 200 && reconciliation.body.data.details.length === 2)

  const confirmed = await http('POST', `/reconciliations/${reconciliation.body.data.id}/confirm`, {
    token: clients.ownerToken,
  })
  check('业主确认对账并锁定流水', confirmed.status === 200 && confirmed.body.data.lockedLedgerCount === 2)

  const locked = await http('PUT', `/projects/${ctx.projectId}/ledger/${expense.body.data.id}`, {
    token: clients.foremanToken,
    body: { amount: '1.00' },
  })
  check('已锁定流水不可修改（409）', locked.status === 409)

  // AC-L24：结算单 PDF
  const detail = await http('GET', `/reconciliations/${reconciliation.body.data.id}`, { token: clients.ownerToken })
  const signedPath = detail.body.data.settlementPdfSignedPath

  if (signedPath) {
    const download = await fetch(`${BASE}${signedPath}`)
    const buffer = Buffer.from(await download.arrayBuffer())
    check(
      '结算单 PDF 可通过签名链接下载',
      download.status === 200 && buffer.subarray(0, 5).toString() === '%PDF-'
    )
  } else {
    check('结算单 PDF 可通过签名链接下载', false, '详情里没有签名链接（生成失败？）')
  }
}

/** B 端：批量、导出、消息 */
async function adminOpsFlow(ctx) {
  section('四、B 端：批量操作、导出、消息')

  const list = await http('GET', '/admin/projects', { token: ctx.token })
  const projectId = list.body.data.list.find((p) => p.name === `冒烟项目-${RUN_ID}`).id

  // AC-AD60：批量归档，逐条报告结果
  const archived = await http('POST', '/admin/projects/batch/archive', {
    token: ctx.token,
    body: { projectIds: [projectId, 999999], confirm: true },
  })
  check(
    '批量归档逐条报告结果（成功 1 条、失败 1 条）',
    archived.status === 200 &&
      archived.body.data.successCount === 1 &&
      archived.body.data.failureCount === 1 &&
      archived.body.data.failures[0].reason
  )

  // AC-AD61：导出
  const exported = await fetch(`${API}/admin/projects/export?name=${encodeURIComponent(`冒烟项目-${RUN_ID}`)}`, {
    headers: { Authorization: `Bearer ${ctx.token}` },
  })
  const xlsx = Buffer.from(await exported.arrayBuffer())
  check(
    '导出 xlsx（内容与筛选条件一致）',
    exported.status === 200 && xlsx.subarray(0, 2).toString() === 'PK' && xlsx.length > 1000
  )

  // AC-P23 的管理员侧：消息通道
  const notifications = await http('GET', '/admin/notifications', { token: ctx.token })
  check('管理员消息列表可读', notifications.status === 200)

  const read = await http('POST', '/admin/notifications/read', { token: ctx.token, body: {} })
  check('管理员消息可标记已读', read.status === 200)

  // ── AC-AD09：操作日志查询 ──
  const logs = await http('GET', '/admin/operation-logs?pageSize=5', { token: ctx.token })
  check(
    '操作日志可查询，含操作人名称与变更内容',
    logs.status === 200 &&
      logs.body.data.list.length > 0 &&
      logs.body.data.list[0].operatorName &&
      typeof logs.body.data.list[0].detail === 'object'
  )

  const projectLogs = await http('GET', `/admin/operation-logs?projectId=${projectId}&module=project`, {
    token: ctx.token,
  })
  check(
    '操作日志支持按项目与模块筛选',
    projectLogs.status === 200 &&
      projectLogs.body.data.total > 0 &&
      projectLogs.body.data.list.every((r) => r.module === 'project')
  )

  const badModule = await http('GET', '/admin/operation-logs?module=%25', { token: ctx.token })
  check('未知模块被拒绝（不把输入拼进 LIKE）', badModule.status === 400)

  const logFilters = await http('GET', '/admin/operation-logs/filters', { token: ctx.token })
  check(
    '日志筛选下拉可取到模块清单',
    logFilters.status === 200 && logFilters.body.data.modules.some((m) => m.module === 'ledger')
  )

  // ── 系统配置（B-5.5）──
  const configs = await http('GET', '/admin/sys-configs', { token: ctx.token })
  const configOf = (body, key) => body.data.list.find((c) => c.key === key)
  check(
    '系统配置清单可读，未落库的项标记为默认值',
    configs.status === 200 &&
      // 用订阅模板 ID 而不是 seed 会写入的那几项：seed 之后数据库里已经有行，
      // 那些项的 isDefault 恒为 false，第二次跑就会失败
      configOf(configs.body, 'subscribe_template_system').isDefault === true &&
      configOf(configs.body, 'report_max_images').value === '9'
  )

  const badConfig = await http('PUT', '/admin/sys-configs/big_expense_ratio', {
    token: ctx.token,
    body: { value: '1.5' },
  })
  check('越界的配置值被拒绝（AC-AD65）', badConfig.status === 400)

  // 在两个合法值之间来回切，而不是每次都写同一个值 ——
  // 写同一个值时服务端会判定「没变化」而不写库不记日志（那是刻意的），
  // 脚本第二次运行就会拿不到配置变更日志
  const beforeConfig = configOf(await http('GET', '/admin/sys-configs', { token: ctx.token }).then((r) => r.body), 'stale_report_days')
  const nextValue = beforeConfig.value === '5' ? '4' : '5'

  const putConfig = await http('PUT', '/admin/sys-configs/stale_report_days', {
    token: ctx.token,
    body: { value: nextValue },
  })
  const configAgain = await http('GET', '/admin/sys-configs', { token: ctx.token })
  check(
    '系统配置修改后立即生效（不受 60 秒缓存影响）',
    putConfig.status === 200 && configOf(configAgain.body, 'stale_report_days').value === nextValue
  )

  const configLogs = await http('GET', '/admin/operation-logs?action=sys_config.update', { token: ctx.token })
  const latestConfigLog = configLogs.body.data.list[0]
  check(
    '配置变更写入操作日志且含变更前后值',
    configLogs.status === 200 &&
      latestConfigLog &&
      latestConfigLog.detail.before.value === beforeConfig.value &&
      latestConfigLog.detail.after.value === nextValue
  )
}

/**
 * C 端消息中心（AC-U06 ~ AC-U10）。
 *
 * 放在最后跑：前面的汇报、验收、记账、对账都会真的产生消息，
 * 于是这一段测的是「前四段流程攒下来的消息能不能正确读出来」，
 * 而不是自己造几条假数据再读出来。
 */
async function messageCenterFlow(ctx, clients) {
  section('五、C 端：消息中心与红点')

  const token = clients.foremanToken

  const before = await http('GET', '/notifications/unread-count', { token })
  check(
    '红点接口返回未读总数与分类明细',
    before.status === 200 && typeof before.body.data.total === 'number' && before.body.data.byType
  )

  const list = await http('GET', '/notifications', { token })
  check('消息列表可读且带上跳转所需的 refType / projectId', list.status === 200 && Array.isArray(list.body.data.list))

  // 前面几段流程必然写入了消息（验收流转、评论、记账），若一条都没有，
  // 说明写入侧与读取侧的口径对不上 —— 这比「数量不对」更值得报警
  if (list.body.data.total === 0) {
    check('前面的业务流程确实产生了站内消息', false, '消息列表为空')
    return
  }

  const first = list.body.data.list[0]
  check(
    '消息字段完整（分类、标题、已读状态、跳转依据）',
    Boolean(first.type && first.title) && typeof first.isRead === 'boolean' && 'refType' in first
  )

  // AC-U06：分类筛选只返回该分类
  const byType = await http('GET', `/notifications?type=${first.type}`, { token })
  check(
    '按分类筛选结果准确',
    byType.status === 200 && byType.body.data.list.every((n) => n.type === first.type)
  )

  // 列表里的 unread 是全局口径，与筛选无关
  const filteredUnread = await http('GET', '/notifications?type=comment&unreadOnly=true', { token })
  check(
    '列表返回的红点是全局口径，不随筛选变化',
    filteredUnread.status === 200 && filteredUnread.body.data.unread === before.body.data.total
  )

  // 越权：用**业主**的 token 去标记工长的消息。
  // 这条必须在「全部已读」之前跑 —— 等工长自己都标完了再验证，
  // 无论越权是否成功结果都一样，断言会退化成永远成立
  const cross = await http('POST', '/notifications/read', { token: clients.ownerToken, body: { ids: [first.id] } })
  const foremanStillUnread = await http('GET', '/notifications/unread-count', { token })
  check(
    '无法标记他人的消息为已读（对方红点不受影响）',
    cross.status === 200 && cross.body.data.affected === 0 && foremanStillUnread.body.data.total === before.body.data.total
  )

  // AC-U09：单条已读
  const markOne = await http('POST', '/notifications/read', { token, body: { ids: [first.id] } })
  check(
    '单条已读生效且同步返回最新未读数',
    markOne.status === 200 && markOne.body.data.affected === 1 && markOne.body.data.unread === before.body.data.total - 1
  )

  // 幂等：再标一次不应重复计数
  const markAgain = await http('POST', '/notifications/read', { token, body: { ids: [first.id] } })
  check('重复标记同一条是幂等的', markAgain.status === 200 && markAgain.body.data.affected === 0)

  // AC-U07 / AC-U09：全部已读后红点归零
  const markAll = await http('POST', '/notifications/read', { token, body: {} })
  const afterAll = await http('GET', '/notifications/unread-count', { token })
  check(
    '全部已读后红点归零',
    markAll.status === 200 && afterAll.body.data.total === 0 && afterAll.body.data.byType.comment === 0
  )
}

/**
 * C 端个人中心（AC-U01 ~ AC-U05、AC-U14 ~ AC-U20）。
 *
 * 放在最前面跑：注销那一段会用掉一个专用账号，而后面几段都要用
 * clientFlow 里的三个账号 —— 顺序反了会互相影响。
 */
async function personalCenterFlow(ctx, clients) {
  section('六、C 端个人中心与内容页')

  // ── AC-U01 / AC-U02：资料与脱敏 ──
  const profile = await http('GET', `/auth/profile?projectId=${ctx.projectId}`, { token: clients.foremanToken })
  check(
    '个人资料含当前项目内的角色',
    profile.status === 200 && profile.body.data.role === 'foreman' && profile.body.data.roleLabel === '工长'
  )
  check(
    '手机号以掩码返回，响应体里没有完整号码',
    profile.body.data.phoneMasked === null ||
      (profile.body.data.phoneMasked.includes('****') && !/\d{11}/.test(JSON.stringify(profile.body)))
  )

  // ── AC-U05：角色按项目判定 ──
  const asOwner = await http('GET', `/auth/profile?projectId=${ctx.projectId}`, { token: clients.ownerToken })
  check('同一项目内不同成员返回各自的角色', asOwner.body.data.role === 'owner')

  // ── AC-U14：工长专属统计 ──
  const stats = await http('GET', `/projects/${ctx.projectId}/my-stats`, { token: clients.foremanToken })
  check(
    '工长统计返回本月汇报数与两个待办数',
    stats.status === 200 &&
      typeof stats.body.data.monthReportCount === 'number' &&
      typeof stats.body.data.pendingRectifyCount === 'number' &&
      typeof stats.body.data.pendingAcceptanceCount === 'number'
  )

  const ownerStats = await http('GET', `/projects/${ctx.projectId}/my-stats`, { token: clients.ownerToken })
  check('业主调工长统计接口返回 403', ownerStats.status === 403)

  // ── AC-U15：业主的联系入口 ──
  const contacts = await http('GET', `/projects/${ctx.projectId}/contacts`, { token: clients.ownerToken })
  check(
    '业主可取得工长的完整号码用于拨号',
    contacts.status === 200 && contacts.body.data.contacts.some((c) => c.role === 'foreman' && /^\d{11}$/.test(c.phone))
  )
  check('项目配置了监理时 hasSupervisor 为 true', contacts.body.data.hasSupervisor === true)

  const foremanContacts = await http('GET', `/projects/${ctx.projectId}/contacts`, { token: clients.foremanToken })
  check('工长不能查看联系人（业主专属）', foremanContacts.status === 403)

  // ── AC-U16：监理看不到账目 ──
  const supervisorLedger = await http('GET', `/projects/${ctx.projectId}/ledger`, { token: clients.supervisorToken })
  check('监理访问账目返回 403（AC-U16 / AC-L27）', supervisorLedger.status === 403)

  // ── AC-U11 ~ AC-U13：订阅消息授权 ──
  const subs = await http('GET', '/notifications/subscriptions', { token: clients.ownerToken })
  check(
    '订阅状态列表返回五类消息并标记可申请性',
    subs.status === 200 && subs.body.data.list.length === 5 && typeof subs.body.data.availableCount === 'number'
  )

  // ── AC-U17：内容页由后台维护 ──
  //
  // 这里**只**验证「未知 key 返回 404」与「发布后 C 端可读」两件事。
  // 「未发布的页面返回 404」本该在这里测，但冒烟脚本必须可重复执行 ——
  // 第一次跑就把该页发布了，第二次跑它已是已发布状态，断言必然失败。
  // 那条断言由集成测试覆盖（每个用例都重建库，状态是干净的）。
  const unknownPage = await http('GET', '/contents/notexist')
  check('未知的内容页 key 返回 404', unknownPage.status === 404)

  const saved = await http('PUT', '/admin/contents/about', {
    token: ctx.token,
    body: { title: '关于我们', content: `冒烟测试写入的内容-${RUN_ID}`, version: 'smoke', publish: true },
  })
  // 内容页按租户维护：登录前读平台默认版本，进入租户后要带 tenantId 才能读到该租户的版本
  const published = await http('GET', `/contents/about?tenantId=${ctx.tenantId}`)
  check(
    '后台发布后 C 端可正常打开',
    saved.status === 200 &&
      published.status === 200 &&
      published.body.data.content === `冒烟测试写入的内容-${RUN_ID}`
  )
  check('内容页不要求登录态（登录前就要能读）', published.body.data.version === 'smoke')

  // ── AC-U18：意见反馈 ──
  const submitted = await http('POST', '/feedback', {
    token: clients.foremanToken,
    body: { content: `冒烟反馈-${RUN_ID}：进度页在 iOS 上不滚动` },
  })
  check('提交文字反馈成功', submitted.status === 200 && Boolean(submitted.body.data.id))

  const feedbackList = await http('GET', '/admin/feedback?status=new', { token: ctx.token })
  check(
    '后台能查到刚提交的反馈（不是丢进没人看的表）',
    feedbackList.status === 200 && feedbackList.body.data.list.some((f) => f.content.includes(`冒烟反馈-${RUN_ID}`))
  )

  const handled = await http('PUT', `/admin/feedback/${submitted.body.data.id}`, {
    token: ctx.token,
    body: { status: 'processing', reply: '已转交开发' },
  })
  check('后台可置为处理中并写回执', handled.status === 200 && handled.body.data.status === 'processing')

  const resolved = await http('PUT', `/admin/feedback/${submitted.body.data.id}`, {
    token: ctx.token,
    body: { status: 'resolved', reply: '已修复，下个版本发布' },
  })
  check('可继续置为已处理', resolved.status === 200 && resolved.body.data.status === 'resolved')

  const reopen = await http('PUT', `/admin/feedback/${submitted.body.data.id}`, {
    token: ctx.token,
    body: { status: 'processing' },
  })
  // 留退回的口子会让「待处理数量」在两边跳，一条记录永远算不准
  check('已处理完毕的反馈不能再改回处理中（409）', reopen.status === 409)
}

/**
 * 新建一个项目（用当前的超管与内置模板）。
 *
 * ── 为什么后面几段要各自建项目，而不是都用 ctx.projectId ──
 * `adminOpsFlow` 会把 ctx 那个项目**批量归档**，而归档后全链路只读。
 * 后续若继续往它上面邀请成员或设门锁密码，接口会返回 403 ——
 * 而脚本里若不检查那些调用的返回码，断言就会「因为什么都没发生」而通过，
 * 看起来全绿，实际一行都没验证到。
 */
async function createSmokeProject(ctx, label) {
  const res = await http('POST', '/admin/projects', {
    token: ctx.token,
    body: {
      name: `${label}-${RUN_ID}`,
      address: '上海市某路 9 号',
      contractAmount: '200000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-12-01',
      templateId: ctx.templateId,
    },
  })
  return res.status === 200 ? res.body.data.id : null
}

/**
 * 门锁密码（§4.8 / AC-K01 ~ AC-K16）。
 *
 * 这一段自己建项目：要测「归档后不可查看」，而 ctx 那个项目
 * 早在前面的批量归档里就没了。
 */
async function doorCodeFlow(ctx, clients) {
  section('八、门锁密码')

  const projectId = await createSmokeProject(ctx, '门锁冒烟')
  if (!projectId) {
    check('能建出用于门锁测试的项目', false, '建档失败')
    return
  }

  // 把前面的工长与业主请进来 —— 必须确认（active），pending 没有权限
  const phones = {
    foreman: `135${PHONE_SUFFIX}`,
    owner: `134${PHONE_SUFFIX}`,
  }
  const tokens = {}

  for (const [role, phone] of Object.entries(phones)) {
    const invited = await http('POST', `/admin/projects/${projectId}/members`, {
      token: ctx.token,
      body: { phone, role },
    })
    check(`邀请${role}进新项目`, invited.status === 200)

    // 用同一个 code 登录并绑定该手机号，再确认邀请 —— 与第二段同样的流程
    const login = await http('POST', '/auth/login', { body: { code: `smoke-door-${role}-${RUN_ID}` } })
    await http('POST', '/auth/bind-phone', { token: login.body.data.token, body: { phone } })
    const relogin = await http('POST', '/auth/login', { body: { code: `smoke-door-${role}-${RUN_ID}` } })
    tokens[role] = relogin.body.data.token

    // 被邀请人必须先实名认证才能确认邀请
    const verified = await http('POST', '/auth/real-name/verify', {
      token: tokens[role],
      body: { realName: `门锁${role}`, idCardNo: '310101199001011234', consent: true },
    })
    check(`门锁流程：${role} 完成实名认证`, verified.status === 200)

    const memberId = invited.body.data.memberId
    const confirmed = await http('POST', `/invitations/${memberId}/confirm`, { token: tokens[role] })
    check(`确认${role}的邀请`, confirmed.status === 200)
  }

  // ── AC-K01：只有业主能设置 ──
  const byForeman = await http('POST', `/projects/${projectId}/door-codes`, {
    token: tokens.foreman,
    body: { name: '入户门', code: '123456' },
  })
  check('工长设置门锁密码返回 403', byForeman.status === 403)

  const created = await http('POST', `/projects/${projectId}/door-codes`, {
    token: tokens.owner,
    body: { name: '入户门', code: 'DoorCodeSmoke1', remark: '锁上有红点要按住' },
  })
  check('业主设置门锁密码成功', created.status === 200 && Boolean(created.body.data.id))

  // ── AC-K11：工长立即可查看明文，无需业主再操作 ──
  const asForeman = await http('GET', `/projects/${projectId}/door-codes`, { token: tokens.foreman })
  check(
    '工长无需额外授权即可读到明文密码',
    asForeman.status === 200 && asForeman.body.data.list[0].code === 'DoorCodeSmoke1'
  )
  check('含密码的响应带 Cache-Control: no-store（AC-K08）', /no-store/.test(asForeman.headers.get('cache-control') || ''))
  check(
    '响应带回能力边界说明（必须向业主明示）',
    typeof asForeman.body.data.disclaimer === 'string' && asForeman.body.data.disclaimer.includes('不是安防方案')
  )

  // ── AC-K09：读取留痕 ──
  const log = await http('GET', `/projects/${projectId}/door-codes/access-log`, { token: tokens.owner })
  check(
    '业主可查看访问记录，且记录里含刚才的读取',
    log.status === 200 && log.body.data.list.length >= 1 && log.body.data.list[0].codeName === '入户门'
  )
  check('访问记录里不含密码明文', !JSON.stringify(log.body).includes('DoorCodeSmoke1'))

  const foremanLog = await http('GET', `/projects/${projectId}/door-codes/access-log`, { token: tokens.foreman })
  check('工长查看访问记录返回 403（AC-K03）', foremanLog.status === 403)

  // ── AC-K02：后台管理员看不了 ──
  const asAdmin = await http('GET', `/projects/${projectId}/door-codes`, { token: ctx.token })
  check('后台管理员访问门锁密码被拒（后台 token 在 C 端路由即被拦下）', asAdmin.status !== 200)

  // ── AC-K16 / AC-K14：多条独立，失效后不可见 ──
  const second = await http('POST', `/projects/${projectId}/door-codes`, {
    token: tokens.owner,
    body: { name: '单元门', code: 'DoorCodeSmoke2' },
  })
  check('可设置多条密码条目', second.status === 200)

  const revoked = await http('POST', `/door-codes/${created.body.data.id}/revoke`, { token: tokens.owner, body: {} })
  const afterRevoke = await http('GET', `/projects/${projectId}/door-codes`, { token: tokens.foreman })
  check(
    '失效后不可查看，且不影响其他条目（AC-K14 / AC-K16）',
    revoked.status === 200 &&
      afterRevoke.body.data.list.length === 1 &&
      afterRevoke.body.data.list[0].code === 'DoorCodeSmoke2'
  )

  const notified = await http('GET', '/notifications?type=system', { token: tokens.foreman })
  check(
    '可查看者收到「密码已失效」通知，且文案提醒删除记录',
    notified.status === 200 && notified.body.data.list.some((n) => n.title === '门锁密码已失效')
  )

  // ── AC-K12：归档后不可查看 ──
  const archived = await http('POST', `/admin/projects/${projectId}/archive`, { token: ctx.token, body: { confirm: true } })
  const afterArchive = await http('GET', `/projects/${projectId}/door-codes`, { token: tokens.foreman })
  check('项目归档后门锁密码不可查看（AC-K12）', archived.status === 200 && afterArchive.status === 403)

  // ── AC-K15：归档时提醒业主换锁 ──
  const ownerMsgs = await http('GET', '/notifications?type=system', { token: tokens.owner })
  check(
    '归档后业主收到「建议更换门锁密码」提醒',
    ownerMsgs.status === 200 && ownerMsgs.body.data.list.some((n) => n.title === '建议更换门锁密码')
  )
}

/**
 * AC-U19 / AC-U20：注销账号。
 *
 * 用**专用项目与专用账号**，不碰前面几段用过的工长 / 业主 / 监理 ——
 * 注销会解除该账号的全部成员关系，拿正在用的账号做这件事会让
 * 前几段的断言在第二次运行时全部失败。
 */
async function deactivateFlow(ctx) {
  section('七、C 端注销账号')

  const projectId = await createSmokeProject(ctx, '注销冒烟')
  if (!projectId) {
    check('能建出用于注销测试的项目', false, '建档失败')
    return
  }

  const login = await http('POST', '/auth/login', { body: { code: `smoke-deactivate-${RUN_ID}` } })
  // 注意：这里**不能**用登录返回的 userId。绑定手机号会触发「占位账号合并」
  // （CLAUDE.md 第 15 条）—— 邀请时后台按手机号建了一个占位账号，
  // 微信账号绑定该手机号后被合并进去并作废，因此**成员关系挂在占位账号上**。
  // 用绑定前的 id 去比对，永远查不到那条成员记录

  // 先挂进项目成为一名工长，注销后要验证成员关系被解除。
  // **断言邀请成功** —— 不检查的话，邀请失败时后面的
  // 「成员关系被解除」会因为没有成员而恒成立，等于什么都没测
  const invited = await http('POST', `/admin/projects/${projectId}/members`, {
    token: ctx.token,
    body: { phone: `136${PHONE_SUFFIX}`, role: 'foreman' },
  })
  check('把待注销账号邀请进项目', invited.status === 200 && Boolean(invited.body.data.memberId))

  await http('POST', '/auth/bind-phone', { token: login.body.data.token, body: { phone: `136${PHONE_SUFFIX}` } })
  const relogin = await http('POST', '/auth/login', { body: { code: `smoke-deactivate-${RUN_ID}` } })
  const freshToken = relogin.body.data.token
  // 合并之后的 id 才是成员关系真正挂着的那个账号
  const userId = relogin.body.data.user.id

  const noConfirm = await http('POST', '/auth/deactivate', { token: freshToken, body: {} })
  check('缺少二次确认时拒绝注销', noConfirm.status === 400)

  const done = await http('POST', '/auth/deactivate', { token: freshToken, body: { confirm: true } })
  check('二次确认后注销成功', done.status === 200)

  const after = await http('GET', '/auth/profile', { token: freshToken })
  check('注销后旧 token 立即失效', after.status === 403)

  const members = await http('GET', `/admin/projects/${projectId}/members`, { token: ctx.token })
  const mine = members.body.data.members.filter((m) => m.userId === userId)
  check(
    '注销后成员关系被解除（且确实曾经存在过）',
    mine.length === 1 && mine[0].status === 'removed'
  )

  // AC-U20：同一个手机号可以重新注册，不撞唯一键
  const reborn = await http('POST', '/auth/login', { body: { code: `smoke-reborn-${RUN_ID}` } })
  const rebound = await http('POST', '/auth/bind-phone', {
    token: reborn.body.data.token,
    body: { phone: `136${PHONE_SUFFIX}` },
  })
  check('注销后该手机号可重新注册，不撞唯一键', rebound.status === 200)
}

/**
 * 平台账号登录（与超管一样的双密码兼容 + 首登改密）。
 *
 * @returns {Promise<{token: string, admin: object}>}
 */
async function platformLogin() {
  const tryLogin = async (password) => {
    const captcha = await fetchCaptcha()
    return http('POST', '/admin/auth/login', {
      body: {
        username: SEED_PLATFORM_USERNAME,
        password,
        captchaId: captcha.captchaId,
        captchaAnswer: captcha.answer,
        portal: 'platform',
      },
    })
  }

  let login = await tryLogin(SEED_PLATFORM_PASSWORD)
  let usedPassword = SEED_PLATFORM_PASSWORD

  if (login.status !== 200) {
    login = await tryLogin(SMOKE_PLATFORM_PASSWORD)
    usedPassword = SMOKE_PLATFORM_PASSWORD
  }

  if (login.status !== 200) {
    throw new Error(
      `平台账号登录失败（${login.status}：${login.body.message}）。` +
        '请先执行 npm run seed 建平台账号（默认 platform / Platform123456）。'
    )
  }

  if (login.body.data.mustChangePassword) {
    const changed = await http('POST', '/admin/auth/change-password', {
      token: login.body.data.token,
      body: { oldPassword: usedPassword, newPassword: SMOKE_PLATFORM_PASSWORD },
    })
    check('平台账号首登强制改密生效', changed.status === 200)

    login = await tryLogin(SMOKE_PLATFORM_PASSWORD)
  }

  return login.body.data
}

/**
 * SaaS 多租户与排障授权（M13 / P3 / P4 / P5）。
 *
 * ── 这一段为什么必须走真实 HTTP ──
 * 集成测试打的是进程内的 app；这一段要验证的恰恰是「平台账号在真实服务上
 * 能不能登录、路由分流有没有挂错、限流与中间件顺序是否正确」。
 *
 * 所有断言都围绕一条主线：**租户 A 的数据不会出现在租户 B 的视野里**，
 * 平台默认也看不到；只有租户显式授权一个时间窗之后，平台才能**只读**。
 */
async function saasTenantFlow(ctx) {
  section('九、SaaS 多租户与排障授权')

  const platform = await platformLogin()
  check('平台运营账号可以登录', Boolean(platform.token))

  // ── 默认拒绝 ──
  const noHeader = await http('GET', '/admin/projects', { token: platform.token })
  check('平台默认看不到租户业务数据（403）', noHeader.status === 403)

  const noGrant = await http('GET', '/admin/projects', {
    token: platform.token,
    headers: { 'X-Tenant-Id': String(ctx.tenantId) },
  })
  check('没有租户授权时带上下文也被拒绝（403）', noGrant.status === 403)

  // ── 开通新租户 ──
  const ownerInitialPassword = 'Tenant123456'
  const ownerFinalPassword = 'SmokeTenant123456'
  const ownerUsername = `tenant${RUN_ID}`
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  const provisioned = await http('POST', '/admin/platform/tenants', {
    token: platform.token,
    body: {
      name: `冒烟客户-${RUN_ID}`,
      code: `smoke-${RUN_ID}`,
      maxProjects: 1,
      maxAdminUsers: 2,
      expiresAt,
      contactName: '冒烟联系人',
      provinceCode: '310000',
      cityCode: '310000',
      owner: { username: ownerUsername, password: ownerInitialPassword },
    },
  })
  check(
    '平台可以开通租户（租户 + owner + 默认模板 + 内容页）',
    provisioned.status === 200 && provisioned.body.data.owner.mustChangePassword === true
  )
  const newTenantId = provisioned.body.data.tenant.id
  check('开通时用量从 1 个账号起算', provisioned.body.data.tenant.usage.adminCount === 1)

  // ── 新租户 owner 登录并改密 ──
  const tryOwnerLogin = async (password) => {
    const captcha = await fetchCaptcha()
    return http('POST', '/admin/auth/login', {
      body: {
        username: ownerUsername,
        password,
        captchaId: captcha.captchaId,
        captchaAnswer: captcha.answer,
        // 新租户的 owner 从平台生成的专属地址登录
        tenantCode: provisioned.body.data.tenantCode,
        portal: 'tenant',
      },
    })
  }

  let ownerLogin = await tryOwnerLogin(ownerInitialPassword)
  if (ownerLogin.status === 200 && ownerLogin.body.data.mustChangePassword) {
    const changed = await http('POST', '/admin/auth/change-password', {
      token: ownerLogin.body.data.token,
      body: { oldPassword: ownerInitialPassword, newPassword: ownerFinalPassword },
    })
    check('新租户 owner 首登强制改密生效', changed.status === 200)
    ownerLogin = await tryOwnerLogin(ownerFinalPassword)
  }
  check('新租户 owner 可以登录', ownerLogin.status === 200)
  const ownerToken = ownerLogin.body.data.token

  // ── 新租户建档：不传模板，必须回落到开通时灌入的默认模板（8 个阶段） ──
  const newProject = await http('POST', '/admin/projects', {
    token: ownerToken,
    body: {
      name: `租户项目-${RUN_ID}`,
      address: '上海市某路 2 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
    },
  })
  check(
    '新租户可以直接建档（使用默认模板的 8 个阶段）',
    newProject.status === 200 && newProject.body.data.stageCount === 8
  )
  const newProjectId = newProject.body.data.id

  // ── 配额：maxProjects = 1 ──
  const overQuota = await http('POST', '/admin/projects', {
    token: ownerToken,
    body: {
      name: `超额项目-${RUN_ID}`,
      address: '上海市某路 3 号',
      contractAmount: '100000.00',
      startDate: '2026-01-01',
      planEndDate: '2026-06-01',
    },
  })
  check('项目数达到配额后拒绝建档（403）', overQuota.status === 403)

  // ── 跨租户不可见（双向） ──
  // 按名字精确筛：即使项目不在第一页，隔离也不该让它出现
  const mainList = await http(
    'GET',
    `/admin/projects?name=${encodeURIComponent(`租户项目-${RUN_ID}`)}`,
    { token: ctx.token }
  )
  check('租户 1 的列表看不到新租户的项目', mainList.status === 200 && mainList.body.data.total === 0)

  const mainCrossTenant = await http('GET', `/admin/projects/${newProjectId}`, { token: ctx.token })
  check('租户 1 直接访问新租户项目得到 404', mainCrossTenant.status === 404)

  const ownerCrossTenant = await http('GET', `/admin/projects/${ctx.projectId}`, { token: ownerToken })
  check('新租户直接访问租户 1 的项目得到 404', ownerCrossTenant.status === 404)

  const newList = await http('GET', '/admin/projects', { token: ownerToken })
  check(
    '新租户的列表只有自己的项目',
    newList.status === 200 &&
      newList.body.data.list.length === 1 &&
      newList.body.data.list[0].id === newProjectId
  )

  // ── 停用 / 恢复 ──
  const suspended = await http('PUT', `/admin/platform/tenants/${newTenantId}/status`, {
    token: platform.token,
    body: { status: 'suspended', reason: '冒烟测试' },
  })
  check('平台可以停用租户', suspended.status === 200 && suspended.body.data.status === 'suspended')

  const blockedToken = await http('GET', '/admin/projects', { token: ownerToken })
  check('租户停用后已有 token 下一次请求即被拒（403）', blockedToken.status === 403)

  const blockedLogin = await tryOwnerLogin(ownerFinalPassword)
  check('租户停用后不能再登录（403）', blockedLogin.status === 403)

  const resumed = await http('PUT', `/admin/platform/tenants/${newTenantId}/status`, {
    token: platform.token,
    body: { status: 'active' },
  })
  check('平台可以恢复租户', resumed.status === 200 && resumed.body.data.status === 'active')

  const resumedLogin = await tryOwnerLogin(ownerFinalPassword)
  check('恢复后可以重新登录', resumedLogin.status === 200)

  // ── 排障授权：租户发起、平台只读、全程留痕 ──
  const grantExpiry = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const grant = await http('POST', '/admin/platform-grants', {
    token: ctx.token,
    body: {
      adminUserId: platform.admin.id,
      reason: `冒烟排障-${RUN_ID}`,
      expiresAt: grantExpiry,
    },
  })
  check(
    '租户可以给平台账号授予排障窗口',
    grant.status === 200 && grant.body.data.status === 'active'
  )
  const grantId = grant.body.data.id

  const platformHeaders = { 'X-Tenant-Id': String(ctx.tenantId) }
  // 按本次运行的项目名筛选，而不是断言「它在第一页」——
  // 冒烟会不断累积数据，分页边界会让一个本来正确的实现偶尔失败
  const platformRead = await http(
    'GET',
    `/admin/projects?name=${encodeURIComponent(`冒烟项目-${RUN_ID}`)}`,
    { token: platform.token, headers: platformHeaders }
  )
  check(
    '平台持授权可读租户项目列表',
    platformRead.status === 200 &&
      platformRead.body.data.list.length === 1 &&
      platformRead.body.data.list[0].id === ctx.projectId
  )

  const platformDetail = await http('GET', `/admin/projects/${ctx.projectId}`, {
    token: platform.token,
    headers: platformHeaders,
  })
  check('平台持授权可读项目详情', platformDetail.status === 200)

  const platformWrite = await http('POST', '/admin/projects', {
    token: platform.token,
    headers: platformHeaders,
    body: {
      name: `平台越权项目-${RUN_ID}`,
      address: '某地',
      contractAmount: '1.00',
      startDate: '2026-01-01',
      planEndDate: '2026-02-01',
    },
  })
  check('平台持授权也不能写（403，只读窗口）', platformWrite.status === 403)

  const accessLogs = await http('GET', '/admin/operation-logs?action=platform.access_tenant', {
    token: platform.token,
    headers: platformHeaders,
  })
  check(
    '平台每一次访问都写审计日志',
    accessLogs.status === 200 && accessLogs.body.data.total > 0
  )

  const tenantSeesAccess = await http('GET', '/admin/operation-logs?action=platform.access_tenant', {
    token: ctx.token,
  })
  check(
    '租户在自己的日志里能看到平台来访',
    tenantSeesAccess.status === 200 && tenantSeesAccess.body.data.total > 0
  )

  const revoked = await http('DELETE', `/admin/platform-grants/${grantId}`, { token: ctx.token })
  check(
    '租户可以立即撤销排障窗口',
    revoked.status === 200 && revoked.body.data.status === 'revoked'
  )

  const afterRevoke = await http('GET', '/admin/projects', {
    token: platform.token,
    headers: platformHeaders,
  })
  check('撤销后平台立即失去访问（403）', afterRevoke.status === 403)

  // ── 新租户的内容页是未发布的草稿 ──
  const content = await http('GET', `/contents/privacy?tenantId=${newTenantId}`)
  check('新租户内容页未发布时 C 端返回 404', content.status === 404)
}

async function main() {
  console.log(`工程宝 · 端到端冒烟`)
  console.log(`目标：${BASE}`)
  console.log(`本次运行标识：${RUN_ID}`)
  console.log('（脚本会自己造数据，跑完不清理 —— 数据带运行标识，不影响下次运行）')

  const started = Date.now()

  try {
    const ctx = await adminFlow()
    const clients = await clientFlow(ctx)
    await ledgerFlow(ctx, clients)
    await adminOpsFlow(ctx)
    await messageCenterFlow(ctx, clients)
    await personalCenterFlow(ctx, clients)
    await deactivateFlow(ctx)
    await doorCodeFlow(ctx, clients)
    await saasTenantFlow(ctx)
  } catch (err) {
    failed += 1
    failures.push({ label: '脚本执行中断', detail: err.message })
    console.error(`\n执行中断：${err.message}`)
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`通过 ${passed}　失败 ${failed}　用时 ${seconds}s`)

  if (failures.length > 0) {
    console.log('\n失败项：')
    for (const f of failures) console.log(`  ✗ ${f.label}${f.detail ? `  → ${f.detail}` : ''}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('冒烟脚本异常：', err)
  process.exitCode = 1
})
