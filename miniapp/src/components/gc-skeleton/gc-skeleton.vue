<template>
  <view class="gc-skeleton">
    <view v-for="index in rows" :key="index" class="gc-skeleton-card">
      <view class="gc-skeleton-cover gc-shimmer" />
      <view class="gc-skeleton-body">
        <view class="gc-skeleton-line gc-skeleton-line--title gc-shimmer" />
        <view class="gc-skeleton-line gc-shimmer" style="width: 86%" />
        <view class="gc-skeleton-line gc-skeleton-line--short gc-shimmer" />
      </view>
    </view>
  </view>
</template>

<script setup>
defineProps({
  rows: { type: Number, default: 3 },
})
</script>

<style scoped lang="scss">
.gc-skeleton {
  display: flex;
  flex-direction: column;
  gap: dp(12);
  width: 100%;
}

.gc-skeleton-card {
  display: flex;
  gap: dp(12);
  padding: dp(12);
  border: 1px solid $color-hairline;
  border-radius: dp(12);
  background: $color-surface;
  animation: gc-skeleton-in 0.28s ease-out both;
}

.gc-skeleton-card:nth-child(2) {
  animation-delay: 0.06s;
}

.gc-skeleton-card:nth-child(3) {
  animation-delay: 0.12s;
}

.gc-skeleton-cover {
  flex: none;
  width: dp(82);
  height: dp(82);
  border-radius: dp(10);
}

.gc-skeleton-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: dp(9);
}

.gc-skeleton-line {
  height: dp(10);
  border-radius: dp(999);
}

.gc-skeleton-line--title {
  width: 56%;
  height: dp(14);
}

.gc-skeleton-line--short {
  width: 38%;
}

.gc-shimmer {
  background: linear-gradient(90deg, #f1ece6 25%, #faf7f3 37%, #f1ece6 63%);
  background-size: 400% 100%;
  animation: gc-shimmer 1.4s ease infinite;
}

@keyframes gc-shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}

@keyframes gc-skeleton-in {
  from {
    opacity: 0;
    transform: translateY(dp(6));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
