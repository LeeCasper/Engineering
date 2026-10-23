#!/usr/bin/env node
'use strict'

/**
 * 把 Stitch 设计稿里的内联 SVG 与实景图转成小程序可用的 PNG。
 *
 * 微信小程序的 `<image>` 对 SVG 的支持在各端不一致（尤其 Android），
 * 因此背景插画、天际线、图标一律栅格化为 3x PNG。
 *
 * 角色卡片的实景图**不在这里处理**：保留原始 JPG（每张 50–80KB），
 * 左侧羽化由页面上的白色渐变覆盖层实现 —— 带 alpha 的大 PNG 每张近 2MB，
 * 会直接把主包顶过微信 2MB 的限制。
 *
 * 运行：node scripts/gen-assets.js
 */

const fs = require('node:fs')
const path = require('node:path')
const sharp = require('/home/lee/project/coding/Renovation/server/node_modules/sharp')

const OUT = path.resolve(__dirname, '..', 'src', 'static', 'images')
fs.mkdirSync(OUT, { recursive: true })

async function renderSvg(name, svg, density) {
  await sharp(Buffer.from(svg), { density }).png().toFile(path.join(OUT, name))
  console.log('  ✔', name)
}

async function renderIcon(name, body, { size = 24, color = '#51463E', strokeWidth = 1.8 } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  await sharp(Buffer.from(svg), { density: 216 }).png().toFile(path.join(OUT, name))
  console.log('  ✔', name)
}

/** 实心图标（底部 tab / 定位 / 更多等）。与 renderIcon 的区别只是 fill 而不是 stroke */
async function renderFilledIcon(name, body, { size = 24, color = '#51463E' } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" stroke="none">${body}</svg>`
  await sharp(Buffer.from(svg), { density: 216 }).png().toFile(path.join(OUT, name))
  console.log('  ✔', name)
}

const LOGIN_BG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 428 380" fill="none">
<defs>
<linearGradient id="skyGrad" x1="0" x2="0" y1="0" y2="1">
<stop offset="0%" stop-color="#F7CDB8"/><stop offset="45%" stop-color="#FBEBDF"/><stop offset="100%" stop-color="#FBF6F0" stop-opacity="0"/>
</linearGradient>
<linearGradient id="fadeDown" x1="0" x2="0" y1="0.6" y2="1">
<stop offset="0%" stop-color="#FBF6F0" stop-opacity="0"/><stop offset="100%" stop-color="#FBF6F0" stop-opacity="1"/>
</linearGradient>
<linearGradient id="sunGlow" x1="1" x2="0.3" y1="0" y2="0.7">
<stop offset="0%" stop-color="#FFFDF0" stop-opacity="0.85"/><stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>
</defs>
<rect fill="url(#skyGrad)" height="380" width="428"/>
<circle cx="360" cy="80" fill="url(#sunGlow)" r="140"/>
<path d="M120 220 H135 V200 H150 V220 H180 V190 H195 V220 H230 V180 H250 V220 H280 V195 H300 V220 H340 V205 H360 V220" opacity="0.6" stroke="#E8BBA3" stroke-width="1.5"/>
<polygon fill="#F3E8E0" opacity="0.7" points="180,180 428,90 428,320 180,320"/>
<polygon fill="#FFFFFF" points="180,180 428,90 428,125 180,200"/>
<polygon fill="#EAD8CD" points="210,190 428,105 428,115 210,197"/>
<rect fill="#F6CDB6" fill-opacity="0.45" height="95" stroke="#FFFFFF" stroke-width="3" width="80" x="230" y="195"/>
<line stroke="#FFFFFF" stroke-width="2" x1="270" x2="270" y1="195" y2="290"/>
<line stroke="#FFFFFF" stroke-width="1.5" x1="230" x2="310" y1="240" y2="240"/>
<rect fill="#F3C5AE" fill-opacity="0.3" height="150" stroke="#E8CDBC" stroke-width="3" width="98" x="330" y="150"/>
<rect fill="#E2DDD5" height="160" width="22" x="375" y="140"/>
<g stroke="#C69255" stroke-linecap="round" stroke-width="2.5">
<line x1="380" x2="368" y1="245" y2="305"/><line x1="388" x2="400" y1="245" y2="305"/>
<line stroke-width="2" x1="375" x2="392" y1="262" y2="262"/><line stroke-width="2" x1="372" x2="395" y1="278" y2="278"/>
<line stroke-width="2" x1="370" x2="398" y1="293" y2="293"/>
</g>
<rect fill="#E07A3F" height="18" rx="2" width="15" x="338" y="278"/>
<ellipse cx="345.5" cy="278" fill="#F2AE86" rx="7.5" ry="2"/>
<rect fill="#FAF7F4" height="15" rx="2" stroke="#D8CFC7" stroke-width="1" width="14" x="350" y="282"/>
<polygon fill="#E6CEB3" opacity="0.85" points="120,310 428,290 428,335 120,340"/>
<line stroke="#D7BA9A" stroke-width="1.5" x1="160" x2="428" y1="315" y2="297"/>
<rect fill="url(#fadeDown)" height="150" width="428" y="230"/>
</svg>`

const LOGIN_SKYLINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 428 50" width="428" height="50">
<g fill="#F1D7C8" opacity="0.6">
<path d="M350 15 V48 M320 22 H395 M320 22 L350 15 L365 22 M380 22 V34" fill="none" stroke="#E7C0A9" stroke-width="1.2"/>
<rect height="12" width="428" x="0" y="38"/>
<path d="M10 32 H22 V50 H10 Z M24 25 H36 V50 H24 Z M40 30 H55 V50 H40 Z M120 28 H135 V50 H120 Z M137 20 H152 V50 H137 Z M154 26 H168 V50 H154 Z M172 32 H182 V50 H172 Z M215 18 H230 V50 H215 Z M233 28 H246 V50 H233 Z M250 22 H265 V50 H250 Z M268 34 H280 V50 H268 Z M370 26 H388 V50 H370 Z M392 32 H410 V50 H392 Z"/>
</g></svg>`

