<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <text class="nav-title">考察计划</text>
    </view>

    <view v-if="loading && !plan" class="state-block">
      <gc-loading text="正在加载考察计划…" />
    </view>

    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-warning-amber.png" mode="aspectFit" />
      <text class="state-title">考察计划不可用</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="goBack">返回考察计划</button>
    </view>

    <view v-else-if="plan" class="content">
      <view class="hero-card">
        <view class="hero-top">
          <view class="hero-main">
            <text class="hero-eyebrow">SAVED ROUTE</text>
            <text class="hero-title">{{ plan.name }}</text>
            <text class="hero-sub">
              {{ plan.origin.type === 'custom' ? plan.origin.name || '自定义起点' : '当前位置出发' }}
              · {{ plan.pointCount }} 个工地 · 已考察 {{ plan.visitedCount }}/{{ plan.pointCount }}
            </text>
          </view>
          <view class="hero-badge">{{ plan.pointCount }} 站</view>
        </view>

        <view class="hero-metrics">
          <view class="hero-metric">
            <text class="hero-metric-value">{{ formatDistance(plan.totalDistance) }}</text>
            <text class="hero-metric-label">总里程</text>
          </view>
          <view class="hero-metric-divider" />
          <view class="hero-metric">
            <text class="hero-metric-value">{{ formatDuration(plan.totalDuration) }}</text>
            <text class="hero-metric-label">预计耗时</text>
          </view>
          <view class="hero-metric-divider" />
          <view class="hero-metric">
            <text class="hero-metric-value">{{ formatDate(plan.createdAt) }}</text>
            <text class="hero-metric-label">保存时间</text>
          </view>
        </view>
      </view>

      <view v-if="plan.stale" class="alert-card alert-card--stale">
        <view class="alert-icon">!</view>
        <view class="alert-main">
          <text class="alert-title">需重新规划</text>
          <text class="alert-text">{{ plan.staleReason || '项目坐标已变更，旧路线不再准确。' }}</text>
        </view>
      </view>

      <view v-else-if="plan.degraded" class="alert-card alert-card--degraded">
        <view class="alert-icon">i</view>
        <view class="alert-main">
          <text class="alert-title">保存时地图服务不可用</text>
          <text class="alert-text">当前没有里程与耗时数据，仍可按列表顺序逐站导航。</text>
        </view>
      </view>

      <view class="map-card">
        <map
          v-if="canUseNativeMap && !plan.stale"
          class="route-map"
          :latitude="mapCenter.latitude"
          :longitude="mapCenter.longitude"
          :markers="mapMarkers"
          :polyline="mapPolyline"
          :include-points="mapPoints"
          :scale="12"
          :show-location="false"
          :enable-zoom="true"
          :enable-scroll="true"
        />
        <view v-else class="map-fallback">
          <image class="map-fallback-icon" src="/static/images/icon-map-sky.png" mode="aspectFit" />
          <text class="map-fallback-title">{{ plan.stale ? '旧路线已失效' : '路线已保存' }}</text>
          <text class="map-fallback-text">
            {{ plan.stale ? '项目坐标发生变化，请重新规划后再查看地图折线。' : '请在微信小程序中查看地图折线，当前按列表顺序逐段导航。' }}
          </text>
        </view>
        <view class="map-caption">
          <text>地图仅供路线参考，实际路况以导航为准</text>
        </view>
      </view>

      <view class="card origin-card">
        <view class="origin-icon">
          <image class="origin-icon-img" src="/static/images/icon-navigation-accent.png" mode="aspectFit" />
        </view>
        <view class="origin-main">
          <text class="origin-label">起点</text>
          <text class="origin-name">{{ plan.origin.name || '当前位置' }}</text>
        </view>
        <text class="origin-coord">
          {{ formatCoord(plan.origin.latitude, plan.origin.longitude) }}
        </text>
      </view>

      <view class="card route-card">
        <view class="card-head">
          <view>
            <text class="card-title">途经工地</text>
            <text class="card-hint">按保存时的顺序逐站导航</text>
          </view>
        </view>

        <view class="route-list">
          <view v-for="(point, index) in plan.points" :key="point.projectId" class="route-point">
            <view class="route-rail">
              <view class="route-dot">{{ index + 1 }}</view>
              <view v-if="index < plan.points.length - 1" class="route-line" />
            </view>

            <view class="route-main">
              <view class="route-title-row">
                <text class="route-name">{{ point.name }}</text>
                <text v-if="index === 0" class="route-first">第一站</text>
              </view>
              <text class="route-address">{{ point.address || '未填写地址' }}</text>
              <text class="route-leg">{{ legLabel(point, index) }}</text>
            </view>

            <view class="point-actions">
              <text v-if="point.visitedAt" class="visited-badge">已考察</text>
              <button v-else class="checkin-btn" @tap.stop="goCheckin(point)">签到</button>
              <button class="nav-btn" @tap.stop="navigatePoint(point)">导航</button>
            </view>
          </view>
        </view>
      </view>

      <view class="footnote">
        <text>保存于 {{ formatTime(plan.createdAt) }}</text>
        <text v-if="plan.stale"> · 最近一次检测到项目坐标变更</text>
      </view>
    </view>

    <view v-if="plan" class="bottom-bar">
      <button class="delete-btn" :disabled="deleting" @tap="confirmDelete">
        {{ deleting ? '删除中…' : '删除' }}
      </button>
      <button class="replan-btn" @tap="replan">重新规划</button>
      <button class="one-tap-btn" :disabled="navigating" @tap="oneTapNavigate">
        {{ navigating ? '规划中…' : '一键导航' }}
      </button>
    </view>

  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow, onPullDownRefresh, onUnload } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import { deleteRoutePlan, fetchRoutePlan, previewRoutePlan } from '../../api/routePlan'

