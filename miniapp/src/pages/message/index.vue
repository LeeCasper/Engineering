<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <text class="nav-title">消息中心</text>
      <text
        class="nav-action"
        :class="{ 'nav-action--disabled': unreadTotal === 0 || markingAll }"
        @tap="markAllRead"
      >
        {{ markingAll ? '处理中' : '全部已读' }}
      </text>
    </view>

    <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false">
      <view class="filter-row">
        <view
          v-for="filter in FILTERS"
          :key="filter.key"
          class="filter-chip"
          :class="{ 'filter-chip--active': activeType === filter.key }"
          @tap="changeFilter(filter.key)"
        >
          {{ filter.label }}
        </view>
      </view>
    </scroll-view>

    <view v-if="loading && !messages.length" class="gc-loading-page">
      <gc-skeleton :rows="4" />
    </view>

    <view v-else-if="error && !messages.length" class="state">
      <image class="state-icon" src="/static/images/icon-message-accent.png" mode="aspectFit" />
      <text class="state-title">消息加载失败</text>
      <text class="state-text">{{ error }}</text>
      <button class="state-btn" @tap="load(true)">重新加载</button>
    </view>

    <view v-else-if="!messages.length" class="state">
      <image class="state-icon state-icon--empty" src="/static/images/icon-message-accent.png" mode="aspectFit" />
      <text class="state-title">暂无消息</text>
      <text class="state-text">验收、进度、付款和评论提醒会显示在这里</text>
    </view>

    <view v-else class="list">
      <view
        v-for="message in messages"
        :key="message.id"
        class="message-card"
        :class="{ 'message-card--unread': !message.isRead }"
        @tap="openMessage(message)"
      >
        <view class="type-icon" :class="`type-icon--${message.type}`">
          <text class="type-icon-text">{{ typeInitial(message.type) }}</text>
        </view>
        <view class="message-main">
          <view class="message-top">
            <text class="message-title">{{ message.title }}</text>
            <text class="message-time">{{ formatTime(message.createdAt) }}</text>
          </view>
          <text v-if="message.content" class="message-content">{{ message.content }}</text>
          <view class="message-foot">
            <text class="message-type">{{ typeLabel(message.type) }}</text>
            <text v-if="!message.isRead" class="unread-dot">未读</text>
          </view>
        </view>
      </view>

      <view v-if="messages.length < total" class="load-more" @tap="loadMore">
        <gc-loading v-if="loadingMore" inline text="加载中" />
        <text v-else>加载更多</text>
      </view>
      <view v-else class="list-end">— 没有更多消息了 —</view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { getToken, getCachedProjects, setCachedProjects } from '../../store/session'
import { setCurrentProject } from '../../store/projectContext'
import { myProjects } from '../../api/project'
import {
  fetchNotifications,
  markNotificationsRead,
} from '../../api/notification'
import { setMineTabBadge } from '../../utils/notificationBadge'

defineOptions({ name: 'MessagePage' })

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'acceptance', label: '验收' },
  { key: 'progress', label: '进度' },
  { key: 'payment', label: '付款' },
  { key: 'comment', label: '评论' },
]

const TYPE_LABELS = {
  acceptance: '验收通知',
  progress: '进度提醒',
  payment: '付款提醒',
  comment: '评论回复',
  system: '系统通知',
}

const TYPE_INITIALS = {
  acceptance: '验',
  progress: '进',
  payment: '款',
  comment: '评',
  system: '系',
}

