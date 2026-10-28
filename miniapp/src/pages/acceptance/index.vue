<template>
  <view class="page">
    <!-- 浅橙渐变 + 暖色建筑蓝图背景 -->
    <view class="hero" :style="{ paddingTop: `${safeTop + 10}px` }">
      <image class="hero-art" src="/static/images/acceptance-header.jpg" mode="aspectFill" />
      <view class="hero-fade-left" />
      <view class="hero-fade-bottom" />

      <view class="hero-content">
        <view class="hero-title-row">
          <view class="shield-tile">
            <image class="shield-icon" src="/static/images/icon-shield-white.png" mode="aspectFit" />
          </view>
          <view class="hero-text">
            <text class="hero-title">验收</text>
            <text class="hero-sub">多项目管理，随时掌握验收进度</text>
          </view>
        </view>

      </view>
    </view>

    <!-- 搜索 + 分类：与项目页一致的吸顶搜索栏 -->
    <view
      class="search-wrap"
      :class="{ 'search-wrap--stuck': searchStuck }"
      :style="{ top: `${safeTop}px` }"
    >
      <view class="search-row">
        <view class="search-bar">
          <image class="search-icon" src="/static/images/icon-search.png" mode="aspectFit" />
          <input
            v-model="query"
            class="search-input"
            type="text"
            confirm-type="search"
            placeholder="搜索项目 / 阶段 / 主工长"
            placeholder-class="search-placeholder"
          />
          <view v-if="query" class="search-clear" @tap="query = ''">
            <image class="search-clear-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="search-filter" @tap="openFilterSheet">
          <image
            class="search-filter-icon"
            src="/static/images/icon-filter-accent.png"
            mode="aspectFit"
          />
          <text class="search-filter-label">筛选</text>
          <view v-if="projectFilter !== null" class="filter-active-dot" />
        </view>
      </view>

      <!-- 四个分类：全部项目 / 待我处理 / 进行中 / 已完成 -->
      <view class="tabs">
        <view
          v-for="tab in TABS"
          :key="tab.key"
          class="tab"
          :class="{ 'tab--active': activeTab === tab.key }"
          @tap="activeTab = tab.key"
        >
          <text class="tab-label">{{ tab.label }}</text>
          <text
            v-if="tab.key !== 'all' && tabCount(tab.key) > 0"
            class="tab-badge"
            :class="`tab-badge--${tab.key}`"
          >
            {{ tabCount(tab.key) }}
          </text>
          <view v-if="activeTab === tab.key" class="tab-underline" />
        </view>
      </view>
    </view>
    <view v-if="searchStuck" class="sticky-status-bg" :style="{ height: `${safeTop}px` }" />

    <!-- 首屏加载：只在第一次进入且还没有数据时显示 -->
    <view v-if="loading && !loaded && !items.length" class="gc-loading-page">
      <gc-skeleton :rows="3" />
    </view>

    <!-- 加载失败 -->
    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
      <text class="state-title">加载失败</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="load">重新加载</button>
    </view>

    <!-- 空态 -->
    <view v-else-if="!visibleItems.length" class="state-block">
      <image class="state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
      <text class="state-title">{{ emptyTitle }}</text>
      <text class="state-text">{{ emptyText }}</text>
      <button v-if="activeTab !== 'all' && tabCount('all') > 0" class="state-btn" @tap="activeTab = 'all'">
        查看全部项目
      </button>
      <button v-else class="state-btn" @tap="load">刷新</button>
    </view>

    <!-- 验收卡片 -->
    <view v-else class="card-list gc-stagger">
      <view
        v-for="item in visibleItems"
        :key="itemKey(item)"
        class="card"
        @tap="onCardTap(item)"
      >
        <view class="card-top">
          <image class="cover" :src="coverFor(item.projectId)" mode="aspectFill" />

          <view class="card-info">
            <view class="title-row">
              <view class="title-wrap">
                <text class="card-title">{{ titleFor(item) }}</text>
                <text class="status-badge" :class="statusClass(item)">{{ statusText(item) }}</text>
                <text v-if="item.canInitiate" class="status-badge status-badge--muted">未发起</text>
              </view>
              <image class="chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>

            <view class="meta-row">
              <image class="meta-icon" src="/static/images/icon-location.png" mode="aspectFit" />
              <text class="meta-text">{{ item.projectAddress }}</text>
            </view>

            <view class="meta-row">
              <image class="meta-icon" src="/static/images/icon-people.png" mode="aspectFit" />
              <text class="meta-text">主工长：{{ item.foremanName }}</text>
            </view>

            <view class="meta-row">
              <image class="meta-icon" src="/static/images/icon-clock.png" mode="aspectFit" />
              <text v-if="item.waitingHours !== null" class="meta-text">
                第 {{ item.round }} 轮 · 已等待
                <text :class="{ 'waiting-danger': item.waitingHours >= 48 }">
                  {{ item.waitingHours }} 小时
                </text>
              </text>
              <text v-else-if="item.canInitiate" class="meta-text">
                进度 {{ percent(item.stageProgress) }}% · 尚无验收单
              </text>
              <text v-else-if="item.status === 'passed'" class="meta-text">
                第 {{ item.round }} 轮 · 已完成
              </text>
              <text v-else class="meta-text">第 {{ item.round }} 轮 · 草稿未提交</text>
            </view>
          </view>
        </view>

        <view class="progress-row">
          <text class="progress-label">进度 {{ percent(item.stageProgress) }}%</text>
          <view class="progress-track">
            <view class="progress-fill" :style="{ width: `${percent(item.stageProgress)}%` }" />
          </view>
        </view>

        <view class="card-foot">
          <view class="stage-link" @tap.stop="openStageSheet(item)">
            <image class="stage-link-icon" src="/static/images/icon-document.png" mode="aspectFit" />
            <text class="stage-link-text">查看阶段</text>
            <image class="stage-link-arrow" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>

          <button
            v-if="item.canInitiate"
            class="action-btn"
            @tap.stop="openCreateSheet(item)"
          >
            发起验收
          </button>
          <button
            v-else-if="item.status === 'passed' || item.projectStatus === 'archived'"
            class="action-btn action-btn--ghost"
            @tap.stop="openDetail(item)"
          >
            查看
          </button>
          <button v-else class="action-btn" @tap.stop="openDetail(item)">去处理</button>
        </view>
      </view>
    </view>

    <!-- 项目筛选面板：项目名只出现在这里，不进入主分类行 -->
    <view v-if="filterSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeFilterSheet">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-header" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <text class="sheet-title">筛选项目</text>
          <view class="sheet-close" @tap="closeFilterSheet">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="sheet-options">
          <view
            class="sheet-option"
            :class="{ 'sheet-option--active': draftProject === null }"
            @tap="draftProject = null"
          >
            全部项目
          </view>
          <view
            v-for="project in projects"
            :key="project.id"
            class="sheet-option"
            :class="{ 'sheet-option--active': draftProject === project.id }"
            @tap="draftProject = project.id"
          >
            {{ project.name }}
            <text v-if="project.todo" class="sheet-option-count">{{ project.todo }}</text>
          </view>
        </view>

        <view class="sheet-actions">
          <button class="sheet-reset" @tap="resetFilterSheet">重置</button>
          <button class="sheet-apply" @tap="applyFilterSheet">应用</button>
        </view>
      </view>
    </view>

    <!-- 阶段梯子 -->
    <view v-if="stageSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeStageSheet">
      <view class="sheet sheet--stage" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-header" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">{{ stageProject.name }}</text>
            <text class="sheet-subtitle">阶段推进</text>
          </view>
          <view class="sheet-close" @tap="closeStageSheet">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="stageLoading" class="stage-loading">
          <text class="state-text">加载阶段…</text>
        </view>
        <view v-else-if="stageError" class="stage-loading">
          <text class="state-text">{{ stageError }}</text>
          <button class="state-btn" @tap="loadStages">重试</button>
        </view>
        <view v-else class="stage-list">
          <view
            v-for="(stage, index) in stageRows"
            :key="stage.id"
            class="stage-row"
            :class="{ 'stage-row--actionable': stageActionable(stage) }"
            @tap="onStageTap(stage)"
          >
            <view class="stage-seq" :class="stageSeqClass(stage)">
              {{ stage.gateStatus === 'settled' || stage.gateStatus === 'accepted' ? '✓' : index + 1 }}
            </view>
            <view class="stage-main">
              <view class="stage-title-line">
                <text class="stage-name">{{ stage.name }}</text>
                <text class="stage-state" :class="stageStateClass(stage)">{{ stageStateLabel(stage) }}</text>
              </view>
              <text v-if="stage.gateStatus === 'locked'" class="stage-note">
                上一阶段「{{ previousStageName(index) }}」未结清
              </text>
              <text v-else class="stage-note">进度 {{ percent(stage.progress) }}%</text>
            </view>
            <text v-if="stageActionable(stage)" class="stage-arrow">›</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 发起验收 -->
    <view v-if="createSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeCreateSheet">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-header" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <text class="sheet-title">发起验收</text>
          <view class="sheet-close" @tap="closeCreateSheet">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <text class="create-stage">{{ createTarget.projectName }} · {{ createTarget.stageName }}</text>
        <text class="create-hint">提交后由监理审核，业主确认并签名。</text>

        <textarea
          v-model="createDescription"
          class="create-textarea"
          maxlength="1000"
          placeholder="补充验收说明（选填）"
          placeholder-class="create-placeholder"
        />

        <view class="create-photo-row">
          <view v-if="createPhoto" class="create-photo-wrap">
            <image class="create-photo" :src="createPhoto" mode="aspectFill" />
            <view class="create-photo-remove" @tap="createPhoto = ''">×</view>
          </view>
          <view v-else class="create-photo-add" @tap="chooseCreatePhoto">
            <text class="create-photo-plus">＋</text>
            <text class="create-photo-label">现场照片</text>
          </view>
        </view>

        <view class="sheet-actions">
          <button class="sheet-reset" @tap="closeCreateSheet">取消</button>
          <button class="sheet-apply" :disabled="creating" @tap="submitCreate">
            {{ creating ? '提交中…' : '发起验收' }}
          </button>
        </view>
      </view>
    </view>
    <!-- #ifdef H5 -->
    <ClientTabBar active="acceptance" />
    <!-- #endif -->
  </view>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { onLoad, onShow, onPageScroll, onPullDownRefresh } from '@dcloudio/uni-app'