const ROLE_SKYLINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 120" width="500" height="120">
<path d="M 0,120 L 0,80 L 30,80 L 30,65 L 60,65 L 60,85 L 110,85 L 110,50 L 130,50 L 130,70 L 180,70 L 180,90 L 240,90 L 240,40 L 270,40 L 270,75 L 340,75 L 340,55 L 380,55 L 380,85 L 430,85 L 430,65 L 470,65 L 470,90 L 500,90 L 500,120 Z" fill="#f1d5c5" opacity="0.35"/>
<path d="M 0,120 L 0,95 L 45,95 L 45,75 L 85,75 L 85,98 L 140,98 L 140,65 L 165,65 L 165,95 L 210,95 L 210,80 L 290,80 L 290,60 L 325,60 L 325,85 L 390,85 L 390,70 L 420,70 L 420,95 L 500,95 L 500,120 Z" fill="#f1d5c5" opacity="0.6"/>
<path d="M0,120 Q200,90 500,115 L500,120 Z" fill="#e7b99f" opacity="0.8"/>
</svg>`

/** 首页头部的白色城市天际线与塔吊（设计稿中的 16% 透明度装饰） */
const HOME_SKYLINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120" width="400" height="120">
<g fill="#FFFFFF">
<path d="M260,20 L310,20 L310,5 L314,5 L314,20 L380,20 L380,23 L314,23 L314,80 L310,80 L310,23 L260,23 Z M310,23 L285,45 L290,45 L310,27 Z M314,27 L335,45 L340,45 L314,23 Z"></path>
<rect height="55" width="22" x="230" y="65"></rect>
<rect height="75" width="28" x="255" y="45"></rect>
<rect height="50" width="30" x="288" y="70"></rect>
<rect height="65" width="35" x="322" y="55"></rect>
<rect height="80" width="40" x="360" y="40"></rect>
</g></svg>`

/**
 * 首页品牌区：白底橙色房子的简化标记。
 *
 * 完整品牌 logo 是「橙底白字」，放在橙色 hero 上会糊成一块；
 * 这里用反色版本作为小尺寸标记，完整 wordmark 只出现在浅底页面。
 */
