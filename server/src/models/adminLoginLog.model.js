'use strict'

/**
 * admin_login_log 数据访问层（B-1.8 / AC-AD51）。
 *
 * 与业务 operation_log 分表（§6.2）：登录是高频且绝大多数为成功事件，
 * 混进业务日志会把真正的增删改记录淹没。
 *
 * 写入**不参与事务**：登录日志失败不该导致登录失败。因此本模块的方法
 * 内部吞掉异常，只记 warn —— 审计日志丢一条可以接受，用户登不上不行。
 */

const db = require('../db/pool')
const logger = require('../utils/logger')

/**
 * @param {object} entry
 * @param {number|null} entry.adminUserId 账号不存在时为 null（用户名猜错也要留痕）
 * @param {string} entry.username 登录时输入的用户名，用于排查「谁在猜账号」
 * @param {string} entry.ip
 * @param {'success'|'failed'} entry.result
 * @param {string} [entry.failReason]
 * @param {'password'|'wechat'} [entry.authMethod='password']
 */
async function record({ adminUserId, tenantId, username, ip, result, failReason, authMethod = 'password' }) {
  try {
    await db.query(
      `INSERT INTO admin_login_log (admin_user_id, tenant_id, username, ip, result, fail_reason, auth_method)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      // tenantId 可为 null：用户名猜错时根本不知道是哪个租户，
      // 而这种「不属于任何租户」的失败恰恰是爆破的典型特征，不能丢
      [adminUserId ?? null, tenantId ?? null, username || '', ip || '', result, failReason || null, authMethod]
    )
  } catch (err) {
    logger.warn('写入登录日志失败（不影响登录结果）', { username, result, err })
  }
}

/** 分页查登录日志。默认按时间倒序 */
async function list({ offset, limit, adminUserId, tenantId, username, result }) {
  const where = ['1 = 1']
  const params = []

  // 租户管理员只看本租户的登录日志。tenant_id IS NULL 的那些（用户名猜错）
  // 不归任何租户，只对平台可见 —— 否则等同于把全平台的爆破痕迹分散到各家。
  //
  // `tenantId === null` 是平台日志中心的入口：只查平台级登录记录。
  // `undefined` 才表示「不加租户条件」，供运维脚本使用。
  if (tenantId === null) {
    where.push('tenant_id IS NULL')
  } else if (tenantId !== undefined) {
    where.push('tenant_id = ?')
    params.push(tenantId)
  }

  if (adminUserId) {
    where.push('admin_user_id = ?')
    params.push(adminUserId)
  }
  if (username) {
    where.push('username LIKE ?')
    params.push(`%${username}%`)
  }
  if (result) {
    where.push('result = ?')
    params.push(result)
  }

  const clause = `FROM admin_login_log WHERE ${where.join(' AND ')}`
  const total = await db.count(clause, params)
  const rows = await db.query(
    `SELECT id, admin_user_id, username, login_at, ip, result, fail_reason, auth_method
       ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return { total, rows }
}

/**
 * 统计某账号在给定时间窗内的失败次数。
 * 供运维排查「是不是有人在爆破」使用 —— 锁定策略本身读的是
 * admin_user.failed_count，不依赖本表（见 adminAuth.service.js 的说明）。
 */
async function countRecentFailures(adminUserId, sinceDatetime) {
  return db.count('FROM admin_login_log WHERE admin_user_id = ? AND result = ? AND login_at >= ?', [
    adminUserId,
    'failed',
    sinceDatetime,
  ])
}

module.exports = { record, list, countRecentFailures }
