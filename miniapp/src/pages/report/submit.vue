<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <view class="nav-title-wrap">
        <text class="nav-title">汇报进度</text>
        <text v-if="detail" class="nav-sub">{{ detail.name }}</text>
      </view>
    </view>

    <view v-if="loading" class="state-block">
      <gc-loading text="正在加载阶段与工序…" />
    </view>

    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-warning-amber.png" mode="aspectFit" />
      <text class="state-title">汇报不可用</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="goBack">返回项目</button>
    </view>

    <template v-else>
      <view class="content gc-stagger">
        <view v-if="detail" class="card project-card">
          <view class="project-main">
            <text class="project-name">{{ detail.name }}</text>
            <text class="project-address">{{ detail.address || '未填写项目地址' }}</text>
          </view>
        </view>

        <!-- 没有可汇报阶段 -->
        <view v-if="!canEdit" class="card state-card">
          <view class="state-emoji">!</view>
          <text class="state-title">{{ isForeman ? '当前没有可汇报的阶段' : '仅工长可提交进度汇报' }}</text>
          <view v-if="isForeman && lockedStages.length" class="locked-list">
            <text v-for="stage in lockedStages" :key="stage.id" class="locked-item">
              {{ stage.name }}：{{ stage.lockedReason || '暂不可汇报' }}
            </text>
          </view>
          <text v-else-if="!isForeman" class="state-text">监理和业主可以查看工程动态、发表评论，但不能修改完成度。</text>
          <button class="state-btn" @tap="goBack">返回项目</button>
        </view>

        <template v-else>
          <!-- 阶段 -->
          <view class="card section">
            <view class="section-head">
              <text class="section-title">选择阶段</text>
              <text class="section-count">一次汇报一个工序</text>
            </view>
            <scroll-view class="stage-scroll" scroll-x :show-scrollbar="false">
              <view class="stage-row">
                <view
                  v-for="stage in stages"
                  :key="stage.id"
                  class="stage-chip"
                  :class="{
                    'stage-chip--active': stage.id === selectedStageId,
                    'stage-chip--locked': !stage.canReport,
                  }"
                  @tap="selectStage(stage)"
                >
                  <image
                    v-if="!stage.canReport"
                    class="stage-lock"
                    src="/static/images/icon-stage-locked.png"
                    mode="aspectFit"
                  />
                  <text>{{ stage.name }}</text>
                </view>
              </view>
            </scroll-view>

            <view
              v-if="selectedStage && selectedStage.gateStatus === 'locked' && selectedStage.canReport"
              class="gate-warning"
            >
              <text class="gate-warning-title">上一阶段尚未结清</text>
              <text class="gate-warning-text">
                本次汇报可以提交，但该阶段的验收会被阻断，需等上一阶段结算无异议。
              </text>
            </view>
          </view>

          <!-- 工序 -->
          <view v-if="selectedStage" class="card section">
            <view class="section-head">
              <text class="section-title">选择工序</text>
              <text class="section-count">当前完成度</text>
            </view>
            <view class="item-grid">
              <view
                v-for="item in selectedStage.items"
                :key="item.id"
                class="item-chip"
                :class="{ 'item-chip--active': item.id === selectedItemId }"
                @tap="selectItem(item)"
              >
                <text class="item-name">{{ item.name }}</text>
                <text class="item-progress">{{ percent(item.progress) }}%</text>
              </view>
            </view>
          </view>

          <!-- 完成度 -->
          <view v-if="selectedItem" class="card section">
            <view class="section-head">
              <text class="section-title">本次完成度</text>
              <text class="section-count">步进 5%</text>
            </view>

            <view class="progress-row">
              <text class="progress-value">{{ progress }}%</text>
              <text class="progress-before">
                当前 {{ percent(selectedItem.progress) }}% → {{ progress }}%
              </text>
            </view>

            <slider
              class="progress-slider"
              :value="progress"
              :min="0"
              :max="100"
              :step="5"
              active-color="#EB5C20"
              background-color="#F0EAE4"
              block-size="20"
              @changing="onProgressChange"
              @change="onProgressChange"
            />

            <view class="progress-scale">
              <text>0%</text>
              <text>50%</text>
              <text>100%</text>
            </view>
            <text class="section-hint">完成度发生变化时会写入变更留痕。</text>
          </view>

          <!-- 说明 -->
          <view class="card section">
            <view class="section-head">
              <text class="section-title">汇报说明</text>
              <text class="section-count">{{ content.length }}/2000</text>
            </view>
            <textarea
              v-model="content"
              class="field-textarea"
              maxlength="2000"
              placeholder="今天完成了什么、现场情况、下一步计划…"
              placeholder-class="field-placeholder"
            />
            <text class="section-hint">说明和照片 / 视频至少填写一项。</text>
          </view>

          <!-- 照片 -->
          <view class="card section">
            <view class="section-head">
              <text class="section-title">现场照片</text>
              <text class="section-count">{{ photos.length }}/9</text>
            </view>
            <view class="photo-grid">
              <view v-for="(photo, index) in photos" :key="photo.tempFilePath" class="photo-item">
                <image class="photo-image" :src="photo.tempFilePath" mode="aspectFill" @tap="previewPhoto(index)" />
                <view class="photo-remove" @tap.stop="removePhoto(index)">×</view>
              </view>
              <view v-if="photos.length < 9" class="photo-add" @tap="choosePhotos">
                <image class="photo-add-icon" src="/static/images/icon-camera-gray.png" mode="aspectFit" />
                <text class="photo-add-text">拍照 / 相册</text>
              </view>
            </view>
            <text class="section-hint">照片由服务端叠加水印：时间 + 项目地址 + 工序名。</text>
          </view>

          <!-- 视频 -->
          <view class="card section">
            <view class="section-head">
              <text class="section-title">现场视频</text>
              <text class="section-count">最多 1 个 · 60 秒内</text>
            </view>

            <view v-if="video" class="video-card">
              <view class="video-play" @tap="previewVideo">
                <image class="video-play-icon" src="/static/images/icon-play-white.png" mode="aspectFit" />
              </view>
              <view class="video-main">
                <text class="video-title">已选择现场视频</text>
                <text class="video-meta">时长 {{ formatDuration(video.duration) }}</text>
              </view>
              <view class="video-remove" @tap="removeVideo">移除</view>
            </view>

            <view v-else class="video-add" @tap="chooseVideo">
              <image class="photo-add-icon" src="/static/images/icon-camera-gray.png" mode="aspectFit" />
              <text class="photo-add-text">选择视频</text>
            </view>
          </view>

          <view class="notice-card">
            <text class="notice-text">
              汇报提交后完成度按本次填写更新，变化会留下变更记录；照片/视频由服务端保存，汇报记录不可删除。
            </text>
          </view>
        </template>
      </view>

      <view v-if="canEdit" class="bottom-bar">
        <button class="submit-btn" :disabled="!canSubmit" @tap="submit">
          {{ submitting ? uploadText || '提交中…' : '提交汇报' }}
        </button>
      </view>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import { projectDetail, projectStages } from '../../api/project'
