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

async function renderIcon(name, body, { size = 24, color = '#4E5969' } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  await sharp(Buffer.from(svg), { density: 216 }).png().toFile(path.join(OUT, name))
  console.log('  ✔', name)
}

const LOGIN_BG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 428 380" fill="none">
<defs>
<linearGradient id="skyGrad" x1="0" x2="0" y1="0" y2="1">
<stop offset="0%" stop-color="#CAE0F5"/><stop offset="45%" stop-color="#EBF4FD"/><stop offset="100%" stop-color="#F5F8FC" stop-opacity="0"/>
</linearGradient>
<linearGradient id="fadeDown" x1="0" x2="0" y1="0.6" y2="1">
<stop offset="0%" stop-color="#F5F8FC" stop-opacity="0"/><stop offset="100%" stop-color="#F5F8FC" stop-opacity="1"/>
</linearGradient>
<linearGradient id="sunGlow" x1="1" x2="0.3" y1="0" y2="0.7">
<stop offset="0%" stop-color="#FFFDF0" stop-opacity="0.85"/><stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>
</defs>
<rect fill="url(#skyGrad)" height="380" width="428"/>
<circle cx="360" cy="80" fill="url(#sunGlow)" r="140"/>
<path d="M120 220 H135 V200 H150 V220 H180 V190 H195 V220 H230 V180 H250 V220 H280 V195 H300 V220 H340 V205 H360 V220" opacity="0.6" stroke="#B8D3EE" stroke-width="1.5"/>
<polygon fill="#E8EDF3" opacity="0.7" points="180,180 428,90 428,320 180,320"/>
<polygon fill="#FFFFFF" points="180,180 428,90 428,125 180,200"/>
<polygon fill="#D3DDE8" points="210,190 428,105 428,115 210,197"/>
<rect fill="#C5DCF2" fill-opacity="0.45" height="95" stroke="#FFFFFF" stroke-width="3" width="80" x="230" y="195"/>
<line stroke="#FFFFFF" stroke-width="2" x1="270" x2="270" y1="195" y2="290"/>
<line stroke="#FFFFFF" stroke-width="1.5" x1="230" x2="310" y1="240" y2="240"/>
<rect fill="#B9D5EE" fill-opacity="0.3" height="150" stroke="#CBDCE9" stroke-width="3" width="98" x="330" y="150"/>
<rect fill="#E2DDD5" height="160" width="22" x="375" y="140"/>
<g stroke="#C69255" stroke-linecap="round" stroke-width="2.5">
<line x1="380" x2="368" y1="245" y2="305"/><line x1="388" x2="400" y1="245" y2="305"/>
<line stroke-width="2" x1="375" x2="392" y1="262" y2="262"/><line stroke-width="2" x1="372" x2="395" y1="278" y2="278"/>
<line stroke-width="2" x1="370" x2="398" y1="293" y2="293"/>
</g>
<rect fill="#2E75D3" height="18" rx="2" width="15" x="338" y="278"/>
<ellipse cx="345.5" cy="278" fill="#6EA5E8" rx="7.5" ry="2"/>
<rect fill="#F4F4F6" height="15" rx="2" stroke="#D1D5DB" stroke-width="1" width="14" x="350" y="282"/>
<polygon fill="#E6CEB3" opacity="0.85" points="120,310 428,290 428,335 120,340"/>
<line stroke="#D7BA9A" stroke-width="1.5" x1="160" x2="428" y1="315" y2="297"/>
<rect fill="url(#fadeDown)" height="150" width="428" y="230"/>
</svg>`

const LOGIN_SKYLINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 428 50" width="428" height="50">
<g fill="#D9E6F5" opacity="0.6">
<path d="M350 15 V48 M320 22 H395 M320 22 L350 15 L365 22 M380 22 V34" fill="none" stroke="#BDD4EC" stroke-width="1.2"/>
<rect height="12" width="428" x="0" y="38"/>
<path d="M10 32 H22 V50 H10 Z M24 25 H36 V50 H24 Z M40 30 H55 V50 H40 Z M120 28 H135 V50 H120 Z M137 20 H152 V50 H137 Z M154 26 H168 V50 H154 Z M172 32 H182 V50 H172 Z M215 18 H230 V50 H215 Z M233 28 H246 V50 H233 Z M250 22 H265 V50 H250 Z M268 34 H280 V50 H268 Z M370 26 H388 V50 H370 Z M392 32 H410 V50 H392 Z"/>
</g></svg>`

