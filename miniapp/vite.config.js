import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

/**
 * 正式构建时整段删除「开发调试」代码。
 *
 * 只靠 `import.meta.env.DEV` + `v-if` 只能保证不渲染：账号常量会被摇掉，但
 * 按钮文案仍留在 H5 的 render 函数与微信的 WXML 里。这里在 SFC 编译前按标记
 * 删除模板 / 脚本 / 样式三段，正式包里不留任何痕迹。
 *
 * 标记写法（只在 pages/admin/login/index.vue 里使用）：
 *   <!-- dev-only:start --> ... <!-- dev-only:end -->
 *   /* dev-only:start *\/ ... /* dev-only:end *\/
 *
 * 只在 mode=production 时生效：`dev:mp-weixin` 也是 vite build（watch），
 * 不能用 command 判断，否则微信开发工具里也会被删掉。
 */
function stripDevOnly() {
  const HTML_BLOCK = /<!--\s*dev-only:start[\s\S]*?<!--\s*dev-only:end\s*-->/g
  const CODE_BLOCK = /\/\*\s*dev-only:start[\s\S]*?\/\*\s*dev-only:end\s*\*\//g

  return {
    name: 'strip-dev-only-blocks',
    apply: (_config, { mode }) => mode === 'production',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('pages/admin/login/index.vue')) return null
      return code.replace(HTML_BLOCK, '').replace(CODE_BLOCK, '')
    },
  }
}

export default defineConfig({
  plugins: [stripDevOnly(), uni()],
})
