<template>
  <view class="page">
    <!-- 橙色 hero 恢复到资料卡下方的原始高度；底部只保留白色收口线，不加阴影 -->
    <view class="hero-panel" :style="{ height: `${safeTop + 175}px` }">
      <image class="hero-bg" src="/static/images/mine-hero-bg.png" mode="scaleToFill" />
      <image class="hero-arch" src="/static/images/mine-hero-arch.png" mode="aspectFit" />
      <view class="hero-glow" />
    </view>

    <view class="nav" :style="{ paddingTop: `${safeTop}px` }">
      <text class="nav-title">我的</text>
    </view>

    <view class="content gc-stagger">
      <!-- 用户资料 -->
      <view class="profile-card" @tap="openProfileSheet">
        <view class="profile-row">
          <view class="avatar-wrap">
            <image class="avatar" :src="avatarSrc" mode="aspectFill" @error="onAvatarError" />
          </view>
          <view class="profile-main">
            <view class="name-row">
              <text class="name">{{ displayName }}</text>
              <text v-if="roleLabel" class="role-badge">{{ roleLabel }}</text>
            </view>
            <view v-if="!profile" class="phone phone--loading">
              <gc-loading inline text="加载中" />
            </view>
            <text v-else class="phone" :class="{ 'phone--empty': !profile.hasPhone }">{{ phoneText }}</text>
          </view>
          <image class="chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
        </view>

        <view v-if="projects.length > 0" class="project-switch" @tap.stop="openProjectSheet">
          <view class="project-switch-main">
            <image class="project-home-icon" src="/static/images/icon-home-accent.png" mode="aspectFit" />
            <text class="project-label">当前项目</text>
            <text class="project-name">{{ projectName }}</text>
          </view>
          <image class="project-caret" src="/static/images/icon-caret-down-gray.png" mode="aspectFit" />
        </view>
      </view>

      <!-- 工长 / 监理：考察计划入口（C-6.3，不占 tabBar） -->
      <view v-if="canPlanRoute" class="route-banner" @tap="goRoutePlan">
        <view class="route-banner-icon">
          <image class="route-banner-icon-img" src="/static/images/icon-route-plan-accent.png" mode="aspectFit" />
        </view>
        <view class="route-banner-main">
          <view class="route-banner-title-row">
            <text class="route-banner-title">考察计划</text>
            <text class="route-banner-tag">顺路排线</text>
          </view>
          <text class="route-banner-sub">把今天要跑的工地排成一条路线，逐段导航</text>
        </view>
        <image class="route-banner-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
      </view>

      <!-- 业主：一键联系工长 / 监理 -->
      <view v-if="showContacts" class="card contacts-card">
        <view
          v-for="(contact, index) in contacts"
          :key="`${contact.role}-${contact.phone}`"
          class="contact-row"
          :class="{ 'contact-row--divided': index > 0 }"
        >
          <view class="contact-avatar" :class="contactAvatarClass(contact)">
            <image
              class="contact-avatar-icon"
              :src="contactIcon(contact)"
              mode="aspectFit"
            />
          </view>
          <view class="contact-main">
            <view class="contact-title-row">
              <text class="contact-role">{{ contactRole(contact) }}</text>
              <text class="contact-name">{{ contact.name }}</text>
            </view>
            <text class="contact-sub">{{ contactSubtitle(contact) }}</text>
          </view>
          <button class="call-btn" @tap.stop="callContact(contact.phone)">
            <image class="call-icon" src="/static/images/icon-phone-accent.png" mode="aspectFit" />
            <text>拨打</text>
          </button>
        </view>
      </view>

      <!-- 工长：本月汇报统计 -->
      <view v-else-if="showStats" class="card stats-card">
        <view class="stats-head">
          <view class="stats-head-main">
            <text class="stats-title">我的汇报</text>
            <text class="stats-scope">{{ statsScopeLabel }}</text>
          </view>
          <view class="stats-head-side">
            <text class="stats-month">{{ statsMonth }}</text>
          </view>
        </view>
        <view class="stats-grid">
          <view v-for="item in statsItems" :key="item.label" class="stat-item">
            <text class="stat-value">{{ item.value }}</text>
            <text class="stat-label">{{ item.label }}</text>
          </view>
        </view>
      </view>

      <!-- 无项目 / 未选择项目 -->
      <view v-else-if="!loading && emptyProjectState" class="card empty-card">
        <text class="empty-title">{{ emptyProjectState.title }}</text>
        <text class="empty-text">{{ emptyProjectState.text }}</text>
        <button class="empty-btn" @tap="emptyProjectAction">
          {{ emptyProjectState.action }}
        </button>
      </view>

      <!-- 常用功能 -->
      <view class="section">
        <text class="section-title">常用功能</text>
        <view class="quick-grid">
          <view class="quick-card" @tap="goMessages">
            <view class="quick-icon-wrap">
              <image class="quick-icon" src="/static/images/icon-quick-message.png" mode="aspectFit" />
              <text v-if="unreadTotal > 0" class="quick-badge">{{ unreadBadge }}</text>
            </view>
            <text class="quick-title">消息</text>
            <text class="quick-sub">最新动态</text>
          </view>

          <!-- 业主：只保留消息与验收报告；项目 / 验收 / 记账已在底部 tab 里 -->
          <view v-if="isOwnerRole" class="quick-card" @tap="goAcceptanceReports">
            <view class="quick-icon-wrap">
              <image class="quick-icon" src="/static/images/icon-quick-acceptance.png" mode="aspectFit" />
            </view>
            <text class="quick-title">验收报告</text>
            <text class="quick-sub">查看已完成验收</text>
          </view>

          <!-- 工长 / 监理：保留项目与验收入口（记账仅业主和工长可见） -->
          <template v-else>
            <view class="quick-card" @tap="goProjects">
              <view class="quick-icon-wrap">
                <image class="quick-icon" src="/static/images/icon-quick-project.png" mode="aspectFit" />
              </view>
              <text class="quick-title">我的项目</text>
              <text class="quick-sub">项目管理</text>
            </view>
            <view class="quick-card" @tap="goAcceptance">
              <view class="quick-icon-wrap">
                <image class="quick-icon" src="/static/images/icon-quick-acceptance.png" mode="aspectFit" />
              </view>
              <text class="quick-title">验收</text>
              <text class="quick-sub">在线验收</text>
            </view>
            <view v-if="canUseLedger" class="quick-card" @tap="goLedger">
              <view class="quick-icon-wrap">
                <image class="quick-icon" src="/static/images/icon-quick-ledger.png" mode="aspectFit" />
              </view>
              <text class="quick-title">记账</text>
              <text class="quick-sub">收支对账</text>
            </view>
          </template>
        </view>
      </view>

      <!-- 服务与设置 -->
      <view class="section">
        <text class="section-title">服务与设置</text>
        <view class="settings-card">
          <view
            v-for="(row, index) in serviceRows"
            :key="row.key"
            class="setting-row"
            :class="{ 'setting-row--divided': index > 0 }"
            @tap="openService(row.key)"
          >
            <view class="setting-icon-wrap">
              <image class="setting-icon" :src="row.icon" mode="aspectFit" />
            </view>
            <view class="setting-main">
              <text class="setting-title">{{ row.title }}</text>
              <text class="setting-sub">{{ row.sub }}</text>
            </view>
            <image class="setting-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>
      </view>

      <button class="deactivate-btn" :disabled="deactivating" @tap="confirmDeactivate">
        <view v-if="deactivating" class="deactivate-loading">
          <view class="deactivate-spinner" />
          <text>正在注销</text>
        </view>
        <template v-else>
          <image class="deactivate-icon" src="/static/images/icon-logout-gray.png" mode="aspectFit" />
          <text>注销账号</text>
        </template>
      </button>
      <text class="version">{{ branding.name }} v{{ appVersion }}</text>
    </view>

    <!-- 项目切换面板：第一项为「全部项目」 -->
    <view v-if="projectSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeProjectSheet">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">切换项目</text>
            <text class="sheet-sub">选择「全部项目」查看汇总，或进入单个项目</text>
          </view>
          <view class="sheet-close" @tap="closeProjectSheet">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <scroll-view class="project-list" scroll-y>
          <view
            class="project-option"
            :class="{ 'project-option--active': !currentProject }"
            @tap="selectAllProjects"
          >
            <view class="project-option-main">
              <view class="project-option-title-row">
                <text class="project-option-name">全部项目</text>
                <text class="project-option-role">汇总</text>
              </view>
              <text class="project-option-tenant">我的汇报按全部项目统计</text>
            </view>
            <text v-if="!currentProject" class="project-option-check">✓</text>
          </view>

          <view
            v-for="project in projects"
            :key="project.id"
            class="project-option"
            :class="{ 'project-option--active': currentProject && currentProject.id === project.id }"
            @tap="selectProject(project)"
          >
            <view class="project-option-main">
              <view class="project-option-title-row">
                <text class="project-option-name">{{ project.name }}</text>
                <text class="project-option-role">{{ project.myRoleLabel || roleLabelOf(project.myRole) }}</text>
              </view>
              <text class="project-option-tenant">{{ project.tenantName || '未命名租户' }}</text>
            </view>
            <text v-if="currentProject && currentProject.id === project.id" class="project-option-check">✓</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 个人资料面板 -->
    <view v-if="profileSheetOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="profileSheetOpen = false">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">个人资料</text>
            <text class="sheet-sub">可直接使用微信头像与昵称，也可以手动修改</text>
          </view>
          <view class="sheet-close" @tap="profileSheetOpen = false">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="profile-detail">
          <!-- 微信 chooseAvatar 只能在 button 上触发；H5 走 chooseImage 兜底 -->
          <button
            class="avatar-picker"
            open-type="chooseAvatar"
            @chooseavatar="onChooseAvatar"
            @tap="onAvatarPickerTap"
          >
            <image class="profile-detail-avatar" :src="avatarSrc" mode="aspectFill" />
            <text class="avatar-edit-badge">更换</text>
          </button>
          <text class="profile-edit-tip">点击头像可直接使用微信头像</text>

          <view class="profile-name-field profile-name-field--stacked">
            <view class="profile-name-head">
              <text class="profile-name-label">实名认证</text>
              <text v-if="profile && profile.requiresRealNameAuth" class="profile-required">（加入项目后必填）</text>
            </view>
            <view class="real-name-row">
              <view class="real-name-main">
                <text
                  class="real-name-status"
                  :class="{ 'real-name-status--verified': profile && profile.realNameVerified }"
                >
                  {{ profile && profile.realNameVerified ? '已实名' : '未实名' }}
                </text>
                <text v-if="profile && profile.realName" class="real-name-value">{{ profile.realName }}</text>
                <text v-if="profile && profile.idCardMask" class="real-name-mask">{{ profile.idCardMask }}</text>
              </view>
              <text class="real-name-action" @tap="goRealName">
                {{ profile && profile.realNameVerified ? '查看' : '去认证' }}
              </text>
            </view>
          </view>
          <text class="profile-edit-tip">实名认证后，姓名会显示在项目参与人、联系人和验收记录中</text>

          <view class="profile-name-field">
            <text class="profile-name-label">昵称</text>
            <input
              v-model="nicknameDraft"
              class="profile-name-input"
              type="nickname"
              maxlength="64"
              placeholder="请输入昵称"
              placeholder-class="profile-name-placeholder"
              @blur="nicknameDraft = nicknameDraft.trim()"
            />
          </view>
          <text class="profile-edit-tip">昵称输入框支持直接选择微信昵称</text>
          <text class="profile-detail-phone">{{ phoneText }}</text>
        </view>

        <button class="profile-save-btn" :disabled="savingProfile" @tap="saveProfile">
          {{ savingProfile ? '保存中…' : '保存资料' }}
        </button>

        <view class="detail-list">
          <view class="detail-row">
            <text class="detail-label">当前角色</text>
            <text class="detail-value">{{ roleLabel || '未加入项目' }}</text>
          </view>
          <view class="detail-row">
            <text class="detail-label">所属租户</text>
            <text class="detail-value">{{ currentProject?.tenantName || '—' }}</text>
          </view>
          <view class="detail-row">
            <text class="detail-label">当前项目</text>
            <text class="detail-value">{{ currentProject?.name || '—' }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 注销成功过场：遮住清会话后 reLaunch 的硬切换 -->
    <view v-if="leaving" class="exit-overlay">
      <view class="exit-card">
        <view class="exit-mark">
          <view class="exit-ring exit-ring--outer" />
          <view class="exit-ring exit-ring--inner" />
          <view class="exit-logo">
            <gc-brand-logo :src="branding.logoUrl" mode="aspectFit" />
          </view>
        </view>
        <text class="exit-title">账号已注销</text>
        <text class="exit-tip">个人资料已匿名化，历史业务记录仍会保留</text>
        <view class="exit-dots">
          <view
            v-for="n in 3"
            :key="n"
            class="exit-dot"
            :style="{ animationDelay: `${(n - 1) * 140}ms` }"
          />
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import {
  getToken,
  getCachedProjects,
  setCachedProjects,
  clearSession,
  getUser,
  setUser,
} from '../../store/session'
import {
  getCurrentProject,
  setCurrentProject,
  syncProjectContext,
  clearCurrentProject,
} from '../../store/projectContext'
import { branding, loadBranding } from '../../store/branding'
import { myProjects, projectContacts, projectMyStats, projectMyStatsAll } from '../../api/project'
import { deactivateAccount, getProfile, updateProfile, uploadAvatar } from '../../api/auth'
import { resolveMediaUrl } from '../../api/request'
import { refreshMineTabBadge, setMineTabBadge } from '../../utils/notificationBadge'
import { useSwipeClose } from '../../composables/useSwipeClose'

// 底部弹窗下滑关闭：绑定把手 / 标题区，不干扰表单滚动
const sheetSwipe = useSwipeClose(() => closeActiveSheet())
const sheetSwipeStyle = sheetSwipe.style

defineOptions({ name: 'MinePage' })

const APP_VERSION = '0.1.0'
const DEFAULT_AVATAR = '/static/images/mine-avatar-default.png'

const ROLE_LABELS = {
  owner: '业主',
  foreman: '工长',
  supervisor: '监理',
}

const serviceRows = [
  {
    key: 'subscription',
    title: '订阅消息管理',
    sub: '管理消息通知方式',
    icon: '/static/images/icon-bell-accent.png',
  },
  {
    key: 'feedback',
    title: '意见反馈',
    sub: '告诉我们您的建议',
    icon: '/static/images/icon-edit-accent.png',
  },
  {
    key: 'about',
    title: '关于我们',
    sub: '了解品牌故事',
    icon: '/static/images/icon-info-accent.png',
  },
  {
    key: 'legal',
    title: '用户协议 / 隐私政策',
    sub: '阅读并了解相关条款',
    icon: '/static/images/icon-document.png',
  },
]

const safeTop = ref(0)
const loading = ref(true)
const profile = ref(null)
const currentProject = ref(null)
const projects = ref([])
const supportContact = ref('')
const contacts = ref([])
const stats = ref(null)
// 统计对应的范围（all / project:<id>）。用于区分「同一范围的后台刷新」与
// 「切换项目」：前者保留旧值直到新值返回，后者必须先清空，避免串项目。
const statsScopeKey = ref('')
const contactsScopeId = ref(null)
const unreadTotal = ref(0)
const profileSheetOpen = ref(false)
const projectSheetOpen = ref(false)
const switching = ref(false)
// 「验收报告」入口：没有当前项目时先让用户选项目，选完自动进入报告页
const pendingAcceptanceReports = ref(false)
const deactivating = ref(false)
// 注销成功后的退出过场
const leaving = ref(false)
const avatarError = ref(false)
// 资料编辑：头像先选临时文件，保存时才上传；昵称直接改
const savingProfile = ref(false)
const nicknameDraft = ref('')
const avatarPreview = ref('')
const avatarChanged = ref(false)
const appVersion = APP_VERSION

let bootstrapped = false

const avatarSrc = computed(() => {
  // 刚选的临时文件优先展示，保存成功后再切回服务端地址
  if (avatarPreview.value) return avatarPreview.value
  if (!avatarError.value && profile.value && profile.value.avatar) {
    return resolveMediaUrl(profile.value.avatar)
  }
  return DEFAULT_AVATAR
})

const displayName = computed(() => {
  const realName = (profile.value && profile.value.realName) || ''
  if (realName.trim()) return realName.trim()
  const nickname = (profile.value && profile.value.nickname) || ''
  return nickname.trim() || '微信用户'
})

// 角色是账号级固定的；没有选中项目时仍然能显示「工长 / 监理 / 业主」
const accountRole = computed(
  () => (profile.value && (profile.value.accountRole || profile.value.role)) || null
)
const role = accountRole
const roleLabel = computed(() => {
  if (!role.value) return ''
  if (currentProject.value) {
    if (role.value === 'foreman' && profile.value.isPrimaryForeman) return '主工长'
    // 业主在当前项目下细分为主业主 / 临时业主；没有项目上下文时才显示账号角色「业主」
    if (profile.value.roleLabel) return profile.value.roleLabel
  }
  return (
    profile.value.accountRoleLabel ||
    ROLE_LABELS[role.value] ||
    role.value
  )
})

const phoneText = computed(() => {
  if (!profile.value) return '加载中…'
  return profile.value.phoneMasked || '未绑定手机号'
})

const projectName = computed(() => {
  if (currentProject.value) return currentProject.value.name
  return '全部项目'
})

const showContacts = computed(
  () => accountRole.value === 'owner' && Boolean(currentProject.value) && contacts.value.length > 0
)
const showStats = computed(() => accountRole.value === 'foreman' && Boolean(stats.value))
const canUseLedger = computed(
  () => accountRole.value === 'owner' || accountRole.value === 'foreman'
)
/** 业主端常用功能只保留消息与验收报告 */
const isOwnerRole = computed(() => accountRole.value === 'owner')
// 考察计划只对工长 / 监理开放（AC-N15）。按**所有项目**判断，
// 因为当前项目可能是业主，但他在另一个项目是工长，仍然需要这个入口。
const canPlanRoute = computed(
  () => accountRole.value === 'foreman' || accountRole.value === 'supervisor'
)

const unreadBadge = computed(() => (unreadTotal.value > 99 ? '99+' : String(unreadTotal.value)))

const statsMonth = computed(() => {
  const month = stats.value && stats.value.month
  if (!month) return '本月'
  const [year, value] = month.split('-')
  return `${year}年${Number(value)}月`
})

const statsScopeLabel = computed(() => {
  if (!stats.value) return ''
  if (stats.value.scope === 'all') {
    return stats.value.projectCount ? `全部项目 · ${stats.value.projectCount} 个` : '全部项目'
  }
  return (currentProject.value && currentProject.value.name) || '当前项目'
})

const statsItems = computed(() => {
  const data = stats.value || {}
  return [
    { label: '本月汇报', value: Number(data.monthReportCount) || 0 },
    { label: '待整改', value: Number(data.pendingRectifyCount) || 0 },
    { label: '待验收', value: Number(data.pendingAcceptanceCount) || 0 },
  ]
})

const emptyProjectState = computed(() => {
  if (projects.value.length === 0) {
    const hasPhone = Boolean(profile.value && profile.value.hasPhone)
    return {
      title: '还没有加入项目',
      text: supportContact.value
        ? `请联系装修公司管理员邀请你加入。客服联系方式：${supportContact.value}`
        : '项目邀请按手机号发送。请先绑定手机号，再联系装修公司管理员。',
      action: hasPhone ? '刷新项目' : '去绑定手机号',
      type: hasPhone ? 'refresh' : 'noProjects',
    }
  }
  if (!currentProject.value) {
    return {
      title: '还没有选择项目',
      text: '当前显示全部项目汇总。点击上方「当前项目」选择具体项目，或进入项目查看进度与账目。',
      action: '选择项目',
      type: 'noCurrent',
    }
  }
  return null
})

onLoad(() => {
  loadBranding()
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  if (!getToken()) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }

  init()
})