// #ifdef H5
import ClientTabBar from '../../components/ClientTabBar.vue'
// #endif
import { syncCustomTabBar } from '../../utils/tabBar'
import {
  createAcceptance,
  fetchAcceptanceInbox,
  fetchProjectStages
} from '../../api/acceptance'
import { getToken } from '../../store/session'
import { setCurrentProject } from '../../store/projectContext'
import { useSwipeClose } from '../../composables/useSwipeClose'

// 底部弹窗下滑关闭：绑定把手 / 标题区，不干扰表单滚动
const sheetSwipe = useSwipeClose(() => closeActiveSheet())
const sheetSwipeStyle = sheetSwipe.style

const TABS = [
  { key: 'all', label: '全部项目' },
  { key: 'todo', label: '待我处理' },
  { key: 'inProgress', label: '进行中' },
  { key: 'done', label: '已完成' },
]

const loading = ref(false)
// 是否至少成功加载过一次。tab 页切回来时 onShow 会静默刷新，
// 只有首次加载才显示「加载中…」，否则空列表也会闪一下加载态。
const loaded = ref(false)
const loadError = ref('')
const items = ref([])
const projects = ref([])
const safeTop = ref(12)
const activeTab = ref('todo')
const query = ref('')
const searchStuck = ref(false)
const searchStickyThreshold = ref(0)
const pageScrollTop = ref(0)

