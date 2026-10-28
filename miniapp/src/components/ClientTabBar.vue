<template>
  <view class="client-tabbar">
    <view
      v-for="tab in TABS"
      :key="tab.key"
      class="tab-item"
      :class="{ 'tab-item--active': active === tab.key }"
      @tap="go(tab)"
    >
      <view class="tab-icon-wrap">
        <image
          class="tab-icon"
          :src="active === tab.key ? tab.activeIcon : tab.icon"
          mode="aspectFit"
        />
        <text v-if="tab.key === 'mine' && badgeText" class="tab-badge">{{ badgeText }}</text>
      </view>
      <text class="tab-label">{{ tab.label }}</text>
    </view>
  </view>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { mineTabBadge } from '../utils/notificationBadge'

defineOptions({ name: 'ClientTabBar' })

const props = defineProps({
  active: { type: String, default: 'projects' },
})

/**
 * C 端自绘底栏（替代原生 tabBar）。
 *
 * ── 为什么不用原生 tabBar ──
 * 微信原生 tabBar 只能设置纯色背景，无法做液态玻璃；产品要求底栏与页面卡片
 * 统一为玻璃材质，因此改为固定定位的自绘底栏。位置、高度与原原生栏一致，
 * 页面底部统一预留 76dp + 安全区（见各 tab 页的 `.page`）。
 *
 * 原生栏由组件挂载时的 `uni.hideTabBar` 隐藏；`uni.switchTab` 仍然有效，
 * 因为 pages.json 里的 tabBar 配置保留（只是不可见）。
 */
const TABS = [
  {
    key: 'projects',
    label: '项目',
    icon: '/static/images/icon-tab-project-flat-gray.png',
    activeIcon: '/static/images/icon-tab-project-flat-theme.png',
    url: '/pages/projects/index',
  },
  {
    key: 'acceptance',
    label: '验收',
    icon: '/static/images/icon-tab-acceptance-flat-gray.png',
    activeIcon: '/static/images/icon-tab-acceptance-flat-theme.png',
    url: '/pages/acceptance/index',
  },
  {
    key: 'ledger',
    label: '记账',
    icon: '/static/images/icon-tab-ledger-flat-gray.png',
    activeIcon: '/static/images/icon-tab-ledger-flat-theme.png',
    url: '/pages/ledger/index',
  },
  {
    key: 'mine',
    label: '我的',
    icon: '/static/images/icon-tab-mine-flat-gray.png',
    activeIcon: '/static/images/icon-tab-mine-flat-theme.png',
    url: '/pages/mine/index',
  },
]

const badgeText = computed(() => {
  const count = Number(mineTabBadge.value) || 0
  if (count <= 0) return ''
  return count > 99 ? '99+' : String(count)
})

function go(tab) {
  if (props.active === tab.key) return
  uni.switchTab({ url: tab.url })
}

function hideNativeTabBar() {
  // H5 与微信端都支持；隐藏后 switchTab 仍然有效（pages.json 的配置保留）
  uni.hideTabBar({ animation: false, fail: () => {} })
}

onMounted(() => {
  hideNativeTabBar()
  // 微信端挂载时机可能早于原生栏就绪，再补一次（只补一次，避免循环）
  setTimeout(hideNativeTabBar, 300)
})
</script>

<style scoped lang="scss">
.client-tabbar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  /* 低于底部弹窗遮罩（1000/1200/1300），高于页面内容 */
  z-index: 900;
  display: flex;
  align-items: flex-start;
  /* 高度对齐原生 tabBar（约 50px + 安全区） */
  padding: dp(5) dp(6) calc(#{dp(5)} + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(255, 255, 255, 0.72);
  background: linear-gradient(
    180deg,
    rgba(250, 247, 244, 0.72) 0%,
    rgba(255, 255, 255, 0.84) 100%
  );
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  box-shadow:
    0 -#{dp(2)} dp(16) rgba(29, 33, 41, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.tab-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  padding-top: dp(1);
}

.tab-icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(30);
  height: dp(25);
}

.tab-icon {
  width: dp(24);
  height: dp(24);
}

.tab-badge {
  position: absolute;
  top: dp(-3);
  right: dp(-6);
  min-width: dp(15);
  height: dp(15);
  padding: 0 dp(4);
  border: 1px solid #fff;
  border-radius: dp(999);
  background: #f53f3f;
  color: #fff;
  font-size: dp(9);
  font-weight: 700;
  line-height: dp(14);
  text-align: center;
}

.tab-label {
  margin-top: dp(2);
  color: #8b8179;
  font-size: dp(10);
  line-height: 1.25;
}

.tab-item--active .tab-label {
  color: #eb5c20;
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .client-tabbar {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
</style>
