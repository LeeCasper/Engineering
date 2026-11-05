<template>
  <view class="page">
    <!-- 顶部品牌区：蓝底渐变 + 白色城市天际线 -->
    <view class="hero" :style="{ paddingTop: `${safeTop + 8}px` }">
      <image class="hero-skyline" src="/static/images/home-skyline.png" mode="widthFix" />
      <view class="hero-content">
        <view class="brand">
          <image class="brand-logo" :src="branding.logoUrl || '/static/images/logo.png'" mode="aspectFit" />
          <view class="brand-text">
            <text class="brand-name">{{ branding.name }}</text>
            <text class="brand-slogan">让装修工程更透明、更可控</text>
          </view>
        </view>
        <view v-if="adminEntryVisible" class="hero-actions">
          <view class="admin-entry" @tap="openAdmin">
            <image
              class="admin-entry-icon"
              src="/static/images/icon-gear-white.png"
              mode="aspectFit"
            />
            <text class="admin-entry-label">管理</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 搜索 + 状态筛选 -->
    <view
      v-if="hasProjects"
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
            placeholder="搜索项目名称 / 地址 / 业主"
            placeholder-class="search-placeholder"
          />
          <view v-if="query" class="search-clear" @tap="query = ''">
            <image class="search-clear-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="allTenants.length > 1" class="search-filter" @tap="openFilterSheet">
          <image
            class="search-filter-icon"
            src="/static/images/icon-filter-accent.png"
            mode="aspectFit"
          />
          <text class="search-filter-label">筛选</text>
          <view v-if="activeFilterCount" class="filter-active-dot" />
        </view>
      </view>

      <view class="tabs">
        <view
          v-for="tab in HOME_TABS"
          :key="tab.key"
          class="tab"
          :class="{ 'tab--active': statusTab === tab.key }"
          @tap="setStatusTab(tab.key)"
        >
          <text class="tab-label">{{ tab.label }}</text>
          <text v-if="tab.key !== 'all' && tabCount(tab.key) > 0" class="tab-badge">
            {{ tabCount(tab.key) }}
          </text>
          <view v-if="statusTab === tab.key" class="tab-underline" />
        </view>
      </view>
    </view>
    <view v-if="searchStuck" class="sticky-status-bg" :style="{ height: `${safeTop}px` }" />

    <!-- 待确认邀请：保留原有确认/拒绝能力，位置在项目列表之前 -->
    <view
      v-if="invitations.length"
      class="invite-section"
      :class="{ 'invite-section--focus': focusInvitations }"
    >
      <view class="invite-head">
        <text class="invite-title">待确认邀请</text>
        <text class="invite-count">{{ invitations.length }}</text>
      </view>

      <view
        v-for="inv in invitations"
        :key="inv.memberId"
        class="invite-card"
        :class="{ 'invite-card--first': inv === invitations[0] }"
      >
        <view class="invite-top">
          <text class="invite-project">{{ inv.projectName }}</text>
          <text class="role-chip" :class="roleChipClass(inv.role)">{{ inv.roleLabel }}</text>
        </view>
        <text class="invite-meta">{{ inv.tenantName }} · {{ inv.projectAddress }}</text>
        <text class="invite-meta">
          邀请人：{{ inv.invitedBy || '管理员' }} · {{ formatTime(inv.invitedAt) }}
        </text>
        <view class="invite-actions">
          <view class="invite-reject" @tap="onReject(inv)">
            <text class="invite-btn-text">拒绝</text>
          </view>
          <view class="invite-accept" @tap="onAccept(inv)">
            <text class="invite-btn-text">确认加入</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 有邀请但还没有项目：确认后项目会出现在列表里 -->
    <view
      v-if="!loading && !hasProjects && invitations.length && !loadError"
      class="invite-hint"
    >
      确认邀请后，项目会出现在这里。
    </view>

    <!-- 完全没有任何项目：沿用「绑定手机号 + 联系管理员」引导 -->
    <view v-if="noProjects" class="no-project">
      <image class="no-project-logo" :src="branding.logoUrl || '/static/images/logo.png'" mode="aspectFit" />
      <text class="no-project-title">还没有加入任何项目</text>
      <text class="no-project-text">
        项目邀请按手机号发送。请确认已绑定手机号，再联系邀请您的装修公司管理员。
      </text>
      <text v-if="hasPhone" class="no-project-phone">已绑定手机号：{{ phoneMasked }}</text>

      <!-- #ifdef MP-WEIXIN -->
      <button
        v-if="!hasPhone && !devPhoneBind"
        class="no-project-bind"
        open-type="getPhoneNumber"
        @getphonenumber="onGetPhoneNumber"
      >
        绑定手机号
      </button>
      <view v-if="!hasPhone && devPhoneBind" class="bind-row">
        <input
          v-model="phoneInput"
          class="bind-input"
          type="number"
          maxlength="11"
          placeholder="请输入手机号"
          placeholder-class="bind-placeholder"
        />
        <button class="bind-btn" :disabled="binding" @tap="bindByPhone">
          {{ binding ? '绑定中…' : '绑定' }}
        </button>
      </view>
      <!-- #endif -->

      <!-- #ifndef MP-WEIXIN -->
      <view v-if="!hasPhone" class="bind-row">
        <input
          v-model="phoneInput"
          class="bind-input"
          type="number"
          maxlength="11"
          placeholder="请输入手机号"
          placeholder-class="bind-placeholder"
        />
        <button class="bind-btn" :disabled="binding" @tap="bindByPhone">
          {{ binding ? '绑定中…' : '绑定' }}
        </button>
      </view>
      <!-- #endif -->

      <text v-if="devPhoneBind" class="no-project-hint">
        开发环境未配置微信手机号授权，可直接输入手机号绑定。
      </text>
      <text v-else class="no-project-hint">绑定后点击刷新；管理员用该手机号发起邀请后即可看到。</text>
      <text v-if="supportContact" class="no-project-contact">客服联系方式：{{ supportContact }}</text>
      <button class="no-project-refresh" :disabled="loading" @tap="load">刷新</button>
    </view>

    <!-- 项目卡片列表 -->
    <view v-if="hasProjects && filteredProjects.length" class="project-list gc-stagger">
      <view
        v-for="project in filteredProjects"
        :key="project.id"
        class="project-card"
        @tap="openProject(project)"
      >
        <view class="project-main">
          <view class="project-cover-wrap">
            <image class="project-cover" :src="coverFor(project)" mode="aspectFill" />
            <text class="status-badge" :class="statusClass(project.status)">
              {{ project.statusLabel }}
            </text>
          </view>

          <view class="project-info">
            <view class="project-title-row">
              <text class="project-name">{{ project.name }}</text>
              <view class="more-btn" @tap.stop="openMore(project)">
                <image class="more-icon" src="/static/images/icon-more.png" mode="aspectFit" />
              </view>
            </view>

            <view class="meta-row">
              <image class="meta-icon" src="/static/images/icon-location.png" mode="aspectFit" />
              <text class="meta-text">{{ project.address }}</text>
            </view>

            <view class="meta-row">
              <image class="meta-icon" src="/static/images/icon-people.png" mode="aspectFit" />
              <text class="meta-text">业主：<text class="meta-owner">{{ project.ownerName || '待分配' }}</text><text class="meta-divider">|</text>工长：{{ project.foremanName || '待分配' }}</text>
            </view>

            <view class="progress-block">
              <view class="progress-head">
                <text class="progress-label">项目进度{{ progressDate(project) }}</text>
                <text class="progress-value" :class="{ 'progress-value--done': isDone(project) }">
                  {{ percent(project) }}%
                </text>
              </view>
              <view class="progress-track">
                <view
                  class="progress-fill"
                  :class="{ 'progress-fill--done': isDone(project) }"
                  :style="{ width: `${percent(project)}%` }"
                />
              </view>
            </view>
          </view>
        </view>

        <view v-if="displayStages(project).length" class="stage-row">
          <view
            v-for="stage in displayStages(project)"
            :key="stage.id"
            class="stage-pill"
            :class="`stage-pill--${stage.visual.kind}`"
          >
            <view class="stage-icon-wrap">
              <image class="stage-icon" :src="stage.visual.icon" mode="aspectFit" />
            </view>
            <view class="stage-text">
              <text class="stage-name">{{ stage.name }}</text>
              <text class="stage-state">{{ stage.visual.label }}</text>
            </view>
            <text v-if="stage.visual.clickable" class="stage-arrow">›</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="statusTab === 'finished' && filteredProjects.length" class="list-footnote">
      — 仅展示已完工的项目 —
    </view>

    <!-- 搜索 / 筛选无结果 -->
    <view v-if="hasProjects && !filteredProjects.length" class="search-empty">
      <view class="empty-icon-wrap">
        <image class="empty-search-icon" src="/static/images/icon-search-empty.png" mode="aspectFit" />
      </view>
      <text class="empty-title">未找到相关项目</text>
      <text class="empty-text">{{ emptyText }}</text>
      <button class="empty-reset" @tap="clearFilters">清空搜索条件</button>
    </view>

    <view v-if="loading && !hasProjects && !invitations.length" class="gc-loading-page">
      <gc-skeleton :rows="3" />
    </view>

    <view v-if="!loading && loadError" class="load-error">
      <text class="load-error-text">{{ loadError }}</text>
      <button class="load-error-retry" @tap="load">重新加载</button>
    </view>

    <!-- 新建项目只对租户管理员开放，入口在管理端工作台/项目列表；C 端不展示 FAB -->

    <!-- 筛选面板 -->
    <view v-if="filterSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeFilterSheet">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-header" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <text class="sheet-title">筛选项目</text>
          <view class="sheet-close" @tap="closeFilterSheet">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="allTenants.length > 1" class="sheet-section">
          <text class="sheet-label">所属公司</text>
          <view class="sheet-options">
            <view
              class="sheet-option"
              :class="{ 'sheet-option--active': draftTenant === 'all' }"
              @tap="draftTenant = 'all'"
            >
              全部
            </view>
            <view
              v-for="tenant in allTenants"
              :key="tenant.id"
              class="sheet-option"
              :class="{ 'sheet-option--active': draftTenant === tenant.id }"
              @tap="draftTenant = tenant.id"
            >
              {{ tenant.name }}
            </view>
          </view>
        </view>

        <view class="sheet-actions">
          <button class="sheet-reset" @tap="resetSheet">重置</button>
          <button class="sheet-apply" @tap="applyFilters">应用</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { onLoad, onShow, onPageScroll, onPullDownRefresh } from '@dcloudio/uni-app'