import { stageReportMedia, submitReport } from '../../api/report'

defineOptions({ name: 'ReportSubmitPage' })

const safeTop = ref(0)
const loading = ref(false)
const loadError = ref('')
const detail = ref(null)
const stages = ref([])

const selectedStageId = ref(null)
const selectedItemId = ref(null)
const progress = ref(0)
const content = ref('')
const photos = ref([])
const video = ref(null)
const submitting = ref(false)
const uploadText = ref('')
const clientRequestId = ref('')
const projectId = ref(0)

const isForeman = computed(() => detail.value?.myRole === 'foreman')
const reportableStages = computed(() => stages.value.filter((stage) => stage.canReport))
const lockedStages = computed(() =>
  stages.value.filter((stage) => !stage.canReport && stage.lockedReason)
)
const canEdit = computed(() => isForeman.value && reportableStages.value.length > 0)

const selectedStage = computed(
  () => stages.value.find((stage) => stage.id === selectedStageId.value) || null
)
const selectedItem = computed(() => {
  if (!selectedStage.value) return null
  return selectedStage.value.items.find((item) => item.id === selectedItemId.value) || null
})

const canSubmit = computed(() => {
  if (!canEdit.value || !selectedItem.value || submitting.value) return false
  if (!content.value.trim() && photos.value.length === 0 && !video.value) return false
  return true
})

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }

  projectId.value = options && options.projectId ? Number(options.projectId) : 0
  if (!projectId.value) {
    loadError.value = '缺少项目 ID'
    return
  }

  clientRequestId.value = generateClientRequestId()
  load()
})

onPullDownRefresh(async () => {
  try {
    await load()
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function load() {
  loading.value = true
  loadError.value = ''

  try {
    const [project, stageData] = await Promise.all([
      projectDetail(projectId.value),
      projectStages(projectId.value),
    ])

    detail.value = project
    stages.value = (stageData && stageData.stages) || []

    if (project.myRole !== 'foreman') {
      loadError.value = '仅该项目的工长可提交进度汇报'
      return
    }

    const preferred =
      stages.value.find((stage) => stage.id === project.currentStageId && stage.canReport) ||
      stages.value.find((stage) => stage.canReport)
    if (preferred) selectStage(preferred)
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }
    loadError.value = err.message || '阶段与工序加载失败'
  } finally {
    loading.value = false
  }
}

function goBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/projects/index' }),
  })
}

function generateClientRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function percent(value) {
  const number = Number(value) || 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

function normalizeProgress(value) {
  const number = Math.max(0, Math.min(100, percent(value)))
  return Math.min(100, Math.round(number / 5) * 5)
}

function selectStage(stage) {
  if (!stage) return
  if (!stage.canReport) {
    uni.showToast({
      title: stage.lockedReason || '当前阶段暂不可汇报',
      icon: 'none',
    })
    return
  }

  selectedStageId.value = stage.id
  const firstItem = stage.items[0] || null
  if (firstItem) selectItem(firstItem)
  else {
    selectedItemId.value = null
    progress.value = 0
  }

  // 附件暂存时绑定了工序；换阶段必须重新上传
  resetMediaIds()
}

function selectItem(item) {
  if (!item) return
  selectedItemId.value = item.id
  progress.value = normalizeProgress(item.progress)
  resetMediaIds()
}

function resetMediaIds() {
  for (const photo of photos.value) photo.mediaId = null
  if (video.value) video.value.mediaId = null
}

function onProgressChange(event) {
  progress.value = Number(event.detail.value)
}

function choosePhotos() {
  const remain = 9 - photos.value.length
  if (remain <= 0) return

  uni.chooseImage({
    count: remain,
    sizeType: ['compressed'],
    sourceType: ['camera', 'album'],
    success(res) {
      const paths = res.tempFilePaths || []
      for (const tempFilePath of paths.slice(0, remain)) {
        photos.value.push({ tempFilePath, mediaId: null })
      }
    },
  })
}

function removePhoto(index) {
  photos.value.splice(index, 1)
}

function previewPhoto(index) {
  const urls = photos.value.map((photo) => photo.tempFilePath)
  uni.previewImage({ urls, current: urls[index] })
}

function chooseVideo() {
  if (video.value) {
    uni.showToast({ title: '请先移除已选择的视频', icon: 'none' })
    return
  }
  if (typeof uni.chooseVideo !== 'function') {
    uni.showToast({ title: '当前环境不支持选择视频', icon: 'none' })
    return
  }

  uni.chooseVideo({
    sourceType: ['camera', 'album'],
    compressed: true,
    maxDuration: 60,
    camera: 'back',
    success(res) {
      const duration = Math.round(Number(res.duration) || 0)
      if (duration > 60) {
        uni.showToast({ title: '视频时长不能超过 60 秒', icon: 'none' })
        return
      }
      video.value = {
        tempFilePath: res.tempFilePath,
        duration,
        mediaId: null,
      }
    },
  })
}

function removeVideo() {
  video.value = null
}

function previewVideo() {
  if (!video.value) return
  if (typeof uni.previewMedia === 'function') {
    uni.previewMedia({
      sources: [{ url: video.value.tempFilePath, type: 'video' }],
    })
    return
  }
  uni.showToast({ title: '提交后可在工程动态查看视频', icon: 'none' })
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(Math.floor(total % 60)).padStart(2, '0')
  return `${mm}:${ss}`
}

async function uploadMedia() {
  const itemId = selectedItemId.value
  const total = photos.value.length + (video.value ? 1 : 0)
  let done = 0

  for (const photo of photos.value) {
    if (photo.mediaId) {
      done += 1
      continue
    }
    uploadText.value = `上传附件 ${done + 1}/${total}…`
    const result = await stageReportMedia(projectId.value, itemId, photo.tempFilePath)
    photo.mediaId = result.mediaId
    done += 1
  }

  if (video.value && !video.value.mediaId) {
    uploadText.value = `上传附件 ${done + 1}/${total}…`
    const result = await stageReportMedia(
      projectId.value,
      itemId,
      video.value.tempFilePath,
      { duration: video.value.duration }
    )
    video.value.mediaId = result.mediaId
  }
}

async function submit() {
  if (!canSubmit.value || submitting.value || !selectedItem.value) return

  submitting.value = true
  uploadText.value = ''

  try {
    await uploadMedia()

    const mediaIds = photos.value.map((photo) => photo.mediaId)
    if (video.value && video.value.mediaId) mediaIds.push(video.value.mediaId)

    const videoDurations = video.value ? [video.value.duration] : []
    await submitReport(projectId.value, {
      itemId: selectedItemId.value,
      progress: String(progress.value),
      content: content.value.trim() || undefined,
      clientRequestId: clientRequestId.value,
      mediaIds,
      videoDurations: JSON.stringify(videoDurations),
    })

    uni.$emit('report:created', { projectId: projectId.value })
    uni.showToast({ title: '汇报成功', icon: 'success' })
    setTimeout(() => goBack(), 600)
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }

    // 暂存附件过期 / 被消费 / 不属于当前工序时，下一次提交重新上传
    if (
      err.statusCode === 400 &&
      /附件|照片|视频|工序.*(不存在|不匹配)|已失效/.test(String(err.message || ''))
    ) {
      resetMediaIds()
    }

    uni.showToast({ title: err.message || '汇报失败，请重试', icon: 'none' })
  } finally {
    submitting.value = false
    uploadText.value = ''
  }
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $color-canvas;
  padding-bottom: dp(120);
}

