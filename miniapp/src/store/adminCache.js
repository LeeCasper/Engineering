/**
 * 管理端顶层页的进程内快照。
 *
 * 管理端四个顶层页（工作台 / 项目 / 成员 / 我的）之间用 redirectTo 切换，
 * 页面实例会被销毁重建。若每次 onLoad 都先显示加载态，用户会觉得「切页 = 刷新」，
 * 底部内页导航也会跟着闪。
 *
 * 这里缓存每个 tab 最近一次成功的数据：新页面先用快照渲染（不显示加载态），
 * 再在后台静默刷新。只放内存、不落 storage；管理员会话变化时必须清空，
 * 避免把上一个账号的数据画给下一个账号。
 */
const cache = new Map()

export function readAdminCache(key) {
  return cache.has(key) ? cache.get(key) : null
}

export function writeAdminCache(key, value) {
  cache.set(key, value)
}

export function clearAdminCache() {
  cache.clear()
}
