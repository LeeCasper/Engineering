/**
 * 「这一页的数据可能在别处被改过」的标记（BZGGCB-12）。
 *
 * ── 为什么不是简单的全局节流 ──
 * 项目详情 / 记账页的 `onShow` 静默刷新有最小间隔，用来省掉「纯浏览页返回」的
 * 整组重拉。但**写操作返回必须看到新数据**：先汇报再返回、在验收页驳回再返回、
 * 在阶段结算页确认再返回，如果被节流吞掉，用户看到的就是旧完成度、旧待办、
 * 未锁定的旧流水 —— 那不是少刷一下，是显示错数据。
 *
 * 因此在跳转到**可能写数据**的页面之前调 `mark*Dirty`，返回时页面
 * `consume*Dirty` 为 true 就无视最小间隔强制刷新一次。
 *
 * ── 为什么用内存而不是 storage ──
 * 标记只服务本次运行：小程序冷启动会重新 onLoad 拉数据，持久化反而可能让
 * 隔天第一次进来多刷一次。Map 的键分「项目」与「记账」两条独立通道，
 * 两个页面互不干扰。
 */

const dirty = new Map()

function mark(key) {
  if (key) dirty.set(key, true)
}

/** 返回值表示「这次消费到了标记」，调用方据此绕过最小刷新间隔 */
function consume(key) {
  if (!key || !dirty.get(key)) return false
  dirty.delete(key)
  return true
}

function projectKey(projectId) {
  return projectId ? `project:${projectId}` : null
}

function ledgerKey(projectId) {
  return projectId ? `ledger:${projectId}` : null
}

/** 跳转到会改项目数据的页面前调用（汇报提交 / 验收详情 / 阶段结算 / 现场签到 / 动态评论） */
export function markProjectDirty(projectId) {
  mark(projectKey(projectId))
}

export function consumeProjectDirty(projectId) {
  return consume(projectKey(projectId))
}

/** 跳转到会改账目数据的页面前调用（阶段结算详情） */
export function markLedgerDirty(projectId) {
  mark(ledgerKey(projectId))
}

export function consumeLedgerDirty(projectId) {
  return consume(ledgerKey(projectId))
}