const filterSheetOpen = ref(false)
const projectFilter = ref(null)
const draftProject = ref(null)

const stageSheetOpen = ref(false)
const stageLoading = ref(false)
const stageError = ref('')
const stageRows = ref([])
const stageData = ref(null)
const stageProject = ref({ id: null, name: '', tenantId: null, tenantName: null })

const createSheetOpen = ref(false)
const createTarget = ref({
  projectId: null,
  tenantId: null,
  tenantName: null,
  projectName: '',
  stageId: null,
  stageName: '',
})
const createDescription = ref('')
const createPhoto = ref('')
const creating = ref(false)

const searchedItems = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return items.value

  return items.value.filter((item) => {
    const haystack = [
      item.projectName,
      item.projectAddress,
      item.stageName,
      item.itemName,
      item.foremanName,
      item.statusLabel,
      item.canInitiate ? '未发起' : '',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(keyword)
  })
})

const projectScopedItems = computed(() => {
  if (projectFilter.value === null) return searchedItems.value
  return searchedItems.value.filter((item) => item.projectId === projectFilter.value)
})

const visibleItems = computed(() => {
  const list = projectScopedItems.value

  if (activeTab.value === 'todo') {
    return list.filter((item) => item.canInitiate || item.isMine)
  }
  if (activeTab.value === 'inProgress') {
    return list.filter(
      (item) => !item.canInitiate && !item.isMine && item.status !== 'passed'
    )
  }
  if (activeTab.value === 'done') {
    return list.filter((item) => item.status === 'passed')
  }
  return list
})

const emptyTitle = computed(() => {
  if (query.value.trim()) return '未找到相关验收'
  if (!items.value.length) return '暂无验收事项'
  if (activeTab.value === 'todo') return '暂无待我处理的验收'
  if (activeTab.value === 'inProgress') return '暂无进行中的验收'
  if (activeTab.value === 'done') return '暂无已完成的验收'
  return '暂无相关验收'
})

const emptyText = computed(() => {
  if (query.value.trim()) {
    return `没有找到与“${query.value.trim()}”匹配的验收事项，试试清除搜索或筛选条件。`
  }
  if (!items.value.length) {
    return '项目进入待验收阶段后，会出现在这里。'
  }
  if (activeTab.value === 'todo') {
    return '其他环节的验收可以在「进行中」或「全部项目」里查看。'
  }
  if (projectFilter.value !== null) {
    return '当前项目在这个分类下没有验收事项，试试切换分类或清除筛选。'
  }
  return '试试切换分类，或下拉刷新。'
})

function tabCount(key) {
  const list = projectScopedItems.value
  if (key === 'all') return list.length
  if (key === 'todo') return list.filter((item) => item.canInitiate || item.isMine).length
  if (key === 'inProgress') {
    return list.filter((item) => !item.canInitiate && !item.isMine && item.status !== 'passed').length
  }
  if (key === 'done') return list.filter((item) => item.status === 'passed').length
  return 0
}

