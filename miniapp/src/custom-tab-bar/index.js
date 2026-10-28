/**
 * 微信原生自定义 tabBar。
 *
 * 底栏必须放在这里（`custom-tab-bar/`）而不是 Vue 页面里：
 * 它由微信渲染在所有 webview 之外，切换 tab 时不会随页面重建，
 * 因此不会出现「每切一次底栏闪一下」。
 *
 * 选中态优先按当前页面路由判断（`refresh`），页面也会在 onShow 里通过
 * `utils/tabBar.js` 再同步一次，两层兜底。
 *
 * 注意：这里不能用 Vue / uni API，只有原生小程序运行时。
 */

const TABS = [
  {
    pagePath: 'pages/projects/index',
    text: '项目',
    icon: '/static/images/icon-tab-project-flat-gray.png',
    activeIcon: '/static/images/icon-tab-project-flat-theme.png',
  },
  {
    pagePath: 'pages/acceptance/index',
    text: '验收',
    icon: '/static/images/icon-tab-acceptance-flat-gray.png',
    activeIcon: '/static/images/icon-tab-acceptance-flat-theme.png',
  },
  {
    pagePath: 'pages/ledger/index',
    text: '记账',
    icon: '/static/images/icon-tab-ledger-flat-gray.png',
    activeIcon: '/static/images/icon-tab-ledger-flat-theme.png',
  },
  {
    pagePath: 'pages/mine/index',
    text: '我的',
    icon: '/static/images/icon-tab-mine-flat-gray.png',
    activeIcon: '/static/images/icon-tab-mine-flat-theme.png',
  },
]

Component({
  data: {
    selected: 0,
    badge: 0,
    list: TABS,
  },

  lifetimes: {
    attached() {
      this.refresh()
    },
  },

  pageLifetimes: {
    // 从其他 tab 切回来时同步，避免高亮滞留在上一个 tab
    show() {
      this.refresh()
    },
  },

  methods: {
    /** 以当前路由为准设置选中态；红点从 storage 读取（由 notificationBadge 写入） */
    refresh() {
      let selected = 0
      try {
        const pages = getCurrentPages()
        const current = pages && pages[pages.length - 1]
        const route = current && current.route
        for (let i = 0; i < TABS.length; i += 1) {
          if (TABS[i].pagePath === route) {
            selected = i
            break
          }
        }
      } catch (err) {
        // 冷启动早期页面栈可能为空，保持默认 0
      }

      let badge = 0
      try {
        badge = Number(wx.getStorageSync('gc_mine_badge')) || 0
      } catch (err) {
        badge = 0
      }

      if (this.data.selected !== selected || this.data.badge !== badge) {
        this.setData({ selected, badge })
      }
    },

    /**
     * 只调用 switchTab，不在这里 setData 选中态 ——
     * 同一次切换里再改 selected 会触发底栏二次重绘，正是闪烁的来源。
     * 新页面的 pageLifetimes.show / 页面 onShow 会负责同步。
     */
    onTap(event) {
      const index = Number(event.currentTarget.dataset.index)
      const tab = TABS[index]
      if (!tab) return
      wx.switchTab({ url: `/${tab.pagePath}` })
    },
  },
})
