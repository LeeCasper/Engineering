'use strict'

/**
 * 门锁密码加解密单测（§4.8.3 / AC-K06）。
 *
 * ── 为什么这个模块的单测比其他模块重要 ──
 * 加解密的失败模式**大多是静默的**：IV 复用、认证标签没校验、
 * 密钥长短不一被默默补零 —— 这些都不会在功能测试里暴露，
 * 只有密文被真正解开时才会发现，而那时泄露已经发生了。
 * 因此这里逐条锁住那些「错了也照样跑通」的地方。
 */

const crypto = require('node:crypto')
const cipher = require('../../src/utils/crypto')

const KEY = crypto.randomBytes(32)

describe('AC-K06 加解密正确性', () => {
  it('加密后可原样解回', () => {
    for (const plain of ['123456', '0', '000000', 'a b c', '门锁密码', 'A1B2C3']) {
      expect(cipher.decrypt(cipher.encrypt(plain, KEY), KEY)).toBe(plain)
    }
  })

  it('前导零与中间空格原样保留（门锁密码的每一位都可能有意义）', () => {
    // 把 `0123` 当 `123` 处理，业主设的密码与工长看到的就不是同一个，
    // 而这件事没有任何办法当场发现 —— 只能等工长站在门口打不开门
    expect(cipher.decrypt(cipher.encrypt('0123', KEY), KEY)).toBe('0123')
    expect(cipher.decrypt(cipher.encrypt('12 34', KEY), KEY)).toBe('12 34')
  })

  it('密文格式为 v1.<iv>.<authTag>.<ciphertext>', () => {
    const payload = cipher.encrypt('1234', KEY)
    const parts = payload.split('.')

    expect(parts).toHaveLength(4)
    // 版本前缀是为了将来能换算法：老数据按 v1 解，新数据按 v2 写，
    // 不需要一次性停机迁移。没有它，「升级加密方案」等于「所有现存密码作废」
    expect(parts[0]).toBe('v1')
    expect(Buffer.from(parts[1], 'base64url')).toHaveLength(cipher.IV_BYTES)
    expect(Buffer.from(parts[2], 'base64url')).toHaveLength(cipher.AUTH_TAG_BYTES)
  })

  it('相同明文两次加密得到不同密文（IV 必须每次随机）', () => {
    const a = cipher.encrypt('1234', KEY)
    const b = cipher.encrypt('1234', KEY)

    // GCM 在同一密钥下重复使用 IV 会直接摧毁它的安全性 ——
    // 不仅泄露明文的异或关系，还能恢复认证密钥。
    // 因此「两次密文相同」是一条必须失败的红线
    expect(a).not.toBe(b)
    expect(a.split('.')[1]).not.toBe(b.split('.')[1])
    expect(cipher.decrypt(a, KEY)).toBe(cipher.decrypt(b, KEY))
  })

  it('明文不出现在密文串里', () => {
    const payload = cipher.encrypt('888888', KEY)
    expect(payload).not.toContain('888888')
    // base64url 编码后也不该出现明文片段
    expect(Buffer.from(payload.split('.')[3], 'base64url').toString('utf8')).not.toContain('888888')
  })
})

describe('AC-K06 篡改与错误密钥必须**失败**，不能静默解出垃圾', () => {
  it('换一把密钥解密会抛错', () => {
    const payload = cipher.encrypt('1234', KEY)
    const other = crypto.randomBytes(32)

    // 失败而不是返回空串/原文：静默返回一个错误的密码，
    // 用户会站在门口反复试，而系统毫无察觉
    expect(() => cipher.decrypt(payload, other)).toThrow()
  })

  it('密文被篡改会抛错（GCM 认证标签的作用）', () => {
    const payload = cipher.encrypt('123456', KEY)
    const [v, iv, tag, data] = payload.split('.')
    const bytes = Buffer.from(data, 'base64url')
    bytes[0] ^= 0xff

    const tampered = [v, iv, tag, bytes.toString('base64url')].join('.')
    expect(() => cipher.decrypt(tampered, KEY)).toThrow()
  })

  it('认证标签被换掉会抛错', () => {
    const a = cipher.encrypt('1111', KEY).split('.')
    const b = cipher.encrypt('2222', KEY).split('.')

    expect(() => cipher.decrypt([a[0], a[1], b[2], a[3]].join('.'), KEY)).toThrow()
  })

  it('IV 被换掉会抛错', () => {
    const a = cipher.encrypt('1111', KEY).split('.')
    const b = cipher.encrypt('2222', KEY).split('.')

    expect(() => cipher.decrypt([a[0], b[1], a[2], a[3]].join('.'), KEY)).toThrow()
  })

  it('格式不对的密文抛错，且错误信息不回显密文内容', () => {
    for (const bad of ['', 'not-a-cipher', 'v1.only.three', null, undefined]) {
      expect(() => cipher.decrypt(bad, KEY)).toThrow()
    }

    // 报错信息会被调用方写进日志，因此它自己不能带上密文
    try {
      cipher.decrypt('v1.aaa.bbb.ccc.ddd', KEY)
    } catch (err) {
      expect(err.message).not.toContain('aaa')
    }
  })

  it('未知版本前缀抛错，且提示能区分「版本不认识」与「密文坏了」', () => {
    const payload = cipher.encrypt('1234', KEY)
    const future = payload.replace(/^v1\./, 'v9.')

    // 前者是部署问题（代码回滚了？），后者是数据问题，排查方向完全不同
    expect(() => cipher.decrypt(future, KEY)).toThrow(/不支持的密文版本/)
  })
})

describe('AC-K10 密钥解析', () => {
  it('接受 64 位十六进制', () => {
    const hex = crypto.randomBytes(32).toString('hex')
    expect(cipher.parseKey(hex)).toHaveLength(32)
  })

  it('接受 32 字节的 base64', () => {
    const b64 = crypto.randomBytes(32).toString('base64')
    expect(cipher.parseKey(b64)).toHaveLength(32)
  })

  it('拒绝长度不足的密钥，并给出可操作的提示', () => {
    // Node 自己对短密钥也会报错，但报的是 "Invalid key length" ——
    // 运维看到这句话不会意识到「密钥太弱」，只会以为是代码问题
    for (const weak of ['abc', 'short-key', '1234567890']) {
      expect(() => cipher.parseKey(weak)).toThrow(/32 字节/)
    }
    expect(() => cipher.parseKey('')).toThrow()
    expect(() => cipher.parseKey(null)).toThrow()
    expect(() => cipher.parseKey(undefined)).toThrow()
  })

  it('绝不「不足则补零」', () => {
    // 补零会把一个弱密钥**静默**变成一个看起来正常的密钥 ——
    // 部署的人以为配好了，实际用一个可枚举的密钥加密了所有门锁密码
    expect(() => cipher.parseKey('00'.repeat(31))).toThrow()
    expect(() => cipher.parseKey('00'.repeat(33))).toThrow()
  })

  it('派生开发密钥是确定性的，且只用于非生产环境', () => {
    const a = cipher.deriveDevKey()
    const b = cipher.deriveDevKey()

    expect(a).toHaveLength(32)
    expect(a.equals(b)).toBe(true)
    // 派生密钥来自一个**写死在源码里的字符串**，因此它只可能是开发用的。
    // 生产环境由 doorCode.service.assertKeyConfigured() 拒绝启动拦住
    expect(a.equals(KEY)).toBe(false)
  })

  it('派生密钥与真实密钥解不开彼此的密文', () => {
    const devPayload = cipher.encrypt('1234', cipher.deriveDevKey())
    expect(() => cipher.decrypt(devPayload, KEY)).toThrow()
  })
})