const HOME_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
<rect width="96" height="96" rx="22" fill="#FFFFFF"/>
<path transform="translate(24,24) scale(2)" fill="#EB5C20" d="M12 2L2 9.5V20C2 21.1 2.9 22 4 22H20C21.1 22 22 21.1 22 20V9.5L12 2ZM14.5 19H9.5V14H14.5V19ZM19.5 19H16.5V13C16.5 12.45 16.05 12 15.5 12H8.5C7.95 12 7.5 12.45 7.5 13V19H4.5V10.45L12 4.83L19.5 10.45V19Z"/>
</svg>`

const SEARCH_EMPTY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="#EB5C20" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
<circle cx="22" cy="22" r="13"/>
<line x1="31.5" y1="31.5" x2="41" y2="41" stroke-width="2.5"/>
<path d="M16 23v-5l6-4.5 6 4.5v5"/>
<rect x="19" y="20" width="6" height="6" rx="0.5"/>
</svg>`

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
<defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#F07A3A"/><stop offset="100%" stop-color="#EB5C20"/></linearGradient></defs>
<rect width="96" height="96" rx="22" fill="url(#lg)"/>
<path transform="translate(24,24) scale(2)" fill="#fff" d="M12 2L2 9.5V20C2 21.1 2.9 22 4 22H20C21.1 22 22 21.1 22 20V9.5L12 2ZM14.5 19H9.5V14H14.5V19ZM19.5 19H16.5V13C16.5 12.45 16.05 12 15.5 12H8.5C7.95 12 7.5 12.45 7.5 13V19H4.5V10.45L12 4.83L19.5 10.45V19Z"/>
</svg>`

/** 「我的」页默认头像（Stitch 设计稿里的 3D 卡通头像，避免空头像只剩一个字母） */
const MINE_AVATAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="240" height="240">
<circle cx="50" cy="50" fill="#FEEAD8" r="50"/>
<path d="M22 92 C26 74 38 70 50 70 C62 70 74 74 78 92 Z" fill="#E67E22"/>
<path d="M42 70 L50 82 L58 70 Z" fill="#FFFFFF"/>
<rect fill="#FAD1B5" height="15" rx="3" width="12" x="44" y="56"/>
<ellipse cx="50" cy="46" fill="#FCD9C0" rx="18" ry="20"/>
<path d="M30 42 C29 25 40 18 53 18 C67 18 73 27 71 39 C67 36 60 36 56 38 C49 40 43 36 37 38 C33 40 31 41 30 42 Z" fill="#5D3A1A"/>
<path d="M31 38 C34 30 45 22 62 25 C58 23 48 20 37 25 C32 28 30 32 31 38 Z" fill="#784B24"/>
<circle cx="32" cy="48" fill="#F8C7A9" r="4.5"/>
<circle cx="68" cy="48" fill="#F8C7A9" r="4.5"/>
<path d="M40 39 Q44 37 47 40" fill="none" stroke="#4A2F17" stroke-linecap="round" stroke-width="1.8"/>
<path d="M53 40 Q56 37 60 39" fill="none" stroke="#4A2F17" stroke-linecap="round" stroke-width="1.8"/>
<ellipse cx="44" cy="44" fill="#2C3E50" rx="2" ry="2.6"/>
<ellipse cx="56" cy="44" fill="#2C3E50" rx="2" ry="2.6"/>
<path d="M46 53 Q50 58 54 53" fill="none" stroke="#D35400" stroke-linecap="round" stroke-width="2"/>
</svg>`

/**
 * 「我的」页橙色头部整体形状：一条贯通页面的向下弧线。
 *
 * 橙色块本身沿曲线收口，白线是它的下边缘；资料卡叠在上面。
 * 不能用“左右两个装饰弧 + 中间平”的做法 —— 那样弧线不贯通。
 */