import { branding, loadBranding } from '../../store/branding'
import { myProjects, confirmInvitation, rejectInvitation } from '../../api/project'
import { resolveMediaUrl } from '../../api/request'
import { bindPhone, listAdminBindings } from '../../api/auth'
import { DEV_PHONE_BIND } from '../../config'
import {
  setCachedProjects,
  getToken,
  getUser,
  setUser,
  setToken,
} from '../../store/session'
import { setCurrentProject, syncProjectContext } from '../../store/projectContext'
import { refreshMineTabBadge } from '../../utils/notificationBadge'
import {
  getAdminToken,
  getBindingHint,
  setBindingHint,
} from '../../store/adminSession'
import { useSwipeClose } from '../../composables/useSwipeClose'

// 底部弹窗下滑关闭：绑定把手 / 标题区，不干扰表单滚动
const sheetSwipe = useSwipeClose(() => closeActiveSheet())
const sheetSwipeStyle = sheetSwipe.style

const HOME_TABS = [
  { key: 'all', label: '全部项目' },
  { key: 'building', label: '进行中' },
  { key: 'finished', label: '已完工' },
  { key: 'archived', label: '已归档' },
]

const STATUS_BADGE_CLASSES = {
  pending: 'status-badge--pending',
  building: 'status-badge--building',
  finished: 'status-badge--finished',
  archived: 'status-badge--archived',
}

