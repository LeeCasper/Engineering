<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <text class="nav-title">规划考察路线</text>
    </view>

    <view v-if="loadingProjects" class="state-block">
      <gc-loading text="正在加载项目…" />
    </view>

    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-warning-amber.png" mode="aspectFit" />
      <text class="state-title">无法开始规划</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="load">重新加载</button>
    </view>

    <view v-else class="content">
      <!-- 起点 -->
      <view class="card origin-card">
        <view class="card-head">
          <text class="card-title">出发起点</text>
          <text class="card-hint">GCJ-02</text>
        </view>

        <view class="origin-row" @tap="chooseOrigin">
          <view class="origin-pin">
            <image class="origin-pin-icon" src="/static/images/icon-navigation-accent.png" mode="aspectFit" />
          </view>
          <view class="origin-main">
            <text class="origin-name">{{ origin ? origin.name : '尚未设置起点' }}</text>
            <text class="origin-sub">
              {{ origin ? `${Number(origin.latitude).toFixed(5)}, ${Number(origin.longitude).toFixed(5)}` : '使用当前位置，或手动选择一个起点' }}
            </text>
          </view>
          <image class="origin-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
        </view>

        <view class="origin-actions">
          <button class="origin-btn" @tap.stop="locateCurrent">
            <image class="origin-btn-icon" src="/static/images/icon-location-accent.png" mode="aspectFit" />
            <text>{{ locating ? '定位中…' : '使用当前位置' }}</text>
          </button>
          <button class="origin-btn" @tap.stop="chooseOrigin">
            <image class="origin-btn-icon" src="/static/images/icon-map-sky.png" mode="aspectFit" />
            <text>选择起点</text>
          </button>
        </view>
      </view>

      <!-- 选择工地 -->
      <view v-if="!result" class="card select-card">
        <view class="card-head">
          <view>
            <text class="card-title">选择工地</text>
            <text class="card-hint">按名称或地址搜索</text>
          </view>
          <text class="selected-count" :class="{ 'selected-count--full': selectedIds.length >= maxPoints }">
            {{ selectedIds.length }}/{{ maxPoints }}
          </text>
        </view>

        <view class="search-row">
          <image class="search-icon" src="/static/images/icon-search.png" mode="aspectFit" />
          <input
            v-model="keyword"
            class="search-input"
            placeholder="搜索项目名称或地址"
            placeholder-class="search-placeholder"
            confirm-type="search"
          />
          <view v-if="keyword" class="search-clear" @tap="keyword = ''">×</view>
        </view>

        <view v-if="routableProjects.length === 0" class="project-empty">
          <text class="project-empty-title">暂无可规划的工地</text>
          <text class="project-empty-text">只有你是工长或监理的项目才能加入考察路线。</text>
        </view>

        <view v-else-if="visibleProjects.length === 0" class="project-empty">
          <text class="project-empty-title">没有匹配的工地</text>
          <text class="project-empty-text">换一个名称或地址关键字试试。</text>
        </view>

        <view v-else class="project-list">
          <view
            v-for="project in visibleProjects"
            :key="project.id"
            class="project-row"
            :class="{
              'project-row--selected': selectedIds.includes(project.id),
              'project-row--disabled': !project.hasCoordinates,
            }"
            @tap="toggleProject(project)"
          >
            <view class="project-check" :class="{ 'project-check--on': selectedIds.includes(project.id) }">
              <text v-if="selectedIds.includes(project.id)" class="project-check-mark">✓</text>
            </view>
            <view class="project-main">
              <view class="project-title-row">
                <text class="project-name">{{ project.name }}</text>
                <text class="project-role">{{ project.myRoleLabel }}</text>
              </view>
              <text class="project-address">{{ project.address || '未填写地址' }}</text>
              <text v-if="!project.hasCoordinates" class="project-warning">
                未设置坐标，请联系管理员补全地址后再规划
              </text>
            </view>
          </view>
        </view>

        <text v-if="routableProjects.length > 0" class="select-tip">
          一次最多选择 {{ maxPoints }} 个工地。未设置坐标的项目不能加入路线。
        </text>
      </view>

      <!-- 路线结果 -->
      <template v-else>
        <view class="card summary-card">
          <view class="summary-head">
            <view>
              <text class="summary-eyebrow">{{ result.degraded ? '简化模式' : '推荐路线' }}</text>
              <text class="summary-title">{{ result.points.length }} 个工地，按顺序出发</text>
            </view>
            <view class="summary-badge">{{ result.points.length }} 站</view>
          </view>

          <view class="metric-row">
            <view class="metric-item">
              <text class="metric-value">{{ formatDistance(result.totalDistance) }}</text>
              <text class="metric-label">总里程</text>
            </view>
            <view class="metric-divider" />
            <view class="metric-item">
              <text class="metric-value">{{ formatDuration(result.totalDuration) }}</text>
              <text class="metric-label">预计耗时</text>
            </view>
            <view class="metric-divider" />
            <view class="metric-item">
              <text class="metric-value">{{ originType === 'custom' ? '自定义' : '当前' }}</text>
              <text class="metric-label">起点</text>
            </view>
          </view>

          <view v-if="result.degraded" class="degraded-banner">
            <text class="degraded-title">地图路线服务暂不可用</text>
            <text class="degraded-text">{{ result.degradedReason || '已改为按选择顺序逐点导航' }}</text>
          </view>
        </view>

        <!-- 地图 -->
        <view class="map-card">
          <map
            v-if="canUseNativeMap"
            class="route-map"
            :latitude="mapCenter.latitude"
            :longitude="mapCenter.longitude"
            :markers="mapMarkers"
            :polyline="mapPolyline"
            :include-points="mapPoints"
            :scale="12"
            :show-location="true"
            :enable-zoom="true"
            :enable-scroll="true"
          />
          <view v-else class="map-fallback">
            <image class="map-fallback-icon" src="/static/images/icon-map-sky.png" mode="aspectFit" />
            <text class="map-fallback-title">路线已生成</text>
            <text class="map-fallback-text">请在微信小程序中查看地图折线，当前按列表顺序逐段导航。</text>
          </view>
          <view class="map-caption">
            <text>地图仅供路线参考，实际路况以导航为准</text>
            <text v-if="result.cached" class="map-cached">已命中 5 分钟缓存</text>
          </view>
        </view>

        <!-- 顺序列表 -->
        <view class="card route-list-card">
          <view class="card-head">
            <view>
              <text class="card-title">访问顺序</text>
              <text class="card-hint">可上下调整，调整后自动重算</text>
            </view>
            <text v-if="recalculating" class="recalc-text">重算中…</text>
          </view>

          <view class="route-list">
            <view v-for="(point, index) in result.points" :key="point.projectId" class="route-point">
              <view class="route-rail">
                <view class="route-dot">{{ index + 1 }}</view>
                <view v-if="index < result.points.length - 1" class="route-line" />
              </view>

              <view class="route-main">
                <view class="route-title-row">
                  <text class="route-name">{{ point.name }}</text>
                  <text v-if="index === 0" class="route-first">第一站</text>
                </view>
                <text class="route-address">{{ point.address || '未填写地址' }}</text>
                <text class="route-leg">{{ legLabel(point, index) }}</text>
              </view>

              <view class="route-actions">
                <view
                  class="reorder-btn"
                  :class="{ 'reorder-btn--disabled': index === 0 || recalculating }"
                  @tap.stop="movePoint(index, -1)"
                >↑</view>
                <view
                  class="reorder-btn"
                  :class="{ 'reorder-btn--disabled': index === result.points.length - 1 || recalculating }"
                  @tap.stop="movePoint(index, 1)"
                >↓</view>
                <button class="nav-btn" @tap.stop="navigatePoint(point)">导航</button>
              </view>
            </view>
          </view>
        </view>

        <view class="route-actions-bar">
          <button class="secondary-btn" @tap="backToSelection">重新选择</button>
          <button class="secondary-btn" :disabled="saving" @tap="openSaveSheet">
            {{ saving ? '保存中…' : '保存计划' }}
          </button>
          <button
            class="primary-btn"
            :disabled="navigating || recalculating || generating"
            @tap="oneTapNavigate"
          >
            {{ navigating ? '规划中…' : '一键导航' }}
          </button>
        </view>
      </template>
    </view>

    <view v-if="!result && !loadingProjects && !loadError" class="bottom-bar bottom-bar--split">
      <button class="generate-btn generate-btn--secondary" :disabled="generating || navigating" @tap="generateRoute">
        <text>{{ generating ? '正在规划…' : '查看推荐路线' }}</text>
      </button>
      <button class="generate-btn" :disabled="generating || navigating" @tap="oneTapNavigate">
        <text>{{ navigating ? '正在规划…' : '一键导航' }}</text>
      </button>
    </view>

    <!-- 保存命名面板 -->
    <view v-if="saveSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeSaveSheet">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">保存考察计划</text>
            <text class="sheet-sub">下次可以直接复用这条路线</text>
          </view>
          <view class="sheet-close" @tap="closeSaveSheet">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="name-field">
          <input
            v-model="planName"
            class="name-input"
            maxlength="50"
            placeholder="例如：周二上午 · 三个工地"
            placeholder-class="name-placeholder"
            :focus="saveSheetOpen"
          />
          <text class="name-count">{{ planName.length }}/50</text>
        </view>

        <view class="sheet-actions">
          <button class="sheet-cancel" @tap="closeSaveSheet">取消</button>
          <button class="sheet-save" :disabled="saving" @tap="confirmSave">
            {{ saving ? '保存中…' : '保存计划' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import { getCurrentProject } from '../../store/projectContext'
import { myProjects } from '../../api/project'
import {
  fetchRoutePlan,
  fetchRoutePlans,
  previewRoutePlan,
  saveRoutePlan,
} from '../../api/routePlan'
import { useSwipeClose } from '../../composables/useSwipeClose'

// 底部弹窗下滑关闭：绑定把手 / 标题区，不干扰表单滚动
const sheetSwipe = useSwipeClose(() => closeActiveSheet())
const sheetSwipeStyle = sheetSwipe.style

defineOptions({ name: 'RoutePlanCreatePage' })

const safeTop = ref(0)
const loadingProjects = ref(true)
const loadError = ref('')
const projects = ref([])
const keyword = ref('')
const selectedIds = ref([])
const maxPoints = ref(10)
const origin = ref(null)
const originType = ref('current')
const locating = ref(false)
const generating = ref(false)
const recalculating = ref(false)
const navigating = ref(false)
const result = ref(null)
const navSession = ref(null)
// openLocation 会离开小程序；返回时 onShow 才知道这次返回是「导航回来」
let awaitingNavigationReturn = false
const saving = ref(false)
const saveSheetOpen = ref(false)
const planName = ref('')
const replanId = ref(null)
const canUseNativeMap = ref(false)

const PLAN_ROLES = new Set(['foreman', 'supervisor'])

// uni-app 的 H5 地图组件需要额外的地图 Key；本系统不把地图 Key 下发前端，
// 因此 H5 只展示列表与说明，微信小程序里使用原生 map 组件。
// #ifdef MP-WEIXIN
canUseNativeMap.value = true
// #endif

const routableProjects = computed(() =>
  projects.value.filter(
    (project) => PLAN_ROLES.has(project.myRole) && project.status !== 'archived'
  )
)

const visibleProjects = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return routableProjects.value
  return routableProjects.value.filter((project) =>
    `${project.name || ''} ${project.address || ''}`.toLowerCase().includes(needle)
  )
})

