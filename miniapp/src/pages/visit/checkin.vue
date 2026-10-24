<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <view class="nav-title-wrap">
        <text class="nav-title">现场签到</text>
        <text v-if="meta && meta.projectName" class="nav-sub">{{ meta.projectName }}</text>
      </view>
    </view>

    <view v-if="loading && !meta" class="state-block">
      <gc-loading text="正在加载签到信息…" />
    </view>

    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-warning-amber.png" mode="aspectFit" />
      <text class="state-title">签到不可用</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="goBack">返回项目</button>
    </view>

    <template v-else-if="meta">
      <view class="content gc-stagger">
        <!-- 项目信息 -->
        <view class="card project-card">
          <view class="project-main">
            <text class="project-name">{{ meta.projectName }}</text>
            <text class="project-address">{{ meta.address || '未填写项目地址' }}</text>
          </view>
          <text class="role-badge">{{ roleText }}</text>
        </view>

        <!-- 今日已签到 / 不可签到 -->
        <view v-if="!meta.canCheckin" class="card state-card">
          <view class="state-emoji" :class="{ 'state-emoji--done': meta.reason === 'ALREADY_CHECKED_IN' }">
            {{ meta.reason === 'ALREADY_CHECKED_IN' ? '✓' : '!' }}
          </view>
          <text class="state-title">{{ meta.reasonText || '暂不可签到' }}</text>

          <template v-if="meta.todayVisit">
            <text class="state-time">{{ meta.todayVisit.checkinAt }} · 距项目 {{ formatDistance(meta.todayVisit.distanceM) }}</text>
            <text v-if="meta.todayVisit.isAbnormal" class="abnormal-tag">异常签到</text>
            <text v-if="meta.todayVisit.abnormalReason" class="state-reason">
              说明：{{ meta.todayVisit.abnormalReason }}
            </text>
            <text v-if="meta.todayVisit.remark" class="state-reason">
              备注：{{ meta.todayVisit.remark }}
            </text>
            <view v-if="todayPhotos.length" class="today-photos">
              <image
                v-for="(url, index) in todayPhotos"
                :key="url"
                class="today-photo"
                :src="url"
                mode="aspectFill"
                @tap="previewToday(index)"
              />
            </view>
          </template>

          <button class="state-btn" @tap="goBack">返回项目</button>
        </view>

        <!-- 签到表单 -->
        <template v-else>
          <view class="card section">
            <view class="section-head">
              <text class="section-title">现场照片</text>
              <text class="section-count">{{ photos.length }} / 3</text>
            </view>

            <view class="photo-grid">
              <view v-for="(photo, index) in photos" :key="photo.tempFilePath" class="photo-item">
                <image class="photo-image" :src="photo.tempFilePath" mode="aspectFill" @tap="previewPhoto(index)" />
                <view class="photo-remove" @tap.stop="removePhoto(index)">×</view>
              </view>
              <view v-if="photos.length < 3" class="photo-add" @tap="choosePhotos">
                <image class="photo-add-icon" src="/static/images/icon-camera-gray.png" mode="aspectFit" />
                <text class="photo-add-text">拍照 / 相册</text>
              </view>
            </view>

            <text class="section-hint">至少 1 张、最多 3 张；提交后由服务端叠加水印，不能修改。</text>
          </view>

          <view class="card section">
            <view class="section-head">
              <text class="section-title">当前位置</text>
              <text class="section-count">{{ meta.thresholdM }} 米内为正常</text>
            </view>

            <view class="location-row">
              <view class="location-main">
                <text class="location-title">{{ location ? '已获取当前位置' : '尚未获取位置' }}</text>
                <text class="location-text">
                  {{ location ? locationText : '签到必须获取当前位置，定位失败时不能提交' }}
                </text>
              </view>
              <button class="location-btn" :disabled="locating" @tap="locate">
                {{ locating ? '定位中…' : location ? '重新定位' : '获取位置' }}
              </button>
            </view>

            <view
              v-if="distance !== null"
              class="distance-row"
              :class="{ 'distance-row--abnormal': showReason }"
            >
              <text class="distance-main">距项目约 {{ formatDistance(distance) }}</text>
              <text class="distance-sub">
                {{ showReason ? `超过 ${meta.thresholdM} 米阈值，需填写说明` : `在 ${meta.thresholdM} 米阈值内` }}
              </text>
            </view>

            <!-- 仅开发构建显示：DevTools 默认坐标在华盛顿，手动改传感器比较麻烦 -->
            <view v-if="isDev" class="dev-sim">
              <text class="dev-sim-label">开发模拟</text>
              <view class="dev-sim-btn" @tap="useProjectLocation">正常距离</view>
              <view class="dev-sim-btn dev-sim-btn--warn" @tap="useAbnormalLocation">异常距离</view>
            </view>
          </view>

          <view class="card section">
            <view class="section-head">
              <text class="section-title">考察备注</text>
              <text class="section-count">选填</text>
            </view>
            <textarea
              v-model="remark"
              class="field-textarea"
              maxlength="1000"
              placeholder="记录施工质量、发现的问题、待办事项…"
              placeholder-class="field-placeholder"
            />
            <text class="field-count">{{ remark.length }}/1000</text>
          </view>

          <view v-if="showReason" class="card section section--warning">
            <view class="section-head">
              <text class="section-title">异常说明</text>
              <text class="section-count section-count--danger">必填</text>
            </view>
            <text class="section-hint section-hint--warning">
              定位偏差超过 {{ meta.thresholdM }} 米。确实在现场的，请说明原因（如 GPS 漂移、工地围挡遮挡）。
            </text>
            <textarea
              v-model="reason"
              class="field-textarea"
              maxlength="500"
              placeholder="请说明偏差原因"
              placeholder-class="field-placeholder"
            />
            <text class="field-count">{{ reason.length }}/500</text>
          </view>

          <view class="notice-card">
            <text class="notice-text">签到记录提交后不可修改；如需更正，请在次日重新签到并说明原因。</text>
          </view>
        </template>
      </view>

      <view v-if="meta.canCheckin" class="bottom-bar">
        <button class="submit-btn" :disabled="!canSubmit" @tap="submit">
          {{ submitting ? uploadText || '提交中…' : '提交签到' }}
        </button>
      </view>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import { resolveMediaUrl } from '../../api/request'
