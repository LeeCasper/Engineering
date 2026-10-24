'use strict'

/**
 * 主业主 / 临时业主的共享判定。
 *
 * 两种业主的 role 都是 'owner'，区别只在 project_member.owner_type：
 *   primary   = 主业主（一个项目唯一，可执行验收/付款/对账等重要决策）
 *   temporary = 临时业主（普通能力与业主一致，但不能执行上述决策）
 *
 * ── 为什么 NULL 要失败关闭 ──
 * 直接 SQL、旧测试夹具或人工修数据都可能留下 owner_type = NULL。
 * 这里宁可拒绝，也不能把一条来源不明的业主记录当成主业主放行。
 */

const AppError = require('./AppError')

const OWNER_TYPE = {
  PRIMARY: 'primary',
  TEMPORARY: 'temporary',
}

const OWNER_TYPE_LABELS = {
  [OWNER_TYPE.PRIMARY]: '主业主',
  [OWNER_TYPE.TEMPORARY]: '临时业主',
}

const ROLE_LABELS = {
  foreman: '工长',
  supervisor: '监理',
  owner: '业主',
}

/** 项目内的展示角色：业主细分为主业主 / 临时业主 */
function ownerRoleLabel(role, ownerType) {
  if (role === 'owner') return OWNER_TYPE_LABELS[ownerType] || ROLE_LABELS.owner
  return ROLE_LABELS[role] || role
}

function isPrimaryOwner(member) {
  return Boolean(member) && member.role === 'owner' && member.owner_type === OWNER_TYPE.PRIMARY
}

function ownerTypeOf(member) {
  if (!member || member.role !== 'owner') return null
  return OWNER_TYPE_LABELS[member.owner_type] ? member.owner_type : null
}

/**
 * 重要决策的权限断言。
 *
 * @param {object} member findActiveRole 返回的成员记录（含 role / owner_type）
 * @param {string} action 动作名，用于拼提示，例如「确认验收」
 */
function assertPrimaryOwner(member, action) {
  if (!member || member.role !== 'owner') {
    throw AppError.forbidden(`仅业主可${action}`)
  }
  if (member.owner_type !== OWNER_TYPE.PRIMARY) {
    throw AppError.forbidden(`仅主业主可${action}`)
  }
}

module.exports = {
  OWNER_TYPE,
  OWNER_TYPE_LABELS,
  ownerRoleLabel,
  isPrimaryOwner,
  ownerTypeOf,
  assertPrimaryOwner,
}
