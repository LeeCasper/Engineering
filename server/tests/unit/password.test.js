'use strict'

/**
 * 密码策略与哈希单测（B-1.6 / AC-AD04 / AC-AD49）。
 */

const password = require('../../src/utils/password')

describe('password · 策略（AC-AD49）', () => {
  it('接受「长度 ≥ 8 且同时含字母与数字」的密码', () => {
    for (const good of ['abcd1234', 'Ab1', 'a1b2c3d4', 'Passw0rd!', 'Ａ１．']) {
      const result = password.validatePolicy(good)
      // 'Ab1' 只有 3 位，应当被拒 —— 放在上面是为了说明长度是硬条件
      if (good.length >= 8) expect(result.ok).toBe(true)
      else expect(result.ok).toBe(false)
    }
  })

  it('拒绝少于 8 位', () => {
    const result = password.validatePolicy('Ab1')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('8')
  })

  it('拒绝纯字母与纯数字', () => {
    expect(password.validatePolicy('abcdefgh').ok).toBe(false)
    expect(password.validatePolicy('12345678').ok).toBe(false)
    expect(password.validatePolicy('abcdefgh').reason).toContain('字母与数字')
    expect(password.validatePolicy('12345678').reason).toContain('字母与数字')
  })

  it('拒绝空值', () => {
    for (const empty of ['', null, undefined]) {
      expect(password.validatePolicy(empty).ok).toBe(false)
    }
  })

  it('拒绝超过 72 字节的密码（bcrypt 只取前 72 字节，超长会被静默截断）', () => {
    const long = 'a1'.repeat(40) // 80 字节
    const result = password.validatePolicy(long)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('72')
  })

  it('长度按字节算而不是按字符算（中文 3 字节/字）', () => {
    // 23 个中文 = 69 字节，加 'ab1' 共 72 字节，刚好卡在边界上。
    // 若按字符数算，这串只有 26 个字符，永远测不出字节边界
    const boundary = `${'密'.repeat(23)}ab1`
    expect(Buffer.byteLength(boundary, 'utf8')).toBe(72)
    expect(password.validatePolicy(boundary).ok).toBe(true)

    const over = `${'密'.repeat(23)}abc1`
    expect(Buffer.byteLength(over, 'utf8')).toBe(73)
    expect(password.validatePolicy(over).ok).toBe(false)
  })
})

describe('password · 哈希与校验（AC-AD04）', () => {
  it('哈希结果不等于明文，且形如 bcrypt 串', async () => {
    const hash = await password.hash('Secret123456')
    expect(hash).not.toBe('Secret123456')
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/)
  })

  it('同一密码两次哈希结果不同（加盐）', async () => {
    const a = await password.hash('SamePassword1')
    const b = await password.hash('SamePassword1')
    // 相同哈希意味着没加盐，那样彩虹表可以直接命中
    expect(a).not.toBe(b)
  })

  it('正确密码校验通过，错误密码不通过', async () => {
    const hash = await password.hash('Correct123')
    expect(await password.verify('Correct123', hash)).toBe(true)
    expect(await password.verify('Wrong123', hash)).toBe(false)
    // 大小写敏感
    expect(await password.verify('correct123', hash)).toBe(false)
  })

  it('参数缺失时返回 false 而不是抛错', async () => {
    expect(await password.verify('', '')).toBe(false)
    expect(await password.verify('x', null)).toBe(false)
    expect(await password.verify(null, await password.hash('x'))).toBe(false)
  })

  it('库里是非法哈希串时返回 false 而不是让登录接口 500', async () => {
    expect(await password.verify('anything', 'not-a-bcrypt-hash')).toBe(false)
  })
})

describe('password · bcrypt cost 的生产守卫', () => {
  it('测试环境用低 cost，但不改变哈希格式与校验语义', async () => {
    // cost 只影响计算量，不影响哈希串的格式与比对结果 ——
    // 这是「测试环境降 cost」不削弱覆盖的前提
    const rounds = password.SALT_ROUNDS
    expect(rounds).toBeLessThan(10)
    expect(rounds).toBeGreaterThanOrEqual(4)

    const hash = await password.hash('Test123456')
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/)
    expect(await password.verify('Test123456', hash)).toBe(true)
    expect(await password.verify('Wrong123', hash)).toBe(false)
  })

  it('生产环境 cost 低于下限时拒绝启动', () => {
    expect(() => password.checkBcryptRounds({ isProd: true, rounds: 4, minimum: 10 })).toThrow(/低于安全下限/)
    // 报错要说清后果，否则运维只会看到「配置不对」而随手改成能跑起来的值
    let message = ''
    try {
      password.checkBcryptRounds({ isProd: true, rounds: 4, minimum: 10 })
    } catch (err) {
      message = err.message
    }
    expect(message).toContain('离线爆破')
  })

  it('生产环境 cost 达标时通过；非生产环境不检查', () => {
    expect(password.checkBcryptRounds({ isProd: true, rounds: 10, minimum: 10 })).toBe(true)
    expect(password.checkBcryptRounds({ isProd: true, rounds: 12, minimum: 10 })).toBe(true)
    // 开发/测试环境放行，否则本地根本跑不起来
    expect(password.checkBcryptRounds({ isProd: false, rounds: 4, minimum: 10 })).toBe(true)
  })

  it('非整数 cost 同样被拒绝，不只是「小」', () => {
    expect(() => password.checkBcryptRounds({ isProd: true, rounds: NaN, minimum: 10 })).toThrow()
    expect(() => password.checkBcryptRounds({ isProd: true, rounds: 10.5, minimum: 10 })).toThrow()
  })

  it('当前配置能通过自检（测试环境）', () => {
    expect(password.assertSecureConfig()).toBe(true)
  })
})