onLoad(() => {
  // #ifdef H5
  // H5 没有原生 custom-tab-bar，仍需隐藏 uni-tabbar
  uni.hideTabBar({ animation: false, fail: () => {} })
  // #endif
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }
  load()
})

onShow(() => {
  // 原生自定义底栏不在 Vue 树里，进入页面时同步选中态
  syncCustomTabBar({ selected: 1 })
  if (!loading.value && getToken()) load()
  measureSearchSticky()
})

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

onPageScroll((event) => {
  const top = Number(event && event.scrollTop) || 0
  pageScrollTop.value = top
  if (!searchStickyThreshold.value) {
    searchStuck.value = false
    return
  }
  searchStuck.value = top >= searchStickyThreshold.value
})

function measureSearchSticky() {
  nextTick(() => {
    uni
      .createSelectorQuery()
      .select('.search-wrap')
      .boundingClientRect((rect) => {
        if (!rect) {
          searchStickyThreshold.value = 0
          return
        }
        // rect.top 是相对视口的位置；加上当前滚动量才是元素在页面中的静态位置
        searchStickyThreshold.value = Math.max(0, rect.top + pageScrollTop.value - safeTop.value)
      })
      .exec()
  })
}

async function load() {
  loading.value = true
  loadError.value = ''

  try {
    const data = await fetchAcceptanceInbox()
    items.value = data.items || []
    projects.value = data.projects || []
    loaded.value = true

    // 首次进入如果「待我处理」为空但有其他事项，直接展示全部，
    // 避免用户以为验收页什么都没有
    if (activeTab.value === 'todo' && tabCount('todo') === 0 && tabCount('all') > 0) {
      activeTab.value = 'all'
    }
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }
    // 已经成功加载过（或列表里还有数据）时，刷新失败只提示、不把整页替换成失败态
    if (loaded.value || items.value.length) {
      uni.showToast({ title: err.message || '加载失败', icon: 'none' })
    } else {
      loadError.value = err.message || '加载失败，请稍后重试'
    }
  } finally {
    loading.value = false
    measureSearchSticky()
  }
}

// ── 卡片展示 ──

function itemKey(item) {
  return item.canInitiate ? `stage-${item.projectId}-${item.stageId}` : `acceptance-${item.id}`
}

function coverFor(projectId) {
  const index = (Math.abs(Number(projectId) || 0) % 4) + 1
  return `/static/images/project-cover-${index}.jpg`
}

