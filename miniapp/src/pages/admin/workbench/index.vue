<template>
  <view class="admin-page admin-page--cool admin-page--tabbar workbench-page">
    <view class="hero" :style="{ paddingTop: `${safeTop + 6}px` }">
      <text class="hero-title">{{ brandTitle }}</text>

      <view class="hero-role">
        <text class="role-pill">{{ roleLabel }}</text>
      </view>

      <text class="hero-greeting">{{ greeting }}</text>
    </view>

    <view v-if="!stats" class="state-wrap">
      <AdminPageState :loading="loading" :error="error" @retry="load()" />
    </view>

    <view v-else class="content gc-stagger">
      <view class="overview-card">
        <view class="card-head">
          <text class="card-title">经营概览</text>
          <text class="card-range">实时</text>
        </view>
        <view class="stat-grid">
          <view v-for="item in overviewItems" :key="item.key" class="stat-tile">
            <text class="stat-label">{{ item.label }}</text>
            <text class="stat-value" :class="`stat-value--${item.tone}`">{{ item.display }}</text>
          </view>
        </view>
      </view>

      <view class="section">
        <view class="section-head">
          <view class="section-title-wrap">
            <text class="section-title">待办提醒</text>
            <text v-if="reminderCount" class="section-badge">{{ reminderCount }}</text>
          </view>
          <view v-if="reminderCount" class="section-link" @tap="openReminderSheet">
            <text>全部</text>
            <image class="section-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>

        <view class="reminder-card">
          <view
            v-for="item in previewReminders"
            :key="item.key"
            class="reminder-row"
            @tap="tapReminder(item)"
          >
            <view class="reminder-icon">!</view>
            <view class="reminder-main">
              <text class="reminder-title">{{ item.title }}</text>
              <text class="reminder-sub">{{ item.subtitle }}</text>
            </view>
            <image class="reminder-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
          <view v-if="!previewReminders.length" class="reminder-empty">暂无待办提醒</view>
        </view>
      </view>

      <view class="section">
        <view class="section-head">
          <text class="section-title">快捷管理</text>
        </view>
        <view class="quick-grid">
          <view v-for="action in quickActions" :key="action.key" class="quick-item" @tap="action.handler">
            <view class="quick-icon">
              <image class="quick-icon-img" :src="action.icon" mode="aspectFit" />
            </view>
            <text class="quick-label">{{ action.label }}</text>
          </view>
        </view>
      </view>

      <view class="section">
        <view class="section-head">
          <text class="section-title">最近项目</text>
          <view class="section-link" @tap="goProjects">
            <text>查看全部</text>
            <image class="section-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>
        <view class="recent-list">
          <AdminProjectCard
            v-for="project in recentProjects"
            :key="project.id"
            :project="project"
            compact
            @select="openProject"
          />
          <view v-if="!recentProjects.length" class="recent-empty">暂无项目，去创建第一个项目吧</view>
        </view>
      </view>
    </view>

    <AdminTabBar active="workbench" />

    <!-- 待办提醒 -->
    <view
      v-if="reminderOpen"
      class="admin-sheet-mask"
      @touchmove.stop
      @tap="closeReminderSheet"
    >
      <view class="admin-sheet reminder-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">待办提醒</text>
            <text class="admin-sheet-sub">
              {{ reminderCount ? `共 ${reminderCount} 条待处理` : '暂无待办' }}
            </text>
          </view>
          <view class="admin-sheet-close" @tap="closeReminderSheet">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="sheetLoading" class="sheet-state">
          <gc-loading inline text="加载中" />
        </view>
        <view v-else-if="sheetError" class="sheet-state">
          <text>{{ sheetError }}</text>
          <text class="sheet-retry" @tap="loadSheetNotifications(true)">重新加载</text>
        </view>
        <template v-else>
          <view
            v-for="item in sheetReminders"
            :key="item.key"
            class="sheet-reminder"
            @tap="tapReminder(item)"
          >
            <view class="reminder-icon">!</view>
            <view class="reminder-main">
              <text class="reminder-title">{{ item.title }}</text>
              <text v-if="item.subtitle" class="reminder-sub">{{ item.subtitle }}</text>
              <text v-if="item.createdAt" class="reminder-time">{{ formatDateTime(item.createdAt) }}</text>
            </view>
            <image class="reminder-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
          <view v-if="!sheetReminders.length" class="sheet-state">暂无待办提醒</view>
          <text v-if="sheetNote" class="sheet-note">{{ sheetNote }}</text>
          <button
            v-if="unread > 0"
            class="admin-btn admin-btn--block sheet-mark-all"
            :class="{ 'admin-btn--disabled': markingAll }"
            :disabled="markingAll"
            @tap="markAllRead"
          >
            {{ markingAll ? '处理中…' : '全部已读' }}
          </button>
        </template>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import AdminTabBar from '../../../components/admin/AdminTabBar.vue'