.nav {
  display: flex;
  align-items: center;
  gap: dp(10);
  padding: 0 dp(16) dp(10);
  background: rgba(250, 247, 244, 0.86);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 dp(6) dp(18) rgba(94, 45, 22, 0.04);
  position: sticky;
  top: 0;
  z-index: 20;
}

.nav-back {
  width: dp(32);
  height: dp(32);
  border-radius: 50%;
  background: $color-surface;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 dp(2) dp(8) rgba(36, 28, 23, 0.06);
}

.nav-back-icon {
  width: dp(18);
  height: dp(18);
}

.nav-title-wrap {
  flex: 1;
  min-width: 0;
}

.nav-title {
  display: block;
  font-size: dp(18);
  font-weight: 600;
  color: $color-ink;
}

.nav-sub {
  display: block;
  margin-top: dp(2);
  font-size: dp(11);
  color: $color-ink-tertiary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state-block {
  padding: dp(80) dp(24);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: dp(10);
}

.state-icon {
  width: dp(48);
  height: dp(48);
}

.state-title {
  font-size: dp(17);
  font-weight: 600;
  color: $color-ink;
  text-align: center;
}

.state-text {
  font-size: dp(13);
  color: $color-ink-tertiary;
  text-align: center;
  line-height: 1.7;
}

.state-btn {
  margin-top: dp(12);
  min-width: dp(140);
  height: dp(42);
  border-radius: dp(21);
  background: $color-primary;
  color: $color-on-primary;
  font-size: dp(14);
  display: flex;
  align-items: center;
  justify-content: center;
}

.state-btn::after {
  border: none;
}

.content {
  padding: dp(4) dp(16) dp(16);
}

.card {
  @include glass-surface(dp(16), 20px);
  padding: dp(16);
  margin-bottom: dp(12);
}

.project-card {
  display: flex;
  align-items: flex-start;
}

.project-main {
  flex: 1;
  min-width: 0;
}

.project-name {
  display: block;
  font-size: dp(17);
  font-weight: 600;
  color: $color-ink;
}

.project-address {
  display: block;
  margin-top: dp(5);
  font-size: dp(12);
  color: $color-ink-tertiary;
  line-height: 1.6;
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(28) dp(18);
}

.state-emoji {
  width: dp(52);
  height: dp(52);
  border-radius: 50%;
  background: $color-warning-soft;
  color: $color-warning-ink;
  font-size: dp(24);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.state-card .state-title {
  margin-top: dp(12);
}

.locked-list {
  margin-top: dp(10);
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: dp(6);
}

.locked-item {
  font-size: dp(11);
  color: $color-ink-tertiary;
  line-height: 1.6;
  text-align: center;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: dp(8);
}

.section-title {
  font-size: dp(15);
  font-weight: 600;
  color: $color-ink;
}

.section-count {
  font-size: dp(11);
  color: $color-ink-tertiary;
}

.section-hint {
  display: block;
  margin-top: dp(10);
  font-size: dp(11);
  color: $color-ink-tertiary;
  line-height: 1.6;
}

.stage-scroll {
  margin-top: dp(12);
  width: 100%;
}

.stage-row {
  display: flex;
  gap: dp(8);
  white-space: nowrap;
}

.stage-chip {
  display: inline-flex;
  align-items: center;
  gap: dp(4);
  padding: dp(6) dp(12);
  border-radius: dp(999);
  background: $color-surface-sunken;
  color: $color-ink-secondary;
  font-size: dp(12);
}

.stage-chip--active {
  background: $color-primary-soft;
  color: $color-primary;
  font-weight: 600;
}

.stage-chip--locked {
  color: $color-neutral;
}

.stage-lock {
  width: dp(11);
  height: dp(11);
}

.gate-warning {
  margin-top: dp(12);
  padding: dp(10) dp(12);
  border-radius: dp(10);
  background: $color-warning-soft;
}

.gate-warning-title {
  display: block;
  font-size: dp(12);
  font-weight: 600;
  color: $color-warning-ink;
}

.gate-warning-text {
  display: block;
  margin-top: dp(4);
  font-size: dp(10);
  color: $color-warning-ink;
  line-height: 1.6;
}

.item-grid {
  margin-top: dp(12);
  display: flex;
  flex-wrap: wrap;
  gap: dp(8);
}

.item-chip {
  padding: dp(8) dp(12);
  border-radius: dp(10);
  background: $color-surface-sunken;
  display: flex;
  flex-direction: column;
  gap: dp(3);
  min-width: dp(92);
}

.item-chip--active {
  background: $color-primary-soft;
}

.item-name {
  font-size: dp(12);
  color: $color-ink;
}

.item-chip--active .item-name {
  color: $color-primary;
  font-weight: 600;
}

.item-progress {
  font-size: dp(10);
  color: $color-ink-tertiary;
}

.progress-row {
  margin-top: dp(12);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.progress-value {
  font-size: dp(30);
  font-weight: 700;
  color: $color-primary;
}

.progress-before {
  font-size: dp(11);
  color: $color-ink-tertiary;
}

.progress-slider {
  margin: dp(12) dp(2) 0;
}

.progress-scale {
  display: flex;
  justify-content: space-between;
  padding: 0 dp(2);
  font-size: dp(9);
  color: $color-neutral;
}

.field-textarea {
  margin-top: dp(10);
  width: 100%;
  min-height: dp(96);
  padding: dp(10);
  box-sizing: border-box;
  border-radius: dp(10);
  background: $color-surface-sunken;
  font-size: dp(13);
  color: $color-ink;
  line-height: 1.6;
}

.field-placeholder {
  color: $color-neutral;
}

.photo-grid {
  margin-top: dp(12);
  display: flex;
  flex-wrap: wrap;
  gap: dp(9);
}

.photo-item,
.photo-add {
  width: dp(96);
  height: dp(96);
  border-radius: dp(12);
  overflow: hidden;
  position: relative;
  background: $color-surface-sunken;
}

.photo-image {
  width: 100%;
  height: 100%;
}

.photo-remove {
  position: absolute;
  top: dp(5);
  right: dp(5);
  width: dp(20);
  height: dp(20);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: dp(14);
  line-height: dp(20);
  text-align: center;
}

.photo-add {
  border: 1px dashed $color-hairline-strong;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: dp(5);
}

.photo-add-icon {
  width: dp(24);
  height: dp(24);
}

.photo-add-text {
  font-size: dp(10);
  color: $color-ink-tertiary;
}

.video-card {
  margin-top: dp(12);
  display: flex;
  align-items: center;
  gap: dp(10);
  padding: dp(10);
  border-radius: dp(12);
  background: $color-surface-sunken;
}

.video-play {
  width: dp(44);
  height: dp(44);
  border-radius: dp(10);
  background: #241c17;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.video-play-icon {
  width: dp(16);
  height: dp(16);
}

.video-main {
  flex: 1;
  min-width: 0;
}

.video-title {
  display: block;
  font-size: dp(12);
  font-weight: 600;
  color: $color-ink;
}

.video-meta {
  display: block;
  margin-top: dp(3);
  font-size: dp(10);
  color: $color-ink-tertiary;
}

.video-remove {
  flex-shrink: 0;
  padding: dp(5) dp(9);
  border-radius: dp(8);
  background: $color-danger-soft;
  color: $color-danger-ink;
  font-size: dp(10);
  font-weight: 600;
}

.video-add {
  margin-top: dp(12);
  width: dp(96);
  height: dp(96);
  border-radius: dp(12);
  border: 1px dashed $color-hairline-strong;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: dp(5);
}

.notice-card {
  padding: dp(12) dp(14);
  border-radius: dp(12);
  background: $color-neutral-soft;
}

.notice-text {
  font-size: dp(11);
  color: $color-neutral-ink;
  line-height: 1.7;
}

.bottom-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  padding: dp(10) dp(16) calc(dp(10) + env(safe-area-inset-bottom));
  background: rgba(250, 247, 244, 0.88);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow:
    0 -#{dp(6)} dp(24) rgba(36, 28, 23, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.submit-btn {
  width: 100%;
  height: dp(46);
  border-radius: dp(23);
  background: $color-primary;
  color: $color-on-primary;
  font-size: dp(15);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.submit-btn::after {
  border: none;
}

.submit-btn[disabled] {
  background: $color-hairline-strong;
  color: $color-surface;
}
</style>
