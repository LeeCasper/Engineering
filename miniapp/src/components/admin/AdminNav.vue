<template>
  <view class="admin-nav" :style="{ paddingTop: `${safeTop + 6}px` }">
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
import { adminBack, goCProjects } from '../../utils/admin'

defineOptions({ name: 'AdminNav' })

const props = defineProps({
  title: { type: String, default: '管理' },
  fallback: { type: String, default: '/pages/admin/projects/index' },
  backToC: { type: Boolean, default: false },
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
