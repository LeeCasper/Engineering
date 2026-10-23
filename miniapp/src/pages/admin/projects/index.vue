<template>
  <view class="admin-page">
    <AdminNav title="项目管理" fallback="/pages/admin/projects/index">
      <template #right>
        <text class="admin-nav-action" @tap="goProfile">我的</text>
      </template>
    </AdminNav>

    <view class="admin-content">
      <view v-if="profile" class="console-head">
        <view class="console-head-main">
          <text class="console-tenant">{{ profile.tenantName || '当前租户' }}</text>
          <text class="console-role">{{ roleLabel }} · {{ profile.username }}</text>
        </view>
        <view class="console-stat">
          <text class="console-stat-value">{{ total }}</text>
          <text class="console-stat-label">项目</text>
        </view>
      </view>

      <view class="admin-search">
        <image class="search-icon" src="/static/images/icon-search.png" mode="aspectFit" />
        <input
          v-model="keyword"
          class="admin-search-input"
          confirm-type="search"
          placeholder="搜索项目名称"
          placeholder-class="admin-placeholder"
          @confirm="load(true)"
        />
        <text v-if="keyword" class="search-clear" @tap="clearKeyword">清除</text>
      </view>

      <scroll-view class="status-scroll" scroll-x :show-scrollbar="false">
        <view class="status-row">
          <view
            v-for="item in STATUS_OPTIONS"
            :key="item.key"
            class="admin-chip"
            :class="{ 'admin-chip--active': status === item.key }"
            @tap="changeStatus(item.key)"
          >
            {{ item.label }}
          </view>
        </view>
      </scroll-view>

      <AdminPageState
        :loading="loading && !projects.length"
        :error="error"
        :empty="!loading && !error && !projects.length"
        empty-title="暂无项目"
        :empty-text="keyword || status ? '没有符合当前条件的项目' : '还没有项目，创建第一个项目后会显示在这里'"
        @retry="load(true)"
      >
        <template #empty-action>
          <button v-if="!keyword && !status" class="admin-state-btn" @tap="goCreate">新建项目</button>
        </template>
      </AdminPageState>

      <view v-if="projects.length" class="admin-list">
        <view v-for="project in projects" :key="project.id" class="project-card" @tap="goDetail(project)">
          <view class="project-top">
            <view class="project-title-wrap">
              <text class="project-name">{{ project.name }}</text>
              <text class="admin-badge" :class="statusTone(project.status)">{{ project.statusLabel }}</text>
            </view>
            <image class="project-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>

          <view class="project-address-row">
            <image class="project-address-icon" src="/static/images/icon-location.png" mode="aspectFit" />
            <text class="project-address">{{ project.address || '未填写地址' }}</text>
          </view>

          <view class="project-progress-row">
            <text class="project-progress-label">进度 {{ percent(project.progress) }}%</text>
            <view class="admin-progress-track project-progress-track">
              <view class="admin-progress-fill" :style="{ width: `${percent(project.progress)}%` }" />
            </view>
          </view>

          <view class="project-meta-row">
            <text class="project-meta">合同 ¥{{ formatMoney(project.contractAmount) }}</text>
            <text class="project-meta">当前 {{ project.currentStageName || '暂无阶段' }}</text>
          </view>
        </view>

        <view v-if="projects.length < total" class="load-more" @tap="loadMore">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </view>
      </view>
    </view>

    <view class="admin-fab" @tap="goCreate">
      <image class="admin-fab-icon" src="/static/images/icon-plus-white.png" mode="aspectFit" />
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onReachBottom, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import { fetchAdminProjects } from '../../../api/admin/project'
import {
  requireAdminSession,
  ADMIN_ROLE_LABELS,
  formatMoney,
  percent,
  showAdminError,
} from '../../../utils/admin'

defineOptions({ name: 'AdminProjectsPage' })

const STATUS_OPTIONS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待开工' },
  { key: 'building', label: '施工中' },
  { key: 'finished', label: '已完工' },
  { key: 'archived', label: '已归档' },
]

