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

        <view class="field">
          <view class="field-head">
            <text class="field-label">问题截图（选填）</text>
            <text class="field-count">{{ images.length }}/{{ MAX_IMAGES }}</text>
          </view>
          <view class="image-grid">
            <view v-for="(item, index) in images" :key="item.key" class="image-item">
              <image class="image-thumb" :src="item.path" mode="aspectFill" @tap="previewImage(index)" />
              <view v-if="item.uploading" class="image-mask">
                <view class="image-spinner" />
              </view>
              <view v-else-if="item.failed" class="image-mask image-mask--failed" @tap="retryUpload(index)">
                <text class="image-retry">重试</text>
              </view>
              <view class="image-remove" @tap.stop="removeImage(index)">
                <text class="image-remove-text">×</text>
              </view>
            </view>
            <view v-if="images.length < MAX_IMAGES" class="image-add" @tap="chooseImages">
              <image class="image-add-icon" src="/static/images/icon-camera-gray.png" mode="aspectFit" />
              <text class="image-add-text">添加</text>
            </view>
          </view>
          <text class="field-hint">最多 3 张，截图能帮我们更快定位问题</text>
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
        {{ submitText }}
      </button>

      <text class="footnote">图片为选填项，最多 3 张。提交后我们会尽快查看并处理。</text>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import { getCurrentProject } from '../../store/projectContext'
import { stageFeedbackImage, submitFeedback } from '../../api/feedback'

defineOptions({ name: 'FeedbackPage' })

/** 与后端 feedback.service 的 MAX_IMAGES 保持一致（AC-U18） */
const MAX_IMAGES = 3

const safeTop = ref(0)
const content = ref('')
const contact = ref('')
const error = ref('')
const submitting = ref(false)
const projectId = ref(null)
const tenantId = ref(null)
const currentProject = ref(null)

/**
 * 已选图片。
 *
 * 微信一次只能上传一个文件，因此每张图选完就逐张暂存到服务端，
 * 提交时只带 mediaId。`uploading` / `failed` 用来提示「这张还没传上去」，
 * 提交前会把失败的再补传一次，避免出现「选了 3 张只提交 1 张」。
 */
const images = ref([])
let imageSeq = 0
let uploadChain = Promise.resolve()

const submitText = computed(() => {
  if (!submitting.value) return '提交反馈'
  return images.value.some((item) => !item.mediaId) ? '上传图片中…' : '提交中…'
})

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

/**
 * 微信端先压缩再上传：反馈截图往往是整屏尺寸，原图动辄几 MB，
 * 3 张会把用户等到以为卡死。H5 没有 compressImage，chooseImage 已经带了
 * `sizeType: ['compressed']`，直接原样上传。
 */
function compressImage(path) {
  // #ifdef MP-WEIXIN
  return new Promise((resolve) => {
    uni.compressImage({
      src: path,
      quality: 70,
      success: (res) => resolve(res.tempFilePath || path),
      // 压缩失败不能挡着用户提交，退回原图
      fail: () => resolve(path),
    })
  })
  // #endif
  // #ifndef MP-WEIXIN
  return Promise.resolve(path)
  // #endif
}

function chooseImages() {
  const remain = MAX_IMAGES - images.value.length
  if (remain <= 0) return

  uni.chooseImage({
    count: remain,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const paths = res.tempFilePaths || []
      if (paths.length === 0) return

      const added = paths.map((path) => ({
        key: ++imageSeq,
        path,
        mediaId: null,
        uploading: true,
        failed: false,
      }))
      images.value = [...images.value, ...added]
      // 串行上传：并发 3 个 multipart 在弱网下更容易一起失败
      uploadChain = uploadChain.then(() => uploadItems(added))
    },
    fail: (err) => {
      // 用户点「取消」不是错误，不要弹提示
      if (String((err && err.errMsg) || '').includes('cancel')) return
      uni.showToast({ title: '选择图片失败，请重试', icon: 'none' })
    },
  })
}

/** 逐张上传；已被移除的图片不再上传 */
async function uploadItems(items) {
  for (const item of items) {
    // 必须从 images.value 里取回同一个响应式对象：直接改传入的原始对象
    // 不会触发视图更新，上传完成的遮罩会一直转下去
    const current = images.value.find((entry) => entry.key === item.key)
    if (!current) continue
    await uploadItem(current)
  }
}

