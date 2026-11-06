<template>
  <view />
</template>

<script setup>
import { onLoad } from '@dcloudio/uni-app'

// 旧路径兼容：转到管理端壳页的「成员」tab，保留邀请入口参数
onLoad((options) => {
  const invite = options && options.invite === '1' ? '&invite=1' : ''
  uni.redirectTo({ url: `/pages/admin/home/index?tab=members${invite}` })
})
</script>
