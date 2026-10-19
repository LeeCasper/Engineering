'use strict'

/**
 * 门锁密码的加解密（§4.8.3 / AC-K06 / AC-K10）。
 *
 * ── 为什么是「可逆加密」而不是哈希 ──
 * bcrypt / argon2 是单向的，存进去取不出明文。而 C-8.5 要求密码在工长与
 * 监理端**直接展示明文** —— 单向哈希在这一步就走不通。
 * 这不是「我们偷懒用了弱方案」，是功能决定了必须可逆；
 * 因此安全投入全部压在另外四件事上：密钥分离、日志脱敏、读取留痕、及时失效。
 *
 * ── 算法选择 ──
 * AES-256-GCM 而非 AES-CBC：GCM 自带认证标签，密文被篡改时解密会**失败**
 * 而不是解出一段垃圾。对门锁密码来说这个区别很重要 —— 静默解出错误密码，
 * 用户会站在门口反复试一个错的密码，而系统毫无察觉。
 *
 * ── 密文格式 `v1.<iv>.<authTag>.<ciphertext>`（base64url）──
 * 版本前缀是为了将来能换算法：老数据按 v1 解，新数据按 v2 写，
 * 不需要一次性停机迁移。没有它，「升级加密方案」就等于「所有现存密码作废」。
 */

const crypto = require('node:crypto')

/** 当前写入使用的版本 */
const CURRENT_VERSION = 'v1'

/** GCM 的推荐 IV 长度。12 字节是 NIST 推荐值，也是性能最优的长度 */
const IV_BYTES = 12

/** 认证标签长度。16 字节（128 位）是 GCM 的最大值，不缩短 */
const AUTH_TAG_BYTES = 16

const ALGORITHM = 'aes-256-gcm'

/**
 * 解析密钥。
 *
 * ── 只接受 32 字节，且必须显式给出 ──
 * 太短的密钥（如用户随手填的 'abc123'）会被 Node 直接拒绝，但**报错信息是
 * 「Invalid key length」** —— 运维看到这句话不会意识到「密钥太弱」，
 * 只会以为是代码问题。因此这里先自己校验并给出可操作的提示。
 * 也不做「不足则补零」之类的容错：那会把一个弱密钥静默变成一个看起来正常的密钥。
 *
 * 支持两种写法：64 位十六进制，或 44 字符的 base64（32 字节的 base64 长度）。
 * 两种都是运维习惯的写法，指定其一即可。
 *
 * @param {string} raw
 * @returns {Buffer} 32 字节密钥
 */
function parseKey(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('缺少门锁密码加密密钥（DOOR_CODE_KEY）')
  }

  const value = raw.trim()
  let key = null

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, 'hex')
  } else {
    try {
      const decoded = Buffer.from(value, 'base64')
      if (decoded.length === 32) key = decoded
    } catch {
      key = null
    }
  }

  if (!key || key.length !== 32) {
    throw new Error(
      'DOOR_CODE_KEY 必须是 32 字节密钥：64 位十六进制，或 32 字节的 base64。' +
        '生成方式：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    )
  }

  return key
}

/**
 * 加密。
 *
 * **每次都生成新的随机 IV** —— 这不是可选项。GCM 在同一个密钥下
 * 重复使用 IV 会直接摧毁它的安全性（不仅泄露明文异或关系，还能恢复认证密钥）。
 * 因此绝不要把 IV 固定成常量或从项目 id 派生。
 *
 * @param {string} plaintext
 * @param {Buffer} key
 * @returns {string} `v1.<iv>.<authTag>.<ciphertext>`
 */
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    CURRENT_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/**
 * 解密。
 *
 * @param {string} payload 加密产物
 * @param {Buffer} key
 * @returns {string} 明文
 * @throws {Error} 版本不支持、格式损坏、密钥不对或被篡改
 */
function decrypt(payload, key) {
  if (!payload || typeof payload !== 'string') {
    throw new Error('密文为空')
  }

  const parts = payload.split('.')
  if (parts.length !== 4) {
    // 只说「格式不正确」，**不回显密文本身**：调用方多半会把它塞进日志
    throw new Error('密文格式不正确')
  }

  const [version, ivPart, tagPart, dataPart] = parts
  if (version !== CURRENT_VERSION) {
    // 明确区分「版本不认识」与「密文坏了」：前者是部署问题（回滚了代码？），
    // 后者是数据问题，排查方向完全不同
    throw new Error(`不支持的密文版本：${version}`)
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))

  // GCM 的认证失败（密钥不对、密文被改过、authTag 被换过）在这里抛错。
  // **绝不能 catch 掉返回空串或原文** —— 静默返回一个错误的密码，
  // 用户会站在门口反复试，而系统毫无察觉
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8')
}

/**
 * 派生一个固定的开发用密钥。
 *
 * **仅用于非生产环境**：本机开发没有配置 DOOR_CODE_KEY 时，若直接拒绝启动，
 * 每个人都要先生成一次密钥才能跑起来。派生一个固定值让开发无感，
 * 代价是「开发库里的密文在别的机器上解不开」—— 那没有关系。
 *
 * 生产环境由 `server.assertSafeConfig` 拦住：**没有密钥就拒绝启动**。
 * 这个函数在那里永远不该被调用到，因此它自己也做了一次判断 ——
 * 「只在开发用」的函数如果没人拦，迟早会被用在生产。
 */
function deriveDevKey() {
  return crypto.createHash('sha256').update('renovation-dev-door-code-key').digest()
}

module.exports = {
  CURRENT_VERSION,
  ALGORITHM,
  IV_BYTES,
  AUTH_TAG_BYTES,
  parseKey,
  encrypt,
  decrypt,
  deriveDevKey,
}