function percent(value) {
  const number = Number(value) || 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

function titleFor(item) {
  const subject = item.itemName ? `${item.stageName} · ${item.itemName}` : item.stageName
  return `${item.projectName} · ${subject}`
}

function statusText(item) {
  // 设计稿用「待业主签字」，后端状态文案是「待业主确认」；
  // 这里按设计稿展示，语义不变
  if (item.status === 'pending_owner') return '待业主签字'
  return item.statusLabel || '验收'
}

function statusClass(item) {
  return `status-badge--${item.status}`
}

function roleOf(item) {
  return item.myRole || 'owner'
}

// ── 交互 ──

function onCardTap(item) {
  if (item.canInitiate) {
    openCreateSheet(item)
    return
  }
  openDetail(item)
}

function openDetail(item) {
  if (!item || !item.id) return
  setCurrentProject({
    id: item.projectId,
    name: item.projectName,
    role: roleOf(item),
    tenantId: item.tenantId ?? null,
    tenantName: item.tenantName ?? null,
  })
  uni.navigateTo({ url: `/pages/acceptance/detail?id=${item.id}` })
}

function openFilterSheet() {
  draftProject.value = projectFilter.value
  filterSheetOpen.value = true
}

function closeFilterSheet() {
  filterSheetOpen.value = false
}

function resetFilterSheet() {
  draftProject.value = null
}

function applyFilterSheet() {
  projectFilter.value = draftProject.value
  filterSheetOpen.value = false
}

// ── 阶段梯子 ──

async function openStageSheet(item) {
  stageProject.value = {
    id: item.projectId,
    name: item.projectName,
    tenantId: item.tenantId ?? null,
    tenantName: item.tenantName ?? null,
  }
  stageSheetOpen.value = true
  await loadStages()
}

function closeStageSheet() {
  stageSheetOpen.value = false
}

async function loadStages() {
  stageLoading.value = true
  stageError.value = ''

  try {
    const data = await fetchProjectStages(stageProject.value.id)
    stageRows.value = data.stages || []
    stageData.value = data
  } catch (err) {
    stageError.value = err.message || '阶段加载失败'
  } finally {
    stageLoading.value = false
  }
}

function stageStateLabel(stage) {
  if (stage.gateStatus === 'settled') return '已结清'
  if (stage.gateStatus === 'accepted') return '已验收 · 待结算'
  if (stage.gateStatus === 'disputed') return '结算有异议'
  if (stage.gateStatus === 'pending_acceptance') return '待验收'
  if (stage.gateStatus === 'locked') return '未解锁'
  return '施工中'
}

function stageStateClass(stage) {
  if (stage.gateStatus === 'settled') return 'stage-state--success'
  if (stage.gateStatus === 'accepted') return 'stage-state--primary'
  if (stage.gateStatus === 'disputed') return 'stage-state--danger'
  if (stage.gateStatus === 'pending_acceptance') return 'stage-state--warning'
  if (stage.gateStatus === 'locked') return 'stage-state--muted'
  return 'stage-state--primary'
}

function stageSeqClass(stage) {
  if (stage.gateStatus === 'settled') return 'stage-seq--success'
  if (stage.gateStatus === 'accepted') return 'stage-seq--primary'
  if (stage.gateStatus === 'disputed') return 'stage-seq--danger'
  if (stage.gateStatus === 'pending_acceptance') return 'stage-seq--warning'
  if (stage.gateStatus === 'locked') return 'stage-seq--muted'
  return 'stage-seq--primary'
}

function previousStageName(index) {
  if (index <= 0) return '上一阶段'
  return stageRows.value[index - 1].name
}

function stageActionable(stage) {
  if (!stageData.value || !stageData.value.isPrimaryForeman) return false
  if (stage.gateStatus !== 'pending_acceptance') return false
  // 已存在未终结验收单时不能重复发起
  return !items.value.some(
    (item) =>
      item.kind === 'acceptance' &&
      item.projectId === stageProject.value.id &&
      item.stageId === stage.id &&
      item.status !== 'passed'
  )
}

function onStageTap(stage) {
  const existing = items.value.find(
    (item) =>
      item.kind === 'acceptance' &&
      item.projectId === stageProject.value.id &&
      item.stageId === stage.id
  )

  if (existing) {
    closeStageSheet()
    openDetail(existing)
    return
  }

  if (stageActionable(stage)) {
    closeStageSheet()
    openCreateSheet({
      canInitiate: true,
      projectId: stageProject.value.id,
      tenantId: stageProject.value.tenantId,
      tenantName: stageProject.value.tenantName,
      projectName: stageProject.value.name,
      stageId: stage.id,
      stageName: stage.name,
      myRole: 'foreman',
    })
  }
}

// ── 发起验收 ──

function openCreateSheet(item) {
  createTarget.value = {
    projectId: item.projectId,
    tenantId: item.tenantId ?? null,
    tenantName: item.tenantName ?? null,
    projectName: item.projectName,
    stageId: item.stageId,
    stageName: item.stageName,
  }
  createDescription.value = ''
  createPhoto.value = ''
  createSheetOpen.value = true
}

function closeCreateSheet() {
  if (creating.value) return
  createSheetOpen.value = false
}

function chooseCreatePhoto() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['camera', 'album'],
    success: (res) => {
      createPhoto.value = res.tempFilePaths[0]
    },
  })
}

async function submitCreate() {
  if (creating.value) return
  creating.value = true

  try {
    const detail = await createAcceptance(
      createTarget.value.projectId,
      {
        stageId: createTarget.value.stageId,
        description: createDescription.value.trim(),
      },
      createPhoto.value
    )

    createSheetOpen.value = false
    uni.showToast({ title: '验收单已创建', icon: 'success' })
    await load()

    if (detail && detail.id) {
      openDetail({
        id: detail.id,
        projectId: createTarget.value.projectId,
        tenantId: createTarget.value.tenantId,
        tenantName: createTarget.value.tenantName,
        projectName: createTarget.value.projectName,
        myRole: 'foreman',
      })
    }
  } catch (err) {
    uni.showToast({ title: err.message || '发起失败', icon: 'none' })
  } finally {
    creating.value = false
  }
}
function closeActiveSheet() {
  if (filterSheetOpen.value) closeFilterSheet()
  else if (stageSheetOpen.value) closeStageSheet()
  else if (createSheetOpen.value) closeCreateSheet()
}
</script>

