'use strict'

/**
 * 文件上传中间件（multer）。
 *
 * ── 用 memoryStorage 而不是 diskStorage ──
 * 落盘前要先做两件事：图片要叠加服务端水印（AC-P12），所有文件要通过
 * storage 适配器写入（换对象存储时只改那一处）。
 * 用 diskStorage 会先写到本地临时目录、再读出来处理、再写到最终位置 ——
 * 多一次完整 IO，还要自己清理临时文件。
 *
 * 代价是文件全在内存里。因此 `limits.fileSize` 与 `files` 必须设死：
 * 不设的话，一个恶意请求发几十个 100MB 文件就能把进程打爆。
 */

const multer = require('multer')
const config = require('../../config')
const AppError = require('../utils/AppError')

/** 图片与视频的 MIME 白名单。白名单能穷举，黑名单不能 */
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime'])

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
}

/**
 * 单次请求的总文件数上限。
 *
 * ── 它是**传输层**的硬上限，不是一个可配置的业务值 ──
 * 业务上限（单次汇报多少张照片/几个视频）在 `sysConfig.SCHEMA` 里可配，
 * 由 report.service 读取后判定，错误提示也更具体（「最多 9 张照片」）。
 * 这里拦的是「一个请求能塞多少字节进内存」——multer 用的是 memoryStorage，
 * 单个文件上限 10MB，不收口就等于给了对方一个把进程内存打满的入口。
 *
 * **不变式**：配置项的最大值之和不得超过本值。
 * 否则会出现「把照片上限调到 15，结果第 11 张就报文件过多」——
 * 而那句错误看起来像客户端的问题。`tests/unit/configLimits.test.js` 锁着这条。
 */
const MAX_FILES = 12

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxSizeMb * 1024 * 1024,
    files: MAX_FILES,
    // 限制非文件字段的数量与大小，避免用超大表单字段绕过文件限制
    fields: 20,
    fieldSize: 1024 * 100,
  },
  fileFilter(req, file, cb) {
    if (IMAGE_MIME.has(file.mimetype) || VIDEO_MIME.has(file.mimetype)) return cb(null, true)
    // 拒绝时给出的是业务错误，而不是 multer 的英文异常
    cb(AppError.badRequest(`不支持的文件类型：${file.mimetype}`))
  },
})

/** 把 multer 的异常翻译成统一响应（AC-AD46：不暴露框架内部信息） */
function handleUploadErrors(req, res, next) {
  uploader.any()(req, res, (err) => {
    if (!err) return next()

    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: `单个文件不得超过 ${config.upload.maxSizeMb}MB`,
        LIMIT_FILE_COUNT: `一次最多上传 ${MAX_FILES} 个文件`,
        LIMIT_UNEXPECTED_FILE: '存在不允许的上传字段',
        LIMIT_FIELD_COUNT: '表单字段过多',
        LIMIT_FIELD_VALUE: '表单字段内容过大',
      }
      return next(AppError.badRequest(messages[err.code] || '文件上传失败'))
    }

    return next(err)
  })
}

/**
 * 把 multer 的 file 对象整理成业务可用的结构。
 *
 * `ext` 走 MIME 映射而不是取原始文件名的后缀 ——
 * 文件名是客户端可控的，`photo.jpg.php` 这种后缀取出来就是 `php`。
 */
function normalizeFiles(files = []) {
  return files.map((file) => ({
    // 保留字段名：验收的「现场照片」与「业主签名」都用 multipart 提交，
    // 不记下字段名就只能靠数组顺序猜哪张是签名 —— 那是必然出错的做法
    field: file.fieldname,
    buffer: file.buffer,
    mime: file.mimetype,
    ext: EXTENSION_BY_MIME[file.mimetype],
    type: VIDEO_MIME.has(file.mimetype) ? 'video' : 'image',
    sizeBytes: file.size,
  }))
}

// 视频时长**不在这里处理**：本机与线上都没有 ffprobe，服务端无法自行测量，
// 只能由客户端在 `videoDurations` 字段上报（见 report.service.js 的说明）。
// 这个值未经服务端校验，是一道 UX 约束而非安全边界 —— 真正的限制是
// 「最多 1 个视频」与文件大小上限，那两个是服务端自己算的。

module.exports = {
  IMAGE_MIME,
  VIDEO_MIME,
  EXTENSION_BY_MIME,
  MAX_FILES,
  uploadAny: handleUploadErrors,
  normalizeFiles,
}
