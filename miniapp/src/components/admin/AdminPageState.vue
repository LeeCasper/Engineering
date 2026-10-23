<template>
  <view v-if="loading" class="admin-state">
    <text class="admin-state-text">{{ loadingText }}</text>
  </view>

  <view v-else-if="error" class="admin-state">
    <image class="admin-state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
    <text class="admin-state-title">加载失败</text>
    <text class="admin-state-text">{{ error }}</text>
    <button class="admin-state-btn" @tap="$emit('retry')">重新加载</button>
  </view>

  <view v-else-if="empty" class="admin-state">
    <slot name="empty">
      <image class="admin-state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
      <text class="admin-state-title">{{ emptyTitle }}</text>
      <text v-if="emptyText" class="admin-state-text">{{ emptyText }}</text>
      <slot name="empty-action" />
    </slot>
  </view>

  <slot v-else />
</template>

<script setup>
defineOptions({ name: 'AdminPageState' })

defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  empty: { type: Boolean, default: false },
  loadingText: { type: String, default: '加载中…' },
  emptyTitle: { type: String, default: '暂无数据' },
  emptyText: { type: String, default: '' },
})

defineEmits(['retry'])
</script>

<style scoped lang="scss">
.admin-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(56) dp(24) dp(28);
  text-align: center;
}

.admin-state-icon {
  width: dp(52);
  height: dp(52);
  margin-bottom: dp(12);
  opacity: 0.75;
}

.admin-state-title {
  color: #241c17;
  font-size: dp(15);
  font-weight: 600;
}

.admin-state-text {
  margin-top: dp(7);
  color: #8b8179;
  font-size: dp(12);
  line-height: 1.7;
}

.admin-state-btn {
  min-width: dp(140);
  height: dp(36);
  margin-top: dp(14);
  border: none;
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  line-height: dp(36);
}
</style>