import { fetchVisitMeta, submitVisit, uploadVisitMedia } from '../../api/visit'

defineOptions({ name: 'VisitCheckinPage' })

// 只有开发构建显示「模拟位置」按钮；生产包不渲染
const isDev = import.meta.env.DEV

const safeTop = ref(0)
const loading = ref(false)
const loadError = ref('')
const meta = ref(null)
const location = ref(null)
const locating = ref(false)
const photos = ref([])
const remark = ref('')
const reason = ref('')
const submitting = ref(false)
const uploadText = ref('')
const forceReason = ref(false)

const projectId = ref(0)
const routePlanId = ref(0)
const seqInPlan = ref(0)

const roleText = computed(() => {
  const labels = { foreman: '工长', supervisor: '监理', owner: '业主' }
  return labels[meta.value?.myRole] || '项目成员'
})

const locationText = computed(() => {
  if (!location.value) return ''
  return `${location.value.latitude.toFixed(6)}, ${location.value.longitude.toFixed(6)}`
})

/** 与后端同一套球面距离，仅用于提交前给用户提示；最终判定仍以服务端为准 */
function haversineMeters(a, b) {
  const radius = 6371000
  const toRad = (value) => (Number(value) * Math.PI) / 180
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const dLat = lat2 - lat1
  const dLng = toRad(Number(b.longitude) - Number(a.longitude))
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)))
}

const distance = computed(() => {
  if (!location.value || !meta.value || !meta.value.hasCoordinates) return null
  return haversineMeters(
    { latitude: meta.value.latitude, longitude: meta.value.longitude },
    location.value
  )
})

const isAbnormal = computed(() => {
  if (distance.value === null || !meta.value) return false
  return distance.value > Number(meta.value.thresholdM)
})

/** 服务端判定异常与客户端不一致时，也要展开说明输入框 */
const showReason = computed(() => isAbnormal.value || forceReason.value)

const todayPhotos = computed(() => {
  const media = meta.value?.todayVisit?.media || []
  return media.map((item) => resolveMediaUrl(item.url))
})

const canSubmit = computed(() => {
  if (!meta.value || !meta.value.canCheckin) return false
  if (submitting.value || locating.value) return false
  if (!location.value) return false
  if (photos.value.length < 1 || photos.value.length > 3) return false
  if (showReason.value && !reason.value.trim()) return false
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
  routePlanId.value = options && options.routePlanId ? Number(options.routePlanId) : 0
  seqInPlan.value = options && options.seqInPlan ? Number(options.seqInPlan) : 0

  if (!projectId.value) {
    loadError.value = '缺少项目 ID'
    return
  }

  loadMeta()
})