<style scoped lang="scss">
.page {
  position: relative;
  min-height: 100vh;
  /* 自绘底栏固定悬浮，任何平台都要给底部留出与原生 tabBar 一致的高度 */
  padding-bottom: calc(#{dp(76)} + env(safe-area-inset-bottom));
  background: #faf7f4;
}

/* ── 顶部 ── */
.hero {
  position: relative;
  overflow: hidden;
  padding: 0 dp(16) dp(18);
  background: linear-gradient(180deg, #fbe0d2 0%, #fdf1e9 58%, #faf7f4 100%);
}

.hero-art {
  position: absolute;
  top: 0;
  right: 0;
  width: 76%;
  height: 100%;
  opacity: 0.45;
  /* 底图是蓝图照片，轻微暖色化后与橙色主题融合，避免右上角仍然发蓝 */
  filter: sepia(0.45) saturate(1.15) hue-rotate(-18deg);
  mix-blend-mode: multiply;
  pointer-events: none;
}

.hero-fade-left {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 68%;
  background: linear-gradient(90deg, #fbe0d2 0%, rgba(250, 226, 211, 0.88) 52%, rgba(250, 226, 211, 0) 100%);
  pointer-events: none;
}

.hero-fade-bottom {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 60%;
  background: linear-gradient(180deg, rgba(250, 247, 244, 0) 0%, #faf7f4 100%);
  pointer-events: none;
}

.hero-content {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-top: dp(12);
}

/* 小程序右上角有微信原生胶囊，筛选按钮要往左让位；H5 保持设计稿位置 */
/* #ifdef MP-WEIXIN */
.hero-content {
  padding-right: dp(96);
}
/* #endif */

.hero-title-row {
  display: flex;
  align-items: flex-start;
  min-width: 0;
}

.shield-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(44);
  height: dp(44);
  margin-right: dp(12);
  border-radius: dp(12);
  background: linear-gradient(180deg, #eb5c20 0%, #c44710 100%);
  box-shadow: 0 dp(4) dp(12) rgba(235, 92, 32, 0.22);
  flex-shrink: 0;
}

.shield-icon {
  width: dp(24);
  height: dp(24);
}

.hero-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hero-title {
  color: #241c17;
  font-size: dp(23);
  font-weight: 700;
  letter-spacing: dp(-0.3);
  line-height: 1.15;
}

.hero-sub {
  margin-top: dp(5);
  color: #6d6259;
  font-size: dp(12);
  line-height: 1.3;
}

/* ── 搜索与筛选（吸顶，与项目页一致） ── */
.search-wrap {
  position: sticky;
  z-index: 35;
  margin-top: dp(-8);
  padding: 0 dp(16);
  transition: background-color 0.18s ease, box-shadow 0.18s ease;
}

.search-wrap--stuck {
  background: rgba(250, 247, 244, 0.82);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  box-shadow: 0 dp(6) dp(18) rgba(94, 45, 22, 0.05);
}

/* 吸顶栏底部羽化：避免背景在验收卡片上出现一条硬边 */
.search-wrap--stuck::after {
  position: absolute;
  right: 0;
  bottom: dp(-26);
  left: 0;
  height: dp(26);
  background: linear-gradient(
    180deg,
    rgba(250, 247, 244, 0.88) 0%,
    rgba(250, 247, 244, 0.56) 32%,
    rgba(250, 247, 244, 0) 100%
  );
  pointer-events: none;
  content: '';
}

.sticky-status-bg {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 34;
  background: #faf7f4;
}

.search-row {
  display: flex;
  align-items: center;
  gap: dp(8);
}

.search-bar {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: dp(42);
  padding: 0 dp(14);
  @include glass-surface(dp(999), 18px);
  box-shadow:
    0 dp(4) dp(16) rgba(94, 45, 22, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.94);
}

.search-icon {
  width: dp(20);
  height: dp(20);
  margin-right: dp(8);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  height: 100%;
  font-size: dp(14);
  color: #241c17;
}

.search-placeholder {
  color: #a19488;
}

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(20);
  height: dp(20);
  margin-left: dp(6);
  border-radius: 50%;
  background: #f3efea;
  flex-shrink: 0;
}

.search-clear-icon {
  width: dp(12);
  height: dp(12);
}

.search-filter {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(42);
  padding: 0 dp(12);
  @include glass-surface(dp(999), 18px);
  box-shadow:
    0 dp(4) dp(16) rgba(94, 45, 22, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.94);
  color: #eb5c20;
  flex-shrink: 0;
}

.search-filter-icon {
  width: dp(15);
  height: dp(15);
  margin-right: dp(4);
}

.search-filter-label {
  font-size: dp(12);
  font-weight: 600;
  line-height: 1;
}

.filter-active-dot {
  position: absolute;
  top: dp(-1);
  right: dp(-1);
  width: dp(7);
  height: dp(7);
  border-radius: 50%;
  background: #f53f3f;
}

/* ── 分类 tab ── */
.tabs {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(10);
  padding: 0;
}

.tab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: dp(30);
  margin-right: dp(6);
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: dp(999);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.9) 0%,
    rgba(255, 247, 242, 0.62) 100%
  );
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  backdrop-filter: blur(14px) saturate(170%);
  color: #5A4638;
  font-size: dp(12);
  font-weight: 500;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}

.tab:last-child {
  margin-right: 0;
}

.tab--active {
  background: #eb5c20;
  color: #fff;
  box-shadow: 0 dp(2) dp(6) rgba(235, 92, 32, 0.22);
  transform-origin: center;
  animation: gc-tab-pop 420ms cubic-bezier(0.2, 1.35, 0.35, 1) both;
}

.tab-label {
  line-height: 1;
}

.tab-badge {
  position: absolute;
  top: dp(-5);
  right: dp(-1);
  min-width: dp(16);
  height: dp(16);
  padding: 0 dp(3);
  border: 1.5px solid #fff;
  border-radius: dp(8);
  color: #fff;
  font-size: dp(9);
  font-weight: 700;
  line-height: dp(13);
  text-align: center;
}