import AdminProjectCard from '../../../components/admin/AdminProjectCard.vue'
import {
  fetchAdminProjects,
  fetchAdminProjectStats,
  fetchAdminNotifications,
  markAdminNotificationsRead,
} from '../../../api/admin/project'
import { branding, loadBranding } from '../../../store/branding'
import {
  requireAdminSession,
  ADMIN_ROLE_LABELS,
  formatDateTime,
  showAdminError,
} from '../../../utils/admin'

defineOptions({ name: 'AdminWorkbenchPage' })

const info = uni.getSystemInfoSync()
const safeTop = ref(info.statusBarHeight || 12)

const profile = ref(null)
const stats = ref(null)
const recentProjects = ref([])
const previewNotifications = ref([])
const unread = ref(0)
const loading = ref(true)
const error = ref('')

const reminderOpen = ref(false)
const sheetNotifications = ref([])
const sheetLoading = ref(false)
const sheetLoaded = ref(false)
const sheetError = ref('')
const sheetTotal = ref(0)
const markingAll = ref(false)

let bootstrapped = false
let loadedOnce = false
let inFlight = false

const brandTitle = computed(() => `${branding.name || '柏总管'} · 管理端`)
const roleLabel = computed(() => ADMIN_ROLE_LABELS[profile.value && profile.value.role] || '管理员')

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了，注意休息，明天再继续'
  if (hour < 12) return '上午好，今天也要把项目管理得井井有条'
  if (hour < 18) return '下午好，今天也要把项目管理得井井有条'
  return '晚上好，今天也要把项目管理得井井有条'
})

const overviewItems = computed(() => {
  const data = stats.value
  return [
    { key: 'total', label: '项目总数', value: data ? data.total : null, tone: 'total' },
    {
      key: 'building',
      label: '施工中',
      value: data ? data.statusCounts.building : null,
      tone: 'building',
    },
    {
      key: 'acceptance',
      label: '待验收',
      value: data ? data.pendingAcceptance : null,
      tone: 'acceptance',
    },
    { key: 'overdue', label: '延期项目', value: data ? data.overdue : null, tone: 'overdue' },
  ].map((item) => ({
    ...item,
    display: item.value === null || item.value === undefined ? '—' : String(item.value),
  }))
})

const pendingInvitations = computed(() =>
  stats.value ? Number(stats.value.pendingInvitations) || 0 : 0
)

const inviteReminder = computed(() => ({
  key: 'invite',
  kind: 'invite',
  title: '待确认的项目邀请',
  subtitle: `${pendingInvitations.value} 位成员尚未加入`,
}))

function notificationReminder(item) {
  return {
    key: `notification-${item.id}`,
    kind: 'notification',
    title: item.title,
    subtitle: item.content || '点击查看详情',
    createdAt: item.createdAt,
    raw: item,
  }
}

const previewReminders = computed(() => {
  const list = []
  if (pendingInvitations.value > 0) list.push(inviteReminder.value)
  for (const item of previewNotifications.value) list.push(notificationReminder(item))
  return list.slice(0, 2)
})

const reminderCount = computed(() => unread.value + (pendingInvitations.value > 0 ? 1 : 0))

