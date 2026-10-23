'use strict'

/**
 * 图形验证码。
 *
 * 需求文档 B-1.1（登录须填图形验证码）与 AC-AD02：
 *   - 必填且**一次性有效（用后即失效）**；
 *   - 验证码错误**不消耗登录失败次数**（AC-AD03 的 5 次锁定只针对密码错误）。
 *
 * 产出 SVG 而非位图：无需 canvas 之类的原生依赖，且同样无法被简单 OCR 轻易识别
 * （svg-captcha 会做字符扭曲与干扰线）。
 */

const svgCaptcha = require('svg-captcha')
const { nanoid } = require('nanoid')

const config = require('../../config')
const cache = require('../cache')
const logger = require('../utils/logger')

/** 验证码有效期。太短用户来不及输入，太长等于给爆破留时间窗口 */
const TTL_SECONDS = 5 * 60

function key(id) {
  return `captcha:admin-login:${id}`
}

/**
 * 生成验证码。
 *
 * 把答案存在**服务端**，只把 id 和图片给前端 —— 答案绝不能出现在响应里，
 * 否则验证码形同虚设（前端拿到答案直接回填即可）。
 *
 * 开发环境下额外返回答案明文（见下方 debugAnswer），生产环境绝不会带上。
 *
 * @param {object} [options]
 * @param {'svg'|'png'} [options.format='svg'] 小程序不支持稳定的 SVG 渲染，需要 PNG
 * @returns {Promise<{captchaId: string, svg?: string, pngDataUrl?: string, debugAnswer?: string}>}
 */
async function generate({ format = 'svg' } = {}) {
  const captcha = svgCaptcha.create({
    size: 4,
    noise: 3,
    // 排除易混淆字符（0/O、1/l/I），减少「明明输对了却说错误」的客诉
    ignoreChars: '0o1ilI',
    color: true,
    background: '#f5f5f5',
    width: 120,
    height: 40,
  })

  const captchaId = nanoid(24)
  // 大小写不敏感：用户看不清大小写是常态，为此判错没有意义
  const answer = captcha.text.toLowerCase()
  await cache.set(key(captchaId), answer, TTL_SECONDS)

  // 开发环境回显答案，否则用 curl 手工调登录接口时永远拿不到正确的验证码。
  // 只认 config.isDev（即 NODE_ENV=development）—— 测试环境不需要它（测试直接读缓存），
  // 生产环境即便误配也拿不到。启动时会打一条醒目告警（见 server.js）。
  const debugAnswer = config.isDev ? answer : undefined

  if (format === 'png') {
    // sharp 是重依赖，只有小程序登录页取 PNG 时才加载，避免拖慢服务启动
    const sharp = require('sharp')
    const png = await sharp(Buffer.from(captcha.data)).png().toBuffer()
    return {
      captchaId,
      pngDataUrl: `data:image/png;base64,${png.toString('base64')}`,
      ...(debugAnswer ? { debugAnswer } : {}),
    }
  }

  return {
    captchaId,
    svg: captcha.data,
    ...(debugAnswer ? { debugAnswer } : {}),
  }
}

/**
 * 校验验证码。
 *
 * **无论对错都立即删除**（AC-AD02 的「用后即失效」）——
 * 若错了还留着，同一个验证码就能被反复试，4 位字符只需几千次请求即可穷举。
 *
 * @param {string} captchaId
 * @param {string} answer 用户输入
 * @returns {Promise<boolean>}
 */
async function verify(captchaId, answer) {
  if (!captchaId || !answer) return false

  const expected = await cache.get(key(captchaId))

  // 先删再比：即便下面的比较抛错，验证码也已经被消费掉了
  await cache.del(key(captchaId))

  if (expected === null) {
    // 过期或从未签发。不区分这两种情况对外提示，但日志里要能看出来
    logger.debug('验证码不存在或已过期', { captchaId })
    return false
  }

  return String(answer).trim().toLowerCase() === String(expected)
}

module.exports = { TTL_SECONDS, generate, verify, _key: key }