/* 设计稿三个分类的角标都是红色；数字只表示数量，不表示严重程度 */
.tab-badge--todo,
.tab-badge--inProgress,
.tab-badge--done {
  background: #f53f3f;
}

.tab-underline {
  position: absolute;
  bottom: dp(-6);
  left: 50%;
  width: dp(22);
  height: dp(2);
  border-radius: dp(2);
  background: #eb5c20;
  transform: translateX(-50%);
}

/* ── 列表 ── */
.card-list {
  display: flex;
  flex-direction: column;
  gap: dp(14);
  padding: dp(10) dp(14) 0;
}

.card {
  padding: dp(14);
  @include glass-surface(dp(16), 20px);
}

.card:active {
  background: rgba(255, 255, 255, 0.72);
}

.card-top {
  display: flex;
  gap: dp(12);
}

.cover {
  width: dp(80);
  height: dp(80);
  border-radius: dp(12);
  background: #f3efea;
  flex-shrink: 0;
}

.card-info {
  flex: 1;
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.title-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.card-title {
  max-width: 100%;
  margin-right: dp(6);
  overflow: hidden;
  color: #241c17;
  font-size: dp(15);
  font-weight: 700;
  letter-spacing: dp(-0.2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.status-badge {
  padding: dp(2) dp(6);
  border-radius: dp(4);
  font-size: dp(11);
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
}

.status-badge--pending_owner {
  background: #fff7e8;
  color: #a85400;
  border: 1px solid #ffe8bf;
}

.status-badge--pending_supervisor {
  background: #fdebe4;
  color: #eb5c20;
  border: 1px solid #f4b392;
}

.status-badge--pending_rectify {
  background: #ffece8;
  color: #b22a26;
  border: 1px solid #ffd4cc;
}

.status-badge--passed {
  background: #e8ffea;
  color: #087a1e;
  border: 1px solid #aff0b5;
}

.status-badge--draft {
  background: #f3efea;
  color: #8b8179;
}

.status-badge--can_initiate {
  background: #e8ffea;
  color: #00b42a;
  border: 1px solid #aff0b5;
}

.status-badge--muted {
  background: #f3efea;
  color: #8b8179;
}

.chevron {
  width: dp(14);
  height: dp(14);
  margin-top: dp(2);
  margin-left: dp(6);
  flex-shrink: 0;
  opacity: 0.7;
}

.meta-row {
  display: flex;
  align-items: center;
  margin-top: dp(6);
  min-width: 0;
}

.meta-icon {
  width: dp(13);
  height: dp(13);
  margin-right: dp(4);
  flex-shrink: 0;
}

.meta-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #6d6259;
  font-size: dp(12);
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.waiting-danger {
  color: #f53f3f;
  font-weight: 700;
}

.progress-row {
  display: flex;
  align-items: center;
  margin-top: dp(12);
}

.progress-label {
  flex-shrink: 0;
  margin-right: dp(8);
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 600;
}

.progress-track {
  flex: 1;
  height: dp(6);
  overflow: hidden;
  border-radius: dp(999);
  background: #fdeee6;
}

.progress-fill {
  height: 100%;
  border-radius: dp(999);
  background: #eb5c20;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(14);
  padding-top: dp(12);
  border-top: 1px solid #f5f0eb;
}

.stage-link {
  display: flex;
  align-items: center;
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 500;
}

.stage-link-icon {
  width: dp(14);
  height: dp(14);
  margin-right: dp(4);
}

.stage-link-text {
  line-height: 1;
}

.stage-link-arrow {
  width: dp(11);
  height: dp(11);
  margin-left: dp(2);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(30);
  padding: 0 dp(18);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  font-weight: 500;
  line-height: 1;
  box-shadow: 0 dp(2) dp(6) rgba(235, 92, 32, 0.18);
}

.action-btn:active {
  background: #c44710;
}

.action-btn--ghost {
  background: #fff7f2;
  color: #eb5c20;
  box-shadow: none;
}

/* ── 空/加载 ── */
.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(72) dp(28) dp(24);
}

.state-icon {
  width: dp(64);
  height: dp(64);
  opacity: 0.85;
}

.state-title {
  margin-top: dp(16);
  color: #241c17;
  font-size: dp(17);
  font-weight: 600;
}

.state-text {
  margin-top: dp(8);
  color: #6d6259;
  font-size: dp(13);
  line-height: 1.7;
  text-align: center;
}

.state-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(40);
  margin-top: dp(20);
  padding: 0 dp(24);
  border: 1px solid #eb5c20;
  border-radius: dp(8);
  background: #fff;
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 600;
}

/* ── 底部面板 ── */
.sheet-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  /* 高于 H5 的 uni-tabbar；小程序原生 tabBar 在 webview 外，不受影响 */
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  background: rgba(29, 33, 41, 0.45);
}

.sheet {
  width: 100%;
  max-height: 82vh;
  overflow-y: auto;
  /* tab 页；微信原生 tabBar 已经处理底部安全区 */
  padding: dp(8) dp(16) dp(16);
  border-radius: dp(20) dp(20) 0 0;
  @include glass-sheet;
}