onShow(() => {
  if (bootstrapped && getToken()) refresh({ silent: true })
})

onPullDownRefresh(async () => {
  try {
    await refresh({ silent: true })
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function init() {
  loading.value = true

  // 先用缓存把项目名与上下文渲染出来，避免切到“我的”时空白
  const cached = getCachedProjects()
  if (cached) applyProjects(cached)

  try {
    const data = await myProjects()
    setCachedProjects(data)
    applyProjects(data)
    await loadProfileAndRole()
  } catch (err) {
    if (err.statusCode === 401) {
      uni.reLaunch({ url: '/pages/login/index' })
      return
    }
    if (!cached) {
      uni.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  } finally {
    loading.value = false
    bootstrapped = true
    refreshUnread()
  }
}

async function refresh({ silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    const data = await myProjects()
    setCachedProjects(data)
    applyProjects(data)
    await loadProfileAndRole()
  } catch (err) {
    if (err.statusCode === 401) {
      uni.reLaunch({ url: '/pages/login/index' })
      return
    }
    if (!silent) uni.showToast({ title: err.message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
    refreshUnread()
  }
}

function applyProjects(data) {
  projects.value = ((data && data.groups) || []).flatMap((group) => group.items || [])
  supportContact.value = (data && data.supportContact) || ''

  // 「我的」默认展示「全部项目」；只有用户明确点选项目后才切换上下文
  const context = syncProjectContext(data, { autoSelect: false })
  if (context.removed) {
    uni.showToast({ title: '上次进入的项目已不可用', icon: 'none' })
  }
  currentProject.value = context.current
}

async function loadProfileAndRole() {
  const projectId = currentProject.value ? currentProject.value.id : undefined
  const data = await getProfile(projectId)
  profile.value = data
  avatarError.value = false

  // 被邀请进入项目后必须完成实名认证：打开「我的」时提示，
  // 资料面板里给出「去认证」入口，不在这里直接跳走打断用户。
  if (data.requiresRealNameAuth && !profileSheetOpen.value) {
    openProfileSheet()
    uni.showToast({ title: '加入项目后请先完成实名认证', icon: 'none' })
  }

  // 后端的角色是最终事实；把本地项目上下文里的角色同步过去，
  // 避免记账 / 验收页面继续用上一个项目的旧角色。
  if (data.role && currentProject.value) {
    setCurrentProject({ ...currentProject.value, myRole: data.role })
    currentProject.value = getCurrentProject()
  }

  await loadRoleSection()
}

async function loadRoleSection() {
  if (!profile.value) return

  const role = accountRole.value

  if (role !== 'owner') {
    contacts.value = []
    contactsScopeId.value = null
  }
  if (role !== 'foreman') {
    stats.value = null
    statsScopeKey.value = ''
  }

  if (role === 'owner') {
    if (!currentProject.value) {
      contacts.value = []
      contactsScopeId.value = null
      return
    }
    // 切换项目时先清空，避免把上一个项目的联系人显示在新项目下；
    // 同一项目的后台刷新保留旧数据。
    if (contactsScopeId.value !== currentProject.value.id) contacts.value = []
    try {
      const data = await projectContacts(currentProject.value.id)
      contacts.value = (data && data.contacts) || []
      contactsScopeId.value = currentProject.value.id
    } catch (err) {
      // 业主联系人只对业主开放；角色刚变化时静默降级即可
    }
    return
  }

  if (role === 'foreman') {
    const nextScopeKey = currentProject.value ? `project:${currentProject.value.id}` : 'all'

    // 关键：只有范围真正变化时才清空。每次 onShow 的静默刷新如果先置 null，
    // 页面会先闪一下空白再加载，这就是「切到我的要等一下才显示汇报」的原因。
    if (statsScopeKey.value !== nextScopeKey) stats.value = null

    try {
      const data = currentProject.value
        ? await projectMyStats(currentProject.value.id)
        : await projectMyStatsAll()
      stats.value = data
      statsScopeKey.value = nextScopeKey
    } catch (err) {
      // 非工长 / 角色变化时后端会拒绝：只有切到新范围才隐藏，
      // 同一范围的刷新失败保留上一次成功的数据。
      if (statsScopeKey.value !== nextScopeKey) stats.value = null
    }
  }
}

function openProjectSheet() {
  if (!projects.value.length) {
    uni.showToast({ title: '还没有项目', icon: 'none' })
    return
  }
  projectSheetOpen.value = true
}

function closeProjectSheet() {
  if (switching.value) return
  pendingAcceptanceReports.value = false
  projectSheetOpen.value = false
}

async function selectAllProjects() {
  if (switching.value) return
  // 验收报告必须落到具体项目；此时不能选「全部项目」
  if (pendingAcceptanceReports.value) {
    uni.showToast({ title: '请选择一个具体项目', icon: 'none' })
    return
  }
  switching.value = true
  clearCurrentProject()
  currentProject.value = null
  projectSheetOpen.value = false
  try {
    await loadProfileAndRole()
    uni.showToast({ title: '已切换到全部项目', icon: 'success' })
  } catch (err) {
    uni.showToast({ title: err.message || '切换失败', icon: 'none' })
  } finally {
    switching.value = false
  }
}

async function selectProject(project) {
  if (switching.value) return
  if (currentProject.value && currentProject.value.id === project.id) {
    projectSheetOpen.value = false
    if (pendingAcceptanceReports.value) {
      pendingAcceptanceReports.value = false
      uni.navigateTo({ url: `/pages/acceptance/reports?projectId=${project.id}` })
    }
    return
  }

  const openAcceptanceReports = pendingAcceptanceReports.value
  pendingAcceptanceReports.value = false
  switching.value = true
  setCurrentProject({ ...project, myRole: project.myRole })
  currentProject.value = getCurrentProject()
  projectSheetOpen.value = false
  try {
    await loadProfileAndRole()
    uni.showToast({ title: '已切换项目', icon: 'success' })
    if (openAcceptanceReports) {
      uni.navigateTo({ url: `/pages/acceptance/reports?projectId=${project.id}` })
    }
  } catch (err) {
    uni.showToast({ title: err.message || '项目切换失败', icon: 'none' })
  } finally {
    switching.value = false
  }
}

async function refreshUnread() {
  const total = await refreshMineTabBadge()
  if (total !== null) unreadTotal.value = total
}

function onAvatarError() {
  avatarError.value = true
}

/** 打开资料面板时同步草稿，避免上次未保存的临时头像残留 */
function openProfileSheet() {
  nicknameDraft.value = ((profile.value && profile.value.nickname) || '').trim()
  avatarPreview.value = ''
  avatarChanged.value = false
  avatarError.value = false
  profileSheetOpen.value = true
}

/** 进入实名认证页；返回时 onShow 会静默刷新资料 */
function goRealName() {
  profileSheetOpen.value = false
  uni.navigateTo({ url: '/pages/mine/real-name' })
}

/** 微信「选择头像」回调；返回的是临时文件，保存时才上传 */
function onChooseAvatar(event) {
  const path = event && event.detail && event.detail.avatarUrl
  if (!path) return
  avatarPreview.value = path
  avatarChanged.value = true
  avatarError.value = false
}

/** H5 没有 chooseAvatar，用系统相册 / 相机兜底；小程序端由 open-type 接管 */
function onAvatarPickerTap() {
  // #ifndef MP-WEIXIN
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const path = (res.tempFilePaths || [])[0]
      if (!path) return
      avatarPreview.value = path
      avatarChanged.value = true
      avatarError.value = false
    },
  })
  // #endif
}

async function saveProfile() {
  if (savingProfile.value) return

  const nickname = String(nicknameDraft.value || '').trim()
  if (!nickname) {
    uni.showToast({ title: '请输入昵称', icon: 'none' })
    return
  }

  savingProfile.value = true
  try {
    if (avatarChanged.value && avatarPreview.value) {
      const uploaded = await uploadAvatar(avatarPreview.value)
      // 上传接口返回的是不带项目上下文的 profile，这里只取头像，
      // 项目角色仍保留当前值，避免保存头像后「我的」页角色标签消失
      profile.value = { ...profile.value, avatar: uploaded.avatar }
      avatarPreview.value = ''
      avatarChanged.value = false
      avatarError.value = false
    }

    const data = await updateProfile({ nickname })
    // 刷新一次带项目上下文的资料，恢复 role / roleLabel
    await loadProfileAndRole().catch(() => {})
    profile.value = {
      ...(profile.value || data),
      nickname: data.nickname,
      avatar: data.avatar,
    }

    const cached = getUser() || {}
    setUser({ ...cached, nickname: data.nickname, avatar: data.avatar })

    profileSheetOpen.value = false
    uni.showToast({ title: '资料已更新', icon: 'success' })
  } catch (err) {
    uni.showToast({ title: err.message || '保存失败，请稍后重试', icon: 'none' })
  } finally {
    savingProfile.value = false
  }
}

function roleLabelOf(roleKey) {
  return ROLE_LABELS[roleKey] || roleKey
}

function contactRole(contact) {
  if (contact.role === 'foreman' && contact.isPrimaryForeman) return '主工长'
  return contact.roleLabel || roleLabelOf(contact.role)
}

function contactSubtitle(contact) {
  return contact.role === 'supervisor' ? '负责工程质量监督' : '负责现场施工管理'
}

function contactAvatarClass(contact) {
  return contact.role === 'supervisor' ? 'contact-avatar--gray' : 'contact-avatar--accent'
}

function contactIcon(contact) {
  return contact.role === 'supervisor'
    ? '/static/images/icon-supervisor-portrait.png'
    : '/static/images/icon-foreman-portrait.png'
}

function callContact(phone) {
  if (!phone) return
  uni.makePhoneCall({ phoneNumber: String(phone) })
}

function goMessages() {
  uni.navigateTo({ url: '/pages/message/index' })
}

function goProjects() {
  uni.switchTab({ url: '/pages/projects/index' })
}

function goAcceptance() {
  uni.switchTab({ url: '/pages/acceptance/index' })
}

/**
 * 业主的「验收报告」：进入当前项目的验收报告库。
 *
 * 报告按项目归档，因此没有当前项目时先打开项目选择面板；
 * 选择具体项目后 selectProject 会接着跳到报告页。
 */
function goAcceptanceReports() {
  if (currentProject.value) {
    uni.navigateTo({
      url: `/pages/acceptance/reports?projectId=${currentProject.value.id}`,
    })
    return
  }

  if (projects.value.length === 0) {
    uni.showToast({ title: '还没有加入项目', icon: 'none' })
    return
  }

  pendingAcceptanceReports.value = true
  projectSheetOpen.value = true
}

function goRoutePlan() {
  uni.navigateTo({ url: '/pages/route-plan/index' })
}

function goLedger() {
  // 记账页自己提供项目下拉；没有当前项目时由它选择，不在「我的」里拦一道
  uni.switchTab({ url: '/pages/ledger/index' })
}

function emptyProjectAction() {
  const state = emptyProjectState.value
  if (state && state.type === 'noCurrent') {
    openProjectSheet()
    return
  }
  if (state && state.type === 'refresh') {
    refresh()
    return
  }
  goProjects()
}

function openService(key) {
  if (key === 'subscription') {
    const tenantId = currentProject.value ? currentProject.value.tenantId : ''
    const query = tenantId ? `?tenantId=${tenantId}` : ''
    uni.navigateTo({ url: `/pages/subscriptions/index${query}` })
    return
  }
  if (key === 'feedback') {
    const params = []
    if (currentProject.value) {
      params.push(`projectId=${currentProject.value.id}`)
      if (currentProject.value.tenantId) params.push(`tenantId=${currentProject.value.tenantId}`)
    }
    uni.navigateTo({ url: `/pages/feedback/index${params.length ? `?${params.join('&')}` : ''}` })
    return
  }
  if (key === 'about') {
    uni.navigateTo({ url: '/pages/legal/index?key=about' })
    return
  }
  if (key === 'legal') {
    uni.showActionSheet({
      itemList: ['用户协议', '隐私政策'],
      success: (res) => {
        uni.navigateTo({
          url: `/pages/legal/index?key=${res.tapIndex === 0 ? 'agreement' : 'privacy'}`,
        })
      },
    })
  }
}

function confirmModal(title, content, confirmText, confirmColor) {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      confirmText,
      confirmColor,
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
}

async function confirmDeactivate() {
  if (deactivating.value) return

  const first = await confirmModal(
    '注销账号',
    '注销后个人资料会被匿名化，但历史汇报、验收、账目等业务记录会保留。此操作不可恢复。',
    '继续',
    '#F53F3F'
  )
  if (!first) return

  const second = await confirmModal(
    '再次确认',
    '确定要注销当前账号吗？注销后当前登录状态会立即失效。',
    '确认注销',
    '#F53F3F'
  )
  if (!second) return

  deactivating.value = true
  try {
    await deactivateAccount()
    // 注销接口已经让 token 失效；先显示过场，再清本地会话并回登录页，
    // 避免页面直接硬切。
    leaving.value = true
    await new Promise((resolve) => setTimeout(resolve, 680))
    clearSession()
    setMineTabBadge(0)
    uni.reLaunch({
      url: '/pages/login/index',
      fail: () => {
        leaving.value = false
        deactivating.value = false
        uni.showToast({ title: '退出失败，请重试', icon: 'none' })
      },
    })
  } catch (err) {
    uni.showToast({ title: err.message || '注销失败，请稍后重试', icon: 'none' })
  } finally {
    if (!leaving.value) deactivating.value = false
  }
}
function closeActiveSheet() {
  if (projectSheetOpen.value) {
    closeProjectSheet()
  } else if (profileSheetOpen.value) {
    profileSheetOpen.value = false
  }
}
</script>

<style scoped lang="scss">
.page {
  position: relative;
  min-height: 100vh;
  padding-bottom: calc(#{dp(28)} + env(safe-area-inset-bottom));
  /* 页面底色里埋几团很淡的暖色光晕：玻璃卡片经过模糊后能看到细微折射，
     在接近白色的画布上才有“玻璃”可读；色值压得很低，不抢内容 */
  background:
    radial-gradient(58% 26% at 92% 27%, rgba(235, 92, 32, 0.09) 0%, rgba(235, 92, 32, 0) 72%),
    radial-gradient(46% 22% at 4% 52%, rgba(255, 180, 143, 0.13) 0%, rgba(255, 180, 143, 0) 72%),
    radial-gradient(52% 24% at 90% 80%, rgba(235, 92, 32, 0.06) 0%, rgba(235, 92, 32, 0) 72%),
    #faf7f4;
  overflow-x: hidden;
}

/* H5 的 tabBar 在页面内，给底部菜单留出空间 */
/* #ifdef H5 */
.page {
  padding-bottom: dp(86);
}
/* #endif */

/* ── 分层橙色头部：橙色块本身沿一条贯通页面的弧线收口 ── */
.hero-panel {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.hero-bg {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
}

.hero-arch {
  position: absolute;
  top: dp(8);
  right: dp(-12);
  z-index: 1;
  width: 78%;
  height: 84%;
  opacity: 0.95;
}

.hero-glow {
  position: absolute;
  top: dp(-45);
  right: dp(-25);
  z-index: 2;
  width: dp(230);
  height: dp(230);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.32) 0%, rgba(255, 255, 255, 0) 70%);
}

.nav {
  position: relative;
  z-index: 2;
  padding-right: dp(18);
  padding-left: dp(18);
}

.nav-title {
  display: block;
  padding-top: dp(8);
  padding-bottom: dp(10);
  color: #fff;
  font-size: dp(28);
  font-weight: 800;
  letter-spacing: dp(-0.4);
  line-height: 1.2;
  text-shadow: 0 dp(2) dp(8) rgba(120, 40, 10, 0.16);
}

.content {
  position: relative;
  z-index: 3;
  margin-top: dp(4);
  padding: 0 dp(18);
}

/* ── 资料卡 ── */
.profile-card {
  padding: dp(16);
  @include glass-surface(dp(20), 24px);
  /* 卡片允许跨过橙白收口线；不要再加外投影，否则会在橙色左右两侧留下阴影带 */
  background-color: rgba(255, 252, 248, 0.74);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.58);
}

.profile-row {
  display: flex;
  align-items: center;
}

.avatar-wrap {
  width: dp(64);
  height: dp(64);
  padding: dp(2);
  border-radius: 50%;
  background: linear-gradient(135deg, #ffe7d4, #fff5ec);
  flex-shrink: 0;
}

.avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #feead8;
}

.profile-main {
  flex: 1;
  min-width: 0;
  margin-left: dp(14);
}

.name-row {
  display: flex;
  align-items: center;
  gap: dp(7);
}

.name {
  overflow: hidden;
  color: #241c17;
  font-size: dp(20);
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.role-badge {
  padding: dp(2) dp(7);
  border-radius: dp(999);
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(10);
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.phone {
  display: block;
  margin-top: dp(6);
  color: #8b8179;
  font-size: dp(12);
}

.phone--empty {
  color: #eb5c20;
}

.chevron {
  width: dp(16);
  height: dp(16);
  margin-left: dp(8);
  flex-shrink: 0;
}

.project-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(14);
  padding: dp(9) dp(11);
  @include glass-surface(dp(12), 14px);
  background-color: rgba(255, 251, 246, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42);
}

.project-switch-main {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.project-home-icon {
  width: dp(14);
  height: dp(14);
  margin-right: dp(5);
  flex-shrink: 0;
}

.project-label {
  color: #8b8179;
  font-size: dp(11);
  white-space: nowrap;
}

.project-name {
  overflow: hidden;
  margin-left: dp(5);
  color: #241c17;
  font-size: dp(12);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-caret {
  width: dp(13);
  height: dp(13);
  margin-left: dp(8);
  flex-shrink: 0;
}

/* ── 考察计划入口 ── */
.route-banner {
  display: flex;
  align-items: center;
  margin-top: dp(18);
  padding: dp(13) dp(14);
  @include glass-surface(dp(16), 18px);
  /* 保持品牌暖调，但用单一底色，避免三段渐变在卡片中间形成色带 */
  background-color: rgba(255, 250, 246, 0.68);
  box-shadow:
    0 dp(4) dp(16) rgba(235, 92, 32, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.54);
}

.route-banner:active {
  transform: scale(0.99);
}

/* 图标底座用液态玻璃：与横幅的玻璃材质叠加，但保持不透明度足够看清橙色图标 */
.route-banner-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(38);
  height: dp(38);
  margin-right: dp(11);
  border: 1px solid rgba(255, 253, 250, 0.55);
  border-radius: dp(12);
  background-color: rgba(255, 251, 247, 0.62);
  -webkit-backdrop-filter: blur(14px) saturate(180%);
  backdrop-filter: blur(14px) saturate(180%);
  box-shadow:
    0 dp(2) dp(8) rgba(235, 92, 32, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.55);
  flex-shrink: 0;
}

.route-banner-icon-img {
  width: dp(21);
  height: dp(21);
}

.route-banner-main {
  min-width: 0;
  flex: 1;
}

.route-banner-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.route-banner-title {
  color: #241c17;
  font-size: dp(14);
  font-weight: 700;
}

.route-banner-tag {
  padding: dp(1) dp(5);
  border-radius: dp(4);
  background: #fdebe4;
  color: #c44710;
  font-size: dp(8);
  font-weight: 600;
}

.route-banner-sub {
  display: block;
  overflow: hidden;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.route-banner-chevron {
  width: dp(14);
  height: dp(14);
  margin-left: dp(8);
  flex-shrink: 0;
}

/* ── 联系人 / 统计 ── */
.card {
  margin-top: dp(18);
  padding: dp(16);
  @include glass-surface(dp(16), 20px);
}

.contacts-card {
  padding-top: dp(5);
  padding-bottom: dp(5);
}

.contact-row {
  display: flex;
  align-items: center;
  padding: dp(11) 0;
}

.contact-row--divided {
  border-top: 1px solid rgba(120, 82, 58, 0.09);
}

.contact-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(44);
  height: dp(44);
  margin-right: dp(11);
  border-radius: 50%;
  flex-shrink: 0;
}

.contact-avatar--accent {
  background: #fff1e5;
}

.contact-avatar--gray {
  background: #f1ebe5;
}

.contact-avatar-icon {
  width: dp(32);
  height: dp(32);
}

.contact-main {
  flex: 1;
  min-width: 0;
}

.contact-title-row {
  display: flex;
  align-items: baseline;
  min-width: 0;
}

.contact-role {
  color: #241c17;
  font-size: dp(15);
  font-weight: 700;
  white-space: nowrap;
}

.contact-name {
  margin-left: dp(6);
  overflow: hidden;
  color: #51463e;
  font-size: dp(15);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.contact-sub {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(11);
}

.call-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: dp(65);
  height: dp(30);
  margin-left: dp(8);
  padding: 0 dp(10);
  border: none;
  border-radius: dp(999);
  background: #fff2e8;
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 500;
  line-height: 1;
  flex-shrink: 0;
}

.call-btn:active {
  background: #ffe5d4;
}

.call-icon {
  width: dp(14);
  height: dp(14);
  margin-right: dp(3);
}

.stats-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: dp(10);
}

.stats-title {
  color: #241c17;
  font-size: dp(15);
  font-weight: 700;
}

.stats-month {
  color: #8b8179;
  font-size: dp(10);
}

.stats-head-main {
  min-width: 0;
}

.stats-scope {
  display: block;
  overflow: hidden;
  max-width: dp(190);
  margin-top: dp(3);
  color: #a79d94;
  font-size: dp(9);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats-head-side {
  display: flex;
  align-items: flex-end;
  gap: dp(4);
  flex-direction: column;
  flex-shrink: 0;
}

.stats-grid {
  display: flex;
}

.stat-item {
  flex: 1;
  text-align: center;
}

.stat-item + .stat-item {
  border-left: 1px solid rgba(120, 82, 58, 0.09);
}

.stat-value {
  display: block;
  color: #eb5c20;
  font-size: dp(22);
  font-weight: 800;
  line-height: 1.1;
}

.stat-label {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}

/* ── 无项目 ── */
.empty-card {
  text-align: center;
}

.empty-title {
  display: block;
  color: #241c17;
  font-size: dp(15);
  font-weight: 700;
}

.empty-text {
  display: block;
  margin-top: dp(7);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.6;
}

.empty-btn {
  min-width: dp(120);
  height: dp(34);
  margin-top: dp(12);
  border: 1px solid #f7c7b1;
  border-radius: dp(999);
  background: #fff7f2;
  color: #eb5c20;
  font-size: dp(12);
  line-height: dp(34);
}

/* ── 常用功能 ── */
.section {
  margin-top: dp(18);
}

.section-title {
  display: block;
  margin-bottom: dp(10);
  padding-left: dp(4);
  color: #241c17;
  font-size: dp(16);
  font-weight: 700;
  letter-spacing: dp(-0.2);
}

.quick-grid {
  display: flex;
  gap: dp(8);
}

.quick-card {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  padding: dp(12) dp(4) dp(10);
  @include glass-surface(dp(16), 18px);
  flex-direction: column;
}

.quick-card:active {
  transform: scale(0.97);
}

.quick-icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(40);
  height: dp(40);
  margin-bottom: dp(8);
  border: 1px solid rgba(255, 253, 250, 0.52);
  border-radius: 50%;
  background-color: rgba(255, 251, 247, 0.6);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  backdrop-filter: blur(12px) saturate(180%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.52),
    0 dp(1) dp(4) rgba(94, 45, 22, 0.04);
}

.quick-icon {
  width: dp(21);
  height: dp(21);
}

.quick-badge {
  position: absolute;
  top: dp(-3);
  right: dp(-4);
  min-width: dp(16);
  height: dp(16);
  padding: 0 dp(4);
  border: 2px solid #fff;
  border-radius: dp(8);
  background: #f53f3f;
  color: #fff;
  font-size: dp(9);
  font-weight: 700;
  line-height: dp(12);
  text-align: center;
}

.quick-title {
  color: #241c17;
  font-size: dp(12);
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
}

.quick-sub {
  margin-top: dp(3);
  color: #a79c92;
  font-size: dp(9);
  line-height: 1.2;
  white-space: nowrap;
}

/* ── 服务与设置 ── */
.settings-card {
  overflow: hidden;
  padding: 0 dp(14);
  @include glass-surface(dp(16), 20px);
}

.setting-row {
  display: flex;
  align-items: center;
  padding: dp(13) 0;
}

.setting-row--divided {
  border-top: 1px solid rgba(120, 82, 58, 0.09);
}

.setting-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(30);
  height: dp(30);
  margin-right: dp(12);
  flex-shrink: 0;
}

.setting-icon {
  width: dp(20);
  height: dp(20);
}

.setting-main {
  flex: 1;
  min-width: 0;
}

.setting-title {
  display: block;
  color: #241c17;
  font-size: dp(14);
  font-weight: 500;
}

.setting-sub {
  display: block;
  margin-top: dp(2);
  color: #a79c92;
  font-size: dp(10);
}

.setting-chevron {
  width: dp(15);
  height: dp(15);
  margin-left: dp(8);
  flex-shrink: 0;
}

/* ── 注销与版本 ── */
.deactivate-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: dp(44);
  margin-top: dp(20);
  border: 1px solid #e8e1da;
  border-radius: dp(999);
  background: #fff;
  color: #6d6259;
  font-size: dp(13);
  font-weight: 500;
  line-height: 1;
  box-shadow: 0 dp(1) dp(4) rgba(0, 0, 0, 0.02);
}

.deactivate-btn:active {
  background: #fbf9f7;
}

.deactivate-loading {
  display: flex;
  align-items: center;
}

.deactivate-spinner {
  width: dp(15);
  height: dp(15);
  margin-right: dp(7);
  border: 2px solid #e2dad3;
  border-top-color: #6d6259;
  border-radius: 50%;
  animation: deactivate-spin 720ms linear infinite;
}

@keyframes deactivate-spin {
  to {
    transform: rotate(360deg);
  }
}

.deactivate-icon {
  width: dp(16);
  height: dp(16);
  margin-right: dp(6);
}

.version {
  display: block;
  padding: dp(12) 0 dp(10);
  color: #a79c92;
  font-size: dp(10);
  letter-spacing: dp(0.4);
  text-align: center;
}

/* ── 底部面板 ── */
.sheet-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1300;
  display: flex;
  align-items: flex-end;
  background: rgba(29, 33, 41, 0.5);
}

