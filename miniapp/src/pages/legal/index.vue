<template>
  <view class="page">
    <view v-if="loading" class="state">
      <gc-loading text="正在加载内容…" />
    </view>

    <view v-else-if="error" class="state">
      <text class="state-title">{{ error }}</text>
      <text class="state-text">可稍后在「我的 → 关于我们」中查看</text>
    </view>

    <view v-else class="document">
      <text class="doc-title">{{ title }}</text>
      <text v-if="version" class="doc-version">版本 {{ version }}</text>
      <text class="doc-content">{{ content }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getContent } from '../../api/auth'
import { getCurrentProject } from '../../store/projectContext'

const TITLES = {
  agreement: '用户协议',
  privacy: '隐私政策',
  about: '关于我们',
  esign_agreement: '电子签名知情同意书',
}

const loading = ref(true)
const error = ref('')
const title = ref('')
const content = ref('')
const version = ref('')

onLoad(async (options) => {
  const key = (options && options.key) || 'agreement'
  title.value = TITLES[key] || '内容页'
  uni.setNavigationBarTitle({ title: title.value })

  try {
    // 有当前项目时优先读该项目所属租户的版本；没有则读平台基础版本。
    // 后端也会做同样顺序的回退，这里带 tenantId 是为了让租户覆盖版本生效。
    const currentProject = getCurrentProject()
    const data = await getContent(key, currentProject ? currentProject.tenantId : undefined)
    title.value = data.title || title.value
    content.value = data.content || ''
    version.value = data.version || ''
    uni.setNavigationBarTitle({ title: title.value })
  } catch (err) {
    // 页面尚未发布是正常状态（种子只写入未发布的骨架），
    // 不应该表现成「网络错误」
    error.value = err.statusCode === 404 ? err.message || '页面尚未发布' : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $color-surface;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(80) dp(32);
}

.state-title {
  font-size: dp(17);
  font-weight: 600;
  color: $color-ink;
}

.state-text {
  margin-top: dp(10);
  font-size: dp(13);
  color: $color-ink-tertiary;
  text-align: center;
}

.document {
  padding: dp(24) dp(20) dp(48);
}

.doc-title {
  display: block;
  font-size: dp(22);
  font-weight: 700;
  color: $color-ink;
}

.doc-version {
  display: block;
  margin-top: dp(6);
  font-size: dp(12);
  color: $color-ink-tertiary;
}

.doc-content {
  display: block;
  margin-top: dp(20);
  font-size: dp(15);
  line-height: 1.8;
  color: $color-ink-secondary;
  white-space: pre-wrap;
}
</style>
