<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <view class="nav-title-wrap">
        <text class="nav-title">考察记录</text>
        <text class="nav-sub">签到人、时间、偏差与现场照片</text>
      </view>
    </view>

    <view v-if="loading && !loaded" class="skeleton-wrap">
      <gc-skeleton :rows="3" />
    </view>

    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-warning-amber.png" mode="aspectFit" />
      <text class="state-title">考察记录不可用</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="goBack">返回项目</button>
    </view>

    <view v-else-if="!visits.length" class="state-block">
      <image class="state-icon" src="/static/images/icon-camera-gray.png" mode="aspectFit" />
      <text class="state-title">还没有考察记录</text>
      <text class="state-text">工长或监理在项目现场签到后，记录会出现在这里。</text>
    </view>

    <view v-else class="content gc-stagger">
      <view v-for="visit in visits" :key="visit.id" class="visit-card">
        <view class="visit-head">
          <view class="avatar-wrap">
            <image v-if="visit.signer.avatar" class="avatar" :src="resolveMediaUrl(visit.signer.avatar)" mode="aspectFill" />
            <text v-else class="avatar-letter">{{ initial(visit) }}</text>
          </view>

          <view class="head-main">
            <view class="head-line">
              <text class="signer-name">{{ visit.signer.nickname || '项目成员' }}</text>
              <text v-if="visit.signer.roleLabel" class="signer-role">{{ visit.signer.roleLabel }}</text>
              <text v-if="visit.isAbnormal" class="abnormal-tag">异常</text>
            </view>
            <text class="visit-time">{{ visit.checkinAt }}</text>
          </view>

          <view class="distance-chip" :class="{ 'distance-chip--abnormal': visit.isAbnormal }">
            距项目 {{ formatDistance(visit.distanceM) }}
          </view>
        </view>

        <view v-if="visit.route" class="route-chip">
          <image class="route-icon" src="/static/images/icon-navigation-accent.png" mode="aspectFit" />
          <text>来自考察计划第 {{ visit.route.seqInPlan }} 站</text>
        </view>

        <text v-if="visit.remark" class="visit-remark">{{ visit.remark }}</text>
        <text v-if="visit.abnormalReason" class="abnormal-reason">异常说明：{{ visit.abnormalReason }}</text>

        <view v-if="visit.media.length" class="photo-grid">
          <image
            v-for="(photo, index) in visit.media"
            :key="photo.id"
            class="photo"
            :src="resolveMediaUrl(photo.url)"
            mode="aspectFill"
            @tap="preview(visit, index)"
          />
        </view>
      </view>

      <view class="load-more">
        <gc-loading v-if="loadingMore" text="正在加载更多…" inline />
        <text v-else-if="finished" class="load-more-text">没有更多了</text>
        <text v-else class="load-more-text">上拉加载更多</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import { resolveMediaUrl } from '../../api/request'
import { fetchProjectVisits } from '../../api/visit'

defineOptions({ name: 'VisitTimelinePage' })

const safeTop = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const loadError = ref('')
const visits = ref([])
const page = ref(1)
const pageSize = 10
const total = ref(0)
const finished = ref(false)

const projectId = ref(0)

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

  load()
})

onPullDownRefresh(async () => {
  try {
    await load()
  } finally {
    uni.stopPullDownRefresh()
  }
})

onReachBottom(() => {
  loadMore()
})

async function load() {
  loading.value = true
  loadError.value = ''

  try {
    const data = await fetchProjectVisits(projectId.value, { page: 1, pageSize })
    visits.value = data.list || []
    total.value = Number(data.total) || 0
    page.value = 1
    finished.value = visits.value.length >= total.value
    loaded.value = true
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }
    loadError.value = err.message || '考察记录加载失败'
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || finished.value) return

  loadingMore.value = true
  const nextPage = page.value + 1

  try {
    const data = await fetchProjectVisits(projectId.value, { page: nextPage, pageSize })
    const list = data.list || []
    if (list.length === 0) {
      finished.value = true
      return
    }
    visits.value = visits.value.concat(list)
    page.value = nextPage
    total.value = Number(data.total) || visits.value.length
    finished.value = visits.value.length >= total.value
  } catch (err) {
    uni.showToast({ title: err.message || '加载更多失败', icon: 'none' })
  } finally {
    loadingMore.value = false
  }
}

function goBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/projects/index' }),
  })
}

function initial(visit) {
  const name = visit.signer.nickname || ''
  return name ? name.slice(0, 1) : '员'
}

function formatDistance(meters) {
  const value = Number(meters)
  if (!Number.isFinite(value)) return '未知'
  if (value < 1000) return `${Math.round(value)} 米`
  return `${(value / 1000).toFixed(1)} 公里`
}

function preview(visit, index) {
  const urls = visit.media.map((photo) => resolveMediaUrl(photo.url))
  uni.previewImage({ urls, current: urls[index] })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $color-canvas;
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
}

.skeleton-wrap {
  padding: dp(8) dp(16);
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
  font-size: dp(16);
  font-weight: 600;
  color: $color-ink;
}

.state-text {
  font-size: dp(12);
  color: $color-ink-tertiary;
  text-align: center;
  line-height: 1.7;
}

.state-btn {
  margin-top: dp(10);
  min-width: dp(140);
  height: dp(42);
  border-radius: dp(21);
  background: $color-primary;
  color: $color-on-primary;
  font-size: dp(14);
}

.state-btn::after {
  border: none;
}

.content {
  padding: dp(4) dp(16) dp(24);
}

.visit-card {
  @include glass-surface(dp(16), 20px);
  padding: dp(14);
  margin-bottom: dp(12);
}

.visit-head {
  display: flex;
  align-items: flex-start;
  gap: dp(10);
}

.avatar-wrap {
  width: dp(38);
  height: dp(38);
  border-radius: 50%;
  background: $color-primary-soft;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.avatar {
  width: 100%;
  height: 100%;
}

.avatar-letter {
  font-size: dp(16);
  font-weight: 600;
  color: $color-primary;
}

.head-main {
  flex: 1;
  min-width: 0;
}

.head-line {
  display: flex;
  align-items: center;
  gap: dp(6);
  flex-wrap: wrap;
}

.signer-name {
  font-size: dp(14);
  font-weight: 600;
  color: $color-ink;
}

.signer-role {
  padding: dp(1) dp(6);
  border-radius: dp(8);
  background: $color-neutral-soft;
  color: $color-neutral-ink;
  font-size: dp(10);
}

.abnormal-tag {
  padding: dp(1) dp(6);
  border-radius: dp(8);
  background: $color-danger-soft;
  color: $color-danger-ink;
  font-size: dp(10);
  font-weight: 600;
}

.visit-time {
  display: block;
  margin-top: dp(4);
  font-size: dp(11);
  color: $color-ink-tertiary;
}

.distance-chip {
  flex-shrink: 0;
  padding: dp(4) dp(8);
  border-radius: dp(10);
  background: $color-success-soft;
  color: $color-success-ink;
  font-size: dp(10);
  font-weight: 600;
}

.distance-chip--abnormal {
  background: $color-danger-soft;
  color: $color-danger-ink;
}

.route-chip {
  margin-top: dp(10);
  display: inline-flex;
  align-items: center;
  gap: dp(5);
  padding: dp(4) dp(8);
  border-radius: dp(9);
  background: $color-primary-wash;
  color: $color-primary;
  font-size: dp(10);
}

.route-icon {
  width: dp(12);
  height: dp(12);
}

.visit-remark {
  display: block;
  margin-top: dp(10);
  font-size: dp(13);
  color: $color-ink-secondary;
  line-height: 1.7;
}

.abnormal-reason {
  display: block;
  margin-top: dp(8);
  padding: dp(8) dp(10);
  border-radius: dp(9);
  background: $color-danger-soft;
  color: $color-danger-ink;
  font-size: dp(11);
  line-height: 1.6;
}

.photo-grid {
  margin-top: dp(10);
  display: flex;
  flex-wrap: wrap;
  gap: dp(6);
}

.photo {
  width: dp(94);
  height: dp(94);
  border-radius: dp(10);
  background: $color-surface-sunken;
}

.load-more {
  padding: dp(16) 0 dp(24);
  display: flex;
  align-items: center;
  justify-content: center;
}

.load-more-text {
  font-size: dp(11);
  color: $color-neutral;
}
</style>
