'use strict'

/**
 * 生产密钥自检。
 *
 * config/index.js 给 JWT / 签名 URL 密钥留了公开的默认值（方便本地起服务），
 * 但生产环境如果忘了配置，任何人都能拿仓库里的字面量伪造 token 或签名链接。
 * 其它危险配置（WX_MOCK、bcrypt cost、门锁密钥）都有启动自检，密钥也不该例外。
 */

const config = require('../../config')

const DEFAULT_SECRETS = new Set([
  'dev-only-mini-secret-change-me',
  'dev-only-admin-secret-change-me',
  'dev-only-signed-url-secret-change-me',
])

const MIN_LENGTH = 32

function assertSecureSecrets() {
  if (!config.isProd) return

  const entries = [
    ['JWT_MINI_SECRET', config.jwt.mini.secret],
    ['JWT_ADMIN_SECRET', config.jwt.admin.secret],
    ['SIGNED_URL_SECRET', config.signedUrl.secret],
  ]

  for (const [name, value] of entries) {
    if (!value || DEFAULT_SECRETS.has(value) || String(value).length < MIN_LENGTH) {
      throw new Error(
        `${name} 未配置、仍为默认值或长度不足 ${MIN_LENGTH} 位；` +
          '请用 openssl rand -hex 32 生成后写入生产 .env'
      )
    }
  }
}

module.exports = { assertSecureSecrets, DEFAULT_SECRETS, MIN_LENGTH }