const ROLE_CHIP_CLASSES = {
  foreman: 'role-chip--foreman',
  supervisor: 'role-chip--supervisor',
  owner: 'role-chip--owner',
}

const loading = ref(false)
const loadError = ref('')
const allProjects = ref([])
const invitations = ref([])
const allTenants = ref([])
const supportContact = ref('')
const focusInvitations = ref(false)

const query = ref('')
const statusTab = ref('all')
const tenantFilter = ref('all')

const filterSheetOpen = ref(false)
const draftTenant = ref('all')

const user = ref(getUser() || {})
const phoneInput = ref('')
const binding = ref(false)
const safeTop = ref(12)
const adminEntryVisible = ref(false)
const searchStuck = ref(false)
const searchStickyThreshold = ref(0)
const pageScrollTop = ref(0)

const devPhoneBind = DEV_PHONE_BIND
const hasPhone = computed(() => Boolean(user.value.hasPhone || user.value.phoneMasked))
const phoneMasked = computed(() => user.value.phoneMasked || '')
const hasProjects = computed(() => allProjects.value.length > 0)
const noProjects = computed(
  () => !loading.value && !loadError.value && !hasProjects.value && !invitations.value.length
)

const activeFilterCount = computed(() => (tenantFilter.value === 'all' ? 0 : 1))

const baseProjects = computed(() => {
  const keyword = query.value.trim().toLowerCase()

  return allProjects.value.filter((project) => {
    if (tenantFilter.value !== 'all' && project.tenantId !== tenantFilter.value) return false

    if (keyword) {
      const haystack = [
        project.name,
        project.address,
        project.ownerName,
        project.foremanName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      if (!haystack.includes(keyword)) return false
    }

    return true
  })
})

const filteredProjects = computed(() => {
  if (statusTab.value === 'all') return baseProjects.value
  return baseProjects.value.filter((project) => project.status === statusTab.value)
})

function tabCount(key) {
  if (key === 'all') return baseProjects.value.length
  return baseProjects.value.filter((project) => project.status === key).length
}

const emptyText = computed(() => {
  const keyword = query.value.trim()
  if (keyword) {
    return `没有找到与“${keyword}”匹配的项目，请检查关键词或清除筛选条件`
  }
  return '没有符合当前筛选条件的项目，试试调整筛选条件'
})

async function refreshAdminAccess() {
  if (!getToken()) return

  if (getAdminToken()) {
    adminEntryVisible.value = true
    return
  }

  const hint = getBindingHint()
  if (hint && Date.now() - Number(hint.checkedAt || 0) < 5 * 60 * 1000) {
    adminEntryVisible.value = Number(hint.count) > 0
    return
  }

  try {
    const data = await listAdminBindings()
    const count = (data.bindings || []).length
    setBindingHint(count)
    adminEntryVisible.value = count > 0
  } catch (err) {
    adminEntryVisible.value = false
  }
}

function openAdmin() {
  if (getAdminToken()) {
    uni.navigateTo({ url: '/pages/admin/workbench/index' })
    return
  }
  uni.navigateTo({ url: '/pages/admin/login/index' })
}

onPageScroll((event) => {
  const top = Number(event && event.scrollTop) || 0
  pageScrollTop.value = top
  if (!hasProjects.value || !searchStickyThreshold.value) {
    searchStuck.value = false
    return
  }
  searchStuck.value = top >= searchStickyThreshold.value
})

onLoad((options) => {
  loadBranding()
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12
  focusInvitations.value = Boolean(options && options.focus === 'invitations')
  user.value = getUser() || {}

  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }
  refreshAdminAccess()
  load()
})