.sheet {
  width: 100%;
  max-height: 82vh;
  overflow-y: auto;
  /* tab 页；微信原生 tabBar 已经处理底部安全区 */
  padding: dp(8) dp(16) dp(18);
  border-radius: dp(20) dp(20) 0 0;
  @include glass-sheet;
}

.sheet-handle {
  width: dp(36);
  height: dp(4);
  margin: 0 auto dp(10);
  border-radius: dp(999);
  background: #e8e1da;
}

.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: dp(12);
  border-bottom: 1px solid #f3efea;
}

.sheet-title {
  display: block;
  color: #241c17;
  font-size: dp(18);
  font-weight: 700;
}

.sheet-sub {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(11);
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(30);
  height: dp(30);
  flex-shrink: 0;
}

.sheet-close-icon {
  width: dp(16);
  height: dp(16);
}

.project-list {
  max-height: 60vh;
  padding-top: dp(6);
}

.project-option {
  display: flex;
  align-items: center;
  padding: dp(12);
  border-radius: dp(12);
}

.project-option--active {
  background: #fff7f2;
}

.project-option-main {
  flex: 1;
  min-width: 0;
}

.project-option-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.project-option-name {
  overflow: hidden;
  color: #241c17;
  font-size: dp(14);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-option-role {
  padding: dp(2) dp(6);
  border-radius: dp(999);
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(9);
  white-space: nowrap;
  flex-shrink: 0;
}

.project-option-tenant {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}

.project-option-check {
  margin-left: dp(10);
  color: #eb5c20;
  font-size: dp(17);
  font-weight: 700;
}

.profile-detail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(18) 0 dp(10);
}

