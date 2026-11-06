<template>
  <view />
</template>

<script setup>
import { onLoad } from '@dcloudio/uni-app'

// 旧路径兼容：转到管理端壳页的「我的」tab
onLoad(() => {
  uni.redirectTo({ url: '/pages/admin/home/index?tab=profile' })
})
</script>
