'use strict'

/**
 * 主业主 / 临时业主（v2.12）的跨模块不变量。
 *
 * 这里只放「无法自然归入某个业务模块」的用例：
 *   - 迁移回填；
 *   - 数据库唯一索引；
 *   - 主业主注销时的自动提升。
 * 验收 / 付款 / 对账的权限用例分别在各自的测试文件里。
 */

const fs = require('node:fs')
const path = require('node:path')

const db = require('../../src/db/pool')
const cache = require('../../src/cache')
const { prepareDatabase } = require('./helpers/db')
const fixtures = require('./helpers/fixtures')
const mini = require('./helpers/mini')

beforeAll(() => {
  prepareDatabase()
})

afterAll(async () => {
  await db.close()
  await cache.close()
})

beforeEach(async () => {
  await cache.flush()
  await fixtures.resetBusinessTables()
})

let seq = 0

async function insertOwner(projectId, userId, { status = 'active', ownerType = null } = {}) {
  await db.query(
    `INSERT INTO project_member
       (project_id, user_id, role, status, owner_type, confirmed_at, joined_at)
     VALUES (?, ?, 'owner', ?, ?, ${status === 'active' ? 'NOW()' : 'NULL'}, ${status === 'active' ? 'NOW()' : 'NULL'})`,
    [projectId, userId, status, ownerType]
  )
}

function readBackfillSql() {
  const file = path.join(__dirname, '../../db/migrations/025_primary_owner.sql')
  const source = fs.readFileSync(file, 'utf8')
  const block = source.split('-- BACKFILL:BEGIN')[1].split('-- BACKFILL:END')[0]
  return block
    .split(';')
    .map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(Boolean)
}

describe('主业主 · 数据库不变量', () => {
  it('同一项目不能存在两个 pending/active 主业主；移除其中一个后释放名额', async () => {
    seq += 1
    const projectId = await mini.createProject({ name: `主业主唯一-${seq}` })
    const a = await mini.createWechatUser(`owner-a-${seq}`)
    const b = await mini.createWechatUser(`owner-b-${seq}`)

    await insertOwner(projectId, a, { ownerType: 'primary' })
    await expect(insertOwner(projectId, b, { ownerType: 'primary' })).rejects.toThrow(/uk_pm_primary_owner/)

    await db.query("UPDATE project_member SET status = 'removed' WHERE project_id = ? AND user_id = ?", [
      projectId,
      a,
    ])
    await expect(insertOwner(projectId, b, { ownerType: 'primary' })).resolves.toBeUndefined()
  })

  it('存量回填优先把最早加入（active）的业主设为主业主', async () => {
    seq += 1
    const p1 = await mini.createProject({ name: `回填-1-${seq}` })
    const p2 = await mini.createProject({ name: `回填-2-${seq}` })
    const p3 = await mini.createProject({ name: `回填-3-${seq}` })

    const removed = await mini.createWechatUser(`backfill-removed-${seq}`)
    const activeEarly = await mini.createWechatUser(`backfill-active-early-${seq}`)
    const pending = await mini.createWechatUser(`backfill-pending-${seq}`)
    const activeLate = await mini.createWechatUser(`backfill-active-late-${seq}`)
    const onlyPending = await mini.createWechatUser(`backfill-only-pending-${seq}`)

    await insertOwner(p1, removed, { status: 'removed' })
    await insertOwner(p1, activeEarly)
    await insertOwner(p1, pending, { status: 'pending' })
    await insertOwner(p1, activeLate)
    await insertOwner(p2, onlyPending, { status: 'pending' })

    for (const statement of readBackfillSql()) {
      await db.query(statement)
    }

    const rows = await db.query(
      "SELECT user_id, owner_type FROM project_member WHERE project_id = ? ORDER BY id",
      [p1]
    )
    const byUser = new Map(rows.map((row) => [Number(row.user_id), row.owner_type]))
    expect(byUser.get(Number(activeEarly))).toBe('primary')
    expect(byUser.get(Number(activeLate))).toBe('temporary')
    expect(byUser.get(Number(pending))).toBe('temporary')
    expect(byUser.get(Number(removed))).toBeNull()

    const p2Rows = await db.query('SELECT owner_type FROM project_member WHERE project_id = ?', [p2])
    expect(p2Rows.map((row) => row.owner_type)).toEqual(['primary'])

    const p3Rows = await db.query('SELECT id FROM project_member WHERE project_id = ?', [p3])
    expect(p3Rows).toEqual([])
  })
})