/* 头像选择按钮：微信要求 chooseAvatar 挂在 button 上，重置掉原生按钮样式 */
.avatar-picker {
  position: relative;
  display: block;
  width: dp(64);
  height: dp(64);
  padding: 0;
  overflow: visible;
  border: none;
  border-radius: 50%;
  background: transparent;
  line-height: 1;
}

.avatar-picker::after {
  border: none;
}

.profile-detail-avatar {
  width: dp(64);
  height: dp(64);
  border: 3px solid #fdebe4;
  border-radius: 50%;
  background: #feead8;
}

.avatar-edit-badge {
  position: absolute;
  right: dp(-4);
  bottom: dp(-2);
  padding: dp(2) dp(6);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(9);
  font-weight: 600;
  line-height: 1.4;
  box-shadow: 0 dp(2) dp(6) rgba(235, 92, 32, 0.24);
}

.profile-edit-tip {
  margin-top: dp(6);
  color: #a79c92;
  font-size: dp(10);
  line-height: 1.4;
}

.profile-name-field {
  display: flex;
  align-items: center;
  width: 100%;
  margin-top: dp(16);
  padding: dp(8) dp(12);
  border: 1px solid rgba(120, 82, 58, 0.12);
  border-radius: dp(12);
  background: #fdfbf9;
}

