import { getToken } from '../store/session'
import { fetchUnreadSummary } from '../api/notification'

/**
 * 消息红点挂在“我的”tab 上（tabBar index 3）。
 *
 * 口径是全局未读数，与消息分类、当前项目无关（G-29）。
 * 调用方要吞掉失败：红点只是提示，不能因为它让页面进入错误态。
 */
export function setMineTabBadge(total) {
  const count = Number(total) || 0
  if (!getToken()) {
    uni.removeTabBarBadge({ index: 3, fail: () => {} })
    return
  }

  if (count > 0) {
    uni.setTabBarBadge({
      index: 3,
      text: count > 99 ? '99+' : String(count),
      fail: () => {},
    })
  } else {
    uni.removeTabBarBadge({ index: 3, fail: () => {} })
  }
}

/** 拉一次未读数并同步 tab 红点；失败返回 null，不打断页面 */
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