defineOptions({ name: 'RoutePlanDetailPage' })

const safeTop = ref(0)
const loading = ref(false)
const loadError = ref('')
const plan = ref(null)
const planId = ref(0)
const deleting = ref(false)
const navigating = ref(false)
const navSession = ref(null)
// openLocation 会离开小程序；返回时 onShow 才知道这次返回是「导航回来」
let awaitingNavigationReturn = false
const canUseNativeMap = ref(false)

// #ifdef MP-WEIXIN
canUseNativeMap.value = true
// #endif

const mapCenter = computed(() => {
  if (plan.value && plan.value.origin) {
    return {
      latitude: Number(plan.value.origin.latitude),
      longitude: Number(plan.value.origin.longitude),
    }
  }
  return { latitude: 31.2304, longitude: 121.4737 }
})

const mapPoints = computed(() => {
  if (!plan.value) return []
  const points = []
  if (plan.value.origin) {
    points.push({
      latitude: Number(plan.value.origin.latitude),
      longitude: Number(plan.value.origin.longitude),
    })
  }
  for (const point of plan.value.points) {
    points.push({
      latitude: Number(point.currentLatitude ?? point.latitude),
      longitude: Number(point.currentLongitude ?? point.longitude),
    })
  }
  return points
})

const mapMarkers = computed(() => {
  if (!plan.value) return []
  const markers = []

  if (plan.value.origin) {
    markers.push({
      id: 0,
      latitude: Number(plan.value.origin.latitude),
      longitude: Number(plan.value.origin.longitude),
      iconPath: '/static/images/icon-navigation-accent.png',
      width: 30,
      height: 30,
      callout: {
        content: '起点',
        display: 'ALWAYS',
        fontSize: 10,
        borderRadius: 5,
        padding: 4,
        bgColor: '#FFFFFF',
        color: '#241c17',
      },
    })
  }

  plan.value.points.forEach((point, index) => {
    markers.push({
      id: point.projectId,
      latitude: Number(point.currentLatitude ?? point.latitude),
      longitude: Number(point.currentLongitude ?? point.longitude),
      iconPath: '/static/images/icon-location-accent.png',
      width: 28,
      height: 28,
      callout: {
        content: `${index + 1}. ${point.name}`,
        display: 'BYCLICK',
        fontSize: 10,
        borderRadius: 5,
        padding: 4,
        bgColor: '#FFFFFF',
        color: '#241c17',
      },
    })
  })

  return markers
})