const mapCenter = computed(() => {
  if (result.value && result.value.origin) {
    return {
      latitude: Number(result.value.origin.latitude),
      longitude: Number(result.value.origin.longitude),
    }
  }
  if (origin.value) {
    return { latitude: Number(origin.value.latitude), longitude: Number(origin.value.longitude) }
  }
  return { latitude: 31.2304, longitude: 121.4737 }
})

const mapPoints = computed(() => {
  if (!result.value) return []
  const points = []
  if (result.value.origin) {
    points.push({
      latitude: Number(result.value.origin.latitude),
      longitude: Number(result.value.origin.longitude),
    })
  }
  for (const point of result.value.points) {
    points.push({
      latitude: Number(point.currentLatitude ?? point.latitude),
      longitude: Number(point.currentLongitude ?? point.longitude),
    })
  }
  return points
})

const mapMarkers = computed(() => {
  if (!result.value) return []
  const markers = []

  if (result.value.origin) {
    markers.push({
      id: 0,
      latitude: Number(result.value.origin.latitude),
      longitude: Number(result.value.origin.longitude),
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

  result.value.points.forEach((point, index) => {
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
  if (!result.value || !Array.isArray(result.value.polyline) || result.value.polyline.length < 2) {
    return []
  }
  return [
    {
      points: result.value.polyline.map((point) => ({
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

  replanId.value = options && options.replanId ? Number(options.replanId) : null
  load()
})

/**
 * 从系统地图返回后继续下一站。
 *
 * `uni.openLocation` 一次只能导航到一个目的地，且微信不允许小程序内
 * 接力调用地图。能做的是：用户从地图返回小程序时提示是否继续下一站，
 * 把「一键导航」的路线真正走完，而不是只送到第一站。
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

async function load() {
  loadingProjects.value = true
  loadError.value = ''

  try {
    const data = await myProjects()
    const items = ((data && data.groups) || []).flatMap((group) => group.items || [])
    projects.value = items

    const current = getCurrentProject()
    try {
      const config = await fetchRoutePlans({
        page: 1,
        pageSize: 1,
        tenantId: current ? current.tenantId : undefined,
      })
      if (config && config.maxPoints) maxPoints.value = Number(config.maxPoints)
    } catch {
      // 配置读取失败不阻断规划；后端仍会按真实上限校验
    }

    if (routableProjects.value.length === 0) {
      loadError.value = '只有你是工长或监理的项目才能规划考察路线。'
      return
    }

    if (replanId.value) await prefillFromPlan(replanId.value)
  } catch (err) {
    if (err.statusCode === 401) {
      uni.reLaunch({ url: '/pages/login/index' })
      return
    }
    loadError.value = err.message || '项目加载失败'
  } finally {
    loadingProjects.value = false
  }
}

async function prefillFromPlan(planId) {
  try {
    const plan = await fetchRoutePlan(planId)
    if (!plan || !plan.origin) return

    origin.value = {
      latitude: Number(plan.origin.latitude),
      longitude: Number(plan.origin.longitude),
      name: plan.origin.name || (plan.origin.type === 'custom' ? '自定义起点' : '当前位置'),
    }
    originType.value = plan.origin.type === 'custom' ? 'custom' : 'current'

    const available = new Set(routableProjects.value.map((project) => project.id))
    const ids = (plan.points || [])
      .map((point) => Number(point.projectId))
      .filter((id) => available.has(id))
    selectedIds.value = ids
    planName.value = `${plan.name}（重新规划）`.slice(0, 50)

    if (ids.length < (plan.points || []).length) {
      uni.showToast({ title: '部分工地已不可用，已自动移除', icon: 'none' })
    }
  } catch (err) {
    uni.showToast({ title: err.message || '原计划加载失败', icon: 'none' })
  }
}

function toggleProject(project) {
  if (!project.hasCoordinates) {
    uni.showToast({ title: '该项目尚未设置坐标，请联系管理员补全', icon: 'none' })
    return
  }

  const index = selectedIds.value.indexOf(project.id)
  if (index >= 0) {
    selectedIds.value.splice(index, 1)
    result.value = null
    return
  }

  if (selectedIds.value.length >= maxPoints.value) {
    // AC-N04：达到上限时在勾选阶段就阻止，而不是提交后再报错
    uni.showToast({ title: `一次最多选择 ${maxPoints.value} 个工地`, icon: 'none' })
    return
  }

  selectedIds.value.push(project.id)
  result.value = null
}

function locateCurrent() {
  if (locating.value) return Promise.resolve(false)
  locating.value = true

  return new Promise((resolve) => {
    uni.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 4000,
      success(res) {
        origin.value = {
          latitude: Number(res.latitude),
          longitude: Number(res.longitude),
          name: '当前位置',
        }
        originType.value = 'current'
        result.value = null
        resolve(true)
      },
      fail(err) {
        showLocationHelp(err)
        resolve(false)
      },
      complete() {
        locating.value = false
      },
    })
  })
}

function chooseOrigin() {
  if (typeof uni.chooseLocation !== 'function') {
    uni.showToast({ title: '当前环境不支持地图选点，请使用当前位置', icon: 'none' })
    return
  }

  uni.chooseLocation({
    success(res) {
      if (!Number.isFinite(Number(res.latitude)) || !Number.isFinite(Number(res.longitude))) {
        uni.showToast({ title: '没有取到有效坐标，请重试', icon: 'none' })
        return
      }
      origin.value = {
        latitude: Number(res.latitude),
        longitude: Number(res.longitude),
        name: res.name || res.address || '自定义起点',
      }
      originType.value = 'custom'
      result.value = null
    },
    fail(err) {
      // 用户主动取消不需要弹提示
      if (String((err && err.errMsg) || '').includes('cancel')) return
      showLocationHelp(err)
    },
  })
}

function showLocationHelp(err) {
  const detail = String((err && err.errMsg) || '')
  if (detail.includes('cancel')) return

  uni.showModal({
    title: '无法获取位置',
    content: '请在微信设置中允许小程序获取位置信息，或使用「选择起点」手动指定出发地。',
    confirmText: '去设置',
    cancelText: '知道了',
    success(res) {
      if (res.confirm && typeof uni.openSetting === 'function') {
        uni.openSetting({ fail: () => {} })
      }
    },
  })
}

/**
 * 一键导航：先让后端按最近路线重新排序，再直接打开第一站。
 *
 * 即使页面上已经有推荐结果，也重新调用一次 preview —— 用户可能刚手动
 * 调整过顺序，或项目坐标在后台发生了变化。这里以「最近路线」为准。
 */
async function oneTapNavigate() {
  if (navigating.value || generating.value || recalculating.value) return

  if (selectedIds.value.length === 0) {
    uni.showToast({ title: '请至少选择一个工地', icon: 'none' })
    return
  }
  if (selectedIds.value.length > maxPoints.value) {
    uni.showToast({ title: `一次最多选择 ${maxPoints.value} 个工地`, icon: 'none' })
    return
  }

  const ready = origin.value ? true : await locateCurrent()
  if (!ready || !origin.value) return

  navigating.value = true
  try {
    const data = await previewRoutePlan({
      origin: origin.value,
      projectIds: selectedIds.value,
      optimize: true,
    })

    result.value = data
    selectedIds.value = data.points.map((point) => point.projectId)
    uni.pageScrollTo({ scrollTop: 0, duration: 200 })

    if (!data.points.length) {
      uni.showToast({ title: '没有可导航的工地', icon: 'none' })
      return
    }

    if (data.degraded) {
      uni.showToast({
        title: '地图服务暂不可用，按选择顺序逐站导航',
        icon: 'none',
        duration: 1500,
      })
    }

    navSession.value = { points: data.points, index: 0 }
    // 给页面一点时间把新顺序渲染出来，再打开系统地图
    setTimeout(openNavigationStop, 260)
  } catch (err) {
    showError(err, '路线规划失败')
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

async function generateRoute() {
  navSession.value = null
  if (generating.value) return

  if (selectedIds.value.length === 0) {
    uni.showToast({ title: '请至少选择一个工地', icon: 'none' })
    return
  }
  if (selectedIds.value.length > maxPoints.value) {
    uni.showToast({ title: `一次最多选择 ${maxPoints.value} 个工地`, icon: 'none' })
    return
  }

  const ready = origin.value ? true : await locateCurrent()
  if (!ready || !origin.value) return

  generating.value = true
  try {
    const data = await previewRoutePlan({
      origin: origin.value,
      projectIds: selectedIds.value,
      optimize: true,
    })
    result.value = data
    selectedIds.value = data.points.map((point) => point.projectId)
    uni.pageScrollTo({ scrollTop: 0, duration: 200 })
  } catch (err) {
    showError(err, '路线规划失败')
  } finally {
    generating.value = false
  }
}

async function movePoint(index, delta) {
  if (!result.value || recalculating.value || generating.value) return
  // 手动调整顺序后，旧的导航会话已经不对应页面上的路线
  navSession.value = null
  const target = index + delta
  if (target < 0 || target >= result.value.points.length) return

  const ids = result.value.points.map((point) => point.projectId)
  const temp = ids[index]
  ids[index] = ids[target]
  ids[target] = temp

  recalculating.value = true
  try {
    const data = await previewRoutePlan({
      origin: origin.value,
      projectIds: ids,
      optimize: false,
    })
    result.value = data
    selectedIds.value = ids
  } catch (err) {
    // 保留旧结果：重算失败时用户仍然可以按现有顺序导航
    showError(err, '重新计算失败')
  } finally {
    recalculating.value = false
  }
}

function backToSelection() {
  navSession.value = null
  result.value = null
  uni.pageScrollTo({ scrollTop: 0, duration: 200 })
}

function openSaveSheet() {
  if (!result.value || saving.value) return
  if (!planName.value.trim()) planName.value = defaultPlanName()
  saveSheetOpen.value = true
}

function closeSaveSheet() {
  if (saving.value) return
  saveSheetOpen.value = false
}

async function confirmSave() {
  if (!result.value || saving.value) return

  const name = planName.value.trim()
  if (!name) {
    uni.showToast({ title: '请填写计划名称', icon: 'none' })
    return
  }
  if (name.length > 50) {
    uni.showToast({ title: '计划名称不超过 50 字', icon: 'none' })
    return
  }

  saving.value = true
  try {
    const plan = await saveRoutePlan({
      name,
      originType: originType.value,
      origin: origin.value,
      projectIds: result.value.points.map((point) => point.projectId),
    })
    saveSheetOpen.value = false
    uni.showToast({ title: '考察计划已保存', icon: 'success' })
    setTimeout(() => {
      uni.redirectTo({ url: `/pages/route-plan/detail?id=${plan.id}` })
    }, 350)
  } catch (err) {
    showError(err, '保存失败')
  } finally {
    saving.value = false
  }
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
    const distance = result.value && result.value.originLegDistance
    const duration = result.value && result.value.originLegDuration
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

function defaultPlanName() {
  const now = new Date()
  return `${now.getMonth() + 1}月${now.getDate()}日考察 · ${result.value.points.length}个工地`
}

function showError(err, fallback) {
  if (err && err.statusCode === 401) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  uni.showToast({ title: (err && err.message) || fallback, icon: 'none' })
}

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.redirectTo({ url: '/pages/route-plan/index' })
}
function closeActiveSheet() {
  if (saveSheetOpen.value) closeSaveSheet()
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding-bottom: calc(#{dp(94)} + env(safe-area-inset-bottom));
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

.card {
  margin-bottom: dp(12);
  padding: dp(14);
  border: 1px solid #f0eae4;
  border-radius: dp(16);
  background: #fff;
  box-shadow: 0 dp(3) dp(12) rgba(0, 0, 0, 0.025);
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: dp(11);
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

.origin-row {
  display: flex;
  align-items: center;
  padding: dp(11);
  border-radius: dp(12);
  background: #faf7f4;
}

.origin-pin {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(36);
  height: dp(36);
  margin-right: dp(10);
  border-radius: 50%;
  background: #fff3e8;
  flex-shrink: 0;
}

.origin-pin-icon {
  width: dp(18);
  height: dp(18);
}

.origin-main {
  min-width: 0;
  flex: 1;
}

.origin-name {
  display: block;
  overflow: hidden;
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.origin-sub {
  display: block;
  margin-top: dp(3);
  color: #9b9087;
  font-size: dp(9);
}

.origin-chevron {
  width: dp(14);
  height: dp(14);
  margin-left: dp(8);
  flex-shrink: 0;
}

.origin-actions {
  display: flex;
  gap: dp(8);
  margin-top: dp(9);
}

.origin-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(34);
  padding: 0 dp(10);
  border: 1px solid #f0e6de;
  border-radius: dp(8);
  background: #fff;
  color: #6d6259;
  font-size: dp(10);
  font-weight: 500;
  flex: 1;
}

.origin-btn:active {
  background: #fff7f2;
}

.origin-btn-icon {
  width: dp(13);
  height: dp(13);
  margin-right: dp(4);
}

.selected-count {
  padding: dp(4) dp(8);
  border-radius: dp(6);
  background: #fff3e8;
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 700;
}

.selected-count--full {
  background: #ffece8;
  color: #b22a26;
}

.search-row {
  display: flex;
  align-items: center;
  height: dp(38);
  padding: 0 dp(10);
  border-radius: dp(9);
  background: #faf7f4;
}

.search-icon {
  width: dp(14);
  height: dp(14);
  margin-right: dp(6);
  opacity: 0.6;
}

.search-input {
  min-width: 0;
  color: #241c17;
  font-size: dp(11);
  flex: 1;
}

.search-placeholder {
  color: #b0a69d;
}

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(18);
  height: dp(18);
  border-radius: 50%;
  background: #e8e1da;
  color: #6d6259;
  font-size: dp(12);
  line-height: 1;
}

.project-list {
  margin-top: dp(7);
}

.project-row {
  display: flex;
  align-items: flex-start;
  padding: dp(10) 0;
  border-bottom: 1px solid #f8f3ee;
}

.project-row:last-child {
  border-bottom: none;
}

.project-row--selected {
  margin: 0 dp(-7);
  padding: dp(10) dp(7);
  border-bottom-color: transparent;
  border-radius: dp(10);
  background: #fff8f3;
}

.project-row--disabled {
  opacity: 0.55;
}

.project-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(19);
  height: dp(19);
  margin-top: dp(1);
  border: 1.5px solid #d9d0c8;
  border-radius: 50%;
  background: #fff;
  flex-shrink: 0;
}

.project-check--on {
  border-color: #eb5c20;
  background: #eb5c20;
}

.project-check-mark {
  color: #fff;
  font-size: dp(11);
  font-weight: 700;
  line-height: 1;
}

.project-main {
  min-width: 0;
  margin-left: dp(9);
  flex: 1;
}

.project-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.project-name {
  overflow: hidden;
  color: #241c17;
  font-size: dp(12);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-role {
  padding: dp(1) dp(5);
  border-radius: dp(4);
  background: #f3efea;
  color: #8b8179;
  font-size: dp(8);
  flex-shrink: 0;
}

.project-address {
  display: block;
  overflow: hidden;
  margin-top: dp(3);
  color: #9b9087;
  font-size: dp(9);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-warning {
  display: block;
  margin-top: dp(4);
  color: #a85400;
  font-size: dp(9);
}

.project-empty {
  padding: dp(22) dp(10);
  text-align: center;
}

.project-empty-title {
  display: block;
  color: #51463e;
  font-size: dp(12);
  font-weight: 600;
}

.project-empty-text {
  display: block;
  margin-top: dp(4);
  color: #9b9087;
  font-size: dp(10);
}

.select-tip {
  display: block;
  margin-top: dp(9);
  color: #a79d94;
  font-size: dp(9);
  line-height: 1.5;
}

.summary-card {
  padding: dp(16);
  background: linear-gradient(150deg, #fff 0%, #fff8f3 100%);
}

.summary-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.summary-eyebrow {
  display: block;
  color: #eb5c20;
  font-size: dp(9);
  font-weight: 700;
  letter-spacing: dp(0.8);
}

.summary-title {
  display: block;
  margin-top: dp(5);
  color: #241c17;
  font-size: dp(16);
  font-weight: 700;
}

.summary-badge {
  padding: dp(4) dp(8);
  border-radius: dp(6);
  background: #fff3e8;
  color: #c44710;
  font-size: dp(10);
  font-weight: 700;
}

.metric-row {
  display: flex;
  align-items: center;
  margin-top: dp(15);
  padding-top: dp(13);
  border-top: 1px dashed #f0e2d7;
}

.metric-item {
  flex: 1;
  text-align: center;
}

.metric-value {
  display: block;
  color: #241c17;
  font-size: dp(15);
  font-weight: 700;
}

.metric-label {
  display: block;
  margin-top: dp(3);
  color: #9b9087;
  font-size: dp(9);
}

.metric-divider {
  width: 1px;
  height: dp(24);
  background: #f0e6de;
}

.degraded-banner {
  margin-top: dp(13);
  padding: dp(10) dp(11);
  border: 1px solid #ffe1bf;
  border-radius: dp(9);
  background: #fff7e8;
}

.degraded-title {
  display: block;
  color: #a85400;
  font-size: dp(10);
  font-weight: 700;
}

.degraded-text {
  display: block;
  margin-top: dp(3);
  color: #a85400;
  font-size: dp(9);
  line-height: 1.5;
}

.map-card {
  overflow: hidden;
  margin-bottom: dp(12);
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
  height: dp(190);
  padding: dp(20);
  background: linear-gradient(145deg, #f5eee7 0%, #fff7f2 100%);
  flex-direction: column;
  text-align: center;
}

.map-fallback-icon {
  width: dp(40);
  height: dp(40);
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(8) dp(12);
  color: #a79d94;
  font-size: dp(8);
}

.map-cached {
  color: #00a35c;
}

.route-list-card {
  padding-bottom: dp(4);
}

.route-list {
  margin-top: dp(2);
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
  padding: dp(0) dp(8) dp(13) dp(4);
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

.route-actions {
  display: flex;
  align-items: center;
  gap: dp(4);
  padding-bottom: dp(13);
  flex-shrink: 0;
}

.reorder-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(24);
  height: dp(24);
  border: 1px solid #eee4dc;
  border-radius: dp(6);
  background: #faf7f4;
  color: #6d6259;
  font-size: dp(11);
  line-height: 1;
}

.reorder-btn--disabled {
  opacity: 0.28;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(24);
  padding: 0 dp(9);
  border-radius: dp(6);
  background: #eb5c20;
  color: #fff;
  font-size: dp(9);
  font-weight: 500;
  line-height: 1;
}

.recalc-text {
  color: #eb5c20;
  font-size: dp(9);
}

.route-actions-bar {
  display: flex;
  gap: dp(9);
  margin-top: dp(2);
}

.secondary-btn,
.primary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(44);
  border-radius: dp(10);
  font-size: dp(13);
  font-weight: 600;
}

.secondary-btn {
  width: 27%;
  border: 1px solid #e8ddd4;
  background: #fff;
  color: #51463e;
}

.primary-btn {
  background: #eb5c20;
  color: #fff;
  flex: 1;
  box-shadow: 0 dp(6) dp(14) rgba(235, 92, 32, 0.2);
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

.bottom-bar--split {
  display: flex;
  gap: dp(9);
}

.bottom-bar--split .generate-btn {
  flex: 1;
  min-width: 0;
}

.generate-btn {
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

.generate-btn--secondary {
  background: #fff;
  border: 1px solid #e8ddd4;
  color: #51463e;
  box-shadow: none;
}

.generate-btn:disabled,
.primary-btn:disabled,
.sheet-save:disabled {
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

/* ── 保存面板 ── */
.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  background: rgba(36, 28, 23, 0.4);
}

.sheet {
  width: 100%;
  padding: dp(8) dp(16) calc(#{dp(16)} + env(safe-area-inset-bottom));
  border-radius: dp(20) dp(20) 0 0;
  background: #fff;
}

.sheet-handle {
  width: dp(34);
  height: dp(4);
  margin: 0 auto dp(14);
  border-radius: dp(2);
  background: #e5ddd5;
}

.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.sheet-title {
  display: block;
  color: #241c17;
  font-size: dp(16);
  font-weight: 700;
}

.sheet-sub {
  display: block;
  margin-top: dp(3);
  color: #9b9087;
  font-size: dp(10);
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(26);
  height: dp(26);
  border-radius: 50%;
  background: #f5f0eb;
}

.sheet-close-icon {
  width: dp(13);
  height: dp(13);
}

.name-field {
  position: relative;
  margin-top: dp(16);
}

.name-input {
  height: dp(46);
  padding: 0 dp(42) 0 dp(12);
  border: 1px solid #eee4dc;
  border-radius: dp(10);
  background: #faf7f4;
  color: #241c17;
  font-size: dp(12);
}

.name-placeholder {
  color: #b0a69d;
}

.name-count {
  position: absolute;
  top: dp(16);
  right: dp(11);
  color: #b0a69d;
  font-size: dp(9);
}

.sheet-actions {
  display: flex;
  gap: dp(9);
  margin-top: dp(14);
}

.sheet-cancel,
.sheet-save {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(44);
  border-radius: dp(10);
  font-size: dp(13);
  font-weight: 600;
}

.sheet-cancel {
  width: 36%;
  border: 1px solid #e8ddd4;
  background: #fff;
  color: #51463e;
}

.sheet-save {
  background: #eb5c20;
  color: #fff;
  flex: 1;
}
</style>
