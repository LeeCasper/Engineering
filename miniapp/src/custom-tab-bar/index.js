/**
 * 空的微信自定义 tabBar 占位组件。
 *
 * pages.json 里 `tabBar.custom = true` 会让微信不再渲染原生底栏；按微信的约定，
 * 此时框架会查找 `custom-tab-bar/index` 组件。C 端的底栏实际是页面内的
 * `components/ClientTabBar.vue`（这样才能做液态玻璃与统一的选中态），
 * 因此这里只提供一个空组件，避免开发者工具报「组件不存在」。
 *
 * 不要在这里实现底栏 —— 微信原生自定义 tabBar 无法复用 Vue 组件与项目样式。
 */
Component({})