const mapPolyline = computed(() => {
  if (!plan.value || !Array.isArray(plan.value.path) || plan.value.path.length < 2) return []
  return [
    {
      points: plan.value.path.map((point) => ({
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
      })),
      color: '#EB5C20',
      width: 5,
      arrowLine: true,
      borderColor: '#C44710',
      borderWidth: 1,
    },
  ]
})

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  if (!getToken()) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }

  planId.value = options && options.id ? Number(options.id) : 0
  if (!planId.value) {
    loadError.value = '缺少考察计划 ID'
    return
  }

  load()
  uni.$on('visit:created', onVisitCreated)
})

onUnload(() => {
  uni.$off('visit:created', onVisitCreated)
})

/** 从考察计划发起的签到成功后，刷新「已考察」状态与进度 */
function onVisitCreated(payload) {
  if (!payload) return
  if (Number(payload.routePlanId) !== Number(planId.value)) return
  load()
}

function goCheckin(point) {
  if (!plan.value) return
  uni.navigateTo({
    url:
      `/pages/visit/checkin?projectId=${point.projectId}` +
      `&routePlanId=${plan.value.id}&seqInPlan=${point.seq}` +
      `&name=${encodeURIComponent(point.name || '')}`,
  })
}

/**
 * 从系统地图返回后继续下一站。
 *
 * 微信的 `uni.openLocation` 一次只能导航到一个目的地，不能在外部地图里
 * 一次传入全部途经点。因此「一键导航」负责规划并送到第一站，返回小程序后
 * 再询问是否继续下一站，直到路线走完。
 */
onShow(() => {
  if (!awaitingNavigationReturn) return
  awaitingNavigationReturn = false

  const session = navSession.value
  if (!session) return

  if (session.index >= session.points.length - 1) {
    navSession.value = null
    uni.showToast({ title: '已到最后一站', icon: 'none' })
    return
  }

  const next = session.points[session.index + 1]
  uni.showModal({
    title: '继续导航',
    content: `下一站：${next.name}${next.address ? `\n${next.address}` : ''}`,
    confirmText: '继续导航',
    cancelText: '结束',
    success(res) {
      if (!res.confirm) {
        navSession.value = null
        return
      }
      session.index += 1
      openNavigationStop()
    },
  })
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
    plan.value = await fetchRoutePlan(planId.value)
  } catch (err) {
    if (err.statusCode === 401) {
      uni.reLaunch({ url: '/pages/login/index' })
      return
    }
    loadError.value = err.message || '考察计划加载失败'
  } finally {
    loading.value = false
  }
}

function replan() {
  navSession.value = null
  if (!plan.value) return
  // 用 replace 而不是入栈：保存新计划后 redirectTo 详情，栈里不会留下
  // 「旧详情 → 新详情」两层，返回时直接回列表
  uni.redirectTo({ url: `/pages/route-plan/plan?replanId=${plan.value.id}` })
}

function confirmDelete() {
  if (!plan.value || deleting.value) return

  uni.showModal({
    title: '删除考察计划',
    content: `确定删除「${plan.value.name}」？删除后无法恢复。`,
    confirmText: '删除',
    confirmColor: '#F53F3F',
    success: async (res) => {
      if (!res.confirm) return
      deleting.value = true
      try {
        await deleteRoutePlan(plan.value.id)
        uni.showToast({ title: '已删除', icon: 'success' })
        setTimeout(navigateBackToList, 500)
      } catch (err) {
        uni.showToast({ title: err.message || '删除失败', icon: 'none' })
      } finally {
        deleting.value = false
      }
    },
  })
}

/**
 * 一键导航：用保存的起点与工地重新调用 preview（optimize=true），
 * 按当前坐标重新计算最近路线，然后直接开始第一站导航。
 *
 * 保存的计划可能已经过期（项目坐标变了），因此这里不只读旧折线；
 * 重新规划能保证导航使用的是当前坐标。重新规划结果不回写已保存计划，
 * 需要保存时走「重新规划」。
 */
