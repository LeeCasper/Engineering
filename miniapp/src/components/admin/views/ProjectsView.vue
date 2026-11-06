<template>
  <view
    class="admin-page admin-page--cool"
    :class="{ 'admin-page--tabbar': showTabBar, 'admin-page--fab': isDefaultMode }"
  >
    <AdminRootHeader
      :title="pageTitle"
      :subtitle="pageSubtitle"
      :back="isStagesMode"
      :back-custom="isStagesMode"
      fallback="/pages/admin/home/index?tab=workbench"
      @back="exitStages"
      background="#F6F7F9"
      glass
    />

    <view class="content">
      <view class="search-box">
        <image class="search-icon" src="/static/images/icon-search.png" mode="aspectFit" />
        <input
          v-model="keyword"
          class="search-input"
          confirm-type="search"
          placeholder="搜索项目名称"
          placeholder-class="search-placeholder"
          @confirm="applySearch"
        />
        <text v-if="keyword" class="search-clear" @tap="clearKeyword">清除</text>
      </view>

      <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false">
        <view class="filter-row">
          <view
            v-for="item in statusOptions"
            :key="item.key"
            class="filter-chip"
            :class="{ 'filter-chip--active': status === item.key }"
            @tap="changeStatus(item.key)"
          >
            <text>{{ item.label }}</text>
            <text v-if="item.count !== null" class="filter-count">{{ item.count }}</text>
          </view>
        </view>
      </scroll-view>

      <AdminPageState
        :loading="loading && !projects.length"
        :error="error"
        :empty="!loading && !error && !projects.length"
        :empty-title="emptyTitle"
        :empty-text="emptyText"
        @retry="load(true)"
      >
        <template #empty-action>
          <button v-if="!keyword && !status" class="empty-create" @tap="goCreate">新建项目</button>
        </template>
      </AdminPageState>

      <view v-if="projects.length" class="project-list gc-stagger">
        <view
          v-for="project in projects"
          :key="project.id"
          class="project-item"
        >
          <AdminProjectCard :project="project" @select="openProject" />
        </view>

        <view v-if="projects.length < total" class="load-more" @tap="loadMore">
          <gc-loading v-if="loadingMore" inline text="加载中" />
          <text v-else>加载更多</text>
        </view>

        <text class="permission-note">仅展示当前管理员有权限查看的项目</text>
      </view>
    </view>

    <view v-if="isDefaultMode" class="create-fab" @tap="goCreate">
      <image class="create-fab-icon" src="/static/images/icon-plus-white.png" mode="aspectFit" />
      <text>新建项目</text>
    </view>
  </view>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import AdminRootHeader from '../AdminRootHeader.vue'
import AdminProjectCard from '../AdminProjectCard.vue'
import AdminPageState from '../AdminPageState.vue'
import { fetchAdminProjects, fetchAdminProjectStats } from '../../../api/admin/project'
import { getAdminUser } from '../../../store/adminSession'
import { readAdminCache, writeAdminCache } from '../../../store/adminCache'
import { requestAdminTab } from '../../../store/adminTabs'
import { requireAdminSession, showAdminError } from '../../../utils/admin'

defineOptions({ name: 'AdminProjectsView' })

const props = defineProps({
  active: { type: Boolean, default: true },
  mode: { type: String, default: '' },
})

const STATUS_OPTIONS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待开工' },
  { key: 'building', label: '施工中' },
  { key: 'finished', label: '已完工' },
  { key: 'archived', label: '已归档' },
]

// 壳页内切 tab 不会重建视图；这里保留快照供首次挂载时秒开。
// 阶段管理模式不读默认列表快照。
const inStagesMode = props.mode === 'stages'
const snapshot = inStagesMode ? null : readAdminCache('projects')
const profile = ref(getAdminUser())
const projects = ref(snapshot && snapshot.projects ? snapshot.projects : [])
const total = ref(snapshot ? snapshot.total : 0)
const page = ref(snapshot ? snapshot.page : 1)
const totalPages = ref(snapshot ? snapshot.totalPages : 1)
const pageSize = 20
const keyword = ref('')
const status = ref('')
const stats = ref(snapshot ? snapshot.stats : null)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const mode = ref(inStagesMode ? 'stages' : '')

