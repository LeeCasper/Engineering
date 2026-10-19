'use strict'

/**
 * 文件存储适配器。
 *
 * 当前实现是**本地磁盘**，接口按对象存储的形态设计（save 返回 key，urlFor 拼可访问地址），
 * 因此 V1.1 换成腾讯云 COS / 阿里云 OSS 时只需新增一个实现，调用方一行不改。
 *
 * ── 为什么要有这一层 ──
 * 上传散落在各处的直接 `fs.writeFile` 会带来三个问题：
 *   1. 换存储要改所有写入点；
 *   2. 文件命名规则会各处不一致（有的用时间戳有的用随机串，迟早撞名）；
 *   3. 生产环境要往对象存储写，而本地磁盘路径在容器里是临时的 ——
 *      一次重启照片就没了，而数据库里的 url 还指着它。
 * 收敛到一处之后，这三个问题都只在本地实现里考虑一次。
 */

const fs = require('node:fs/promises')
const path = require('node:path')
const { nanoid } = require('nanoid')

const config = require('../../config')
const logger = require('../utils/logger')

/**
 * 允许的扩展名白名单。不做「黑名单排除」—— 白名单才是能穷举的。
 *
 * **只约束用户上传**（见下面的 save）。服务端自己产出的归档物走 saveGenerated，
 * 不受这份清单约束 —— 把「防止用户上传可执行文件」的规则套到
 * 「保存自己刚生成的 PDF」上，只会逼着后来者往白名单里加 pdf，
 * 顺带把 pdf 也变成了可上传类型。
 */
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'])

/**
 * 服务端生成物的扩展名白名单。范围窄且都是归档格式。
 *
 * `xlsx` 是导出功能（AC-AD61）产生的。它与 `save` 那份白名单的**区别**在于
 * 这里放的是「我们自己渲染出来的字节流」，不含用户上传 ——
 * 因此不要把 xlsx 加进上面那份 ALLOWED_EXTENSIONS，那会顺带允许用户上传表格文件。
 */
const GENERATED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'xlsx'])

/**
 * 生成存储 key：`<category>/<年>/<月>/<日>/<随机>.<ext>`。
 *
 * 按日期分目录不是为了好看：单目录下堆几十万文件时，
 * 某些文件系统与对象存储的列举性能会显著下降，而运维想按时间清理旧文件时
 * 也只能靠前缀匹配。
 */
function buildKey({ category, ext }) {
  const safeCategory = String(category || 'misc').replace(/[^a-z0-9_-]/gi, '')
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')

  return `${safeCategory}/${yyyy}/${mm}/${dd}/${nanoid(20)}.${ext}`
}

/**
 * 写入文件。
 *
 * @param {Buffer} buffer
 * @param {object} params
 * @param {string} params.category 业务分类，如 reports、visits、receipts
 * @param {string} params.ext 扩展名（不含点），必须在白名单内
 * @returns {Promise<{key: string, url: string, sizeBytes: number}>}
 */
async function save(buffer, { category, ext }) {
  return persist(buffer, { category, ext, allowed: ALLOWED_EXTENSIONS })
}

/**
 * 保存**服务端生成**的文件（验收报告 PDF 等）。
 *
 * 与 save 分开是刻意的：两者面对的风险不同。
 * save 处理的是用户上传，必须卡死类型；saveGenerated 处理的是我们自己刚渲染出来的
 * 字节流，类型由代码决定而不可被外部影响。
 * 合成一个入口就得加一个 `trusted` 之类的开关，而那种开关迟早会被滥用来「让它先跑通」。
 */
async function saveGenerated(buffer, { category, ext }) {
  return persist(buffer, { category, ext, allowed: GENERATED_EXTENSIONS })
}

async function persist(buffer, { category, ext, allowed }) {
  const normalizedExt = String(ext || '').toLowerCase().replace(/^\./, '')

  if (!allowed.has(normalizedExt)) {
    // save 这一侧：上传接口已经校验过一层，这里是「万一有人绕过校验
    // 直接调存储层」的兜底。存储层是最后一道，不该假设调用方一定校验过
    throw new Error(`不支持的文件类型：${normalizedExt}`)
  }

  const key = buildKey({ category, ext: normalizedExt })
  const fullPath = path.join(config.upload.dir, key)

  // 递归创建目录：同一天内多个并发上传可能同时尝试创建，因此要容忍已存在
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, buffer)

  logger.debug('文件已保存', { key, sizeBytes: buffer.length })

  return { key, url: urlFor(key), sizeBytes: buffer.length }
}

/**
 * 拼可访问地址。
 *
 * 注意这里返回的是**绝对地址**（带 PUBLIC_BASE_URL），而不是相对路径：
 * 小程序端拿到的图片地址要能直接丢给 `<image src>`，
 * 相对路径在真机上会相对于小程序自身的域名解析，必然 404。
 */
function urlFor(key) {
  if (!key) return null
  return `${config.upload.publicBaseUrl}${config.upload.publicPath}/${key}`
}

/**
 * 删除文件。
 *
 * 失败只记 warn 不抛错：调用场景都是「补偿性删除」（如事务回滚后清理已落盘的文件），
 * 为此抛错会把原始失败原因盖掉。孤儿文件由运维任务清理。
 */
async function remove(key) {
  if (!key) return false

  try {
    await fs.unlink(path.join(config.upload.dir, key))
    return true
  } catch (err) {
    if (err.code === 'ENOENT') return false
    logger.warn('删除文件失败（不影响业务流程）', { key, message: err.message })
    return false
  }
}

/**
 * 读取文件内容。
 *
 * 入参可传 key（`reports/2026/10/16/xxx.jpg`）或完整 url，
 * 由本函数统一截出 key —— 调用方拿到的往往是 url（存在 JSON 字段里），
 * 让每个调用点自己写一遍 `split('/uploads/')[1]` 迟早会漏掉转义或前缀差异。
 *
 * @returns {Promise<Buffer>} 文件不存在时抛错（调用方需要能区分「读不到」与「读到空」）
 */
async function read(keyOrUrl) {
  const key = extractKey(keyOrUrl)
  if (!key) throw new Error('无法从入参解析出存储 key')
  return fs.readFile(path.join(config.upload.dir, key))
}

/** 从 url 或 key 里截出存储 key */
function extractKey(keyOrUrl) {
  if (!keyOrUrl) return null
  const value = String(keyOrUrl)
  const marker = `${config.upload.publicPath}/`
  const index = value.indexOf(marker)
  return index >= 0 ? value.slice(index + marker.length) : value
}

/** 存储层是否可用（启动自检用）。目录不存在时尝试创建 */
async function assertWritable() {
  await fs.mkdir(config.upload.dir, { recursive: true })
  const probe = path.join(config.upload.dir, '.write-probe')
  await fs.writeFile(probe, 'ok')
  await fs.unlink(probe)
}

module.exports = {
  ALLOWED_EXTENSIONS,
  GENERATED_EXTENSIONS,
  save,
  saveGenerated,
  urlFor,
  read,
  extractKey,
  remove,
  assertWritable,
  buildKey,
}
