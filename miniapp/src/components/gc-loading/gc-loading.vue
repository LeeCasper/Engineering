<template>
  <view class="gc-loading" :class="{ 'gc-loading--inline': inline }">
    <view class="gc-loading-dots">
      <view class="gc-loading-dot" />
      <view class="gc-loading-dot" />
      <view class="gc-loading-dot" />
    </view>
    <text v-if="text" class="gc-loading-text">{{ text }}</text>
  </view>
</template>

<script setup>
defineProps({
  text: { type: String, default: '正在加载' },
  inline: { type: Boolean, default: false },
})
</script>

<style scoped lang="scss">
.gc-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: dp(10);
  padding: dp(20) 0;
}

.gc-loading--inline {
  display: inline-flex;
  flex-direction: row;
  gap: dp(6);
  padding: 0;
  vertical-align: middle;
}

.gc-loading-dots {
  display: flex;
  align-items: center;
  gap: dp(5);
  height: dp(14);
}

.gc-loading-dot {
  width: dp(6);
  height: dp(6);
  border-radius: 50%;
  background: $color-primary;
  animation: gc-dot-bounce 1s infinite ease-in-out;
}

.gc-loading-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.gc-loading-dot:nth-child(3) {
  animation-delay: 0.3s;
}

.gc-loading-text {
  color: $color-ink-tertiary;
  font-size: dp(12);
  letter-spacing: dp(0.4);
}

@keyframes gc-dot-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  40% {
    transform: translateY(-dp(5));
    opacity: 1;
  }
}
</style>