onShow(() => {
  // 从其他页面返回时同步用户信息；首次 onLoad 已经触发加载
  user.value = getUser() || {}
  if (getToken()) {
    refreshAdminAccess()
    refreshMineTabBadge()
  }
  if (!loading.value && getToken()) load()
  if (hasProjects.value) measureSearchSticky()
})

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
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
    const data = await myProjects()
    setCachedProjects(data)

    allProjects.value = (data.groups || []).flatMap((group) => group.items || [])
    invitations.value = data.pendingInvitations || []
    allTenants.value = data.tenants || []
    supportContact.value = data.supportContact || ''

    // 当前项目必须仍然在「我可见的项目」里。成员被移除、项目归档或租户停用后，
    // 旧上下文会让项目内页面继续请求一个已经无权访问的 id，所以这里主动清掉。
    const context = syncProjectContext(data)
    if (context.removed) {
      uni.showToast({ title: '上次进入的项目已不可用', icon: 'none' })
    }
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }

    // 已有数据时只提示，不把页面清空；首次加载失败才显示错误态
    if (allProjects.value.length || invitations.value.length) {
      uni.showToast({ title: err.message || '加载失败', icon: 'none' })
    } else {
      loadError.value = err.message || '加载失败，请稍后重试'
    }
  } finally {
    loading.value = false
    if (hasProjects.value) measureSearchSticky()
  }
}

// ── 搜索与筛选 ──

function setStatusTab(key) {
  statusTab.value = key
}

function openFilterSheet() {
  draftTenant.value = tenantFilter.value
  filterSheetOpen.value = true
}

function closeFilterSheet() {
  filterSheetOpen.value = false
}

function resetSheet() {
  draftTenant.value = 'all'
}

function applyFilters() {
  tenantFilter.value = draftTenant.value
  filterSheetOpen.value = false
}

function clearFilters() {
  query.value = ''
  statusTab.value = 'all'
  tenantFilter.value = 'all'
}

// ── 项目卡片 ──

function coverFor(project) {
  // 管理员上传的封面优先；没有封面时按 id 稳定映射到设计稿的 4 张实景占位图。
  if (project.coverUrl) return resolveMediaUrl(project.coverUrl)
  const index = (Math.abs(Number(project.id) || 0) % 4) + 1
  return `/static/images/project-cover-${index}.jpg`
}

