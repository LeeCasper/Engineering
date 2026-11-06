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

// 顶层页现在都在 pages/admin/home/index 壳页内切换，底栏只向上抛事件，
// 不再自己 redirectTo（真机会重建 webview，底栏会闪）。
const emit = defineEmits(['change'])

/**
 * 管理端顶层页的内页导航。
 *
 * 不是原生 tabBar（微信只允许一套 tabBar，且 tabBar 页必须在主包）。
 * 四个顶层页已经合并到 pages/admin/home/index 的壳页里，这里只负责发事件；
 * 不要改回 redirectTo，真机切页会重建 webview、底栏会闪。
 */
const TABS = [
  {
    key: 'workbench',
    label: '工作台',
    icon: '/static/images/icon-admin-workbench-gray.png',
    activeIcon: '/static/images/icon-admin-workbench-accent.png',
  },
  {
    key: 'projects',
    label: '项目',
    icon: '/static/images/icon-admin-project-gray.png',
    activeIcon: '/static/images/icon-admin-project-accent.png',
  },
  {
    key: 'members',
    label: '成员',
    icon: '/static/images/icon-admin-members-gray.png',
    activeIcon: '/static/images/icon-admin-members-accent.png',
  },
  {
    key: 'profile',
    label: '我的',
    icon: '/static/images/icon-admin-profile-gray.png',
    activeIcon: '/static/images/icon-admin-profile-accent.png',
  },
]

function go(tab) {
  if (props.active === tab.key) return
  emit('change', tab.key)
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
  /* 顶层页之间是 redirectTo，底栏每个页面都会重建；加弹跳动画会在每次切页时
     重播一遍，看起来就是底栏在闪。这里只保留选中底色，不做入场动画。 */
  background: #fff2ed;
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

</style>
