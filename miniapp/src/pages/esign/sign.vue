<template>
  <view class="page">
    <web-view v-if="url" :src="url" @message="onMessage" />
    <view v-else class="empty">
      <text class="empty-title">签署链接无效</text>
      <text class="empty-text">请返回验收详情重新发起电子签名。</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'

const url = ref('')

onLoad((options) => {
  url.value = decodeURIComponent((options && options.url) || '')
  uni.setNavigationBarTitle({ title: '电子签名' })
})

function onMessage(event) {
  // 服务商页面通常不会向小程序回传业务消息；完成结果以回调/查单为准。
  // 这里只记录日志，避免把 web-view 消息误当成“签署成功”。
  console.log('[esign] web-view message', event && event.detail)
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #faf7f4;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(80) dp(32);
}

.empty-title {
  color: #241c17;
  font-size: dp(17);
  font-weight: 600;
}

.empty-text {
  margin-top: dp(10);
  color: #6d6259;
  font-size: dp(13);
  line-height: 1.7;
  text-align: center;
}
</style>
