/**
 * 微信原生自定义 tabBar 的同步工具。
 *
 * `pages.json` 设置了 `tabBar.custom = true`，微信端底栏由
 * `src/custom-tab-bar/`（原生 WXML 组件）渲染。它不在 Vue 页面树里，
 * 页面只能通过 `page.$scope.getTabBar()` 拿到实例并 setData。
 *
 * H5 不走这条链路：H5 用 `components/ClientTabBar.vue`，这里的所有调用会
 * 静默跳过（`getTabBar` 不存在）。
 */

function getCustomTabBar() {
  try {
    const pages = getCurrentPages()
    const page = pages && pages[pages.length - 1]
    if (!page) return null
    const scope = page.$scope || (page.$vm && page.$vm.$scope)
    if (!scope || typeof scope.getTabBar !== 'function') return null
    return scope.getTabBar()
  } catch (err) {
    return null
  }
}

/** 同步选中项 / 红点等数据到原生底栏；拿不到实例时静默忽略 */
export function syncCustomTabBar(data) {
  const bar = getCustomTabBar()
  if (bar && typeof bar.setData === 'function') {
    bar.setData(data)
  }
}
