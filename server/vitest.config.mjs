import { defineConfig } from 'vitest/config'

/**
 * Vitest 配置。
 *
 * 用 .mjs 后缀是因为 package.json 里 "type": "commonjs"（后端整体走 CJS），
 * 而 Vite 的配置加载器对 ESM 支持最稳 —— 显式后缀省掉一层歧义。
 *
 * 两类测试分开跑，理由见 package.json 的 scripts：
 *   tests/unit         纯逻辑，不碰数据库，可并行、可频繁跑；
 *   tests/integration  打真实 MySQL，必须串行（--no-file-parallelism），
 *                      否则多个用例文件同时重建同一张表会互相踩。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    // 必须在 config/index.js 被 require 之前生效，否则测试会连到开发库上，
    // 而集成测试会 DROP DATABASE —— 那等于每次跑测试都清空开发数据。
    env: { NODE_ENV: 'test' },
    // globals 必须开启：本项目源码是 CommonJS，测试文件也写成 CJS，
    // 而 vitest 包本身是 ESM-only，`require('vitest')` 会失败。
    // 开启后 describe/it/expect 直接可用，测试文件与源码风格保持一致。
    globals: true,
    // 集成测试里建库、跑迁移、逐条断言，5s 默认超时不够
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
