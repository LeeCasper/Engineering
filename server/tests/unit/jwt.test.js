'use strict'

/**
 * JWT 签发与校验单测（§7.1 / AC-AD10）。
 *
 * 重点在「两端互不通用」这一条。它靠两件事保证：独立密钥 + payload 里的 typ。
 * 只靠密钥是脆的 —— 环境变量被复制粘贴配错是真实会发生的，
 * 因此下面的用例专门验证「即便密钥相同，typ 也要拦住跨端复用」。
 */

const jwtLib = require('jsonwebtoken')
const config = require('../../config')
const jwt = require('../../src/utils/jwt')

describe('jwt · 签发与校验', () => {
  it('签发的 token 能被对应端校验，载荷一致', () => {
    const { token, issuedAt, expiresIn } = jwt.signAdmin({ sub: 7, role: 'owner' })
    const payload = jwt.verifyAdmin(token)

    expect(payload.sub).toBe(7)
    expect(payload.role).toBe('owner')
    expect(payload.typ).toBe('admin')
    expect(payload.aud).toBe('admin')
    expect(payload.iat).toBe(issuedAt)
    expect(issuedAt).toBeGreaterThan(0)
    expect(expiresIn).toBe(config.jwt.admin.expiresIn)
  })

  it('载荷里带 typ 与 aud，用于区分来源', () => {
    const mini = jwt.verifyMini(jwt.signMini({ sub: 1 }).token)
    expect(mini.typ).toBe('mini')
    expect(mini.aud).toBe('mini')
  })

  it('两端的密钥不同（否则隔离形同虚设）', () => {
    expect(config.jwt.admin.secret).not.toBe(config.jwt.mini.secret)
  })
})

describe('jwt · 两端互不通用（AC-AD10）', () => {
  it('C 端 token 无法通过 B 端校验，反之亦然', () => {
    const mini = jwt.signMini({ sub: 1 }).token
    const admin = jwt.signAdmin({ sub: 1 }).token

    expect(() => jwt.verifyAdmin(mini)).toThrow()
    expect(() => jwt.verifyMini(admin)).toThrow()
  })

  it('即便两端误配成同一密钥，typ 仍能拦住跨端复用', () => {
    // 这一条是整套隔离的兜底。构造方式：用 B 端的密钥手工签一个 C 端的 token，
    // 模拟「运维把两个环境变量配成了一样的值」
    const forgedForMini = jwtLib.sign(
      { sub: 1, typ: 'mini' },
      config.jwt.admin.secret,
      { expiresIn: '1h', audience: 'mini' }
    )

    // 签名与 audience 都能过，但 typ 不匹配，必须被拒
    expect(() => jwt.verifyAdmin(forgedForMini)).toThrow()
  })
})

describe('jwt · 异常输入', () => {
  it('签名被篡改的 token 被拒', () => {
    const { token } = jwt.signAdmin({ sub: 1 })
    const tampered = `${token.slice(0, -4)}aaaa`
    expect(() => jwt.verifyAdmin(tampered)).toThrow()
  })

  it('过期的 token 被拒，且提示与「无效 token」不同（过期是可解释的用户可见状态）', () => {
    const expired = jwtLib.sign({ sub: 1, typ: 'admin' }, config.jwt.admin.secret, {
      expiresIn: '-1s',
      audience: 'admin',
    })
    expect(() => jwt.verifyAdmin(expired)).toThrow(/过期/)
  })

  it('用其他密钥签发的 token 被拒', () => {
    const alien = jwtLib.sign({ sub: 1, typ: 'admin' }, 'some-other-secret', { audience: 'admin' })
    expect(() => jwt.verifyAdmin(alien)).toThrow()
  })

  it('无签名（alg=none）的 token 被拒', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ sub: 1, typ: 'admin', aud: 'admin' })).toString('base64url')
    expect(() => jwt.verifyAdmin(`${header}.${payload}.`)).toThrow()
  })
})

describe('jwt · 从请求头取 token', () => {
  function fakeReq(headerValue) {
    return { get: (name) => (name.toLowerCase() === 'authorization' ? headerValue : undefined) }
  }

  it('接受 Bearer 形式（大小写不敏感）', () => {
    expect(jwt.extractToken(fakeReq('Bearer abc.def.ghi'))).toBe('abc.def.ghi')
    expect(jwt.extractToken(fakeReq('bearer abc.def.ghi'))).toBe('abc.def.ghi')
  })

  it('缺少头或格式不对时返回 null，不抛错', () => {
    expect(jwt.extractToken(fakeReq(undefined))).toBeNull()
    expect(jwt.extractToken(fakeReq('abc.def.ghi'))).toBeNull() // 缺 Bearer 前缀
    expect(jwt.extractToken(fakeReq('Basic abc'))).toBeNull()
    expect(jwt.extractToken(fakeReq('Bearer   '))).toBeNull()
  })
})
