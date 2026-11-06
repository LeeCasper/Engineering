<template>
  <view />
</template>

<script setup>
import { onLoad } from '@dcloudio/uni-app'

// 旧路径兼容：管理端顶层页已经合并进 pages/admin/home/index 的壳页，
// 这里只做一次转跳，避免登录回跳 / 旧深链落到不存在的页面上。
onLoad(() => {
  uni.redirectTo({ url: '/pages/admin/home/index?tab=workbench' })
})
</script>
