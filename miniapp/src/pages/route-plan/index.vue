<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <text class="nav-title">考察计划</text>
    </view>

    <view class="content">
      <view class="hero-card">
        <view class="hero-main">
          <text class="hero-eyebrow">ROUTE PLANNER</text>
          <text class="hero-title">把今天的工地，排成一条顺路的线</text>
          <text class="hero-sub">选工地 · 自动排序 · 逐段导航</text>
        </view>
        <view class="hero-icon-wrap">
          <image class="hero-icon" src="/static/images/icon-navigation-accent.png" mode="aspectFit" />
        </view>
        <view class="hero-steps">
          <view v-for="(step, index) in steps" :key="step.key" class="hero-step">
            <view class="hero-step-index">{{ index + 1 }}</view>
            <text class="hero-step-label">{{ step.label }}</text>
            <view v-if="index < steps.length - 1" class="hero-step-line" />
          </view>
        </view>
      </view>

      <view class="section-head">
        <view>
          <text class="section-title">已保存的考察计划</text>
          <text class="section-sub">下次出发前直接复用，不用重新勾选</text>
        </view>
        <text class="section-count">{{ total }} 个</text>
      </view>

      <view v-if="loading && plans.length === 0" class="gc-loading-page">
        <gc-skeleton :rows="3" />
      </view>

      <view v-else-if="error && plans.length === 0" class="state-card">
        <image class="state-icon" src="/static/images/icon-warning-amber.png" mode="aspectFit" />
        <text class="state-title">考察计划加载失败</text>
        <text class="state-text">{{ error }}</text>
        <button class="state-btn" @tap="load(true)">重新加载</button>
      </view>

      <view v-else-if="plans.length === 0" class="state-card state-card--empty">
        <view class="empty-icon-wrap">
          <image class="empty-icon" src="/static/images/icon-map-sky.png" mode="aspectFit" />
        </view>
        <text class="state-title">还没有保存过路线</text>
        <text class="state-text">从下面开始规划，勾选今天要去的工地，系统会给出推荐顺序。</text>
      </view>

      <view v-else class="plan-list">
        <view
          v-for="(plan, index) in plans"
          :key="plan.id"
          class="plan-card"
          @tap="openPlan(plan.id)"
        >
          <view class="plan-card-head">
            <view class="plan-number">{{ index + 1 }}</view>
            <view class="plan-main">
              <view class="plan-title-row">
                <text class="plan-title">{{ plan.name }}</text>
                <text v-if="plan.stale" class="plan-stale">需重新规划</text>
              </view>
              <text class="plan-meta">
                {{ plan.pointCount }} 个工地 · {{ formatDistance(plan.totalDistance) }} · {{ formatDuration(plan.totalDuration) }}
              </text>
            </view>
            <image class="plan-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>

          <view v-if="plan.points && plan.points.length" class="plan-points">
            <text
              v-for="point in plan.points"
              :key="`${plan.id}-${point.seq}`"
              class="plan-point-chip"
            >
              {{ point.name }}
            </text>
          </view>

          <view class="plan-foot">
            <text class="plan-origin">{{ plan.originType === 'custom' ? '自定义起点' : '当前位置出发' }}</text>
            <text class="plan-created">{{ formatDate(plan.createdAt) }}</text>
          </view>
        </view>

        <view v-if="plans.length < total" class="load-more" @tap="loadMore">
          <gc-loading v-if="loadingMore" inline text="加载中" />
          <text v-else>加载更多</text>
        </view>
      </view>
    </view>

    <view class="bottom-bar">
      <button class="create-btn" @tap="createPlan">
        <image class="create-icon" src="/static/images/icon-plus-white.png" mode="aspectFit" />
        <text>规划新路线</text>
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import { getCurrentProject } from '../../store/projectContext'
import { fetchRoutePlans } from '../../api/routePlan'

defineOptions({ name: 'RoutePlanListPage' })

const steps = [
  { key: 'select', label: '选工地' },
  { key: 'sort', label: '排顺序' },
  { key: 'go', label: '逐段走' },
]

const safeTop = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const plans = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const maxPoints = ref(10)

let loadedOnce = false

onLoad(() => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  if (!getToken()) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }

  load(true)
})