let bootstrapped = false
let loadedOnce = Boolean(snapshot)
let requestSeq = 0

const isDefaultMode = computed(() => mode.value === '')
const isStagesMode = computed(() => mode.value === 'stages')
const showTabBar = computed(() => !isStagesMode.value)

const pageTitle = computed(() => (isStagesMode.value ? '阶段管理' : '项目管理'))

const pageSubtitle = computed(() =>
  isStagesMode.value ? '选择项目后管理阶段与工序' : ''
)

const emptyTitle = computed(() =>
  isStagesMode.value ? '暂无可管理阶段的项目' : '暂无项目'
)

const emptyText = computed(() => {
  if (keyword.value || status.value) return '没有符合当前条件的项目'
  if (isStagesMode.value) return '还没有项目，创建项目后可以配置阶段'
  return '还没有项目，创建第一个项目后会显示在这里'
})

const statusOptions = computed(() =>
  STATUS_OPTIONS.map((item) => ({
    ...item,
    count: stats.value
      ? item.key
        ? Number(stats.value.statusCounts[item.key]) || 0
        : Number(stats.value.total) || 0
      : null,
  }))
)

onMounted(async () => {
  try {
    profile.value = await requireAdminSession()
  } catch (err) {
    if (!projects.value.length) showAdminError(err, '管理员信息加载失败')
  }

  bootstrapped = true
  if (profile.value) {
    await load(true, { silent: isDefaultMode.value && Boolean(snapshot) })
  }
})

// 壳页切回本 tab（或从详情页返回）时静默刷新，等价于原来的页面 onShow
watch(
  () => props.active,
  (active) => {
    if (active && bootstrapped && loadedOnce && profile.value && !loading.value) {
      load(true, { silent: true })
    }
  }
)

// 工作台的「阶段管理」快捷入口会直接切换本视图的模式
watch(
  () => props.mode,
  (value) => {
    const next = value === 'stages' ? 'stages' : ''
    if (next === mode.value) return
    mode.value = next
    projects.value = []
    total.value = 0
    stats.value = null
    loadedOnce = false
    load(true)
  }
)

/** 阶段管理模式的返回键：切回工作台（壳页会同时退出阶段模式、恢复底栏） */
function exitStages() {
  requestAdminTab('workbench')
}

async function refresh() {
  if (profile.value) await load(true, { silent: true })
}

defineExpose({ refresh, loadMore })