.profile-name-field--stacked {
  display: block;
}

.profile-name-head {
  display: flex;
  align-items: center;
}

.real-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(8);
}

.real-name-main {
  display: flex;
  align-items: center;
  min-width: 0;
}

.real-name-status {
  padding: dp(2) dp(7);
  border-radius: dp(999);
  background: rgba(235, 92, 32, 0.1);
  color: #c44710;
  font-size: dp(10);
  font-weight: 600;
  flex-shrink: 0;
}

.real-name-status--verified {
  background: rgba(0, 180, 95, 0.1);
  color: #008a4a;
}

.real-name-value {
  margin-left: dp(8);
  overflow: hidden;
  color: #241c17;
  font-size: dp(14);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.real-name-mask {
  margin-left: dp(6);
  overflow: hidden;
  color: #a79c92;
  font-size: dp(10);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.real-name-action {
  margin-left: dp(10);
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 600;
  flex-shrink: 0;
}

.profile-name-label {
  margin-right: dp(10);
  color: #8b8179;
  font-size: dp(12);
  flex-shrink: 0;
}

.profile-name-input {
  flex: 1;
  min-width: 0;
  height: dp(24);
  color: #241c17;
  font-size: dp(15);
  font-weight: 600;
  text-align: right;
}

.profile-name-placeholder {
  color: #b9afa7;
  font-weight: 400;
}

.profile-required {
  color: #c44710;
  font-weight: 600;
}

.profile-save-btn {
  width: 100%;
  height: dp(42);
  margin-top: dp(14);
  border: none;
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(14);
  font-weight: 600;
  line-height: dp(42);
  box-shadow: 0 dp(6) dp(18) rgba(235, 92, 32, 0.22);
}

.profile-save-btn:active {
  background: #c44710;
}

.profile-save-btn[disabled] {
  opacity: 0.6;
}

.profile-detail-phone {
  margin-top: dp(10);
  color: #8b8179;
  font-size: dp(12);
}

.detail-list {
  margin-top: dp(8);
  border-top: 1px solid #f3efea;
}

.detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(12) 0;
  border-bottom: 1px solid #f3efea;
}

.detail-label {
  color: #8b8179;
  font-size: dp(12);
}

.detail-value {
  max-width: 65%;
  overflow: hidden;
  color: #241c17;
  font-size: dp(12);
  font-weight: 500;
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ── 注销成功过场 ── */
.exit-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 dp(28);
  background: rgba(24, 21, 19, 0.48);
  -webkit-backdrop-filter: blur(10px) saturate(140%);
  backdrop-filter: blur(10px) saturate(140%);
  animation: exit-overlay-in 220ms ease-out both;
}

@keyframes exit-overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.exit-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: dp(320);
  padding: dp(28) dp(24) dp(24);
  border: 1px solid rgba(255, 255, 255, 0.76);
  border-radius: dp(22);
  background: rgba(255, 250, 246, 0.97);
  box-shadow:
    0 dp(20) dp(48) rgba(24, 21, 19, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  animation: exit-card-in 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes exit-card-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(dp(8));
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.exit-mark {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(86);
  height: dp(86);
}

.exit-ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(235, 92, 32, 0.22);
  animation: exit-ring 700ms ease-out both;
}

.exit-ring--outer {
  width: dp(84);
  height: dp(84);
}

.exit-ring--inner {
  width: dp(68);
  height: dp(68);
  animation-delay: 90ms;
}

@keyframes exit-ring {
  0% {
    opacity: 0.75;
    transform: scale(1.18);
  }
  100% {
    opacity: 0;
    transform: scale(0.96);
  }
}

.exit-logo {
  position: relative;
  z-index: 1;
  width: dp(56);
  height: dp(56);
  border-radius: dp(16);
  overflow: hidden;
  background: #fff;
  opacity: 0.92;
  box-shadow:
    0 dp(8) dp(22) rgba(235, 92, 32, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.exit-title {
  margin-top: dp(16);
  color: #241c17;
  font-size: dp(17);
  font-weight: 800;
  letter-spacing: dp(-0.2);
}

.exit-tip {
  margin-top: dp(6);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.5;
  text-align: center;
}

.exit-dots {
  display: flex;
  align-items: center;
  margin-top: dp(16);
}

.exit-dot {
  width: dp(5);
  height: dp(5);
  margin: 0 dp(3);
  border-radius: 50%;
  background: #eb5c20;
  animation: exit-dot 900ms ease-in-out infinite;
}

@keyframes exit-dot {
  0%,
  80%,
  100% {
    opacity: 0.22;
    transform: translateY(0) scale(0.8);
  }
  40% {
    opacity: 1;
    transform: translateY(dp(-3)) scale(1);
  }
}
</style>