const sheetReminders = computed(() => {
  const list = []
  if (pendingInvitations.value > 0) list.push(inviteReminder.value)
  for (const item of sheetNotifications.value) list.push(notificationReminder(item))
  return list
})

const sheetNote = computed(() => {
  if (!sheetLoaded.value) return ''
  const total = Number(sheetTotal.value) || 0
  return total > sheetNotifications.value.length
    ? `仅展示最近 ${sheetNotifications.value.length} 条未读，共 ${total} 条`
    : ''
})

const quickActions = [
  {
    key: 'projects',
    label: '项目管理',
    icon: '/static/images/icon-home-accent.png',
    handler: () => uni.redirectTo({ url: '/pages/admin/projects/index' }),
  },
  {
    key: 'create',
    label: '新建项目',
    icon: '/static/images/icon-admin-create-accent.png',
    handler: () => uni.navigateTo({ url: '/pages/admin/project/form' }),
  },
  {
    key: 'members',
    label: '成员邀请',
    icon: '/static/images/icon-members-accent.png',
    handler: () => uni.redirectTo({ url: '/pages/admin/members/index?invite=1' }),
  },
  {
    key: 'stages',
    label: '阶段管理',
    icon: '/static/images/icon-list-accent.png',
    handler: () => uni.navigateTo({ url: '/pages/admin/projects/index?mode=stages' }),
  },
]

onLoad(async () => {
  loadBranding()

  try {
    profile.value = await requireAdminSession()
  } catch (err) {
    error.value = err.message || '管理员信息加载失败'
    loading.value = false
    return
  }

  bootstrapped = true
  if (profile.value) await load()
  else loading.value = false
})

onShow(() => {
  if (bootstrapped && loadedOnce && profile.value && !loading.value) load({ silent: true })
})