async function oneTapNavigate() {
  if (navigating.value || !plan.value) return

  const origin = plan.value.origin
  const originLat = Number(origin && origin.latitude)
  const originLng = Number(origin && origin.longitude)
  const points = plan.value.points || []

  if (!points.length) {
    uni.showToast({ title: '这条计划还没有工地', icon: 'none' })
    return
  }
  if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
    uni.showToast({ title: '计划缺少有效起点，请重新规划', icon: 'none' })
    return
  }

  navigating.value = true
  try {
    const data = await previewRoutePlan({
      origin: {
        latitude: originLat,
        longitude: originLng,
        name: origin.name || '起点',
      },
      projectIds: points.map((point) => point.projectId),
      optimize: true,
    })

    if (!data.points || !data.points.length) {
      uni.showToast({ title: '没有可导航的工地', icon: 'none' })
      return
    }

    navSession.value = { points: data.points, index: 0 }
    uni.showToast({
      title: data.degraded ? '按当前顺序导航' : '最近路线已规划',
      icon: 'none',
      duration: 1200,
    })
    setTimeout(openNavigationStop, 260)
  } catch (err) {
    uni.showToast({ title: err.message || '路线规划失败', icon: 'none' })
  } finally {
    navigating.value = false
  }
}

/** 打开当前站点的系统导航；返回小程序后由 onShow 询问是否继续下一站 */
function openNavigationStop() {
  const session = navSession.value
  if (!session) return

  const point = session.points[session.index]
  if (!point) {
    navSession.value = null
    return
  }

  const latitude = Number(point.currentLatitude ?? point.latitude)
  const longitude = Number(point.currentLongitude ?? point.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    uni.showToast({ title: `${point.name} 缺少有效坐标`, icon: 'none' })
    navSession.value = null
    return
  }

  awaitingNavigationReturn = true
  uni.openLocation({
    latitude,
    longitude,
    name: point.name,
    address: point.address || '',
    scale: 18,
    fail() {
      awaitingNavigationReturn = false
      navSession.value = null
      uni.showToast({ title: '无法打开系统地图', icon: 'none' })
    },
  })
}

function navigatePoint(point) {
  // 单站导航不是「一键导航」，不参与后续站点的自动衔接
  navSession.value = null
  const latitude = Number(point.currentLatitude ?? point.latitude)
  const longitude = Number(point.currentLongitude ?? point.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    uni.showToast({ title: '该项目还没有有效坐标', icon: 'none' })
    return
  }
  uni.openLocation({
    latitude,
    longitude,
    name: point.name,
    address: point.address || '',
    scale: 18,
  })
}

function legLabel(point, index) {
  if (index === 0) {
    const distance = plan.value && plan.value.originLegDistance
    const duration = plan.value && plan.value.originLegDuration
    if (distance === null || distance === undefined) return '从起点出发'
    return `从起点出发 · ${formatDistance(distance)} · ${formatDuration(duration)}`
  }
  if (point.legDistance === null || point.legDistance === undefined) return '分段数据暂不可用'
  return `${formatDistance(point.legDistance)} · ${formatDuration(point.legDuration)}`
}

function formatDistance(meters) {
  if (meters === null || meters === undefined) return '--'
  const value = Number(meters)
  if (!Number.isFinite(value)) return '--'
  if (value >= 1000) return `${(value / 1000).toFixed(1)} km`
  return `${Math.round(value)} m`
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '--'
  const value = Number(seconds)
  if (!Number.isFinite(value)) return '--'
  if (value >= 3600) return `${Math.floor(value / 3600)}h${Math.round((value % 3600) / 60)}m`
  return `${Math.max(1, Math.round(value / 60))} 分钟`
}

function formatDate(value) {
  if (!value) return '--'
  return String(value).slice(0, 10).replace(/-/g, '.')
}

function formatTime(value) {
  if (!value) return '--'
  return String(value).slice(0, 16).replace(/-/g, '.')
}

function formatCoord(latitude, longitude) {
  if (latitude === null || longitude === null) return '未记录坐标'
  return `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`
}

