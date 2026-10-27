<template>
  <view
    class="admin-nav"
    :class="{ 'admin-nav--glass': glass }"
    :style="{ paddingTop: `${safeTop + 6}px`, backgroundColor: glass ? undefined : background }"
  >
    <view class="admin-nav-row">
      <view class="admin-nav-back" @tap="onBack">
        <image class="admin-nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <text class="admin-nav-title">{{ title }}</text>
      <view class="admin-nav-right">
        <slot name="right" />
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { ADMIN_HOME, adminBack, goCProjects } from '../../utils/admin'

defineOptions({ name: 'AdminNav' })

const props = defineProps({
  title: { type: String, default: '管理' },
  fallback: { type: String, default: ADMIN_HOME },
  backToC: { type: Boolean, default: false },
  // 嵌套页默认沿用暖色工具型后台；详情页与列表页统一到冷灰画布
  background: { type: String, default: '#faf7f4' },
  // 吸顶导航使用液态玻璃，滚动时内容从标题下方透出
  glass: { type: Boolean, default: false },
})

const info = uni.getSystemInfoSync()
const safeTop = ref(info.statusBarHeight || 12)

function onBack() {
  if (props.backToC) {
    goCProjects()
    return
  }
  adminBack(props.fallback)
}
</script>

<style scoped lang="scss">
.admin-nav {
  position: sticky;
  top: 0;
  z-index: 40;
  padding-right: dp(12);
  padding-bottom: dp(8);
  padding-left: dp(6);
  background: #faf7f4;
}

.admin-nav--glass {
  background: linear-gradient(
    180deg,
    rgba(246, 247, 249, 0.92) 0%,
    rgba(246, 247, 249, 0.68) 100%
  );
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.62);
  box-shadow:
    0 dp(6) dp(18) rgba(29, 33, 41, 0.04),
    inset 0 -1px 0 rgba(255, 255, 255, 0.4);
}

.admin-nav-row {
  display: flex;
  align-items: center;
  min-height: dp(38);
}

.admin-nav-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(34);
  height: dp(34);
  flex-shrink: 0;
}

.admin-nav-back-icon {
  width: dp(20);
  height: dp(20);
}

.admin-nav-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #241C17;
  font-size: dp(18);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.admin-nav-right {
  display: flex;
  align-items: center;
  min-width: dp(34);
  justify-content: flex-end;
  flex-shrink: 0;
}

/* 小程序右上角有微信原生胶囊，右侧动作往左让位 */
/* #ifdef MP-WEIXIN */
.admin-nav {
  padding-right: dp(92);
}
/* #endif */
</style>