onPullDownRefresh(async () => {
  try {
    await loadMeta()
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function loadMeta() {
  loading.value = true
  loadError.value = ''

  try {
    meta.value = await fetchVisitMeta(projectId.value)
    if (meta.value.canCheckin && !location.value) {
      // 自动定位一次；失败会走权限引导，不会静默提交空坐标
      locate()
    }
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }
    loadError.value = err.message || '签到信息加载失败'
  } finally {
    loading.value = false
  }
}

function goBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/projects/index' }),
  })
}

function locate() {
  if (locating.value) return
  locating.value = true

  uni.getLocation({
    type: 'gcj02',
    isHighAccuracy: true,
    highAccuracyExpireTime: 5000,
    success(res) {
      const latitude = Number(res.latitude)
      const longitude = Number(res.longitude)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        uni.showToast({ title: '定位失败，请重试', icon: 'none' })
        return
      }
      location.value = { latitude, longitude }
    },
    fail(err) {
      showLocationHelp(err)
    },
    complete() {
      locating.value = false
    },
  })
}

function showLocationHelp(err) {
  const message = String((err && err.errMsg) || '')
  const denied = /auth deny|auth denied|authorize|permission/i.test(message)

  uni.showModal({
    title: denied ? '需要位置权限' : '定位失败',
    content: denied
      ? '签到需要获取当前位置。请在设置中允许小程序使用位置信息后重试。'
      : '暂时无法获取当前位置，请检查手机定位服务后重试。',
    confirmText: denied ? '去设置' : '知道了',
    showCancel: denied,
    cancelText: '稍后重试',
    success(res) {
      if (denied && res.confirm && typeof uni.openSetting === 'function') {
        uni.openSetting({})
      }
    },
  })
}

/** 开发模拟：直接把当前位置设成项目坐标，距离 0，用于本地联调 */
function useProjectLocation() {
  if (!meta.value || !meta.value.hasCoordinates) return
  forceReason.value = false
  location.value = {
    latitude: Number(meta.value.latitude),
    longitude: Number(meta.value.longitude),
  }
}

/** 开发模拟：纬度偏 0.0072°（约 800m），用于验证异常说明流程 */
function useAbnormalLocation() {
  if (!meta.value || !meta.value.hasCoordinates) return
  location.value = {
    latitude: Number(meta.value.latitude) + 0.0072,
    longitude: Number(meta.value.longitude),
  }
}

function choosePhotos() {
  const remain = 3 - photos.value.length
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
  const urls = photos.value.map((item) => item.tempFilePath)
  uni.previewImage({ urls, current: urls[index] })
}

function previewToday(index) {
  const urls = todayPhotos.value
  uni.previewImage({ urls, current: urls[index] })
}

function formatDistance(meters) {
  const value = Number(meters)
  if (!Number.isFinite(value)) return '未知'
  if (value < 1000) return `${Math.round(value)} 米`
  return `${(value / 1000).toFixed(1)} 公里`
}

async function uploadPhotos() {
  for (let index = 0; index < photos.value.length; index += 1) {
    const photo = photos.value[index]
    if (photo.mediaId) continue

    uploadText.value = `上传照片 ${index + 1}/${photos.value.length}…`
    const result = await uploadVisitMedia(projectId.value, photo.tempFilePath)
    photo.mediaId = result.mediaId
  }
}

async function submit() {
  if (!canSubmit.value || submitting.value) return

  submitting.value = true
  uploadText.value = ''

  try {
    await uploadPhotos()

    uploadText.value = '提交签到…'
    await submitVisit(projectId.value, {
      latitude: location.value.latitude,
      longitude: location.value.longitude,
      mediaIds: photos.value.map((photo) => photo.mediaId),
      remark: remark.value.trim() || undefined,
      abnormalReason: showReason.value ? reason.value.trim() : undefined,
      routePlanId: routePlanId.value || undefined,
      seqInPlan: seqInPlan.value || undefined,
    })

    uni.$emit('visit:created', {
      projectId: projectId.value,
      routePlanId: routePlanId.value || null,
    })
    uni.showToast({ title: '签到成功', icon: 'success' })
    setTimeout(() => goBack(), 600)
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }

    if (err.statusCode === 409 && String(err.message || '').includes('今日已签到')) {
      uni.showToast({ title: '今日已签到', icon: 'none' })
      await loadMeta()
      return
    }

    // 服务端按提交时的项目坐标重新判定，可能与页面预览略有差异；
    // 命中超阈值错误时展开异常说明，让用户补一句就能重试。
    if (err.statusCode === 400 && String(err.message || '').includes('请填写说明')) {
      forceReason.value = true
    }

    // 暂存照片过期 / 已被消费时，清掉 mediaId，下一次提交重新上传
    if (
      err.statusCode === 400 &&
      /照片.*(失效|不存在|状态)/.test(String(err.message || ''))
    ) {
      for (const photo of photos.value) photo.mediaId = null
    }

    uni.showToast({ title: err.message || '签到失败，请重试', icon: 'none' })
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
  background: $color-canvas;
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
  background: $color-surface;
  border-radius: dp(16);
  padding: dp(16);
  margin-bottom: dp(12);
  box-shadow: 0 dp(4) dp(16) rgba(36, 28, 23, 0.04);
}