const MINE_HERO_BG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 242" width="390" height="242">
<defs>
<linearGradient id="mineHeroGrad" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="#F47A3D"/>
<stop offset="46%" stop-color="#EB5C20"/>
<stop offset="100%" stop-color="#D94B12"/>
</linearGradient>
</defs>
<path d="M0 0 H390 V225 Q195 255 0 225 Z" fill="url(#mineHeroGrad)"/>
<path d="M0 225 Q195 255 390 225" fill="none" stroke="#C44710" stroke-opacity="0.22" stroke-width="12" stroke-linecap="round"/>
<path d="M0 225 Q195 255 390 225" fill="none" stroke="#FFF8F3" stroke-width="5" stroke-linecap="round"/>
</svg>`

/** 「我的」页顶部的橙色渐变建筑线框：白色半透明，叠在品牌橙上做分层 */
const MINE_HERO_ARCH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" width="400" height="260">
<g fill="#FFFFFF" fill-opacity="0.12">
<path d="M150 260V115L235 60L320 115V260Z"/>
<path d="M235 60L320 115L320 260H235Z" fill-opacity="0.06"/>
<path d="M40 260V175L105 140V260Z" fill-opacity="0.08"/>
</g>
<g fill="none" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="2">
<path d="M150 260V115L235 60L320 115V260"/>
<path d="M180 260V130L235 95L290 130V260"/>
<path d="M205 260V150"/>
<path d="M265 260V150"/>
<path d="M150 115L235 170L320 115"/>
<path d="M235 60V170"/>
<path d="M40 260V175L105 140V260"/>
<path d="M330 260V180L392 148V260"/>
</g>
<g fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="10">
<path d="M20 260V190L80 156"/>
<path d="M350 260V195L400 168"/>
</g>
</svg>`


/**
 * 底部 tab 使用设计方提供的彩色 3D 图标：
 * - accent 保留原图质感（当前主题本身就是橙色）；
 * - gray 用灰度 + 暖灰着色，保留明暗层次，避免选中/未选中只是纯色遮罩。
 */
async function trimTransparent(buffer) {
  // 设计方给的 tab 图标四周有较多透明留白，直接缩到 81×81 会让图形只占 70%~85%。
  // 先裁掉透明边再缩放，视觉上图标更大，但 tabBar 本身仍是微信原生组件。
  try {
    return await sharp(buffer).ensureAlpha().trim({ threshold: 1 }).toBuffer()
  } catch {
    return buffer
  }
}

async function renderColorTabIcon(source, outName, size = 81) {
  const trimmed = await trimTransparent(await sharp(source).toBuffer())
  await sharp(trimmed)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, outName))
  console.log('  ✔', outName)
}

async function renderGrayTabIcon(source, outName, color = '#8B8179', size = 81) {
  const trimmed = await trimTransparent(await sharp(source).toBuffer())
  await sharp(trimmed)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .grayscale()
    .tint(color)
    .png()
    .toFile(path.join(OUT, outName))
  console.log('  ✔', outName)
}