const profile = ref(null)
const projects = ref([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const pageSize = 20
const keyword = ref('')
const status = ref('')
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')

let loadedOnce = false
let bootstrapped = false

const roleLabel = computed(() => ADMIN_ROLE_LABELS[profile.value && profile.value.role] || '管理员')

onLoad(async () => {
  try {
    profile.value = await requireAdminSession()
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
  }
  bootstrapped = true
  if (profile.value) await load(true)
})

onShow(() => {
  if (bootstrapped && loadedOnce && profile.value && !loading.value) load(true)
})

onPullDownRefresh(async () => {
  try {
    if (profile.value) await load(true)
  } finally {
    uni.stopPullDownRefresh()
  }
})

onReachBottom(() => {
  loadMore()
})

async function load(reset = false) {
  if (!profile.value) return
  if (loading.value) return

  if (reset) {
    page.value = 1
    error.value = ''
    loading.value = true
  } else {
    if (page.value >= totalPages.value) return
    loadingMore.value = true
  }

  try {
    const data = await fetchAdminProjects({
      page: reset ? 1 : page.value + 1,
      pageSize,
      name: keyword.value.trim() || undefined,
      status: status.value || undefined,
    })

    const list = (data && data.list) || []
    projects.value = reset ? list : projects.value.concat(list)
    total.value = (data && data.total) || 0
    page.value = (data && data.page) || (reset ? 1 : page.value + 1)
    totalPages.value = (data && data.totalPages) || 1
    loadedOnce = true
  } catch (err) {
    error.value = err.message || '项目加载失败'
    showAdminError(err, '项目加载失败')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMore() {
  if (!loading.value && !loadingMore.value && page.value < totalPages.value) load(false)
}

function changeStatus(key) {
  if (status.value === key) return
  status.value = key
  load(true)
}

function clearKeyword() {
  keyword.value = ''
  load(true)
}

function statusTone(value) {
  if (value === 'building') return 'admin-badge--green'
  if (value === 'pending') return 'admin-badge--orange'
  if (value === 'finished') return 'admin-badge--accent'
  return 'admin-badge--gray'
}

function goCreate() {
  uni.navigateTo({ url: '/pages/admin/project/form' })
}

function goDetail(project) {
  uni.navigateTo({ url: `/pages/admin/project/detail?id=${project.id}` })
}

function goProfile() {
  uni.navigateTo({ url: '/pages/admin/profile/index' })
}
</script>

<style scoped lang="scss">
.admin-nav-action {
  padding: dp(4) dp(2);
  color: #eb5c20;
  font-size: dp(13);
  font-weight: 500;
}

.console-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: dp(10) 0 dp(12);
  padding: dp(14) dp(16);
  border-radius: dp(14);
  background: linear-gradient(135deg, #f07a3a 0%, #eb5c20 100%);
  color: #fff;
  box-shadow: 0 dp(6) dp(16) rgba(235, 92, 32, 0.18);
}

.console-head-main {
  min-width: 0;
}

.console-tenant {
  display: block;
  overflow: hidden;
  font-size: dp(16);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.console-role {
  display: block;
  margin-top: dp(4);
  color: rgba(255, 255, 255, 0.8);
  font-size: dp(11);
}

.console-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin-left: dp(12);
  flex-shrink: 0;
}

.console-stat-value {
  font-size: dp(22);
  font-weight: 800;
  line-height: 1.1;
}

.console-stat-label {
  margin-top: dp(2);
  color: rgba(255, 255, 255, 0.75);
  font-size: dp(10);
}

.search-icon {
  width: dp(16);
  height: dp(16);
  margin-right: dp(6);
}

.search-clear {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(11);
}

.status-scroll {
  margin: dp(10) 0 dp(12);
  white-space: nowrap;
}

.status-row {
  display: inline-flex;
  gap: dp(7);
  padding: 0 dp(1);
}

.project-card {
  padding: dp(13);
  border: 1px solid rgba(229, 231, 235, 0.9);
  border-radius: dp(12);
  background: #fff;
  box-shadow: 0 dp(1) dp(5) rgba(0, 0, 0, 0.03);
}

.project-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.project-title-wrap {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: dp(6);
}

.project-name {
  overflow: hidden;
  color: #241c17;
  font-size: dp(14);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-chevron {
  width: dp(13);
  height: dp(13);
  margin-left: dp(6);
  flex-shrink: 0;
}

.project-address-row {
  display: flex;
  align-items: center;
  margin-top: dp(7);
}

.project-address-icon {
  width: dp(12);
  height: dp(12);
  margin-right: dp(4);
  flex-shrink: 0;
}

.project-address {
  overflow: hidden;
  color: #8b8179;
  font-size: dp(10);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-progress-row {
  display: flex;
  align-items: center;
  margin-top: dp(9);
}

.project-progress-label {
  width: dp(78);
  color: #51463e;
  font-size: dp(10);
  flex-shrink: 0;
}

.project-progress-track {
  flex: 1;
}

.project-meta-row {
  display: flex;
  justify-content: space-between;
  margin-top: dp(8);
  color: #8b8179;
  font-size: dp(10);
}

.project-meta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.load-more {
  padding: dp(10) 0 dp(4);
  color: #eb5c20;
  font-size: dp(12);
  text-align: center;
}

.admin-state-btn {
  min-width: dp(140);
  height: dp(36);
  margin-top: dp(14);
  border: none;
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  line-height: dp(36);
}
</style>