onShow(() => {
  if (loadedOnce && getToken()) load(true, { silent: true })
})

onPullDownRefresh(async () => {
  try {
    await load(true, { silent: true })
  } finally {
    uni.stopPullDownRefresh()
  }
})

onReachBottom(() => {
  loadMore()
})

async function load(reset = true, { silent = false } = {}) {
  if (loading.value || loadingMore.value) return

  if (reset) {
    page.value = 1
    if (!silent) loading.value = true
  } else {
    loadingMore.value = true
  }
  error.value = ''

  try {
    const current = getCurrentProject()
    const data = await fetchRoutePlans({
      page: page.value,
      pageSize,
      tenantId: current ? current.tenantId : undefined,
    })
    const list = (data && data.list) || []
    plans.value = reset ? list : plans.value.concat(list)
    total.value = Number(data && data.total) || 0
    maxPoints.value = Number(data && data.maxPoints) || maxPoints.value
    loadedOnce = true
  } catch (err) {
    if (err.statusCode === 401) {
      uni.reLaunch({ url: '/pages/login/index' })
      return
    }
    error.value = err.message || '加载失败'
    if (!silent) uni.showToast({ title: error.value, icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMore() {
  if (loading.value || loadingMore.value) return
  if (plans.value.length >= total.value) return
  page.value += 1
  load(false, { silent: true })
}

function createPlan() {
  uni.navigateTo({ url: '/pages/route-plan/plan' })
}

function openPlan(planId) {
  uni.navigateTo({ url: `/pages/route-plan/detail?id=${planId}` })
}

function formatDistance(meters) {
  if (meters === null || meters === undefined) return '里程待规划'
  const value = Number(meters)
  if (!Number.isFinite(value)) return '里程待规划'
  if (value >= 1000) return `${(value / 1000).toFixed(1)} km`
  return `${Math.round(value)} m`
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '耗时待规划'
  const value = Number(seconds)
  if (!Number.isFinite(value)) return '耗时待规划'
  if (value >= 3600) return `${Math.floor(value / 3600)} 小时 ${Math.round((value % 3600) / 60)} 分`
  return `${Math.max(1, Math.round(value / 60))} 分钟`
}

function formatDate(value) {
  if (!value) return ''
  return String(value).slice(0, 10).replace(/-/g, '.')
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
  padding-bottom: calc(#{dp(96)} + env(safe-area-inset-bottom));
  background: #faf7f4;
}

.nav {
  display: flex;
  align-items: center;
  padding-right: dp(16);
  padding-bottom: dp(8);
  padding-left: dp(8);
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
  font-size: dp(17);
  font-weight: 700;
}

.content {
  padding: dp(4) dp(16) 0;
}

.hero-card {
  position: relative;
  overflow: hidden;
  padding: dp(18) dp(16) dp(16);
  border-radius: dp(20);
  background: linear-gradient(135deg, #eb5c20 0%, #f4772e 58%, #f8a15f 100%);
  box-shadow: 0 dp(10) dp(24) rgba(235, 92, 32, 0.18);
}

.hero-card::after {
  position: absolute;
  top: dp(-48);
  right: dp(-42);
  width: dp(150);
  height: dp(150);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  content: '';
}

.hero-main {
  position: relative;
  z-index: 1;
  max-width: 76%;
}

.hero-eyebrow {
  display: block;
  color: rgba(255, 255, 255, 0.72);
  font-size: dp(9);
  font-weight: 700;
  letter-spacing: dp(1.6);
}

.hero-title {
  display: block;
  margin-top: dp(8);
  color: #fff;
  font-size: dp(20);
  font-weight: 700;
  line-height: 1.35;
}

.hero-sub {
  display: block;
  margin-top: dp(6);
  color: rgba(255, 255, 255, 0.82);
  font-size: dp(11);
}

.hero-icon-wrap {
  position: absolute;
  top: dp(20);
  right: dp(16);
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(48);
  height: dp(48);
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
}

.hero-icon {
  width: dp(24);
  height: dp(24);
}

.hero-steps {
  position: relative;
  z-index: 1;
  display: flex;
  margin-top: dp(18);
  padding-top: dp(13);
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.hero-step {
  display: flex;
  align-items: center;
  flex: 1;
}

.hero-step-index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(17);
  height: dp(17);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  font-size: dp(9);
  font-weight: 700;
}

.hero-step-label {
  margin-left: dp(5);
  color: rgba(255, 255, 255, 0.9);
  font-size: dp(10);
}

.hero-step-line {
  width: dp(12);
  height: 1px;
  margin: 0 dp(6);
  background: rgba(255, 255, 255, 0.34);
}

.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin: dp(22) dp(2) dp(10);
}

.section-title {
  display: block;
  color: #241c17;
  font-size: dp(16);
  font-weight: 700;
}

.section-sub {
  display: block;
  margin-top: dp(3);
  color: #9b9087;
  font-size: dp(10);
}

.section-count {
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 600;
}

.state-card {
  display: flex;
  align-items: center;
  padding: dp(26) dp(18);
  border: 1px solid #f0eae4;
  border-radius: dp(16);
  background: #fff;
  flex-direction: column;
  text-align: center;
}

.state-card--empty {
  padding: dp(30) dp(22);
}

.empty-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(62);
  height: dp(62);
  margin-bottom: dp(12);
  border-radius: 50%;
  background: #fff3e8;
}

.empty-icon {
  width: dp(34);
  height: dp(34);
}

.state-icon {
  width: dp(34);
  height: dp(34);
  margin-bottom: dp(10);
}

.state-title {
  color: #241c17;
  font-size: dp(14);
  font-weight: 700;
}

.state-text {
  margin-top: dp(7);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.65;
}

.state-btn {
  margin-top: dp(14);
  padding: dp(8) dp(18);
  border-radius: dp(8);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  font-weight: 600;
}

.plan-list {
  display: flex;
  flex-direction: column;
  gap: dp(10);
}

.plan-card {
  padding: dp(14);
  border: 1px solid #f0eae4;
  border-radius: dp(16);
  background: #fff;
  box-shadow: 0 dp(3) dp(12) rgba(0, 0, 0, 0.025);
}

.plan-card:active {
  transform: scale(0.992);
}

.plan-card-head {
  display: flex;
  align-items: center;
}

.plan-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(34);
  height: dp(34);
  margin-right: dp(10);
  border-radius: dp(11);
  background: #fff3e8;
  color: #eb5c20;
  font-size: dp(13);
  font-weight: 700;
  flex-shrink: 0;
}

.plan-main {
  min-width: 0;
  flex: 1;
}

.plan-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.plan-title {
  overflow: hidden;
  color: #241c17;
  font-size: dp(14);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-stale {
  padding: dp(2) dp(5);
  border-radius: dp(4);
  background: #fff7e8;
  color: #a85400;
  font-size: dp(8);
  font-weight: 600;
  flex-shrink: 0;
}

.plan-meta {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}

.plan-chevron {
  width: dp(14);
  height: dp(14);
  margin-left: dp(8);
  flex-shrink: 0;
}

.plan-points {
  display: flex;
  gap: dp(5);
  margin-top: dp(11);
  padding-top: dp(10);
  border-top: 1px dashed #f1ebe5;
  flex-wrap: wrap;
}

.plan-point-chip {
  max-width: dp(120);
  overflow: hidden;
  padding: dp(3) dp(7);
  border-radius: dp(5);
  background: #faf7f4;
  color: #6d6259;
  font-size: dp(9);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(10);
}

.plan-origin,
.plan-created {
  color: #aaa097;
  font-size: dp(9);
}

.load-more {
  padding: dp(12) 0;
  color: #8b8179;
  font-size: dp(11);
  text-align: center;
}

.bottom-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  padding: dp(10) dp(16) calc(#{dp(10)} + env(safe-area-inset-bottom));
  background: rgba(250, 247, 244, 0.94);
  border-top: 1px solid #f0eae4;
  backdrop-filter: blur(10px);
}

.create-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(46);
  border-radius: dp(12);
  background: #eb5c20;
  color: #fff;
  font-size: dp(15);
  font-weight: 600;
  box-shadow: 0 dp(8) dp(18) rgba(235, 92, 32, 0.24);
}

.create-btn:active {
  background: #c44710;
}

.create-icon {
  width: dp(16);
  height: dp(16);
  margin-right: dp(7);
}
</style>