function percent(project) {
  const value = Number(project.progress) || 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function isDone(project) {
  return project.status === 'finished'
}

function progressDate(project) {
  if (project.status !== 'finished') return ''
  const date = project.actualEndDate || project.planEndDate
  return date ? `（${String(date).slice(0, 10)} 交付）` : ''
}

function statusClass(status) {
  return STATUS_BADGE_CLASSES[status] || 'status-badge--archived'
}

function stageVisual(stage) {
  if (
    stage.gateStatus === 'accepted' ||
    stage.gateStatus === 'settled' ||
    stage.status === 'accepted'
  ) {
    return {
      kind: 'done',
      label: '已完成',
      icon: '/static/images/icon-stage-done.png',
      clickable: false,
    }
  }

  if (stage.gateStatus === 'pending_acceptance') {
    return {
      kind: 'pending',
      label: '待验收',
      icon: '/static/images/icon-stage-pending.png',
      clickable: true,
    }
  }

  if (stage.gateStatus === 'disputed') {
    return {
      kind: 'danger',
      label: '待整改',
      icon: '/static/images/icon-stage-pending.png',
      clickable: true,
    }
  }

  if (stage.gateStatus === 'active' || stage.status === 'in_progress') {
    return {
      kind: 'active',
      label: '进行中',
      icon: '/static/images/icon-stage-active.png',
      clickable: true,
    }
  }

  if (stage.status === 'completed') {
    return {
      kind: 'done',
      label: '已完成',
      icon: '/static/images/icon-stage-done.png',
      clickable: false,
    }
  }

  return {
    kind: 'locked',
    label: '未解锁',
    icon: '/static/images/icon-stage-locked.png',
    clickable: false,
  }
}

/**
 * 首页只放 3 个阶段胶囊：从「当前阶段」起连续取 3 个；
 * 已全部结清时取最后 3 个。这样进行中的项目能看到下一步，完工项目能看到收尾。
 */
function stagePills(project) {
  const stages = [...(project.stages || [])].sort((a, b) => a.seq - b.seq)
  if (!stages.length) return []

  let start = stages.findIndex((stage) => stage.gateStatus !== 'settled')
  if (start === -1) start = stages.length - 3
  start = Math.max(0, Math.min(start, stages.length - 3))

  return stages.slice(start, start + 3)
}

function displayStages(project) {
  return stagePills(project).map((stage) => ({ ...stage, visual: stageVisual(stage) }))
}

function openProject(project) {
  // 进入项目前先固定上下文。项目内页面只认这个 id，不再从列表里猜一个。
  setCurrentProject(project)
  uni.navigateTo({ url: `/pages/project/index?id=${project.id}` })
}

function openMore(project) {
  uni.showActionSheet({
    itemList: ['查看项目', '复制项目地址'],
    success: (res) => {
      if (res.tapIndex === 0) {
        openProject(project)
        return
      }
      if (res.tapIndex === 1) copyAddress(project)
    },
  })
}

function copyAddress(project) {
  if (!project.address) {
    uni.showToast({ title: '该项目还没有填写地址', icon: 'none' })
    return
  }
  uni.setClipboardData({
    data: project.address,
    success: () => uni.showToast({ title: '地址已复制', icon: 'none' }),
  })
}

// ── 邀请确认 ──

async function onAccept(inv) {
  const confirmed = await confirmModal(
    '确认加入',
    `你将作为「${inv.roleLabel}」加入 ${inv.tenantName} 的「${inv.projectName}」。`
  )
  if (!confirmed) return

  try {
    await confirmInvitation(inv.memberId)
    uni.showToast({ title: '已加入项目', icon: 'success' })
    await load()
  } catch (err) {
    // 被邀请后必须先补真实姓名；后端返回 detail.requiresRealName
    if (err.data && err.data.requiresRealName) {
      const goFill = await new Promise((resolve) => {
        uni.showModal({
          title: '请先填写真实姓名',
          content: '被邀请加入项目后需要先填写真实姓名，确认邀请后才能成为项目成员。',
          confirmText: '去填写',
          cancelText: '稍后',
          success: (res) => resolve(Boolean(res.confirm)),
          fail: () => resolve(false),
        })
      })
      if (goFill) uni.switchTab({ url: '/pages/mine/index' })
      return
    }
    uni.showToast({ title: err.message || '确认失败', icon: 'none' })
  }
}

async function onReject(inv) {
  const confirmed = await confirmModal(
    '拒绝邀请',
    `拒绝后该邀请将从列表中消失，如需加入需联系 ${inv.tenantName} 重新邀请。`
  )
  if (!confirmed) return

  try {
    await rejectInvitation(inv.memberId)
    uni.showToast({ title: '已拒绝', icon: 'none' })
    await load()
  } catch (err) {
    uni.showToast({ title: err.message || '操作失败', icon: 'none' })
  }
}

function roleChipClass(role) {
  return ROLE_CHIP_CLASSES[role] || 'role-chip--owner'
}

function formatTime(value) {
  if (!value) return ''
  return String(value).slice(5, 16)
}

function confirmModal(title, content) {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      confirmText: '确认',
      cancelText: '取消',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
}

// ── 手机号绑定（空态）──

function bindByPhone() {
  if (binding.value) return

  const phone = phoneInput.value.trim()
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    uni.showToast({ title: '请输入正确的手机号', icon: 'none' })
    return
  }

  submitBind({ phone })
}

/** 微信 getPhoneNumber 回调：用 code 去后端换手机号 */
async function onGetPhoneNumber(event) {
  const detail = (event && event.detail) || {}
  if (!detail.code) {
    const denied = String(detail.errMsg || '').includes('deny')
    uni.showToast({ title: denied ? '你已取消手机号授权' : '未获取到手机号', icon: 'none' })
    return
  }

  await submitBind({ code: detail.code })
}

async function submitBind(payload) {
  if (binding.value) return
  binding.value = true

  try {
    const result = await bindPhone(payload)
    // 绑定可能触发占位账号合并，后端会换发 token；不替换就会被立刻踢下线
    if (result && result.token) setToken(result.token)

    const nextUser = {
      ...(getUser() || {}),
      hasPhone: true,
      phoneMasked: (result && result.phoneMasked) || user.value.phoneMasked || '',
    }
    setUser(nextUser)
    user.value = nextUser
    phoneInput.value = ''

    uni.showToast({ title: '手机号已绑定', icon: 'success' })
    // 绑定后可能立刻出现按手机号匹配的邀请，重新拉一次列表
    await load()
  } catch (err) {
    uni.showToast({ title: err.message || '绑定失败', icon: 'none' })
  } finally {
    binding.value = false
  }
}
function closeActiveSheet() {
  if (filterSheetOpen.value) closeFilterSheet()
}
</script>

<style scoped lang="scss">
.page {
  position: relative;
  min-height: 100vh;
  padding-bottom: dp(96);
  background: #faf6f1;
}