async function uploadItem(item) {
  item.uploading = true
  item.failed = false
  try {
    const data = await stageFeedbackImage(await compressImage(item.path))
    item.mediaId = data.mediaId
  } catch (err) {
    item.failed = true
  } finally {
    item.uploading = false
  }
}

function retryUpload(index) {
  const item = images.value[index]
  if (!item) return
  uploadItem(item)
}

function removeImage(index) {
  images.value = images.value.filter((_, i) => i !== index)
  // 已暂存但被移除的图片不需要在这里删服务端文件：
  // 24 小时内没被提交的暂存行由清理任务统一回收
}

function previewImage(index) {
  const item = images.value[index]
  if (!item) return
  uni.previewImage({
    urls: images.value.map((current) => current.path),
    current: item.path,
  })
}

/**
 * 提交前把没传完 / 失败过的图片补传一遍。
 *
 * 补传失败就停下来，让用户重试或移除那张图 —— 静默少传一张，
 * 用户会以为截图已经提交了。
 */
async function ensureImagesUploaded() {
  const pending = images.value.filter((item) => !item.mediaId)
  for (const item of pending) {
    await uploadItem(item)
    if (!item.mediaId) return false
  }
  return true
}

async function submit() {
  if (submitting.value) return
  error.value = validate()
  if (error.value) return

  submitting.value = true
  try {
    if (!(await ensureImagesUploaded())) {
      error.value = '有图片上传失败，请点击图片上的「重试」或移除后再提交'
      return
    }

    await submitFeedback({
      content: content.value.trim(),
      contact: contact.value.trim() || undefined,
      projectId: projectId.value || undefined,
      tenantId: tenantId.value || undefined,
      mediaIds: images.value.map((item) => item.mediaId).filter(Boolean),
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
  display: block;
  width: 100%;
  min-height: dp(96);
  margin-top: dp(8);
  padding: dp(11);
  border: 1px solid #e8e1da;
  border-radius: dp(9);
  background: #fffdfb;
  color: #241c17;
  font-size: dp(13);
  line-height: 1.6;
  /* width:100% 与 padding/border 同时存在时必须 border-box，否则会溢出卡片 */
  box-sizing: border-box;
}

.feedback-input {
  width: 100%;
  height: dp(40);
  margin-top: dp(8);
  padding: 0 dp(11);
  border: 1px solid #e8e1da;
  border-radius: dp(9);
  background: #fffdfb;
  color: #241c17;
  font-size: dp(12);
  box-sizing: border-box;
}

.feedback-placeholder {
  color: #c4bbb2;
}

/* ── 图片 ── */
.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: dp(9);
  margin-top: dp(8);
}

.image-item,
.image-add {
  position: relative;
  width: dp(78);
  height: dp(78);
  border-radius: dp(9);
  overflow: hidden;
}

.image-thumb {
  width: 100%;
  height: 100%;
  background: #f3ede7;
}

.image-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(36, 28, 23, 0.42);
}

.image-mask--failed {
  background: rgba(36, 28, 23, 0.58);
}

.image-retry {
  padding: dp(4) dp(10);
  border-radius: dp(999);
  background: #fff;
  color: #eb5c20;
  font-size: dp(10);
  font-weight: 600;
}

.image-spinner {
  width: dp(18);
  height: dp(18);
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: feedback-spin 0.8s linear infinite;
}

@keyframes feedback-spin {
  to {
    transform: rotate(360deg);
  }
}

.image-remove {
  position: absolute;
  top: dp(4);
  right: dp(4);
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(18);
  height: dp(18);
  border-radius: 50%;
  background: rgba(36, 28, 23, 0.62);
}

.image-remove-text {
  color: #fff;
  font-size: dp(12);
  line-height: 1;
}

.image-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: dp(3);
  border: 1px dashed #d8cec4;
  background: #fffdfb;
}

.image-add:active {
  background: #f8f4ef;
}

.image-add-icon {
  width: dp(20);
  height: dp(20);
}

.image-add-text {
  color: #8b8179;
  font-size: dp(10);
}

.field-hint {
  display: block;
  margin-top: dp(7);
  color: #a79c92;
  font-size: dp(10);
  line-height: 1.5;
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
