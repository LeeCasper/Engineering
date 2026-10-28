import { ref } from 'vue'
import { getToken } from '../store/session'
import { fetchUnreadSummary } from '../api/notification'
import { syncCustomTabBar } from './tabBar'

/**
 * 「我的」tab 的未读红点由自绘底栏 `ClientTabBar` 渲染。
 *
 * 原生 tabBar 已被隐藏（自绘底栏才有液态玻璃），`uni.setTabBarBadge`
 * 即使调用也看不到，因此这里只维护一个响应式计数。
 * 口径是全局未读数，与消息分类、当前项目无关（G-29）。
 */
export const mineTabBadge = ref(0)

export function setMineTabBadge(total) {
  const count = getToken() ? Number(total) || 0 : 0
  mineTabBadge.value = count

  // 微信端底栏是原生 custom-tab-bar，需要写 storage 并推送一次；
  // H5 的 ClientTabBar 直接读上面的 ref。
  try {
    uni.setStorageSync('gc_mine_badge', count)
  } catch (err) {
    // 存储失败不影响页面
  }
  syncCustomTabBar({ badge: count })
}

/** 拉一次未读数并同步底栏红点；失败返回 null，不打断页面 */
export async function refreshMineTabBadge() {
  if (!getToken()) {
    setMineTabBadge(0)
    return null
  }

  try {
    const data = await fetchUnreadSummary()
    setMineTabBadge(data.total)
    return Number(data.total) || 0
  } catch (err) {
    return null
  }
}
