<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <text class="nav-title">意见反馈</text>
    </view>

    <view class="content">
      <view class="intro">
        <text class="intro-title">告诉我们遇到的问题或建议</text>
        <text class="intro-text">请尽量描述具体页面、操作步骤和期望结果，方便我们定位。</text>
      </view>

      <view class="form-card">
        <view class="field">
          <view class="field-head">
            <text class="field-label">反馈内容</text>
            <text class="field-count">{{ content.length }}/1000</text>
          </view>
          <textarea
            v-model="content"
            class="feedback-textarea"
            maxlength="1000"
            auto-height
            placeholder="请至少填写 5 个字说明问题"
            placeholder-class="feedback-placeholder"
          />
        </view>

        <view class="field field--contact">
          <text class="field-label">联系方式（选填）</text>
          <input
            v-model="contact"
            class="feedback-input"
            maxlength="100"
            placeholder="手机号或微信号，便于我们回复"
            placeholder-class="feedback-placeholder"
          />
        </view>

        <view v-if="currentProject" class="project-hint">
          <text class="project-hint-label">关联项目</text>
          <text class="project-hint-value">{{ currentProject.name }}</text>
        </view>
      </view>

      <text v-if="error" class="error-text">{{ error }}</text>

      <button
        class="submit-btn"
        :class="{ 'submit-btn--disabled': submitting }"
        :disabled="submitting"
        @tap="submit"
      >
        {{ submitting ? '提交中…' : '提交反馈' }}
      </button>

      <text class="footnote">当前版本支持文字反馈，图片反馈将在后续版本开放。</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import { getCurrentProject } from '../../store/projectContext'
import { submitFeedback } from '../../api/feedback'

defineOptions({ name: 'FeedbackPage' })

const safeTop = ref(0)
const content = ref('')
const contact = ref('')
const error = ref('')
const submitting = ref(false)
const projectId = ref(null)
const tenantId = ref(null)
const currentProject = ref(null)

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  if (!getToken()) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }

  currentProject.value = getCurrentProject()
  projectId.value = options && options.projectId ? Number(options.projectId) : currentProject.value?.id || null
  tenantId.value =
    options && options.tenantId
      ? Number(options.tenantId)
      : currentProject.value?.tenantId || null
})

function validate() {
  const text = content.value.trim()
  if (text.length < 5) return '请至少填写 5 个字说明问题'
  if (text.length > 1000) return '反馈内容不超过 1000 字'
  return ''
}

async function submit() {
  if (submitting.value) return
  error.value = validate()
  if (error.value) return

  submitting.value = true
  try {
    await submitFeedback({
      content: content.value.trim(),
      contact: contact.value.trim() || undefined,
      projectId: projectId.value || undefined,
      tenantId: tenantId.value || undefined,
    })
    uni.showToast({ title: '反馈已提交', icon: 'success' })
    setTimeout(goBack, 800)
  } catch (err) {
    error.value = err.message || '提交失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.switchTab({ url: '/pages/mine/index' })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding-bottom: calc(#{dp(24)} + env(safe-area-inset-bottom));
  background: #faf7f4;
}

.nav {
  display: flex;
  align-items: center;
  padding-right: dp(14);
  padding-bottom: dp(8);
  padding-left: dp(6);
}

.nav-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(34);
  height: dp(34);
  flex-shrink: 0;
}

.nav-back-icon {
  width: dp(20);
  height: dp(20);
}

.nav-title {
  color: #241c17;
  font-size: dp(18);
  font-weight: 700;
}

.content {
  padding: dp(4) dp(14) 0;
}

.intro {
  padding: 0 dp(4) dp(12);
}

.intro-title {
  display: block;
  color: #241c17;
  font-size: dp(16);
  font-weight: 700;
}

.intro-text {
  display: block;
  margin-top: dp(5);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.6;
}

.form-card {
  padding: dp(14);
  @include glass-surface(dp(14), 20px);
}

.field + .field {
  margin-top: dp(16);
}

.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-label {
  display: block;
  color: #51463e;
  font-size: dp(12);
  font-weight: 500;
}

.field-count {
  color: #a79c92;
  font-size: dp(9);
}

.feedback-textarea {
  width: 100%;
  min-height: dp(150);
  margin-top: dp(8);
  padding: dp(11);
  border: 1px solid #e8e1da;
  border-radius: dp(9);
  background: #fffdfb;
  color: #241c17;
  font-size: dp(13);
  line-height: 1.6;
}

.feedback-input {
  height: dp(40);
  margin-top: dp(8);
  padding: 0 dp(11);
  border: 1px solid #e8e1da;
  border-radius: dp(9);
  background: #fffdfb;
  color: #241c17;
  font-size: dp(12);
}

.feedback-placeholder {
  color: #c4bbb2;
}

.project-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(14);
  padding: dp(9) dp(11);
  border-radius: dp(8);
  background: #f8f4ef;
}

.project-hint-label {
  color: #8b8179;
  font-size: dp(10);
}

.project-hint-value {
  max-width: 65%;
  overflow: hidden;
  color: #51463e;
  font-size: dp(10);
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.error-text {
  display: block;
  margin: dp(10) dp(4) 0;
  color: #f53f3f;
  font-size: dp(11);
  line-height: 1.5;
}

.submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: dp(44);
  margin-top: dp(16);
  border: none;
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(14);
  font-weight: 600;
  line-height: 1;
  box-shadow: 0 dp(4) dp(14) rgba(235, 92, 32, 0.22);
}

.submit-btn--disabled {
  opacity: 0.55;
}

.footnote {
  display: block;
  margin-top: dp(12);
  padding: 0 dp(4);
  color: #a79c92;
  font-size: dp(10);
  line-height: 1.6;
}
</style>