function navigateBackToList() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.redirectTo({ url: '/pages/route-plan/index' })
}

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.redirectTo({ url: '/pages/route-plan/index' })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding-bottom: calc(#{dp(88)} + env(safe-area-inset-bottom));
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
  padding: dp(18) dp(16);
  border-radius: dp(18);
  background: linear-gradient(145deg, #eb5c20 0%, #f4772e 60%, #f8a15f 100%);
  box-shadow: 0 dp(10) dp(24) rgba(235, 92, 32, 0.18);
}

.hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.hero-main {
  min-width: 0;
  flex: 1;
}

.hero-eyebrow {
  display: block;
  color: rgba(255, 255, 255, 0.68);
  font-size: dp(9);
  font-weight: 700;
  letter-spacing: dp(1.4);
}

.hero-title {
  display: block;
  margin-top: dp(6);
  color: #fff;
  font-size: dp(19);
  font-weight: 700;
  line-height: 1.3;
}

.hero-sub {
  display: block;
  margin-top: dp(6);
  color: rgba(255, 255, 255, 0.82);
  font-size: dp(10);
}

.hero-badge {
  margin-left: dp(10);
  padding: dp(4) dp(8);
  border-radius: dp(6);
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: dp(10);
  font-weight: 700;
  flex-shrink: 0;
}

.hero-metrics {
  display: flex;
  align-items: center;
  margin-top: dp(17);
  padding-top: dp(13);
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.hero-metric {
  flex: 1;
  text-align: center;
}

.hero-metric-value {
  display: block;
  color: #fff;
  font-size: dp(14);
  font-weight: 700;
}

.hero-metric-label {
  display: block;
  margin-top: dp(3);
  color: rgba(255, 255, 255, 0.68);
  font-size: dp(8);
}

.hero-metric-divider {
  width: 1px;
  height: dp(22);
  background: rgba(255, 255, 255, 0.2);
}

.alert-card {
  display: flex;
  align-items: flex-start;
  margin-top: dp(12);
  padding: dp(11) dp(12);
  border-radius: dp(10);
}

.alert-card--stale {
  border: 1px solid #ffe1bf;
  background: #fff7e8;
}

.alert-card--degraded {
  border: 1px solid #d9e8ff;
  background: #f2f7ff;
}

.alert-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(17);
  height: dp(17);
  margin-right: dp(7);
  border-radius: 50%;
  background: #ff7d00;
  color: #fff;
  font-size: dp(10);
  font-weight: 700;
  flex-shrink: 0;
}

.alert-card--degraded .alert-icon {
  background: #2f7de1;
}

.alert-main {
  min-width: 0;
  flex: 1;
}

.alert-title {
  display: block;
  color: #8a4d00;
  font-size: dp(10);
  font-weight: 700;
}

.alert-card--degraded .alert-title {
  color: #1f5aa6;
}

.alert-text {
  display: block;
  margin-top: dp(3);
  color: #9b7040;
  font-size: dp(9);
  line-height: 1.5;
}

.alert-card--degraded .alert-text {
  color: #55769f;
}

.map-card {
  overflow: hidden;
  margin-top: dp(12);
  border: 1px solid #f0eae4;
  border-radius: dp(16);
  background: #fff;
}

.route-map {
  width: 100%;
  height: dp(220);
}

.map-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(180);
  padding: dp(20);
  background: linear-gradient(145deg, #f5eee7 0%, #fff7f2 100%);
  flex-direction: column;
  text-align: center;
}

.map-fallback-icon {
  width: dp(38);
  height: dp(38);
  opacity: 0.55;
}

.map-fallback-title {
  margin-top: dp(8);
  color: #51463e;
  font-size: dp(12);
  font-weight: 600;
}

.map-fallback-text {
  margin-top: dp(4);
  color: #9b9087;
  font-size: dp(9);
  line-height: 1.5;
}

.map-caption {
  padding: dp(8) dp(12);
  color: #a79d94;
  font-size: dp(8);
}

.card {
  margin-top: dp(12);
  padding: dp(14);
  @include glass-surface(dp(16), 20px);
}

.origin-card {
  display: flex;
  align-items: center;
}

.origin-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(34);
  height: dp(34);
  margin-right: dp(9);
  border-radius: 50%;
  background: #fff3e8;
}

.origin-icon-img {
  width: dp(17);
  height: dp(17);
}

.origin-main {
  min-width: 0;
  flex: 1;
}

.origin-label {
  display: block;
  color: #a79d94;
  font-size: dp(8);
}

