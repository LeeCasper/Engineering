'use strict'

/**
 * 服务端水印组件（AC-P11 / AC-P12 / AC-P13，供 §4.6 的现场签到复用）。
 *
 * ── 三个验收标准的落点 ──
 *   AC-P11 汇报照片自动叠加水印，内容含拍摄时间、项目地址、工序名
 *          → 由调用方传入 `lines`，本组件不关心具体是哪些字段
 *   AC-P12 水印在**服务端**叠加，绕过小程序直传原图仍带水印
 *          → 因此本组件只在服务端被调用，且上传接口拿到的永远是原图，
 *            带水印版本由服务端生成后另存
 *   AC-P13 位置、字号、透明度全局统一（默认右下角）
 *          → 全部来自 config.watermark，不接收调用方覆盖
 *
 * ── 参数化 ──
 * §4.6.2 要求进度汇报与现场签到共用同一套组件、内容字段可配：
 *   汇报 = 拍摄时间 + 项目地址 + 工序名
 *   签到 = 拍摄时间 + 项目地址 + 签到坐标
 * 差异只在 `lines`，其余（字体、位置、透明度）必须全局一致 ——
 * 否则同一批照片里会出现两种样式，一眼就能看出哪些是后补的。
 *
 * ── 关于字体 ──
 * 见 config/index.js 中 watermark.fontPath 的说明：字体缺失时 sharp 不报错，
 * 会静默产出没有水印的图片。因此这里**主动检查字体文件是否存在并抛错**，
 * 让上传失败 —— 存下一张看似正常、实则没有凭证价值的照片，比上传失败危险得多。
 */

const fs = require('node:fs')
const sharp = require('sharp')

const config = require('../../config')
const logger = require('../utils/logger')

/** 水印相对图片宽度的基准字号比例，用于自适应 */
const FONT_SIZE_RATIO = 0.028
const MIN_FONT_SIZE = 14
const MAX_FONT_SIZE = 64

/** 水印距边缘的留白（像素），按图片宽度自适应 */
const PADDING_RATIO = 0.02
const MIN_PADDING = 8

/**
 * 检查指定字体文件是否可用。
 *
 * 抽成接收路径的纯函数（而不是直接读 config）是为了可测：
 * `config` 是深冻结的，测试无法临时改 `fontPath` 来验证这条守卫，
 * 而「字体缺失导致静默产出无水印图片」恰恰是最需要被测试盯住的一处。
 *
 * @throws {Error} 字体文件不存在
 */
function checkFontAvailable(fontPath) {
  if (fontPath && !fs.existsSync(fontPath)) {
    throw new Error(
      `水印字体文件不存在：${fontPath}。` +
        '字体缺失时 sharp 不会报错，会静默产出没有水印的图片（AC-P12 失效），' +
        '因此这里主动失败。请安装中文字体或设置 WATERMARK_FONT_PATH。'
    )
  }
  return true
}

/**
 * 校验运行环境的水印字体。
 *
 * 由 server.js 在启动时调用一次；每次生成水印前也会再调（结果缓存），
 * 因为运维可能在运行期替换字体文件。
 *
 * @throws {Error} 字体文件不存在
 */
let fontChecked = false
function assertFontAvailable() {
  if (fontChecked) return

  checkFontAvailable(config.watermark.fontPath)
  fontChecked = true
  logger.debug('水印字体可用', { fontPath: config.watermark.fontPath, fontFamily: config.watermark.fontFamily })
}

/**
 * XML 转义。
 *
 * 水印内容含项目地址，而地址是用户填写的自由文本 —— 里面完全可能有 `&`、`<`。
 * 不转义会让 SVG 解析失败（sharp 报一个与真实原因毫无关系的错），
 * 或者更糟：被当成标签注入。
 */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 按图片宽度算字号与留白，使水印在大图小图上观感一致 */
