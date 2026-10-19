'use strict'

/**
 * 极简分级日志。开发环境输出可读单行，生产环境输出单行 JSON 便于采集。
 *
 * 不引 pino/winston：本项目只需要「分级 + 结构化字段 + 脱敏」三件事，
 * 日志框架带来的 transport / 采样等配置面用不上，而真正要防的问题
 * （密码、token、地图 Key 泄漏进日志）它也不会替我们解决。
 */

const config = require('../../config')

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }
const currentLevel = LEVELS[config.log.level] ?? LEVELS.info

/**
 * 需要脱敏的字段名（大小写不敏感、含子串匹配）。
 * 这些字段一旦进日志就等于明文泄漏，宁可少记一点也不要多记。
 */
/**
 * 需要脱敏的字段名（按「键名包含该子串」匹配，大小写不敏感）。
 *
 * ── `code` / `doorCode` 是 M12 专门补上的 ──
 * 原有的名单只覆盖 `password` / `pwd` 这类名字，而门锁密码在代码里
 * 自然会被写成 `code`、`doorCode`、`codeCipher` —— **一个都拦不住**。
 * AC-K07 要求「密码明文不出现在任何日志中」，靠约定「记得别打日志」
 * 是不可能守住的：一次 `logger.debug('创建密码', params)` 就把
 * 业主家的门锁密码写进了日志文件。
 *
 * ── `code` 的副作用是刻意接受的 ──
 * 微信登录的 `code`、签名 URL 的 `code` 参数也会被一起脱敏。
 * 它们是**一次性凭证**（用过即废），脱敏后排查登录问题会略麻烦一些，
 * 但那比「门锁密码可能被写进日志」轻得多。宁可多脱敏一个。
 */
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'authorization',
  'openid',
  'phone',
  'key',
  'code',
  'cipher',
]

/** 递归替换敏感字段值 */
function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))

  // Error 实例直接序列化会丢掉非枚举属性，转成普通对象
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code, stack: config.isProd ? undefined : value.stack }
  }

  const out = {}
  for (const [key, val] of Object.entries(value)) {
    const lowered = key.toLowerCase()
    const isSensitive = SENSITIVE_KEYS.some((needle) => lowered.includes(needle))
    out[key] = isSensitive ? '[REDACTED]' : redact(val, depth + 1)
  }
  return out
}

function timestamp() {
  const d = new Date()
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  )
}

function emit(level, message, meta) {
  if (LEVELS[level] < currentLevel) return

  const safeMeta = meta === undefined ? undefined : redact(meta)
  const line = config.isProd
    ? JSON.stringify({ time: new Date().toISOString(), level, message, ...(safeMeta || {}) })
    : `${timestamp()} [${level.toUpperCase()}] ${message}` +
      (safeMeta === undefined ? '' : ` ${JSON.stringify(safeMeta)}`)

  if (level === 'error') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

module.exports = {
  debug: (message, meta) => emit('debug', message, meta),
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta),
  /** 供测试断言脱敏逻辑使用 */
  _redact: redact,
}