const ROLE_SKYLINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 120" width="500" height="120">
<path d="M 0,120 L 0,80 L 30,80 L 30,65 L 60,65 L 60,85 L 110,85 L 110,50 L 130,50 L 130,70 L 180,70 L 180,90 L 240,90 L 240,40 L 270,40 L 270,75 L 340,75 L 340,55 L 380,55 L 380,85 L 430,85 L 430,65 L 470,65 L 470,90 L 500,90 L 500,120 Z" fill="#cde1f7" opacity="0.35"/>
<path d="M 0,120 L 0,95 L 45,95 L 45,75 L 85,75 L 85,98 L 140,98 L 140,65 L 165,65 L 165,95 L 210,95 L 210,80 L 290,80 L 290,60 L 325,60 L 325,85 L 390,85 L 390,70 L 420,70 L 420,95 L 500,95 L 500,120 Z" fill="#cde1f7" opacity="0.6"/>
<path d="M0,120 Q200,90 500,115 L500,120 Z" fill="#b9d6f3" opacity="0.8"/>
</svg>`

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
<defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#2575FC"/><stop offset="100%" stop-color="#165DFF"/></linearGradient></defs>
<rect width="96" height="96" rx="22" fill="url(#lg)"/>
<path transform="translate(24,24) scale(2)" fill="#fff" d="M12 2L2 9.5V20C2 21.1 2.9 22 4 22H20C21.1 22 22 21.1 22 20V9.5L12 2ZM14.5 19H9.5V14H14.5V19ZM19.5 19H16.5V13C16.5 12.45 16.05 12 15.5 12H8.5C7.95 12 7.5 12.45 7.5 13V19H4.5V10.45L12 4.83L19.5 10.45V19Z"/>
</svg>`

async function main() {
  console.log('生成小程序静态资源…')

  // density 216 = 3x（设计稿 428px 宽 → 1284px）
  await renderSvg('login-bg.png', LOGIN_BG, 216)
  await renderSvg('login-skyline.png', LOGIN_SKYLINE, 216)
  // 角色页天际线设计宽度 500px → 3x = 1500px
  await renderSvg('role-skyline.png', ROLE_SKYLINE, 300)
  await sharp(Buffer.from(LOGO), { density: 288 }).png().toFile(path.join(OUT, 'logo.png'))
  console.log('  ✔ logo.png')

  const UNDERLINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 10" width="140" height="10"><path d="M2 4C40 9 95 9 138 3" fill="none" stroke="#2B66EE" stroke-width="2.5" stroke-linecap="round"/></svg>`
  await renderSvg('login-underline.png', UNDERLINE, 216)

  await renderIcon('icon-phone.png', '<rect x="6" y="2" width="12" height="20" rx="3"/><line x1="11" y1="18" x2="13" y2="18"/>', { color: '#94A3B8' })
  await renderIcon('icon-shield-check.png', '<path d="M12 3L4 6.5V12C4 16.5 7.5 20.5 12 21.5C16.5 20.5 20 16.5 20 12V6.5L12 3Z"/><path d="M9 12L11 14L15 10"/>', { color: '#94A3B8' })
  await renderIcon('icon-shield-check-white.png', '<path d="M12 3L4 6.5V12C4 16.5 7.5 20.5 12 21.5C16.5 20.5 20 16.5 20 12V6.5L12 3Z"/><path d="M9 12L11 14L15 10"/>', { color: '#FFFFFF', size: 24 })
  await renderIcon('icon-shield-white.png', '<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>', { color: '#FFFFFF' })
  await renderIcon('icon-user-white.png', '<path fill="#fff" stroke="none" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>', { color: '#FFFFFF' })
  await renderIcon('icon-gear-white.png', '<path fill="#fff" stroke="none" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"/>', { color: '#FFFFFF' })
  await renderIcon('icon-chevron-right.png', '<path d="M9 5l7 7-7 7"/>', { color: '#64748B', size: 24 })
  await renderIcon('icon-back.png', '<path d="M15 19l-7-7 7-7"/>', { color: '#1E293B', size: 24 })
  await renderIcon('icon-check-white.png', '<path d="M5 13l4 4L19 7"/>', { color: '#FFFFFF', size: 24 })
  await renderIcon('icon-shield-outline.png', '<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>', { color: '#7D93AF' })

  console.log('完成（角色卡实景图保留原 JPG，不在此处理）')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