.project-card {
  display: flex;
  align-items: flex-start;
  gap: dp(10);
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

.role-badge {
  flex-shrink: 0;
  padding: dp(3) dp(9);
  border-radius: dp(10);
  background: $color-primary-soft;
  color: $color-primary;
  font-size: dp(11);
  font-weight: 600;
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

.state-emoji--done {
  background: $color-success-soft;
  color: $color-success-ink;
}

.state-card .state-title {
  margin-top: dp(12);
}

.state-time {
  margin-top: dp(6);
  font-size: dp(12);
  color: $color-ink-tertiary;
}

.abnormal-tag {
  margin-top: dp(8);
  padding: dp(3) dp(9);
  border-radius: dp(10);
  background: $color-danger-soft;
  color: $color-danger-ink;
  font-size: dp(11);
  font-weight: 600;
}

.state-reason {
  margin-top: dp(8);
  font-size: dp(12);
  color: $color-ink-secondary;
  line-height: 1.7;
  text-align: center;
}

.today-photos {
  margin-top: dp(12);
  display: flex;
  gap: dp(8);
  flex-wrap: wrap;
  justify-content: center;
}

.today-photo {
  width: dp(88);
  height: dp(88);
  border-radius: dp(10);
  background: $color-surface-sunken;
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

.section-count--danger {
  color: $color-danger-ink;
  font-weight: 600;
}

.section-hint {
  display: block;
  margin-top: dp(10);
  font-size: dp(11);
  color: $color-ink-tertiary;
  line-height: 1.6;
}

.section-hint--warning {
  color: $color-warning-ink;
}

.section--warning {
  border: 1px solid rgba(245, 63, 63, 0.18);
  background: #fffafa;
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

.location-row {
  margin-top: dp(12);
  display: flex;
  align-items: center;
  gap: dp(10);
}

.location-main {
  flex: 1;
  min-width: 0;
}

.location-title {
  display: block;
  font-size: dp(13);
  font-weight: 600;
  color: $color-ink;
}

.location-text {
  display: block;
  margin-top: dp(4);
  font-size: dp(11);
  color: $color-ink-tertiary;
  line-height: 1.5;
}

.location-btn {
  flex-shrink: 0;
  height: dp(34);
  padding: 0 dp(14);
  border-radius: dp(17);
  background: $color-primary-soft;
  color: $color-primary;
  font-size: dp(12);
  font-weight: 600;
  line-height: dp(34);
}

.location-btn::after {
  border: none;
}

.location-btn[disabled] {
  opacity: 0.6;
}

.distance-row {
  margin-top: dp(12);
  padding: dp(10) dp(12);
  border-radius: dp(10);
  background: $color-success-soft;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: dp(8);
}

.distance-row--abnormal {
  background: $color-danger-soft;
}

.distance-main {
  font-size: dp(13);
  font-weight: 600;
  color: $color-success-ink;
}

.distance-row--abnormal .distance-main {
  color: $color-danger-ink;
}

.distance-sub {
  font-size: dp(10);
  color: $color-ink-secondary;
}

.dev-sim {
  margin-top: dp(10);
  display: flex;
  align-items: center;
  gap: dp(8);
  padding: dp(8) dp(10);
  border-radius: dp(10);
  background: $color-neutral-soft;
}

.dev-sim-label {
  flex: 1;
  font-size: dp(10);
  color: $color-neutral;
}

.dev-sim-btn {
  padding: dp(4) dp(9);
  border-radius: dp(8);
  background: $color-surface;
  color: $color-primary;
  font-size: dp(10);
  font-weight: 600;
}

.dev-sim-btn--warn {
  color: $color-danger-ink;
}

.field-textarea {
  margin-top: dp(10);
  width: 100%;
  min-height: dp(86);
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

.field-count {
  display: block;
  margin-top: dp(5);
  text-align: right;
  font-size: dp(10);
  color: $color-neutral;
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
  background: rgba(250, 247, 244, 0.96);
  border-top: 1px solid $color-hairline;
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
