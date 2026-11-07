import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { setupVitePlugins } from './build/plugins';
import { createViteProxy, getBuildTime } from './build/config';

/**
 * 正式构建时整段删除「开发调试」代码。
 *
 * 只靠 `import.meta.env.DEV` + `v-if` 只能保证不渲染：Vue 会把它编译成
 * 运行时的 `unref(false)`，开发账号/密码字面量仍留在公开的登录 chunk 里。
 * 这里在 SFC 编译前按标记删除模板段，正式包里不留痕迹。
 *
 * 标记写法：
 *   <!-- dev-only:start --> ... <!-- dev-only:end -->
 *
 * 只在 prod/production 模式生效：`pnpm dev` 用的是 `--mode test`。
 */
function stripDevOnly() {
  const HTML_BLOCK = /<!--\s*dev-only:start[\s\S]*?<!--\s*dev-only:end\s*-->/g;

  return {
    name: 'strip-dev-only-blocks',
    apply: (_config: unknown, { mode }: { mode: string }) => mode === 'prod' || mode === 'production',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.includes('pwd-login.vue')) return null;
      return code.replace(HTML_BLOCK, '');
    }
  };
}

export default defineConfig(configEnv => {
  const viteEnv = loadEnv(configEnv.mode, process.cwd()) as unknown as Env.ImportMeta;

  const buildTime = getBuildTime();

  const enableProxy = configEnv.command === 'serve' && !configEnv.isPreview;

  return {
    base: viteEnv.VITE_BASE_URL,
    resolve: {
      alias: {
        '~': fileURLToPath(new URL('./', import.meta.url)),
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
          additionalData: `@use "@/styles/scss/global.scss" as *;`
        }
      }
    },
    plugins: [stripDevOnly(), ...setupVitePlugins(viteEnv, buildTime)],
    define: {
      BUILD_TIME: JSON.stringify(buildTime)
    },
    server: {
      host: '0.0.0.0',
      port: 9527,
      open: true,
      proxy: createViteProxy(viteEnv, enableProxy)
    },
    preview: {
      port: 9725
    },
    build: {
      reportCompressedSize: false,
      sourcemap: viteEnv.VITE_SOURCE_MAP === 'Y',
      commonjsOptions: {
        ignoreTryCatch: false
      }
    }
  };
});