.origin-name {
  display: block;
  overflow: hidden;
  margin-top: dp(2);
  color: #241c17;
  font-size: dp(12);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.origin-coord {
  margin-left: dp(8);
  color: #9b9087;
  font-size: dp(9);
  flex-shrink: 0;
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: dp(8);
}

.card-title {
  display: block;
  color: #241c17;
  font-size: dp(14);
  font-weight: 700;
}

.card-hint {
  display: block;
  margin-top: dp(3);
  color: #a0968d;
  font-size: dp(9);
}

.route-point {
  display: flex;
  align-items: stretch;
}

.route-rail {
  display: flex;
  align-items: center;
  width: dp(24);
  flex-direction: column;
  flex-shrink: 0;
}

.route-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(20);
  height: dp(20);
  margin-top: dp(2);
  border-radius: 50%;
  background: #eb5c20;
  color: #fff;
  font-size: dp(9);
  font-weight: 700;
  flex-shrink: 0;
}

.route-line {
  width: 1px;
  min-height: dp(38);
  margin: dp(3) 0;
  background: #f0d8c8;
  flex: 1;
}

.route-main {
  min-width: 0;
  padding: 0 dp(8) dp(13) dp(4);
  flex: 1;
}

.route-title-row {
  display: flex;
  align-items: center;
  gap: dp(5);
}

.route-name {
  overflow: hidden;
  color: #241c17;
  font-size: dp(12);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.route-first {
  padding: dp(1) dp(4);
  border-radius: dp(3);
  background: #fff3e8;
  color: #c44710;
  font-size: dp(7);
  flex-shrink: 0;
}

.route-address {
  display: block;
  overflow: hidden;
  margin-top: dp(3);
  color: #9b9087;
  font-size: dp(9);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.route-leg {
  display: block;
  margin-top: dp(4);
  color: #eb5c20;
  font-size: dp(9);
}

.point-actions {
  display: flex;
  align-items: center;
  align-self: center;
  gap: dp(5);
  margin-bottom: dp(13);
  flex-shrink: 0;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  height: dp(26);
  margin-bottom: dp(13);
  padding: 0 dp(10);
  border-radius: dp(6);
  background: #eb5c20;
  color: #fff;
  font-size: dp(9);
  font-weight: 500;
  line-height: 1;
  flex-shrink: 0;
}

.point-actions .nav-btn {
  margin-bottom: 0;
}

.checkin-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(26);
  padding: 0 dp(9);
  border-radius: dp(6);
  border: 1px solid #00b42a;
  background: #e8ffea;
  color: #087a1e;
  font-size: dp(9);
  font-weight: 600;
  line-height: 1;
}

.checkin-btn::after {
  border: none;
}

.visited-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(26);
  padding: 0 dp(8);
  border-radius: dp(6);
  background: #e8ffea;
  color: #087a1e;
  font-size: dp(9);
  font-weight: 600;
}

.footnote {
  padding: dp(14) dp(4) 0;
  color: #aaa097;
  font-size: dp(9);
  text-align: center;
}

.bottom-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  display: flex;
  gap: dp(9);
  padding: dp(10) dp(16) calc(#{dp(10)} + env(safe-area-inset-bottom));
  background: rgba(250, 247, 244, 0.94);
  border-top: 1px solid #f0eae4;
  backdrop-filter: blur(10px);
}

.delete-btn,
.replan-btn,
.one-tap-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(44);
  border-radius: dp(10);
  font-size: dp(13);
  font-weight: 600;
}

.delete-btn {
  width: 22%;
  border: 1px solid #ffd6d0;
  background: #fff;
  color: #c62828;
}

.replan-btn {
  width: 30%;
  border: 1px solid #e8ddd4;
  background: #fff;
  color: #51463e;
}

.one-tap-btn {
  flex: 1;
  background: #eb5c20;
  color: #fff;
  box-shadow: 0 dp(6) dp(14) rgba(235, 92, 32, 0.2);
}

.one-tap-btn:disabled {
  opacity: 0.62;
}

.state-block {
  display: flex;
  align-items: center;
  padding: dp(80) dp(28) 0;
  flex-direction: column;
  text-align: center;
}

.state-icon {
  width: dp(42);
  height: dp(42);
  margin-bottom: dp(12);
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
  line-height: 1.6;
}

.state-btn {
  margin-top: dp(16);
  padding: dp(8) dp(20);
  border-radius: dp(8);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  font-weight: 600;
}
</style>