.sheet--stage {
  max-height: 76vh;
}

.sheet-handle {
  width: dp(36);
  height: dp(4);
  margin: 0 auto dp(12);
  border-radius: dp(999);
  background: #cfc6bd;
}

.sheet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: dp(14);
}

.sheet-title {
  display: block;
  color: #241c17;
  font-size: dp(17);
  font-weight: 600;
}

.sheet-subtitle {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(12);
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(28);
  height: dp(28);
}

.sheet-close-icon {
  width: dp(16);
  height: dp(16);
}

.sheet-options {
  display: flex;
  flex-wrap: wrap;
  gap: dp(8);
}

.sheet-option {
  display: flex;
  align-items: center;
  height: dp(34);
  padding: 0 dp(14);
  border-radius: dp(999);
  background: #f3efea;
  color: #51463e;
  font-size: dp(13);
}

.sheet-option--active {
  background: #fdebe4;
  color: #c44710;
  font-weight: 600;
}

.sheet-option-count {
  min-width: dp(16);
  height: dp(16);
  margin-left: dp(5);
  padding: 0 dp(4);
  border-radius: dp(8);
  background: #eb5c20;
  color: #fff;
  font-size: dp(9);
  line-height: dp(16);
  text-align: center;
}

.sheet-actions {
  display: flex;
  margin-top: dp(24);
}

.sheet-reset,
.sheet-apply {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: dp(46);
  padding: 0;
  border-radius: dp(8);
  font-size: dp(15);
  font-weight: 500;
  line-height: 1;
  text-align: center;
}

.sheet-reset {
  margin-right: dp(10);
  border: 1px solid #e8e1da;
  background: #fff;
  color: #51463e;
}

.sheet-apply {
  background: #eb5c20;
  color: #fff;
}

.sheet-apply[disabled] {
  opacity: 0.65;
}

/* ── 阶段梯子 ── */
.stage-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(30) 0;
}

.stage-list {
  display: flex;
  flex-direction: column;
}

.stage-row {
  display: flex;
  align-items: flex-start;
  padding: dp(12) 0;
  border-bottom: 1px solid #f5f0eb;
}

.stage-row:last-child {
  border-bottom: none;
}

.stage-row--actionable {
  border-radius: dp(8);
  background: #fff8f4;
  margin: 0 dp(-8);
  padding: dp(12) dp(8);
}

.stage-seq {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(24);
  height: dp(24);
  margin-right: dp(10);
  border-radius: 50%;
  color: #fff;
  font-size: dp(11);
  font-weight: 700;
  flex-shrink: 0;
}

.stage-seq--success {
  background: #00b42a;
}

.stage-seq--primary {
  background: #eb5c20;
}

.stage-seq--warning {
  background: #ff7d00;
}

.stage-seq--danger {
  background: #f53f3f;
}

.stage-seq--muted {
  background: #cfc6bd;
}

.stage-main {
  flex: 1;
  min-width: 0;
}

.stage-title-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stage-name {
  color: #241c17;
  font-size: dp(14);
  font-weight: 600;
}

.stage-state {
  font-size: dp(11);
  font-weight: 500;
}

.stage-state--success {
  color: #087a1e;
}

.stage-state--primary {
  color: #eb5c20;
}

.stage-state--warning {
  color: #a85400;
}

.stage-state--danger {
  color: #b22a26;
}

.stage-state--muted {
  color: #8b8179;
}

.stage-note {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(11);
}

.stage-arrow {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(16);
  line-height: dp(24);
}

/* ── 发起验收 ── */
.create-stage {
  display: block;
  color: #241c17;
  font-size: dp(15);
  font-weight: 600;
}

.create-hint {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(12);
  line-height: 1.5;
}

.create-textarea {
  width: 100%;
  height: dp(88);
  margin-top: dp(14);
  padding: dp(10) dp(12);
  border: 1px solid #e8e1da;
  border-radius: dp(8);
  background: #f8f4ef;
  color: #241c17;
  font-size: dp(13);
  line-height: 1.5;
  box-sizing: border-box;
}

.create-placeholder {
  color: #a19488;
}

.create-photo-row {
  display: flex;
  margin-top: dp(14);
}

.create-photo-wrap {
  position: relative;
  width: dp(76);
  height: dp(76);
  border-radius: dp(8);
  overflow: hidden;
}

.create-photo {
  width: 100%;
  height: 100%;
}

.create-photo-remove {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(20);
  height: dp(20);
  border-radius: 0 0 0 dp(8);
  background: rgba(29, 33, 41, 0.6);
  color: #fff;
  font-size: dp(14);
}

.create-photo-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: dp(76);
  height: dp(76);
  border: 1px dashed #cfc6bd;
  border-radius: dp(8);
  background: #f8f4ef;
}

.create-photo-plus {
  color: #8b8179;
  font-size: dp(22);
  line-height: 1;
}

.create-photo-label {
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}
</style>