async function main() {
  console.log('生成小程序静态资源…')

  // density 216 = 3x（设计稿 428px 宽 → 1284px）
  await renderSvg('login-bg.png', LOGIN_BG, 216)
  await renderSvg('login-skyline.png', LOGIN_SKYLINE, 216)
  // 角色页天际线设计宽度 500px → 3x = 1500px
  await renderSvg('role-skyline.png', ROLE_SKYLINE, 300)

  // 品牌方提供的完整 logo（橙底白字）优先；缺失时退回内置图形，避免脚本单独运行失败。
  const brandLogoSource = path.resolve(__dirname, '..', 'design-refs', 'brand-logo.png')
  if (fs.existsSync(brandLogoSource)) {
    await sharp(brandLogoSource)
      .resize(384, 384, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, 'logo.png'))
    console.log('  ✔ logo.png（design-refs/brand-logo.png）')
  } else {
    await renderSvg('logo.png', LOGO, 288)
    console.log('  ✔ logo.png（内置回退图形）')
  }

  const UNDERLINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 10" width="140" height="10"><path d="M2 4C40 9 95 9 138 3" fill="none" stroke="#EB5C20" stroke-width="2.5" stroke-linecap="round"/></svg>`
  await renderSvg('login-underline.png', UNDERLINE, 216)

  await renderIcon('icon-phone.png', '<rect x="6" y="2" width="12" height="20" rx="3"/><line x1="11" y1="18" x2="13" y2="18"/>', { color: '#A19488' })
  await renderIcon('icon-shield-check.png', '<path d="M12 3L4 6.5V12C4 16.5 7.5 20.5 12 21.5C16.5 20.5 20 16.5 20 12V6.5L12 3Z"/><path d="M9 12L11 14L15 10"/>', { color: '#A19488' })
  await renderIcon('icon-shield-check-white.png', '<path d="M12 3L4 6.5V12C4 16.5 7.5 20.5 12 21.5C16.5 20.5 20 16.5 20 12V6.5L12 3Z"/><path d="M9 12L11 14L15 10"/>', { color: '#FFFFFF', size: 24 })
  await renderIcon('icon-shield-white.png', '<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>', { color: '#FFFFFF' })
  await renderIcon('icon-user-white.png', '<path fill="#fff" stroke="none" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>', { color: '#FFFFFF' })
  await renderIcon('icon-gear-white.png', '<path fill="#fff" stroke="none" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"/>', { color: '#FFFFFF' })
  await renderIcon('icon-chevron-right.png', '<path d="M9 5l7 7-7 7"/>', { color: '#7A6C60', size: 24 })
  await renderIcon('icon-back.png', '<path d="M15 19l-7-7 7-7"/>', { color: '#1E293B', size: 24 })
  await renderIcon('icon-check-white.png', '<path d="M5 13l4 4L19 7"/>', { color: '#FFFFFF', size: 24 })
  await renderIcon('icon-shield-outline.png', '<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>', { color: '#8A7E73' })

  // ── 首页（我的项目）──
  await renderSvg('home-skyline.png', HOME_SKYLINE, 216)
  await renderSvg('home-logo.png', HOME_LOGO, 216)
  await renderSvg('icon-search-empty.png', SEARCH_EMPTY_ICON, 216)

  await renderIcon('icon-search.png', '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21" stroke-width="2"/>', { color: '#A19488', strokeWidth: 2 })
  await renderFilledIcon('icon-location.png', '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/>', { color: '#A19488' })
  await renderFilledIcon('icon-people.png', '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>', { color: '#A19488' })
  await renderFilledIcon('icon-more.png', '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>', { color: '#A19488' })
  await renderIcon('icon-filter.png', '<path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/>', { color: '#51463E', strokeWidth: 2 })
  await renderIcon('icon-plus-white.png', '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', { color: '#FFFFFF', strokeWidth: 2.5 })
  await renderIcon('icon-close.png', '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', { color: '#A19488', strokeWidth: 2.5 })
  await renderFilledIcon('icon-caret-down-white.png', '<path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/>', { color: '#FFFFFF', size: 20 })
  await renderFilledIcon('icon-caret-down-gray.png', '<path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/>', { color: '#51463E', size: 20 })

  // 阶段胶囊：完成 / 进行中 / 待处理 / 未解锁
  await renderIcon('icon-stage-done.png', '<path d="M5 13l4 4L19 7"/>', { color: '#FFFFFF', strokeWidth: 2.4 })
  await renderFilledIcon('icon-stage-active.png', '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>', { color: '#FFFFFF' })
  await renderIcon('icon-stage-pending.png', '<circle cx="12" cy="12" r="9"/><line x1="12" y1="7" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="#FFFFFF" stroke="none"/>', { color: '#FFFFFF', strokeWidth: 2.2 })
  await renderIcon('icon-stage-locked.png', '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>', { color: '#FFFFFF', strokeWidth: 2 })

  // 底部 tab：设计方提供的四个彩色 3D 图标
  const TAB_ICON_DIR = path.resolve(__dirname, '..', 'design-refs', 'tab-icons')
  const TAB_ICONS = [
    ['project', 'icon-tab-project'],
    ['acceptance', 'icon-tab-acceptance'],
    ['ledger', 'icon-tab-ledger'],
    ['mine', 'icon-tab-mine'],
  ]
  for (const [sourceName, outBase] of TAB_ICONS) {
    const source = path.join(TAB_ICON_DIR, `${sourceName}.png`)
    if (!fs.existsSync(source)) {
      console.log(`  - 跳过 ${outBase}（缺少 design-refs/tab-icons/${sourceName}.png）`)
      continue
    }
    await renderColorTabIcon(source, `${outBase}-accent.png`)
    await renderGrayTabIcon(source, `${outBase}-gray.png`)
  }

  // ── 验收页 / 验收详情页 ──
  await renderIcon('icon-clock.png', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', { color: '#8B8179', strokeWidth: 2 })
  await renderIcon('icon-document.png', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>', { color: '#EB5C20' })
  await renderIcon('icon-filter-accent.png', '<path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/>', { color: '#EB5C20', strokeWidth: 2 })
  await renderIcon('icon-filter-white.png', '<path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/>', { color: '#FFFFFF', strokeWidth: 2 })
  await renderIcon('icon-acceptance-empty.png', '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>', { color: '#EB5C20', size: 48, strokeWidth: 1.8 })

  // ── 项目详情页（业主视角）──
  await renderIcon('icon-members-accent.png', '<path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>', { color: '#EB5C20', strokeWidth: 1.8 })
  await renderIcon('icon-checklist-green.png', '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>', { color: '#00B42A', strokeWidth: 1.8 })
  await renderIcon('icon-wallet-amber.png', '<path d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>', { color: '#FF7D00', strokeWidth: 1.8 })
  await renderIcon('icon-map-sky.png', '<path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>', { color: '#C2410C', strokeWidth: 1.8 })
  await renderIcon('icon-arrow-up.png', '<path d="M5 10l7-7m0 0l7 7m-7-7v18"/>', { color: '#51463E', strokeWidth: 2 })
  await renderIcon('icon-arrow-right-white.png', '<path d="M14 5l7 7m0 0l-7 7m7-7H3"/>', { color: '#FFFFFF', strokeWidth: 2 })
  await renderIcon('icon-camera-gray.png', '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="4"/>', { color: '#8B8179', strokeWidth: 1.8 })
  await renderFilledIcon('icon-location-accent.png', '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/>', { color: '#EB5C20', size: 24 })

  // ── 业主项目总览 ──
  await renderIcon('icon-document-amber.png', '<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>', { color: '#FA8C16', strokeWidth: 1.8 })
  await renderIcon('icon-contract-white.png', '<path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>', { color: '#FFFFFF', strokeWidth: 1.8 })
  await renderIcon('icon-received-white.png', '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>', { color: '#FFFFFF', strokeWidth: 1.8 })
  await renderIcon('icon-expense-white.png', '<path d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>', { color: '#FFFFFF', strokeWidth: 1.8 })
  await renderIcon('icon-balance-white.png', '<path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>', { color: '#FFFFFF', strokeWidth: 1.8 })
  await renderIcon('icon-phone-accent.png', '<path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/>', { color: '#EB5C20', strokeWidth: 1.8 })
  await renderIcon('icon-navigation-accent.png', '<path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/>', { color: '#EB5C20', strokeWidth: 1.8 })
  await renderIcon('icon-comment-gray.png', '<path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>', { color: '#8B8179', strokeWidth: 1.8 })
  await renderIcon('icon-image-gray.png', '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>', { color: '#8B8179', strokeWidth: 1.8 })
  await renderIcon('icon-calendar-gray.png', '<path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>', { color: '#8B8179', strokeWidth: 1.8 })
  await renderIcon('icon-phone-white.png', '<path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/>', { color: '#FFFFFF', strokeWidth: 1.8 })
  await renderFilledIcon('icon-play-white.png', '<polygon points="5 3 19 12 5 21 5 3"/>', { color: '#FFFFFF', size: 24 })
  await renderFilledIcon('icon-shield-accent.png', '<path d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM13.707 8.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"/>', { color: '#EB5C20', size: 24 })
  await renderIcon('icon-lock-gray.png', '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>', { color: '#8B8179', strokeWidth: 1.8 })

  // ── 记账页（业主视角）──
  await renderIcon('icon-warning-amber.png', '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="0.6" fill="#FF7D00" stroke="none"/>', { color: '#FF7D00', strokeWidth: 1.8, size: 20 })
  await renderIcon('icon-list-accent.png', '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>', { color: '#EB5C20', strokeWidth: 2.2 })
  await renderFilledIcon('icon-chart-accent.png', '<path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/>', { color: '#EB5C20', size: 24 })
  await renderFilledIcon('icon-pie-accent.png', '<path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 8V5a6 6 0 016 6h-5a1 1 0 01-1-1z"/>', { color: '#EB5C20', size: 24 })
  await renderFilledIcon('icon-pie-white.png', '<path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 8V5a6 6 0 016 6h-5a1 1 0 01-1-1z"/>', { color: '#FFFFFF', size: 20 })
  await renderIcon('icon-chevron-right-white.png', '<path d="M9 5l7 7-7 7"/>', { color: '#FFFFFF', strokeWidth: 2, size: 20 })
  await renderIcon('icon-receipt-gray.png', '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z"/><path d="M9 7h6M9 11h6"/>', { color: '#8B8179', strokeWidth: 1.8 })
  await renderSvg('ledger-hero-mark.png', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
<g fill="none" stroke="#FFFFFF" stroke-width="2.4" opacity="0.13">
<path d="M20 180V80L100 30L180 80V180H140V120H60V180H20Z"/>
<line x1="60" y1="80" x2="140" y2="80"/>
<line x1="100" y1="30" x2="100" y2="120"/>
</g></svg>`, 216)

  // ── 我的页面 ──
  await renderSvg('mine-avatar-default.png', MINE_AVATAR, 216)
  await renderSvg('mine-hero-arch.png', MINE_HERO_ARCH, 216)
  await renderSvg('mine-hero-bg.png', MINE_HERO_BG, 216)
  await renderFilledIcon('icon-message-accent.png', '<path d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z"/>', { color: '#EB5C20' })
  await renderFilledIcon('icon-home-accent.png', '<path d="M12 3L2 12h3v8h6v-5h2v5h6v-8h3L12 3zm0 2.85l6 5.4V18h-2v-5H8v5H6v-6.75l6-5.4z"/>', { color: '#EB5C20' })
  await renderFilledIcon('icon-acceptance-accent.png', '<path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"/>', { color: '#EB5C20' })
  await renderIcon('icon-bell-accent.png', '<path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>', { color: '#EB5C20', strokeWidth: 1.8 })
  await renderIcon('icon-edit-accent.png', '<path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>', { color: '#EB5C20', strokeWidth: 1.8 })
  await renderIcon('icon-info-accent.png', '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 12v4"/>', { color: '#EB5C20', strokeWidth: 1.8 })
  await renderIcon('icon-logout-gray.png', '<path d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>', { color: '#8B8179', strokeWidth: 1.8 })
  await renderFilledIcon('icon-hardhat-accent.png', '<path d="M12 2a7 7 0 00-7 7v1h14V9a7 7 0 00-7-7z"/><path d="M3 10h18v2H3z"/><circle cx="12" cy="14" r="3"/><path d="M7 21a5 5 0 0110 0H7z"/>', { color: '#EB5C20' })
  await renderFilledIcon('icon-hardhat-gray.png', '<path d="M12 2a7 7 0 00-7 7v1h14V9a7 7 0 00-7-7z"/><path d="M3 10h18v2H3z"/><circle cx="12" cy="14" r="3"/><path d="M7 21a5 5 0 0110 0H7z"/>', { color: '#8B8179' })
  await renderSvg('icon-wallet-fill-accent.png', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="11" fill="#EB5C20"/><path d="M7.5 7l4.5 5 4.5-5M12 12v7M8.5 13h7M8.5 15.5h7" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/></svg>`, 216)

  const acceptanceHeader = path.resolve(__dirname, '..', 'design-refs', 'acceptance-header.jpg')
  if (fs.existsSync(acceptanceHeader)) {
    await sharp(acceptanceHeader).resize(720, 402, { fit: 'cover' }).jpeg({ quality: 78 }).toFile(path.join(OUT, 'acceptance-header.jpg'))
    console.log('  ✔ acceptance-header.jpg')
  }

  // 设计稿的项目封面：后端暂无封面字段，首页按项目 id 取一张占位实景图。
  // 4 张图裁成 300×300 后合计约 100KB，远小于微信主包限制。
  for (let index = 1; index <= 4; index += 1) {
    const source = path.resolve(__dirname, '..', 'design-refs', `home-cover-${index}.jpg`)
    if (!fs.existsSync(source)) {
      console.log(`  - 跳过 project-cover-${index}.jpg（缺少 design-refs/home-cover-${index}.jpg）`)
      continue
    }
    await sharp(source)
      .resize(300, 300, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toFile(path.join(OUT, `project-cover-${index}.jpg`))
    console.log('  ✔', `project-cover-${index}.jpg`)
  }

  console.log('完成（角色卡实景图保留原 JPG，不在此处理）')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