/* ── 顶部品牌区 ── */
.hero {
  position: relative;
  overflow: hidden;
  padding: 0 dp(16) dp(28);
  background: linear-gradient(180deg, #d94b12 0%, #eb5c20 44%, #f18852 74%, #faf6f1 100%);
}

.hero-skyline {
  position: absolute;
  right: 0;
  bottom: dp(12);
  left: 0;
  width: 100%;
  opacity: 0.16;
  pointer-events: none;
}

.hero-content {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-top: dp(14);
}

/* 小程序右上角有微信原生胶囊，筛选入口要往左让位；H5 保持设计稿位置 */
/* #ifdef MP-WEIXIN */
.hero-content {
  padding-right: dp(96);
}
/* #endif */

.brand {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.hero-actions {
  display: flex;
  align-items: flex-start;
  gap: dp(14);
  flex-shrink: 0;
}

.admin-entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: dp(2);
  flex-shrink: 0;
  color: #fff;
}

.admin-entry-icon {
  width: dp(20);
  height: dp(20);
}

.admin-entry-label {
  margin-top: dp(2);
  color: #fff;
  font-size: dp(11);
  font-weight: 500;
}

.filter-active-dot {
  position: absolute;
  top: dp(-1);
  right: dp(-2);
  width: dp(7);
  height: dp(7);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 50%;
  background: #f53f3f;
}

.brand-logo {
  width: dp(48);
  height: dp(48);
  margin-right: dp(12);
  border-radius: dp(16);
  box-shadow: 0 dp(4) dp(12) rgba(94, 45, 22, 0.12);
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-name {
  overflow: hidden;
  font-size: dp(24);
  font-weight: 800;
  color: #fff;
  letter-spacing: dp(-0.3);
  line-height: 1.1;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.brand-slogan {
  margin-top: dp(4);
  overflow: hidden;
  font-size: dp(12);
  color: rgba(255, 255, 255, 0.8);
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ── 搜索与筛选 ── */
.search-wrap {
  position: sticky;
  z-index: 35;
  margin-top: dp(-22);
  padding: 0 dp(16);
  transition: background-color 0.18s ease, box-shadow 0.18s ease;
}

.search-wrap--stuck {
  background: rgba(250, 246, 241, 0.82);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  box-shadow: 0 dp(6) dp(18) rgba(94, 45, 22, 0.05);
}

/* 吸顶栏底部羽化：避免背景在项目卡片上出现一条硬边 */
.search-wrap--stuck::after {
  position: absolute;
  right: 0;
  bottom: dp(-26);
  left: 0;
  height: dp(26);
  background: linear-gradient(
    180deg,
    rgba(250, 246, 241, 0.88) 0%,
    rgba(250, 246, 241, 0.56) 32%,
    rgba(250, 246, 241, 0) 100%
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
  background: #faf6f1;
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

.tabs {
  display: flex;
  align-items: center;
  gap: dp(6);
  margin-top: dp(10);
}

.tab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: dp(30);
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
  background: #f53f3f;
  color: #fff;
  font-size: dp(9);
  font-weight: 700;
  line-height: dp(13);
  text-align: center;
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

/* ── 待确认邀请 ── */
.invite-section {
  margin: dp(16) dp(16) 0;
  padding: dp(14);
  @include glass-surface(dp(16), 20px);
}

.invite-section--focus {
  background: linear-gradient(
    135deg,
    rgba(255, 249, 245, 0.94) 0%,
    rgba(255, 238, 228, 0.74) 100%
  );
  border-color: rgba(247, 199, 177, 0.9);
}

.invite-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(8);
}

.invite-title {
  font-size: dp(15);
  font-weight: 600;
  color: #241c17;
}

.invite-count {
  min-width: dp(20);
  height: dp(20);
  padding: 0 dp(6);
  border-radius: dp(10);
  background: #fdebe4;
  color: #c44710;
  font-size: dp(11);
  line-height: dp(20);
  text-align: center;
}

.invite-card {
  margin-top: dp(12);
  padding-top: dp(12);
  border-top: 1px solid #f3efea;
}

.invite-card--first {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.invite-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.invite-project {
  flex: 1;
  min-width: 0;
  margin-right: dp(10);
  font-size: dp(15);
  font-weight: 600;
  color: #241c17;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.invite-meta {
  display: block;
  margin-top: dp(4);
  font-size: dp(12);
  color: #6d6259;
  line-height: 1.4;
}

.role-chip {
  padding: dp(2) dp(6);
  border-radius: dp(4);
  font-size: dp(11);
  font-weight: 500;
  flex-shrink: 0;
}

.role-chip--foreman {
  background: #e8ffea;
  color: #087a1e;
}

.role-chip--supervisor {
  background: #fdebe4;
  color: #c44710;
}

.role-chip--owner {
  background: #fff7e8;
  color: #a85400;
}

.invite-actions {
  display: flex;
  margin-top: dp(10);
}

.invite-reject,
.invite-accept {
  flex: 1;
  height: dp(40);
  border-radius: dp(8);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: dp(14);
  font-weight: 600;
  line-height: 1;
}

.invite-btn-text {
  font-size: dp(14);
  font-weight: 600;
  line-height: 1;
}

.invite-reject .invite-btn-text {
  color: #51463e;
}

.invite-accept .invite-btn-text {
  color: #fff;
}

.invite-reject {
  margin-right: dp(10);
  background: #fff;
  border: 1px solid #e8e1da;
  color: #51463e;
}

.invite-accept {
  background: #eb5c20;
  color: #fff;
}

.invite-hint {
  margin: dp(12) dp(16) 0;
  padding: dp(12) dp(14);
  @include glass-surface(dp(10), 16px);
  background: linear-gradient(
    135deg,
    rgba(255, 248, 243, 0.9) 0%,
    rgba(255, 240, 232, 0.7) 100%
  );
  color: #6d6259;
  font-size: dp(12);
  line-height: 1.5;
}

/* ── 项目卡片 ── */
.project-list {
  display: flex;
  flex-direction: column;
  gap: dp(14);
  margin-top: dp(14);
  padding: 0 dp(16);
}

.project-card {
  padding: dp(14);
  @include glass-surface(dp(16), 20px);
}

.project-card:active {
  background: rgba(255, 255, 255, 0.72);
}

.project-main {
  display: flex;
  gap: dp(12);
}

.project-cover-wrap {
  position: relative;
  width: dp(100);
  height: dp(100);
  flex-shrink: 0;
  overflow: hidden;
  border-radius: dp(12);
  background: #f3efea;
}

.project-cover {
  width: 100%;
  height: 100%;
}

.status-badge {
  position: absolute;
  bottom: dp(6);
  left: dp(6);
  padding: dp(2) dp(6);
  border-radius: dp(4);
  color: #fff;
  font-size: dp(10);
  font-weight: 500;
  line-height: 1.4;
}

.status-badge--pending {
  background: #ff7d00;
}

.status-badge--building {
  background: #eb5c20;
}

.status-badge--finished {
  background: #51463e;
}

.status-badge--archived {
  background: #8b8179;
}

.project-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.project-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.project-name {
  flex: 1;
  min-width: 0;
  font-size: dp(15);
  font-weight: 700;
  color: #241c17;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.more-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(20);
  height: dp(20);
  margin-left: dp(4);
  flex-shrink: 0;
}

.more-icon {
  width: dp(16);
  height: dp(16);
}

.meta-row {
  display: flex;
  align-items: center;
  min-width: 0;
  margin-top: dp(4);
}

.meta-icon {
  width: dp(13);
  height: dp(13);
  margin-right: dp(4);
  flex-shrink: 0;
}

.meta-text {
  display: block;
  flex: 1;
  min-width: 0;
  color: #51463e;
  font-size: dp(12);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-owner {
  color: #eb5c20;
  font-weight: 500;
  white-space: nowrap;
}

.meta-divider {
  margin: 0 dp(6);
  color: #cfc6bd;
  white-space: nowrap;
}

.progress-block {
  margin-top: dp(8);
}

.progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(4);
}

.progress-label {
  color: #6d6259;
  font-size: dp(11);
}

.progress-value {
  color: #241c17;
  font-size: dp(11);
  font-weight: 600;
}

.progress-value--done {
  color: #087a1e;
}

.progress-track {
  height: dp(6);
  overflow: hidden;
  border-radius: dp(999);
  background: #f3efea;
}

.progress-fill {
  height: 100%;
  border-radius: dp(999);
  background: #eb5c20;
}

.progress-fill--done {
  background: #00b42a;
}

/* ── 阶段胶囊 ── */
.stage-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: dp(8);
  margin-top: dp(12);
}

.stage-pill {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: dp(6);
  border-radius: dp(8);
}

.stage-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(16);
  height: dp(16);
  margin-right: dp(4);
  border-radius: 50%;
  flex-shrink: 0;
}

.stage-icon {
  width: dp(10);
  height: dp(10);
}

.stage-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.stage-name {
  font-size: dp(11);
  font-weight: 500;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stage-state {
  font-size: dp(9);
  font-weight: 600;
  line-height: 1.15;
}

.stage-arrow {
  margin-left: auto;
  font-size: dp(11);
  line-height: 1;
}

.stage-pill--done {
  background: #e8ffea;
  color: #087a1e;
}

.stage-pill--done .stage-icon-wrap {
  background: #00b42a;
}

.stage-pill--active {
  background: #fdebe4;
  color: #eb5c20;
}

.stage-pill--active .stage-icon-wrap {
  background: #eb5c20;
}

.stage-pill--pending {
  background: #fff7e8;
  color: #a85400;
}

.stage-pill--pending .stage-icon-wrap {
  background: #ff7d00;
}

.stage-pill--danger {
  background: #ffece8;
  color: #b22a26;
}

.stage-pill--danger .stage-icon-wrap {
  background: #f53f3f;
}

.stage-pill--locked {
  background: #f3efea;
  color: #8b8179;
}

.stage-pill--locked .stage-icon-wrap {
  background: #cfc6bd;
}

.list-footnote {
  padding: dp(14) 0 dp(4);
  color: #51463e;
  font-size: dp(12);
  text-align: center;
}

/* ── 空态 / 加载 ── */
.no-project {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(48) dp(28) dp(24);
}

.no-project-logo {
  width: dp(56);
  height: dp(56);
  border-radius: dp(15);
  opacity: 0.55;
}

.no-project-title {
  margin-top: dp(18);
  font-size: dp(17);
  font-weight: 600;
  color: #241c17;
}

.no-project-text {
  margin-top: dp(8);
  padding: 0 dp(12);
  color: #6d6259;
  font-size: dp(13);
  line-height: 1.7;
  text-align: center;
}

.no-project-phone {
  margin-top: dp(12);
  color: #51463e;
  font-size: dp(12);
}

.no-project-bind {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(180);
  height: dp(42);
  margin-top: dp(20);
  border-radius: dp(8);
  background: #eb5c20;
  color: #fff;
  font-size: dp(15);
  font-weight: 600;
}

.no-project-bind:active {
  background: #c44710;
}

.bind-row {
  display: flex;
  align-items: center;
  width: dp(280);
  height: dp(42);
  margin-top: dp(20);
  overflow: hidden;
  border: 1px solid #e8e1da;
  border-radius: dp(8);
  background: #fff;
}

.bind-input {
  flex: 1;
  height: 100%;
  padding: 0 dp(12);
  color: #241c17;
  font-size: dp(14);
}

.bind-placeholder {
  color: #a19488;
}

.bind-btn {
  width: dp(72);
  height: 100%;
  border-radius: 0;
  background: #eb5c20;
  color: #fff;
  font-size: dp(14);
  font-weight: 600;
}

.bind-btn[disabled] {
  opacity: 0.7;
}

.no-project-hint {
  margin-top: dp(12);
  padding: 0 dp(20);
  color: #a19388;
  font-size: dp(11);
  line-height: 1.6;
  text-align: center;
}

.no-project-contact {
  margin-top: dp(16);
  color: #eb5c20;
  font-size: dp(13);
}

.no-project-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(160);
  height: dp(40);
  margin-top: dp(24);
  border: 1px solid #e8e1da;
  border-radius: dp(8);
  background: #fff;
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 600;
}

.no-project-refresh[disabled] {
  opacity: 0.6;
}

.search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(64) dp(28) dp(24);
}

.empty-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(80);
  height: dp(80);
  border-radius: 50%;
  background: #fdebe4;
}

.empty-search-icon {
  width: dp(48);
  height: dp(48);
}

.empty-title {
  margin-top: dp(16);
  color: #241c17;
  font-size: dp(17);
  font-weight: 600;
}

.empty-text {
  margin-top: dp(8);
  color: #51463e;
  font-size: dp(13);
  line-height: 1.7;
  text-align: center;
}

.empty-reset {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(40);
  margin-top: dp(24);
  padding: 0 dp(24);
  border: 1px solid #eb5c20;
  border-radius: dp(8);
  background: #fff;
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 600;
}

.loading {
  padding: dp(48) 0;
  text-align: center;
}

.loading-text {
  color: #8b8179;
  font-size: dp(13);
}

.load-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(64) dp(28);
}

.load-error-text {
  color: #6d6259;
  font-size: dp(14);
  text-align: center;
}

.load-error-retry {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(160);
  height: dp(40);
  margin-top: dp(20);
  border: 1px solid #e8e1da;
  border-radius: dp(8);
  background: #fff;
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 600;
}

/* ── 筛选面板 ── */
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
  /* 这是 tab 页；微信原生 tabBar 已经占掉底部安全区，
     再叠加 env(safe-area-inset-bottom) 会在按钮和 tabBar 之间留出一大块空白 */
  padding: dp(8) dp(16) dp(16);
  border-radius: dp(20) dp(20) 0 0;
  background: linear-gradient(
    160deg,
    rgba(255, 255, 255, 0.97) 0%,
    rgba(255, 255, 255, 0.9) 100%
  );
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  backdrop-filter: blur(30px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 -#{dp(10)} dp(40) rgba(29, 33, 41, 0.16);
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
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(8);
}

.sheet-title {
  color: #241c17;
  font-size: dp(17);
  font-weight: 600;
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

.sheet-section {
  margin-top: dp(16);
}

.sheet-label {
  display: block;
  margin-bottom: dp(8);
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.sheet-label--inline {
  margin-bottom: 0;
}

.sheet-options {
  display: flex;
  flex-wrap: wrap;
  gap: dp(8);
}

.sheet-option {
  height: dp(32);
  padding: 0 dp(14);
  border-radius: dp(999);
  background: #f3efea;
  color: #51463e;
  font-size: dp(13);
  line-height: dp(32);
}

.sheet-option--active {
  background: #fdebe4;
  color: #c44710;
  font-weight: 600;
}

.sheet-section--row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: dp(14);
  border-top: 1px solid #f3efea;
}

.sheet-link {
  display: flex;
  align-items: center;
  color: #eb5c20;
  font-size: dp(13);
}

.sheet-link-arrow {
  width: dp(12);
  height: dp(12);
  margin-left: dp(2);
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
</style>
