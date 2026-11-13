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
/**
 * Allure 只在 CI 里开启：本地 `npm test` 不需要每次生成一堆结果文件。
 * CI 通过 ALLURE_RESULTS_DIR 打开，产出交给 `allure generate`。
 * 注意 reporter 的入口是 `allure-vitest/reporter`（包没有 "." 导出），
 * 写成 `allure-vitest` 会报 ERR_RESOLVE_PACKAGE_ENTRY_FAIL。
 */
const reporters = ['default']
if (process.env.ALLURE_RESULTS_DIR) {
  reporters.push('allure-vitest/reporter')
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    reporters,
    // 必须在 config/index.js 被 require 之前生效，否则测试会连到开发库上，
    // 而集成测试会 DROP DATABASE —— 那等于每次跑测试都清空开发数据。
    // WX_MOCK 固定为 true：测试必须走 mock openid，绝不能打真实微信接口；
    // 本地 .env 可能为了联调切成 WX_MOCK=false。
    // 地图 Key 必须显式清空：本地 .env 可能为了联调配了真实 AMAP_KEY，
    // 不清空的话测试会打真实地图接口（慢、消耗配额，且结果随网络变化）。
    // 空字符串在 dotenv 眼里也是「已设置」，因此不会被 .env 覆盖。
    env: { NODE_ENV: 'test', WX_MOCK: 'true', AMAP_KEY: '', TENCENT_MAP_KEY: '', MAP_PROVIDER: 'auto' },
    // globals 必须开启：本项目源码是 CommonJS，测试文件也写成 CJS，
    // 而 vitest 包本身是 ESM-only，`require('vitest')` 会失败。
    // 开启后 describe/it/expect 直接可用，测试文件与源码风格保持一致。
    globals: true,
    // 集成测试里建库、跑迁移、逐条断言，5s 默认超时不够
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