function computeMetrics(width) {
  const fontSize = config.watermark.fontSize || clamp(Math.round(width * FONT_SIZE_RATIO), MIN_FONT_SIZE, MAX_FONT_SIZE)
  const padding = Math.max(MIN_PADDING, Math.round(width * PADDING_RATIO))
  return { fontSize, padding }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * 估算一行文字渲染后的宽度。
 *
 * CJK 是等宽全角（约等于字号），ASCII 大约是字号的 0.55 倍。
 * 这个估算只用来给底衬定宽度 —— 估小了文字会超出底板，估大了底板偏宽。
 * 不追求精确：精确测量需要真正排版一次，为一块半透明底板不值当。
 */
function estimateTextWidth(text, fontSize) {
  let units = 0
  for (const char of String(text)) {
    // 中日韩统一表意文字、全角标点按 1 个字号宽，其余按 0.55
    units += /[　-鿿＀-￯]/.test(char) ? 1 : 0.55
  }
  return Math.ceil(units * fontSize)
}

/**
 * 构造水印图层（SVG）。
 *
 * ── 尺寸只覆盖文字块，不铺满整图 ──
 * 这一点关系到 AC-P13 能否成立：若 SVG 与图片等大，sharp 的 `gravity` 就失去意义
 * （整图图层放在哪都是整图），位置只能硬编码在坐标里，配置项形同虚设。
 * 因此这里只画出「底衬 + 文字」这一小块，由 composite 的 gravity 决定它落在哪。
 *
 * ── 底衬不能省 ──
 * 没有半透明底板，白字落在浅色墙面照片上几乎看不见。
 * 水印的价值是「一眼能看到、且擦不掉」，看不见就等于没有。
 */
function buildWatermarkSvg({ lines, fontSize, padding }) {
  const lineHeight = Math.round(fontSize * 1.45)
  const blockHeight = lineHeight * lines.length
  const textWidth = Math.max(...lines.map((line) => estimateTextWidth(line, fontSize)))
  const blockWidth = textWidth + padding * 2

  // ── 为什么底板外面还要再留一圈透明边距 ──
  // composite 的 gravity 是把图层**贴着**目标角落放的，没有 margin 参数。
  // 若 SVG 尺寸等于底板尺寸，底板就会紧贴图片边缘 —— 观感上像被裁掉了一块。
  // 因此在底板四周再留一圈 padding，靠这圈透明区域形成视觉留白。
  const svgWidth = blockWidth + padding * 2
  const svgHeight = blockHeight + padding * 2

  const backdrop = `<rect x="${padding}" y="${padding}" width="${blockWidth}" height="${blockHeight}" rx="${Math.round(fontSize * 0.3)}" fill="#000000" fill-opacity="0.35"/>`

  // ── 基线要相对**底板顶部**算，不是相对 SVG 顶部 ──
  // 底板从 y=padding 开始（padding 是外侧的透明留白）。
  // 首行基线 = 底板顶 + 一个字号（CJK 字形基本占满 em 框，基线在字形底部）。
  // 写成 padding*2 会把外侧留白也算成内侧留白，
  // 于是最后一行的基线落到底板下沿之外 —— 看起来就是第三行压出了底板。
  const firstBaseline = padding + Math.round(fontSize * 1.15)
  const textX = padding * 2

  const textNodes = lines
    .map((line, index) => {
      const y = firstBaseline + index * lineHeight
      return `<text x="${textX}" y="${y}" font-family="${escapeXml(config.watermark.fontFamily)}" font-size="${fontSize}" fill="#ffffff" fill-opacity="${config.watermark.opacity}">${escapeXml(line)}</text>`
    })
    .join('')

  return {
    svg: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">${backdrop}${textNodes}</svg>`
    ),
    width: svgWidth,
    height: svgHeight,
  }
}

/**
 * 给图片叠加水印。
 *
 * @param {Buffer} inputBuffer 原图
 * @param {object} params
 * @param {string[]} params.lines 水印内容，按行从上到下。
 *   进度汇报传 [时间, 项目地址, 工序名]；现场签到传 [时间, 项目地址, 坐标]
 * @returns {Promise<Buffer>} 带水印的图片（格式与原图一致）
 * @throws {Error} 字体不可用或图片无法解析
 */
async function apply(inputBuffer, { lines }) {
  assertFontAvailable()

  const content = (lines || []).map((line) => String(line ?? '').trim()).filter(Boolean)
  if (content.length === 0) {
    throw new Error('水印内容为空，拒绝生成无水印的图片（AC-P12）')
  }

  // rotate() 不带参数 = 按 EXIF 方向自动旋转。
  // 必须显式调用：手机竖拍的照片像素是横的、靠 EXIF 标记方向，
  // 不先摆正就画水印，最终图里水印会歪 90 度
  const base = sharp(inputBuffer, { failOn: 'none' }).rotate()
  const metadata = await base.metadata()

  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('无法解析图片尺寸，水印未应用')

  const { fontSize, padding } = computeMetrics(width)
  const { svg, width: blockWidth } = buildWatermarkSvg({ lines: content, fontSize, padding })

  // 文字块比图片还宽时（超长地址 + 小图），gravity 会让它溢出并被裁掉。
  // 宁可让水印小一点也要完整可见 —— 被裁掉一半的水印等于没有
  const scale = blockWidth > width ? width / blockWidth : 1
  const layer = scale < 1 ? await sharp(svg).resize({ width: Math.floor(width) }).png().toBuffer() : svg

  if (scale < 1) {
    logger.debug('水印内容较宽，已缩放以适应图片', { scale: Number(scale.toFixed(3)) })
  }

  return base
    .composite([
      {
        input: layer,
        // AC-P13：位置来自全局配置，不接收调用方指定
        gravity: config.watermark.position,
        blend: 'over',
      },
    ])
    .toBuffer()
}

/** 供测试与启动自检重置字体检查缓存 */
function resetFontCheck() {
  fontChecked = false
}

module.exports = {
  apply,
  assertFontAvailable,
  checkFontAvailable,
  resetFontCheck,
  buildWatermarkSvg,
  escapeXml,
  computeMetrics,
}
