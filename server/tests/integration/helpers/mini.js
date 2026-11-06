'use strict'

/**
 * C 端测试辅助。
 *
 * mock 模式下 openid 由 code 派生（见 wx.service.js），因此**同一个 code 永远得到
 * 同一个用户**。这让「登录两次是同一个账号」这类断言可以稳定复现，
 * 也让不同用例之间通过换 code 就能拿到互不干扰的用户。
 */

const db = require('../../../src/db/pool')
const request = require('./request')

/** 登录，返回 { token, userId, body } */
async function login(code) {
  const res = await request.post('/auth/login').send({ code })
  return {
    status: res.status,
    body: res.body,
    token: res.body.data && res.body.data.token,
    userId: res.body.data && res.body.data.user && res.body.data.user.id,
  }
}

/** 带 token 的请求 */
function authed(method, url, token) {
  return request.authed(method, url, token)
}

/**
 * 完成实名认证（姓名 + 身份证号）。
 * 默认证件号是校验位正确的固定样本；需要不同身份时显式传入。
 */
function verifyRealName(
  token,
  { realName = '测试用户', idCardNo = '310101199001011234' } = {}
) {
  return authed('post', '/auth/real-name/verify', token).send({
    realName,
    idCardNo,
    consent: true,
  })
}

/** 直接建项目，绕过尚未实现的建档接口（M4） */
async function createProject({
  name = '测试项目',
  address = '上海市某区某路 1 号',
  contractAmount = '100000.00',
  startDate = '2026-01-01',
  planEndDate = '2026-06-01',
  status = 'building',
  createdBy = 1,
  longitude = null,
  latitude = null,
  tenantId = 1,
} = {}) {
  const result = await db.query(
    `INSERT INTO project (tenant_id, name, address, contract_amount, start_date, plan_end_date, status, created_by, longitude, latitude)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, name, address, contractAmount, startDate, planEndDate, status, createdBy, longitude, latitude]
  )
  return result.insertId
}

/** 直接建阶段，用于验证项目总进度与「当前阶段」 */
async function createStage({
  projectId,
  name = '开工准备',
  seq = 1,
  progress: stageProgress = '0.00',
  weight = null,
  status = 'not_started',
  gateStatus = 'active',
}) {
  const result = await db.query(
    `INSERT INTO project_stage (project_id, name, seq, progress, weight, status, gate_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [projectId, name, seq, stageProgress, weight, status, gateStatus]
  )
  return result.insertId
}

/**
 * 直接建成员关系。status 默认 active，传 pending 可验证「未确认不计入权限」。
 *
 * 业主需要 owner_type：未显式传时按「项目是否已有 pending/active 主业主」
 * 自动选择 primary / temporary，避免每个用例重复写。
 */
async function addMember({ projectId, userId, role, status = 'active', invitedBy = null, ownerType = null }) {
  let resolvedOwnerType = ownerType
  if (role === 'owner' && !resolvedOwnerType) {
    const primary = await db.queryOne(
      `SELECT id FROM project_member
        WHERE project_id = ? AND role = 'owner' AND owner_type = 'primary'
          AND status IN ('pending', 'active') AND deleted_at IS NULL`,
      [projectId]
    )
    resolvedOwnerType = primary ? 'temporary' : 'primary'
  }

  const result = await db.query(
    `INSERT INTO project_member
       (project_id, user_id, role, status, invited_by, owner_type, confirmed_at, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ${status === 'active' ? 'NOW()' : 'NULL'}, ${status === 'active' ? 'NOW()' : 'NULL'})`,
    [projectId, userId, role, status, invitedBy, resolvedOwnerType]
  )
  return result.insertId
}

/**
 * 按手机号创建占位用户 —— 模拟 M4 的「后台录入手机号邀请成员」。
 * 占位账号的特征是 phone 有值、openid 为 NULL。
 */
async function createPlaceholderUser(phone, nickname = null) {
  const result = await db.query('INSERT INTO user (phone, nickname) VALUES (?, ?)', [phone, nickname])
  return result.insertId
}

/** 建一个用户（有 openid、无手机号），模拟已完成微信登录但未绑手机号的人 */
async function createWechatUser(openid) {
  const result = await db.query('INSERT INTO user (openid) VALUES (?)', [openid])
  return result.insertId
}

module.exports = {
  login,
  authed,
  verifyRealName,
  createProject,
  createStage,
  addMember,
  createPlaceholderUser,
  createWechatUser,
}
