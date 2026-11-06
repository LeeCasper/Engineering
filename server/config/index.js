'use strict'

/**
 * 集中配置入口。
 *
 * src/ 下任何文件都**不允许**直接读 process.env，一律 require 本模块 ——
 * 漏掉一处就会造成「配置来源有两份」，排查环境问题时极其痛苦。
 * 本模块只做「读取 + 类型转换 + 分组」，不做业务判断。
 */

const path = require('path')
const dotenv = require('dotenv')

// 先加载 .env 再读取任何变量。用绝对路径，避免脚本从不同 cwd 启动时读不到。
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

function str(key, fallback = '') {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  return String(raw).trim()
}

/** 非法值回落到默认值而不是抛错：环境变量写错不该让服务起不来，但要留痕 */
function int(key, fallback) {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) {
    console.warn(`[config] ${key}="${raw}" 不是合法整数，已回落到默认值 ${fallback}`)
    return fallback
  }
  return n
}

/** 只有显式的 'true' / '1' 才算 true，避免 'false' 这个字符串被 JS 当成真值 */
function bool(key, fallback) {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

const NODE_ENV = str('NODE_ENV', 'development')
const isTest = NODE_ENV === 'test'
const isProd = NODE_ENV === 'production'

const config = {
  env: NODE_ENV,
  isTest,
  isProd,
  isDev: !isTest && !isProd,

  server: {
    port: int('PORT', 3000),
    apiPrefix: str('API_PREFIX', '/api/v1'),
    // 生产环境不允许把内网细节暴露给客户端（AC-AD46）
    exposeStack: !isProd,
  },

  db: {
    host: str('DB_HOST', '127.0.0.1'),
    port: int('DB_PORT', 3306),
    user: str('DB_USER', 'root'),
    password: str('DB_PASSWORD', ''),
    // 测试跑在独立库上：集成测试会清空建表，绝不能打到开发库
    database: isTest ? str('DB_NAME_TEST', 'renovation_test') : str('DB_NAME', 'renovation_dev'),
    poolLimit: int('DB_POOL_LIMIT', 10),
    timezone: str('DB_TIMEZONE', '+08:00'),
  },

  cache: {
    // memory | redis。测试默认走 memory —— 集成测试需要瞬时清空的能力，
    // 且不应依赖外部服务才能跑。
    driver: isTest ? str('CACHE_DRIVER_TEST', 'memory') : str('CACHE_DRIVER', 'redis'),
    prefix: str('REDIS_PREFIX', 'renovation:'),
    redis: {
      host: str('REDIS_HOST', '127.0.0.1'),
      port: int('REDIS_PORT', 6379),
      // 测试走独立 db，避免 FLUSHDB 误伤开发环境的数据
      db: isTest ? int('REDIS_DB_TEST', 1) : int('REDIS_DB', 0),
      password: str('REDIS_PASSWORD', ''),
    },
  },

  jwt: {
    // C 端与 B 端密钥必须不同，否则 token 可跨端复用以绕过 §7.1 的隔离要求
    mini: {
      secret: str('JWT_MINI_SECRET', 'dev-only-mini-secret-change-me'),
      expiresIn: str('JWT_MINI_EXPIRES', '7d'),
      // 用于区分 token 来源，交叉使用直接 401（AC-AD10）
      audience: 'mini',
    },
    admin: {
      secret: str('JWT_ADMIN_SECRET', 'dev-only-admin-secret-change-me'),
      expiresIn: str('JWT_ADMIN_EXPIRES', '8h'),
      audience: 'admin',
      // 空闲超时窗口（B-1.7）：每次请求刷新，超时未活动则失效
      idle: str('JWT_ADMIN_IDLE', '30m'),
    },
  },

  wechat: {
    appid: str('WX_APPID', ''),
    secret: str('WX_SECRET', ''),
    // 无凭据环境下用 mock 通道换取稳定 openid，使全链路可离线跑通
    mock: bool('WX_MOCK', true),
  },

  realName: {
    /**
     * 实名认证（C 端）。
     *
     * provider 取值：
     *   - local  本地证件校验（18 位格式、校验位、出生日期、省级行政区）。
     *            它不能证明「姓名与证件号属于同一个人」，接口返回 basic 等级；
     *   - aliyun 阿里云实人认证 Id2MetaVerify（姓名 + 身份证号二要素）。
     *            需要配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET。
     *   其它值一律让认证接口返回 503，不静默降级。
     *
     * 生产建议使用 aliyun；local 只适合开发联调或无外网依赖的部署。
     */
    enabled: bool('REAL_NAME_ENABLED', true),
    provider: str('REAL_NAME_PROVIDER', 'local').toLowerCase(),
    consentVersion: str('REAL_NAME_CONSENT_VERSION', '2026-11-v1'),
    /** 单用户每分钟最多提交几次；防止用脚本反复撞校验位 */
    maxAttemptsPerMinute: int('REAL_NAME_MAX_ATTEMPTS_PER_MINUTE', 10),
    aliyun: {
      accessKeyId: str('ALIYUN_ACCESS_KEY_ID', ''),
      accessKeySecret: str('ALIYUN_ACCESS_KEY_SECRET', ''),
      /** 可写域名或完整 URL；默认国内版 CloudAuth 接入点 */
      endpoint: str('ALIYUN_REAL_NAME_ENDPOINT', 'cloudauth.aliyuncs.com'),
      timeoutMs: int('ALIYUN_REAL_NAME_TIMEOUT_MS', 8000),
      /**
       * 单用户每小时最多发起多少次阿里云调用。
       * 这是**成本护栏**，不是身份校验逻辑：接口按次计费，
       * 只靠 10 次/分钟的通用限流不足以阻止有人用随机证件号刷调用。
       */
      maxAttemptsPerHour: int('ALIYUN_REAL_NAME_MAX_ATTEMPTS_PER_HOUR', 10),
    },
  },

  upload: {
    dir: path.resolve(__dirname, '..', str('UPLOAD_DIR', './uploads')),
    // 对外可访问的基址与路径前缀，storage.urlFor 用它们拼绝对地址。
    // 换对象存储时 publicBaseUrl 改成 CDN 域名即可，调用方不用动
    publicBaseUrl: str('PUBLIC_BASE_URL', 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    publicPath: '/uploads',
    maxSizeMb: int('MAX_UPLOAD_SIZE_MB', 10),
  },

  watermark: {
    /**
     * 水印字体。
     *
     * **这个配置不是可有可无的**：容器镜像里常常没有中文字体，
     * 而 sharp（librsvg）在字体缺失时**不会报错** —— 它会渲染出空白或方块，
     * 于是照片被静默地以「没有水印」的状态存下来。AC-P12 的全部意义就是
     * 「服务端水印绕不过去」，静默产出无水印图片等于这条防线失效。
     *
     * 因此 watermark 组件在字体文件不存在时**直接抛错**，让上传失败，
     * 而不是存下一张看起来正常、实际没有凭证价值的照片。
     */
    fontFamily: str('WATERMARK_FONT_FAMILY', 'Noto Sans CJK SC'),
    fontPath: str('WATERMARK_FONT_PATH', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
    fontSize: int('WATERMARK_FONT_SIZE', 0), // 0 表示按图片宽度自适应（见 utils/watermark.js）
    opacity: Number.parseFloat(str('WATERMARK_OPACITY', '0.75')),
    /** 水印位置。AC-P13 要求全局统一（默认右下角） */
    position: str('WATERMARK_POSITION', 'southeast'),
  },

  rateLimit: {
    perMinute: int('RATE_LIMIT_PER_MINUTE', 60),
  },

  security: {
    /**
     * bcrypt 的 cost。
     *
     * **测试环境刻意用低值**：cost=10 时单次哈希/校验约 45ms，
     * 而集成测试里有上千次登录（每个用例都要建管理员再登录一次），
     * 仅这一项就吃掉一分钟以上。cost 影响的是计算成本，不影响哈希格式与校验结果，
     * 降下来不会削弱测试对密码逻辑的覆盖。
     *
     * 代价是**测试不再覆盖生产实际的计算耗时**——但那本来就不是测试的职责，
     * 真要验证登录接口的 P95，应该在压测里对真实配置做，而不是靠单测。
     *
     * 生产环境由 `password.assertSecureConfig()` 守住下限（见 server.js 启动自检）：
     * cost 低于 10 直接拒绝启动，避免有人图省事在生产也调成 4。
     */
    bcryptRounds: isTest ? int('BCRYPT_ROUNDS_TEST', 4) : int('BCRYPT_ROUNDS', 10),
    /** 生产环境允许的最低 cost */
    bcryptRoundsMin: int('BCRYPT_ROUNDS_MIN', 10),
  },

  acceptancePdf: {
    /**
     * 验收报告 PDF 的中文字体。
     *
     * ── 这里有个坑，`fontName` 不是字体族名 ──
     * pdfkit（fontkit）加载 `.ttc` 字体集合时，第三个参数要的是集合内**某个字体的
     * postscript 名**（`NotoSansCJKsc-Regular`），而不是字体族名
     * （`Noto Sans CJK SC`）。传族名会报
     * "Not a supported font format or standard PDF font" —— 这个提示完全没提
     * 「你该传 postscript 名」，很容易被误判成字体文件损坏或格式不支持。
     *
     * 查集合内的可用名称：
     *   node -e "console.log(require('fontkit').openSync('<ttc路径>').fonts.map(f=>f.postscriptName))"
     */
    fontPath: str('PDF_FONT_PATH', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
    fontName: str('PDF_FONT_NAME', 'NotoSansCJKsc-Regular'),
  },

  esign: {
    /**
     * 第三方可靠电子签名（验收单）——**可选能力，默认关闭**。
     *
     * 关闭时走 legacy 手写签名：它只是项目内部的验收确认记录，
     * **不具备《电子签名法》意义上的可靠电子签名效力**。
     * 开启后才要求服务商配置，并在生产环境禁止 mock provider；
     * 开启状态下不接受手写签名兜底，避免同一类验收单出现两种效力。
     * 后续需要法律效力时，配置服务商并设置 ESIGN_ENABLED=true 即可。
     */
    enabled: bool('ESIGN_ENABLED', false),
    /** 服务商故障时的暂停开关：只停新建任务，回调/查单/归档继续 */
    signingPaused: bool('ESIGN_SIGNING_PAUSED', false),
    legacySigning: bool('ESIGN_LEGACY_SIGNING', true),
    provider: str('ESIGN_PROVIDER', isTest ? 'mock' : ''),
    appId: str('ESIGN_APP_ID', ''),
    appSecret: str('ESIGN_APP_SECRET', ''),
    /** 服务商侧发起人/操作员 id（腾讯电子签的 UserId） */
    operatorId: str('ESIGN_OPERATOR_ID', ''),
    /** 服务商企业/组织 id（腾讯电子签的 OrganizationId） */
    organizationId: str('ESIGN_ORGANIZATION_ID', ''),
    region: str('ESIGN_REGION', ''),
    apiBase: str('ESIGN_API_BASE', ''),
    callbackUrl: str('ESIGN_CALLBACK_URL', ''),
    callbackSecret: str('ESIGN_CALLBACK_SECRET', ''),
    callbackPreviousSecret: str('ESIGN_CALLBACK_SECRET_PREVIOUS', ''),
    /** 逗号分隔的 IP 白名单；为空表示不做 IP 限制，只依赖验签 */
    callbackIps: str('ESIGN_CALLBACK_IPS', '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    /**
     * 私有存储目录。**必须不在 UPLOAD_DIR 内**，否则会被 express.static
     * 当普通上传文件暴露。启动自检会拒绝这种配置。
     */
    privateDir: path.resolve(__dirname, '..', str('ESIGN_PRIVATE_DIR', './private-esign')),
    signTtlSeconds: int('ESIGN_SIGN_TTL_SECONDS', 7 * 24 * 60 * 60),
    refreshMinIntervalSeconds: int('ESIGN_REFRESH_MIN_INTERVAL_SECONDS', 10),
    createTimeoutMs: int('ESIGN_CREATE_TIMEOUT_MS', 10000),
    maxDocumentMb: int('ESIGN_MAX_DOCUMENT_MB', 20),
    consentVersion: str('ESIGN_CONSENT_VERSION', '2026-10-v1'),
  },

  signedUrl: {
    /**
     * 带签临时链接的密钥（§8.2 / AC-A20）。
     *
     * 刻意**不复用** JWT 密钥：同一个密钥用于两种用途时，任何一处的泄露
     * 都会同时影响另一处，而两处的暴露面并不相同
     * （JWT 密钥只在服务端，签名 URL 会出现在可转发的链接里）。
     * 生产环境务必用 openssl rand -hex 32 生成。
     */
    secret: str('SIGNED_URL_SECRET', 'dev-only-signed-url-secret-change-me'),
    /** 验收报告 PDF 的有效期：2 小时（AC-A20） */
    ttlSeconds: int('SIGNED_URL_TTL_SECONDS', 2 * 60 * 60),
  },

  map: {
    /**
     * 地图服务商：auto / amap / tencent。
     *
     * - auto：有高德 Key 用高德，否则用腾讯；两者都没有时降级
     * - amap：只用高德（同时支持地理编码与驾车路线规划）
     * - tencent：只用腾讯（仅地理编码；腾讯路线规划不在本轮实现）
     *
     * 路线规划只依赖高德（§4.6）。把服务商做成显式配置，是为了让运维
     * 在同一个部署里能明确知道「当前用的是谁」，而不是靠 Key 是否为空来猜。
     */
    provider: str('MAP_PROVIDER', 'auto').toLowerCase(),
    amapKey: str('AMAP_KEY', ''),
    tencentKey: str('TENCENT_MAP_KEY', ''),
    get enabled() {
      // 未配置 Key 时地理编码降级为手工拾取坐标（AC-AD54），不阻断建档
      return this.amapKey !== '' || this.tencentKey !== ''
    },
    get routingEnabled() {
      // 只有高德提供了本模块使用的驾车路线接口。
      // 显式选 tencent 时即使同时配了 AMAP_KEY 也不走路线规划。
      return this.provider !== 'tencent' && this.amapKey !== ''
    },
  },

  doorCode: {
    /**
     * 门锁密码的**加密密钥**（§4.8.3 / AC-K10）。
     *
     * ── 这一项与其它配置的性质不同 ──
     * 它不是「配错了就降级」的参数，而是**唯一能解开已存密码的东西**：
     *   - 泄露 → 拿到库的人可以直接解出所有业主家的门锁密码；
     *   - 丢失 → 所有已存的密码永久不可恢复，只能让业主重新设置。
     *
     * 因此它**不进数据库、不进仓库、不进日志**，只从环境变量读。
     * 生成方式：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     *
     * 刻意**不复用** JWT 密钥或签名 URL 密钥：三者的暴露面完全不同 ——
     * 密钥轮换的代价也不同（换这把等于作废所有门锁密码），
     * 共用一个密钥会让「只想轮换其中一个」变成不可能。
     *
     * 默认值是**空串**而不是像其他项那样给个 dev 占位值：
     * 给默认值的配置项会被静默使用，而这里一旦静默使用了一个公开的默认密钥，
     * 全公司业主家的门锁密码就等于公开。空值由启动自检兜住（见 server.js）。
     */
    key: str('DOOR_CODE_KEY', ''),

    /**
     * 单条密码的最大长度。
     *
     * 门锁密码通常是 4–12 位数字，但智能锁也有字母密码与更长的管理密码，
     * 因此给到 64。上限的意义是防止把 `code_cipher` 撑爆，
     * 以及挡住「误把一段文本粘进密码框」。
     */
    maxLength: int('DOOR_CODE_MAX_LENGTH', 64),
  },

  log: {
    // 测试环境默认只留 error：集成测试会打上千个请求，
    // access log 会把断言失败信息冲出屏幕。需要排查时用
    // LOG_LEVEL_TEST=info npx vitest run ... 单独打开。
    level: isTest ? str('LOG_LEVEL_TEST', 'error') : str('LOG_LEVEL', 'info'),
  },
}

// 冻结深层对象，防止运行时被意外改写导致「配置中途变了」这类难查的问题
function deepFreeze(obj) {
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value)
  }
  return Object.freeze(obj)
}

module.exports = deepFreeze(config)