describe('主业主 · 邀请生命周期', () => {
  it('pending 主业主拒绝邀请后释放名额，下一位业主成为主业主', async () => {
    seq += 1
    const pendingOwner = await mini.login(`pending-primary-${seq}`)
    const projectId = await mini.createProject({ name: `拒绝主业主-${seq}` })
    await insertOwner(projectId, pendingOwner.userId, { status: 'pending', ownerType: 'primary' })

    const member = await db.queryOne(
      'SELECT id FROM project_member WHERE project_id = ? AND user_id = ?',
      [projectId, pendingOwner.userId]
    )
    const rejected = await mini
      .authed('post', `/invitations/${member.id}/reject`, pendingOwner.token)
      .send({})
    expect(rejected.status).toBe(200)

    const oldRow = await db.queryOne(
      'SELECT status, owner_type FROM project_member WHERE id = ?',
      [member.id]
    )
    expect(oldRow.status).toBe('removed')
    expect(oldRow.owner_type).toBeNull()

    const next = await mini.createWechatUser(`next-owner-${seq}`)
    await mini.addMember({ projectId, userId: next, role: 'owner', status: 'pending' })
    const nextRow = await db.queryOne(
      'SELECT owner_type FROM project_member WHERE project_id = ? AND user_id = ?',
      [projectId, next]
    )
    expect(nextRow.owner_type).toBe('primary')
  })
})

describe('主业主 · 注销后的自动提升', () => {
  it('主业主注销后，最早的临时业主升为主业主', async () => {
    seq += 1
    const primary = await mini.login(`deactivate-primary-${seq}`)
    const temporary = await mini.login(`deactivate-temp-${seq}`)
    const projectId = await mini.createProject({ name: `注销提升-${seq}` })
    await mini.addMember({ projectId, userId: primary.userId, role: 'owner' })
    await mini.addMember({ projectId, userId: temporary.userId, role: 'owner' })

    const res = await mini.authed('post', '/auth/deactivate', primary.token).send({ confirm: true })
    expect(res.status).toBe(200)

    const oldRow = await db.queryOne(
      'SELECT status, owner_type FROM project_member WHERE project_id = ? AND user_id = ?',
      [projectId, primary.userId]
    )
    expect(oldRow.status).toBe('removed')
    expect(oldRow.owner_type).toBeNull()

    const promoted = await db.queryOne(
      'SELECT status, owner_type FROM project_member WHERE project_id = ? AND user_id = ?',
      [projectId, temporary.userId]
    )
    expect(promoted.status).toBe('active')
    expect(promoted.owner_type).toBe('primary')
  })

  it('没有临时业主时留下空位，下一位被邀请的业主成为主业主', async () => {
    seq += 1
    const primary = await mini.login(`deactivate-alone-${seq}`)
    const projectId = await mini.createProject({ name: `注销空位-${seq}` })
    await mini.addMember({ projectId, userId: primary.userId, role: 'owner' })

    const res = await mini.authed('post', '/auth/deactivate', primary.token).send({ confirm: true })
    expect(res.status).toBe(200)

    const rows = await db.query(
      "SELECT owner_type FROM project_member WHERE project_id = ? AND status IN ('pending','active')",
      [projectId]
    )
    expect(rows).toEqual([])

    const next = await mini.createWechatUser(`after-deactivate-${seq}`)
    await likeInviteOwner(projectId, next)
    const promoted = await db.queryOne(
      'SELECT owner_type FROM project_member WHERE project_id = ? AND user_id = ?',
      [projectId, next]
    )
    expect(promoted.owner_type).toBe('primary')
  })
})

/** 模拟后台邀请业主：直接写 pending，owner_type 由「是否已有主业主」决定 */
async function likeInviteOwner(projectId, userId) {
  const primary = await db.queryOne(
    `SELECT id FROM project_member
      WHERE project_id = ? AND role = 'owner' AND owner_type = 'primary'
        AND status IN ('pending', 'active') AND deleted_at IS NULL`,
    [projectId]
  )
  await insertOwner(projectId, userId, { status: 'pending', ownerType: primary ? 'temporary' : 'primary' })
}