async function load(reset = false, { silent = false } = {}) {
  if (!profile.value) return
  if (!reset && (loading.value || loadingMore.value || page.value >= totalPages.value)) return

  // 筛选切换必须能打断正在进行的加载更多；否则旧请求返回后会把
  // 新筛选的列表覆盖掉。requestSeq 让旧响应直接作废。
  const seq = ++requestSeq

  if (reset) {
    page.value = 1
    error.value = ''
    loadingMore.value = false
    if (!silent) loading.value = true
  } else {
    loadingMore.value = true
  }

  try {
    const [data, statsData] = await Promise.all([
      fetchAdminProjects({
        page: reset ? 1 : page.value + 1,
        pageSize,
        name: keyword.value.trim() || undefined,
        status: status.value || undefined,
      }),
      // 计数只随首页/筛选变化刷新，加载更多没必要再查一遍
      reset ? fetchAdminProjectStats().catch(() => null) : Promise.resolve(null),
    ])

    if (seq !== requestSeq) return

    const list = (data && data.list) || []
    projects.value = reset ? list : projects.value.concat(list)
    total.value = (data && data.total) || 0
    page.value = (data && data.page) || (reset ? 1 : page.value + 1)
    totalPages.value = (data && data.totalPages) || 1
    if (statsData) stats.value = statsData
    loadedOnce = true
    // 只缓存「无筛选」的默认列表，避免切回来时列表和筛选条对不上
    if (isDefaultMode.value && !keyword.value && !status.value) {
      writeAdminCache('projects', {
        projects: projects.value,
        total: total.value,
        page: page.value,
        totalPages: totalPages.value,
        stats: stats.value,
      })
    }
  } catch (err) {
    if (seq !== requestSeq) return
    if (silent && projects.value.length) {
      showAdminError(err, '项目刷新失败')
    } else {
      error.value = err.message || '项目加载失败'
      showAdminError(err, '项目加载失败')
    }
  } finally {
    if (seq === requestSeq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function loadMore() {
  if (!loading.value && !loadingMore.value && page.value < totalPages.value) load(false)
}

function changeStatus(key) {
  if (status.value === key) return
  status.value = key
  projects.value = []
  total.value = 0
  load(true)
}

function applySearch() {
  projects.value = []
  total.value = 0
  load(true)
}

function clearKeyword() {
  keyword.value = ''
  projects.value = []
  total.value = 0
  load(true)
}

function goCreate() {
  uni.navigateTo({ url: '/pages/admin/project/form' })
}

function openProject(project) {
  if (!project || !project.id) return

  if (isStagesMode.value) {
    uni.navigateTo({ url: `/pages/admin/project/stages?id=${project.id}` })
    return
  }
  uni.navigateTo({ url: `/pages/admin/project/detail?id=${project.id}` })
}
</script>

<style scoped lang="scss">
/* 新建项目固定在右下角，浮在列表之上、管理端 tabBar 之上 */
.create-fab {
  position: fixed;
  right: dp(16);
  bottom: calc(#{dp(76)} + env(safe-area-inset-bottom));
  z-index: 40;
  display: flex;
  align-items: center;
  gap: dp(5);
  height: dp(44);
  padding: 0 dp(18);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(14);
  font-weight: 600;
  box-shadow:
    0 dp(6) dp(18) rgba(235, 92, 32, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.create-fab:active {
  background: #c44710;
}

.create-fab-icon {
  width: dp(14);
  height: dp(14);
}

.content {
  padding: 0 dp(16) dp(12);
}

.admin-page--fab .content {
  padding-bottom: dp(64);
}

.search-box {
  display: flex;
  align-items: center;
  height: dp(44);
  margin-top: dp(4);
  padding: 0 dp(12);
  @include glass-surface(dp(12), 18px);
  box-shadow:
    0 dp(2) dp(8) rgba(29, 33, 41, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.search-icon {
  width: dp(16);
  height: dp(16);
  margin-right: dp(7);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
  color: #1d2129;
  font-size: dp(14);
}

.search-placeholder {
  color: #c9cdd4;
}

.search-clear {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(11);
  flex-shrink: 0;
}

.filter-scroll {
  width: 100%;
  margin-top: dp(12);
  white-space: nowrap;
}

.filter-row {
  display: inline-flex;
  align-items: center;
  gap: dp(8);
  padding: dp(1) 0 dp(2);
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: dp(7) dp(14);
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: dp(999);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.9) 0%,
    rgba(255, 255, 255, 0.66) 100%
  );
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  backdrop-filter: blur(14px) saturate(170%);
  color: #4e5969;
  font-size: dp(13);
  line-height: 1.2;
  white-space: nowrap;
  flex-shrink: 0;
  box-shadow:
    0 dp(2) dp(6) rgba(29, 33, 41, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.filter-chip--active {
  background: #eb5c20;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 dp(2) dp(6) rgba(235, 92, 32, 0.18);
  transform-origin: center;
  animation: gc-tab-pop 420ms cubic-bezier(0.2, 1.35, 0.35, 1) both;
}

.filter-count {
  margin-left: dp(4);
  font-size: dp(12);
  opacity: 0.72;
}

.filter-chip--active .filter-count {
  opacity: 1;
}

.project-list {
  display: flex;
  flex-direction: column;
  gap: dp(10);
  margin-top: dp(12);
}

.load-more {
  padding: dp(10) 0 dp(2);
  color: #eb5c20;
  font-size: dp(12);
  text-align: center;
}

.permission-note {
  display: block;
  padding: dp(10) 0 dp(6);
  color: #86909c;
  font-size: dp(11);
  text-align: center;
}

.empty-create {
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
