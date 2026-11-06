<template>
  <view />
</template>

<script setup>
import { onLoad } from '@dcloudio/uni-app'

// 旧路径兼容：转到管理端壳页的「项目」tab；阶段管理模式一并带上
onLoad((options) => {
  const mode = options && options.mode === 'stages' ? '&mode=stages' : ''
  uni.redirectTo({ url: `/pages/admin/home/index?tab=projects${mode}` })
})
</script>
