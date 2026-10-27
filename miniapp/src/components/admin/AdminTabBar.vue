<template>
  <view class="admin-tabbar">
    <view
      v-for="tab in TABS"
      :key="tab.key"
      class="tabbar-item"
      :class="{ 'tabbar-item--active': active === tab.key }"
      @tap.stop="go(tab)"
    >
      <view class="tabbar-icon-wrap">
        <image
          class="tabbar-icon"
          :src="active === tab.key ? tab.activeIcon : tab.icon"
          mode="aspectFit"
        />
      </view>
      <text class="tabbar-label">{{ tab.label }}</text>
    </view>
  </view>
</template>

<script setup>
defineOptions({ name: 'AdminTabBar' })

const props = defineProps({
  active: { type: String, default: 'workbench' },
})

/**
 * 管理端顶层页的内页导航。
 *
 * 这不是原生 tabBar：管理页仍是 pages/admin/** 下的非 tab 页。
 * 顶层页之间必须用 redirectTo，避免页面栈越点越深。
 */
const TABS = [
  {
    key: 'workbench',
    label: '工作台',
    icon: '/static/images/icon-admin-workbench-gray.png',
    activeIcon: '/static/images/icon-admin-workbench-accent.png',
    url: '/pages/admin/workbench/index',
  },
  {
    key: 'projects',
    label: '项目',
    icon: '/static/images/icon-admin-project-gray.png',
    activeIcon: '/static/images/icon-admin-project-accent.png',
    url: '/pages/admin/projects/index',
  },
  {
    key: 'members',
    label: '成员',
    icon: '/static/images/icon-admin-members-gray.png',
    activeIcon: '/static/images/icon-admin-members-accent.png',
    url: '/pages/admin/members/index',
  },
  {
    key: 'profile',
    label: '我的',
    icon: '/static/images/icon-admin-profile-gray.png',
    activeIcon: '/static/images/icon-admin-profile-accent.png',
    url: '/pages/admin/profile/index',
  },
]

function go(tab) {
  if (props.active === tab.key) return
  uni.redirectTo({ url: tab.url })
}
</script>

<style scoped lang="scss">
.admin-tabbar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  padding: dp(6) dp(6) calc(#{dp(6)} + env(safe-area-inset-bottom));
  border-top: 1px solid #f0f2f5;
  background: #fff;
  box-shadow: 0 -#{dp(2)} dp(12) rgba(29, 33, 41, 0.04);
}

.tabbar-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: dp(2);
}

.tabbar-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(48);
  height: dp(28);
  border-radius: dp(14);
  background: transparent;
  transition: background-color 160ms ease;
}

.tabbar-item--active .tabbar-icon-wrap {
  background: #fff2ed;
  transform-origin: center;
  animation: gc-tab-pop 360ms cubic-bezier(0.2, 1.35, 0.35, 1) both;
}

.tabbar-icon {
  width: dp(21);
  height: dp(21);
}

.tabbar-label {
  margin-top: dp(1);
  color: #86909c;
  font-size: dp(11);
  line-height: 1.25;
}

.tabbar-item--active .tabbar-label {
  color: #eb5c20;
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .tabbar-item--active .tabbar-icon-wrap {
    animation: none;
  }
}
</style>
