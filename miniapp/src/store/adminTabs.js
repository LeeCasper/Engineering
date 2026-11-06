import { ref } from 'vue'

/**
 * 管理端壳页的 tab 状态。
 *
 * 顶层页不再是四个独立页面：`pages/admin/home/index` 里用四个视图组件切换，
 * 底栏常驻，避免 redirectTo 重建 webview 导致真机上底栏闪烁（C 端用原生
 * tabBar 也是同样的效果，但微信只允许一套 tabBar，且 tabBar 页必须在主包）。
 *
 * 任何页面/组件想切换管理端 tab，都调用 requestAdminTab，由壳页监听切换；
 * 不要再 redirectTo 到 pages/admin/{workbench,projects,members,profile}。
 */
export const adminTabRequest = ref({ name: '', options: {}, seq: 0 })

export const ADMIN_TAB_NAMES = ['workbench', 'projects', 'members', 'profile']

export function requestAdminTab(name, options = {}) {
  if (!ADMIN_TAB_NAMES.includes(name)) return
  adminTabRequest.value = {
    name,
    options: options || {},
    seq: adminTabRequest.value.seq + 1,
  }
}