const safeTop = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const markingAll = ref(false)
const error = ref('')
const messages = ref([])
const activeType = ref('')
const page = ref(1)
const pageSize = 20
const total = ref(0)
const unreadTotal = ref(0)

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
    const data = await fetchNotifications({
      page: page.value,
      pageSize,
      type: activeType.value || undefined,
    })
    const list = (data && data.list) || []
    messages.value = reset ? list : messages.value.concat(list)
    total.value = Number(data && data.total) || 0
    applyUnread(Number(data && data.unread) || 0)
    loadedOnce = true
  } catch (err) {
    if (err.statusCode === 401) {
      uni.reLaunch({ url: '/pages/login/index' })
      return
    }
    error.value = err.message || '加载失败'
    if (loadedOnce && reset) {
      uni.showToast({ title: error.value, icon: 'none' })
    }
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function changeFilter(type) {
  if (activeType.value === type) return
  activeType.value = type
  messages.value = []
  total.value = 0
  load(true)
}

function loadMore() {
  if (loading.value || loadingMore.value || messages.value.length >= total.value) return
  page.value += 1
  load(false)
}

function applyUnread(totalUnread) {
  unreadTotal.value = totalUnread
  setMineTabBadge(totalUnread)
}

async function markAllRead() {
  if (markingAll.value || unreadTotal.value === 0) return
  markingAll.value = true
  try {
    const data = await markNotificationsRead()
    messages.value = messages.value.map((item) => ({ ...item, isRead: true }))
    applyUnread(Number(data && data.unread) || 0)
    uni.showToast({ title: '已全部标记为已读', icon: 'success' })
  } catch (err) {
    uni.showToast({ title: err.message || '操作失败', icon: 'none' })
  } finally {
    markingAll.value = false
  }
}

async function markOneRead(message) {
  if (message.isRead) return
  try {
    const data = await markNotificationsRead([message.id])
    message.isRead = true
    applyUnread(Number(data && data.unread) || 0)
  } catch (err) {
    // 标记失败不阻断跳转：用户仍然需要看到对应的业务详情
  }
}

async function openMessage(message) {
  await markOneRead(message)
  await navigateForMessage(message)
}

async function navigateForMessage(message) {
  const projectId = message.projectId

  if (message.refType === 'acceptance' && message.refId) {
    uni.navigateTo({
      url: `/pages/acceptance/detail?id=${message.refId}`,
      fail: () => uni.showToast({ title: '验收单已不可用', icon: 'none' }),
    })
    return
  }

  if (message.refType === 'report' && projectId) {
    await ensureCurrentProject(projectId)
    uni.navigateTo({
      url: `/pages/project/feed?projectId=${projectId}`,
      fail: () => uni.showToast({ title: '项目动态已不可用', icon: 'none' }),
    })
    return
  }

  if ((message.refType === 'ledger' || message.refType === 'reconciliation') && projectId) {
    await ensureCurrentProject(projectId)
    uni.switchTab({ url: '/pages/ledger/index' })
    return
  }

  if (message.refType === 'project') {
    const id = message.refId || projectId
    if (id) {
      uni.navigateTo({
        url: `/pages/project/index?id=${id}`,
        fail: () => uni.showToast({ title: '项目已不可用', icon: 'none' }),
      })
    }
    return
  }

  if (message.refType === 'project_member' && projectId) {
    uni.navigateTo({
      url: `/pages/project/index?id=${projectId}`,
      fail: () => uni.showToast({ title: '项目已不可用', icon: 'none' }),
    })
  }
}

async function ensureCurrentProject(projectId) {
  if (!projectId) return
  const cached = getCachedProjects()
  let project = findProject(cached, projectId)

  if (!project) {
    try {
      const data = await myProjects()
      setCachedProjects(data)
      project = findProject(data, projectId)
    } catch (err) {
      // 找不到项目时不阻断跳转，目标页会按自己的守卫处理
    }
  }

  if (project) setCurrentProject(project)
}

function findProject(data, projectId) {
  const groups = (data && data.groups) || []
  for (const group of groups) {
    const found = (group.items || []).find((item) => Number(item.id) === Number(projectId))
    if (found) return found
  }
  return null
}

function typeLabel(type) {
  return TYPE_LABELS[type] || '系统通知'
}

function typeInitial(type) {
  return TYPE_INITIALS[type] || '系'
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return String(value).slice(5, 16)

  const now = new Date()
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate()
  const pad = (n) => String(n).padStart(2, '0')

  if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    yesterday.getFullYear() === date.getFullYear() &&
    yesterday.getMonth() === date.getMonth() &&
    yesterday.getDate() === date.getDate()
  if (isYesterday) return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`

  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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
  padding-bottom: calc(#{dp(24)} + env(safe-area-inset-bottom));
  background: #faf7f4;
}

.nav {
  display: flex;
  align-items: center;
  padding-right: dp(14);
  padding-bottom: dp(8);
  padding-left: dp(6);
  background: #faf7f4;
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
  flex: 1;
  min-width: 0;
  color: #241c17;
  font-size: dp(18);
  font-weight: 700;
}

.nav-action {
  padding: dp(4) dp(2);
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 500;
  white-space: nowrap;
}

.nav-action--disabled {
  opacity: 0.35;
}

.filter-scroll {
  padding: 0 dp(14) dp(4);
  white-space: nowrap;
}

.filter-row {
  display: inline-flex;
  gap: dp(7);
  padding: dp(4) dp(1) dp(8);
}

.filter-chip {
  padding: dp(6) dp(13);
  border: 1px solid #e8e1da;
  border-radius: dp(999);
  background: #fff;
  color: #6d6259;
  font-size: dp(12);
  line-height: 1.2;
}

.filter-chip--active {
  border-color: #eb5c20;
  background: #eb5c20;
  color: #fff;
  font-weight: 600;
}

.list {
  display: flex;
  flex-direction: column;
  gap: dp(10);
  padding: dp(2) dp(14) 0;
}

.message-card {
  display: flex;
  align-items: flex-start;
  padding: dp(13);
  border: 1px solid #f0eae4;
  border-radius: dp(14);
  background: #fff;
  box-shadow: 0 dp(2) dp(10) rgba(0, 0, 0, 0.02);
}

.message-card--unread {
  border-color: #f7d9c8;
  background: #fffdfb;
}

.type-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(36);
  height: dp(36);
  margin-right: dp(11);
  border-radius: dp(11);
  flex-shrink: 0;
}

.type-icon--acceptance {
  background: #fdebe4;
  color: #eb5c20;
}

.type-icon--progress {
  background: #e8f8f0;
  color: #00b42a;
}

.type-icon--payment {
  background: #fff4e0;
  color: #d97706;
}

.type-icon--comment {
  background: #f3efea;
  color: #8b8179;
}

.type-icon--system {
  background: #f2f3f5;
  color: #8b8179;
}

.type-icon-text {
  font-size: dp(14);
  font-weight: 700;
}

.message-main {
  flex: 1;
  min-width: 0;
}

.message-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: dp(8);
}

.message-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #241c17;
  font-size: dp(14);
  font-weight: 600;
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.message-time {
  flex-shrink: 0;
  color: #a79c92;
  font-size: dp(9);
  line-height: 1.5;
}

.message-content {
  display: -webkit-box;
  overflow: hidden;
  margin-top: dp(5);
  color: #6d6259;
  font-size: dp(11);
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.message-foot {
  display: flex;
  align-items: center;
  gap: dp(8);
  margin-top: dp(7);
}

.message-type {
  padding: dp(1) dp(5);
  border-radius: dp(4);
  background: #f8f4ef;
  color: #8b8179;
  font-size: dp(9);
}

.unread-dot {
  color: #f53f3f;
  font-size: dp(9);
  font-weight: 600;
}

.load-more,
.list-end {
  padding: dp(14) 0;
  color: #a79c92;
  font-size: dp(10);
  text-align: center;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(64) dp(28) dp(24);
  text-align: center;
}

.state-icon {
  width: dp(58);
  height: dp(58);
  margin-bottom: dp(14);
  opacity: 0.8;
}

.state-icon--empty {
  opacity: 0.35;
}

.state-title {
  color: #241c17;
  font-size: dp(15);
  font-weight: 600;
}

.state-text {
  margin-top: dp(7);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.6;
}

.state-btn {
  min-width: dp(120);
  height: dp(34);
  margin-top: dp(14);
  border: none;
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  line-height: dp(34);
}
</style>