onPullDownRefresh(async () => {
  try {
    if (profile.value) await load({ silent: true })
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function load({ silent = false } = {}) {
  if (!profile.value) return
  if (inFlight) return
  inFlight = true

  if (!silent) {
    loading.value = true
    error.value = ''
  }

  try {
    const [statsData, projectsData, notificationData] = await Promise.all([
      fetchAdminProjectStats(),
      fetchAdminProjects({
        page: 1,
        pageSize: 3,
        sortField: 'created_at',
        sortDirection: 'desc',
      }).catch(() => null),
      fetchAdminNotifications({ page: 1, pageSize: 2, onlyUnread: true }).catch(() => null),
    ])

    stats.value = statsData
    recentProjects.value = (projectsData && projectsData.list) || []
    if (notificationData) {
      previewNotifications.value = notificationData.list || []
      unread.value = Number(notificationData.unread) || 0
    }
    loadedOnce = true

    if (!silent && (!projectsData || !notificationData)) {
      uni.showToast({ title: '部分数据加载失败', icon: 'none' })
    }
  } catch (err) {
    if (silent && stats.value) {
      showAdminError(err, '工作台刷新失败')
    } else {
      error.value = err.message || '工作台加载失败'
    }
  } finally {
    inFlight = false
    loading.value = false
  }
}

function goProjects() {
  uni.redirectTo({ url: '/pages/admin/projects/index' })
}

function openProject(project) {
  if (!project || !project.id) return
  uni.navigateTo({ url: `/pages/admin/project/detail?id=${project.id}` })
}

async function openReminderSheet() {
  reminderOpen.value = true
  if (!sheetLoaded.value) await loadSheetNotifications()
}

function closeReminderSheet() {
  reminderOpen.value = false
}

async function loadSheetNotifications(force = false) {
  if (sheetLoading.value) return
  if (sheetLoaded.value && !force) return

  sheetLoading.value = true
  sheetError.value = ''
  try {
    const data = await fetchAdminNotifications({ page: 1, pageSize: 50, onlyUnread: true })
    sheetNotifications.value = (data && data.list) || []
    sheetTotal.value = Number(data && data.total) || 0
    unread.value = Number(data && data.unread) || 0
    sheetLoaded.value = true
  } catch (err) {
    sheetError.value = err.message || '待办加载失败'
  } finally {
    sheetLoading.value = false
  }
}

async function markRead(item) {
  const raw = item.raw
  if (!raw || raw.isRead) return true
  try {
    const result = await markAdminNotificationsRead([raw.id])
    unread.value = Number(result && result.unread) || 0
    sheetTotal.value = unread.value
    previewNotifications.value = previewNotifications.value.filter((n) => n.id !== raw.id)
    sheetNotifications.value = sheetNotifications.value.filter((n) => n.id !== raw.id)
    return true
  } catch (err) {
    showAdminError(err, '标记已读失败')
    return false
  }
}

async function tapReminder(item) {
  if (item.kind === 'invite') {
    reminderOpen.value = false
    uni.redirectTo({ url: '/pages/admin/members/index' })
    return
  }

  const raw = item.raw
  const ok = await markRead(item)
  if (!ok) return

  reminderOpen.value = false
  if (raw && raw.refType === 'project' && Number(raw.refId)) {
    uni.navigateTo({ url: `/pages/admin/project/detail?id=${raw.refId}` })
    return
  }

  uni.showModal({
    title: (raw && raw.title) || item.title,
    content: (raw && raw.content) || item.subtitle || '',
    showCancel: false,
  })
}

async function markAllRead() {
  if (markingAll.value || unread.value === 0) return
  markingAll.value = true
  try {
    const result = await markAdminNotificationsRead()
    unread.value = Number(result && result.unread) || 0
    sheetTotal.value = unread.value
    previewNotifications.value = []
    sheetNotifications.value = []
    sheetLoaded.value = true
    uni.showToast({ title: '已全部标记为已读', icon: 'none' })
  } catch (err) {
    showAdminError(err, '操作失败')
  } finally {
    markingAll.value = false
  }
}
</script>

<style scoped lang="scss">
.workbench-page {
  background: #f6f7f9;
}

.hero {
  padding-right: dp(16);
  padding-bottom: dp(36);
  padding-left: dp(16);
  /* 顶部高光模拟玻璃受光面；垂直渐变保证左右两侧同一高度底色一致 */
  background:
    radial-gradient(circle at 82% 4%, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0) 42%),
    linear-gradient(180deg, #eb5c20 0%, #f07a3a 52%, #f6f7f9 100%);
}

.hero-title {
  display: block;
  color: #fff;
  font-size: dp(26);
  font-weight: 800;
  letter-spacing: dp(0.3);
  line-height: 1.2;
}

.hero-role {
  display: flex;
  align-items: center;
  margin-top: dp(16);
}

.role-pill {
  padding: dp(7) dp(14);
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: dp(999);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.95) 0%,
    rgba(255, 255, 255, 0.76) 100%
  );
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 600;
  white-space: nowrap;
  box-shadow:
    0 dp(4) dp(16) rgba(120, 40, 10, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
}

.hero-greeting {
  display: block;
  margin-top: dp(14);
  color: rgba(255, 255, 255, 0.9);
  font-size: dp(13);
  line-height: 1.4;
}

.state-wrap {
  margin-top: dp(-18);
  padding: 0 dp(16);
}

.content {
  margin-top: dp(-18);
  padding: 0 dp(16);
}

.overview-card {
  padding: dp(16);
  /* 经营概览是工作台的主视觉卡片：不用半透明白，否则在冷灰画布上几乎看不出边界 */
  border: 1px solid rgba(235, 92, 32, 0.14);
  border-top-color: rgba(255, 255, 255, 0.96);
  border-radius: dp(20);
  background: linear-gradient(145deg, #fffdfb 0%, #ffffff 46%, #fff6ef 100%);
  box-shadow:
    0 dp(10) dp(28) rgba(29, 33, 41, 0.1),
    0 dp(2) dp(8) rgba(235, 92, 32, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.98);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  color: #1d2129;
  font-size: dp(17);
  font-weight: 700;
}

.card-range {
  color: #86909c;
  font-size: dp(12);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: dp(8);
  margin-top: dp(12);
}

.stat-tile {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: dp(78);
  padding: dp(12);
  border: 1px solid #f1e9e2;
  border-radius: dp(14);
  background: #ffffff;
  box-shadow: 0 dp(2) dp(8) rgba(29, 33, 41, 0.045);
}

.stat-label {
  color: #86909c;
  font-size: dp(12);
  font-weight: 500;
}

.stat-value {
  margin-top: dp(8);
  font-size: dp(28);
  font-weight: 800;
  line-height: 1;
}

.stat-value--total {
  color: #eb5c20;
}

.stat-value--building {
  color: #00b42a;
}

.stat-value--acceptance {
  color: #ff7d00;
}

.stat-value--overdue {
  color: #f53f3f;
}

.section {
  margin-top: dp(18);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: dp(28);
  padding: 0 dp(2);
  margin-bottom: dp(9);
}

.section-title-wrap {
  display: flex;
  align-items: center;
}

.section-title {
  color: #1d2129;
  font-size: dp(17);
  font-weight: 700;
}

.section-badge {
  min-width: dp(20);
  height: dp(20);
  margin-left: dp(6);
  padding: 0 dp(6);
  border-radius: dp(999);
  background: #fff2ed;
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 700;
  line-height: dp(20);
  text-align: center;
}

.section-link {
  display: flex;
  align-items: center;
  color: #86909c;
  font-size: dp(12);
}

.section-chevron {
  width: dp(12);
  height: dp(12);
  margin-left: dp(2);
}

.reminder-card {
  padding: 0 dp(14);
  @include glass-surface(dp(20), 22px);
}

.reminder-row {
  display: flex;
  align-items: center;
  padding: dp(12) 0;
  border-bottom: 1px solid #f2f3f5;
}

.reminder-row:last-child {
  border-bottom: none;
}

.reminder-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(32);
  height: dp(32);
  border-radius: 50%;
  background: #fff2ed;
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 800;
  flex-shrink: 0;
}

.reminder-main {
  flex: 1;
  min-width: 0;
  margin-left: dp(10);
}

.reminder-title {
  display: block;
  overflow: hidden;
  color: #1d2129;
  font-size: dp(15);
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.reminder-sub {
  display: block;
  margin-top: dp(3);
  overflow: hidden;
  color: #86909c;
  font-size: dp(12);
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.reminder-time {
  display: block;
  margin-top: dp(3);
  color: #c9cdd4;
  font-size: dp(10);
}

.reminder-chevron {
  width: dp(13);
  height: dp(13);
  margin-left: dp(8);
  flex-shrink: 0;
}

.reminder-empty {
  padding: dp(18) 0;
  color: #86909c;
  font-size: dp(12);
  text-align: center;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: dp(8);
}

.quick-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(12) dp(4);
  @include glass-surface(dp(16), 18px);
}

.quick-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(44);
  height: dp(44);
  margin-bottom: dp(8);
  border-radius: dp(14);
  background: #fff2ed;
}

.quick-icon-img {
  width: dp(22);
  height: dp(22);
}

.quick-label {
  color: #1d2129;
  font-size: dp(12);
  font-weight: 600;
  line-height: 1.3;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: dp(10);
}

.recent-empty {
  padding: dp(20);
  @include glass-surface(dp(16), 18px);
  color: #86909c;
  font-size: dp(12);
  text-align: center;
}

.reminder-sheet {
  max-height: 78vh;
}

.sheet-reminder {
  display: flex;
  align-items: center;
  padding: dp(11) 0;
  border-bottom: 1px solid #f2f3f5;
}

.sheet-reminder:last-child {
  border-bottom: none;
}

.sheet-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(24) 0;
  color: #86909c;
  font-size: dp(12);
  line-height: 1.6;
}

.sheet-retry {
  margin-top: dp(6);
  color: #eb5c20;
  font-weight: 600;
}

.sheet-note {
  display: block;
  padding: dp(8) 0 0;
  color: #c9cdd4;
  font-size: dp(10);
  text-align: center;
}

.sheet-mark-all {
  margin-top: dp(14);
}
</style>
