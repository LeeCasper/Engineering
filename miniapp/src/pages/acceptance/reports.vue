<template>
  <view class="page">
    <view class="hero" :style="{ height: `${safeTop + 60}px` }" />
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-glyph">‹</text>
      </view>
      <text class="nav-title">验收报告</text>
      <view v-if="allProjects.length > 1" class="nav-switch" @tap="openProjectSheet">
        <text>切换项目</text>
      </view>
      <view v-else class="nav-switch-placeholder" />
    </view>

    <view class="content">
      <!-- 当前项目 -->
      <view v-if="project" class="project-card">
        <text class="project-eyebrow">当前项目</text>
        <text class="project-name">{{ project.name }}</text>
        <text class="project-address">{{ project.address || '未填写地址' }}</text>

        <view class="summary-row">
          <view class="summary-item">
            <text class="summary-value">{{ doneItems.length }}</text>
            <text class="summary-label">全部报告</text>
          </view>
          <view class="summary-item">
            <text class="summary-value">{{ stageCount }}</text>
            <text class="summary-label">阶段验收</text>
          </view>
          <view class="summary-item">
            <text class="summary-value">{{ itemCount }}</text>
            <text class="summary-label">工序验收</text>
          </view>
        </view>
      </view>

      <view v-if="project && !loading" class="filter-row">
        <view
          v-for="option in filterOptions"
          :key="option.key"
          class="filter-chip"
          :class="{ 'filter-chip--active': activeFilter === option.key }"
          @tap="activeFilter = option.key"
        >
          {{ option.label }} {{ option.count }}
        </view>
      </view>

      <view v-if="loading" class="state-block">
        <gc-loading text="正在加载验收报告…" />
      </view>

      <view v-else-if="!project" class="state-card">
        <image class="state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
        <text class="state-title">
          {{ loadError ? '加载失败' : allProjects.length ? '请选择项目' : '还没有加入项目' }}
        </text>
        <text class="state-text">
          {{
            loadError ||
            (allProjects.length
              ? '选择当前项目后，这里会列出该项目的全部验收报告。'
              : '联系装修公司管理员邀请你加入项目后，验收报告会归档到这里。')
          }}
        </text>
        <button v-if="allProjects.length" class="state-btn" @tap="openProjectSheet">
          选择项目
        </button>
        <button v-else class="state-btn" @tap="goBack">返回</button>
      </view>

      <view v-else-if="!filteredItems.length" class="state-card">
        <image class="state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
        <text class="state-title">暂无验收报告</text>
        <text class="state-text">
          {{
            doneItems.length
              ? '当前筛选下没有报告，切换筛选看看。'
              : '阶段验收通过后，系统会自动生成 PDF 报告并归档到这里。'
          }}
        </text>
      </view>

      <view v-else class="report-groups">
        <view v-for="group in groupedItems" :key="group.key" class="stage-group">
          <view class="stage-head">
            <text class="stage-title">{{ group.name }}</text>
            <text class="stage-count">{{ group.items.length }} 份</text>
          </view>

          <view
            v-for="item in group.items"
            :key="item.id"
            class="report-card"
            @tap="openDetail(item)"
          >
            <view class="report-icon">
              <image class="report-icon-img" src="/static/images/icon-document-amber.png" mode="aspectFit" />
            </view>

            <view class="report-main">
              <view class="report-title-row">
                <text class="report-title">{{ reportTitle(item) }}</text>
                <text class="report-type">{{ item.type === 'item' ? '工序' : '阶段' }}</text>
              </view>
              <text class="report-meta">
                {{ formatDateTime(item.finishedAt) }} · 第 {{ roundOf(item) }} 轮 · {{ signatureText(item) }}
              </text>
              <view class="report-status-row">
                <view class="status-dot" :class="reportMeta(item).tone" />
                <text class="report-status">{{ reportMeta(item).label }}</text>
              </view>
            </view>

            <view class="report-actions">
              <button
                v-if="item.reportPdf && item.reportPdf.signedPath"
                class="report-btn"
                @tap.stop="openReport(item)"
              >
                查看报告
              </button>
              <text v-else class="detail-link">详情 ›</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 项目切换 -->
    <view
      v-if="projectSheetOpen"
      class="sheet-mask"
      @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove"
      @tap="closeProjectSheet"
    >
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view
          class="sheet-handle"
          @touchstart="sheetSwipe.onTouchStart"
          @touchmove.stop.prevent="sheetSwipe.onTouchMove"
          @touchend="sheetSwipe.onTouchEnd"
        />
        <view
          class="sheet-head"
          @touchstart="sheetSwipe.onTouchStart"
          @touchmove.stop.prevent="sheetSwipe.onTouchMove"
          @touchend="sheetSwipe.onTouchEnd"
        >
          <view>
            <text class="sheet-title">切换项目</text>
            <text class="sheet-sub">验收报告按项目归档，请选择一个项目</text>
          </view>
          <view class="sheet-close" @tap="closeProjectSheet">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <scroll-view class="project-list" scroll-y>
          <view
            v-for="item in allProjects"
            :key="item.id"
            class="project-option"
            :class="{ 'project-option--active': project && Number(project.id) === Number(item.id) }"
            @tap="selectProject(item)"
          >
            <view class="project-option-main">
              <view class="project-option-title-row">
                <text class="project-option-name">{{ item.name }}</text>
                <text class="project-option-role">{{ item.myRoleLabel || roleLabelOf(item.myRole) }}</text>
              </view>
              <text class="project-option-address">{{ item.address || '未填写地址' }}</text>
            </view>
            <text v-if="project && Number(project.id) === Number(item.id)" class="project-option-check">✓</text>
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { myProjects, projectAcceptances, projectDetail } from '../../api/project'
import { resolveMediaUrl } from '../../api/request'
import { getCurrentProject, setCurrentProject } from '../../store/projectContext'
import { useSwipeClose } from '../../composables/useSwipeClose'

defineOptions({ name: 'AcceptanceReportsPage' })

const ROLE_LABELS = { owner: '业主', foreman: '工长', supervisor: '监理' }

const sheetSwipe = useSwipeClose(() => closeProjectSheet())
const sheetSwipeStyle = sheetSwipe.style

const safeTop = ref(12)
const projectId = ref(null)
const project = ref(null)
const allProjects = ref([])
const doneItems = ref([])
const loading = ref(true)
const loadError = ref('')
const activeFilter = ref('all')
const projectSheetOpen = ref(false)
const switching = ref(false)

let loadedOnce = false

const stageCount = computed(() => doneItems.value.filter((item) => item.type === 'stage').length)
const itemCount = computed(() => doneItems.value.filter((item) => item.type === 'item').length)

const filterOptions = computed(() => [
  { key: 'all', label: '全部', count: doneItems.value.length },
  { key: 'stage', label: '阶段验收', count: stageCount.value },
  { key: 'item', label: '工序验收', count: itemCount.value },
])

const filteredItems = computed(() => {
  if (activeFilter.value === 'stage') return doneItems.value.filter((item) => item.type === 'stage')
  if (activeFilter.value === 'item') return doneItems.value.filter((item) => item.type === 'item')
  return doneItems.value
})

/** 按阶段分组，阶段级报告排在该组最前 */
const groupedItems = computed(() => {
  const map = new Map()
  for (const item of filteredItems.value) {
    const key = item.stageId ? `stage-${item.stageId}` : 'stage-none'
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: item.stageName || '未归属阶段',
        items: [],
      })
    }
    map.get(key).items.push(item)
  }

  for (const group of map.values()) {
    group.items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'stage' ? -1 : 1
      return Number(b.id) - Number(a.id)
    })
  }

  return [...map.values()]
})

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12
  projectId.value = Number(options && options.projectId) || Number(getCurrentProject()?.id) || null
  load()
})

onShow(() => {
  if (loadedOnce && projectId.value && !loading.value) {
    loadReports({ silent: true })
  }
})

onPullDownRefresh(async () => {
  try {
    await load({ silent: true })
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  loadError.value = ''

  try {
    const data = await myProjects()
    const list = ((data && data.groups) || []).flatMap((group) => group.items || [])
    allProjects.value = list

    if (!projectId.value) {
      const current = getCurrentProject()
      if (current) projectId.value = current.id
      else if (list.length === 1) projectId.value = list[0].id
    }

    project.value = list.find((item) => Number(item.id) === Number(projectId.value)) || null

    // 项目可能来自旧的上下文、已不在列表里；再尝试一次详情，失败就展示选择项目
    if (!project.value && projectId.value) {
      try {
        const detail = await projectDetail(projectId.value)
        project.value = { ...detail, myRole: detail.myRole }
      } catch (err) {
        project.value = null
      }
    }

    if (project.value) {
      const current = getCurrentProject()
      if (!current || Number(current.id) !== Number(project.value.id)) {
        setCurrentProject({ ...project.value, myRole: project.value.myRole })
      }
      await loadReports({ silent: true })
    } else {
      doneItems.value = []
      if (list.length > 0) projectSheetOpen.value = true
    }

    loadedOnce = true
  } catch (err) {
    if (err.statusCode === 401) {
      uni.reLaunch({ url: '/pages/login/index' })
      return
    }
    loadError.value = err.message || '加载失败'
    uni.showToast({ title: loadError.value, icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function loadReports({ silent = false } = {}) {
  if (!projectId.value) return
  if (!silent) loading.value = true
  try {
    const data = await projectAcceptances(projectId.value)
    const done = ((data && data.groups) || []).find((group) => group.key === 'done')
    doneItems.value = (done && done.items) || []
  } catch (err) {
    if (err.statusCode === 401) {
      uni.reLaunch({ url: '/pages/login/index' })
      return
    }
    if (!silent) uni.showToast({ title: err.message || '验收报告加载失败', icon: 'none' })
  } finally {
    if (!silent) loading.value = false
  }
}

function closeProjectSheet() {
  if (switching.value) return
  projectSheetOpen.value = false
}

function openProjectSheet() {
  if (switching.value) return
  projectSheetOpen.value = true
}

async function selectProject(item) {
  if (switching.value) return
  if (project.value && Number(project.value.id) === Number(item.id)) {
    projectSheetOpen.value = false
    return
  }

  switching.value = true
  projectId.value = item.id
  project.value = item
  setCurrentProject({ ...item, myRole: item.myRole })
  projectSheetOpen.value = false
  try {
    await loadReports()
    uni.showToast({ title: '已切换项目', icon: 'success' })
  } catch (err) {
    uni.showToast({ title: err.message || '切换失败', icon: 'none' })
  } finally {
    switching.value = false
  }
}

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.switchTab({ url: '/pages/mine/index' })
}

function openDetail(item) {
  uni.navigateTo({ url: `/pages/acceptance/detail?id=${item.id}` })
}

function openReport(item) {
  const path = item.reportPdf && item.reportPdf.signedPath
  if (!path) {
    openDetail(item)
    return
  }
  openPdfPath(path)
}

function openPdfPath(path) {
  const url = resolveMediaUrl(path)

  // #ifdef H5
  window.open(url, '_blank')
  // #endif
  // #ifndef H5
  uni.showLoading({ title: '下载中…' })
  uni.downloadFile({
    url,
    success: (res) => {
      uni.hideLoading()
      uni.openDocument({ filePath: res.tempFilePath, fileType: 'pdf', showMenu: true })
    },
    fail: () => {
      uni.hideLoading()
      uni.showToast({ title: '报告下载失败', icon: 'none' })
    },
  })
  // #endif
}

function reportMeta(item) {
  const status = (item.reportPdf && item.reportPdf.status) || item.reportPdfStatus
  if (status === 'success') return { label: '报告已生成', tone: 'status-dot--success' }
  if (status === 'failed') return { label: '报告生成失败，可进详情重试', tone: 'status-dot--danger' }
  return { label: '报告生成中', tone: 'status-dot--pending' }
}

function reportTitle(item) {
  if (item.type === 'item') return item.itemName || '工序验收'
  return '阶段验收报告'
}

function roundOf(item) {
  return Number(item.resubmitCount || 0) + 1
}

function signatureText(item) {
  if (item.esignStatus === 'signed') return '可靠电子签'
  if (item.hasSignature) return '手写签名'
  return '未签名'
}

function formatDateTime(value) {
  if (!value) return '—'
  const text = String(value)
  const [date, time] = text.split(' ')
  return time ? `${date} ${time.slice(0, 5)}` : date
}

function roleLabelOf(role) {
  return ROLE_LABELS[role] || role || '成员'
}
</script>

<style scoped lang="scss">
.page {
  position: relative;
  min-height: 100vh;
  padding-bottom: calc(#{dp(28)} + env(safe-area-inset-bottom));
  background: #faf7f4;
  overflow-x: hidden;
}

.hero {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  background: linear-gradient(180deg, #eb5c20 0%, #f07a3a 100%);
}

.nav {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  padding-right: dp(14);
  padding-bottom: dp(10);
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

.nav-back-glyph {
  margin-top: dp(-2);
  color: #fff;
  font-size: dp(28);
  font-weight: 300;
  line-height: 1;
}

.nav-title {
  flex: 1;
  margin-left: dp(4);
  color: #fff;
  font-size: dp(20);
  font-weight: 800;
  letter-spacing: dp(-0.3);
}

.nav-switch {
  padding: dp(5) dp(10);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: dp(999);
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: dp(10);
  white-space: nowrap;
}

.nav-switch-placeholder {
  width: dp(60);
}

.content {
  position: relative;
  z-index: 3;
  padding: dp(12) dp(14) 0;
}

.project-card {
  padding: dp(16);
  border: 1px solid rgba(255, 253, 250, 0.6);
  border-radius: dp(18);
  background: #fffdfb;
  box-shadow: 0 dp(8) dp(24) rgba(94, 52, 25, 0.08);
}

.project-eyebrow {
  display: block;
  color: #a79c92;
  font-size: dp(10);
  letter-spacing: dp(0.4);
}

.project-name {
  display: block;
  overflow: hidden;
  margin-top: dp(4);
  color: #241c17;
  font-size: dp(19);
  font-weight: 800;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-address {
  display: block;
  overflow: hidden;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(11);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.summary-row {
  display: flex;
  margin-top: dp(14);
  padding-top: dp(12);
  border-top: 1px solid rgba(120, 82, 58, 0.08);
}

.summary-item {
  flex: 1;
  text-align: center;
}

.summary-item + .summary-item {
  border-left: 1px solid rgba(120, 82, 58, 0.08);
}

.summary-value {
  display: block;
  color: #eb5c20;
  font-size: dp(22);
  font-weight: 800;
  line-height: 1.1;
}

.summary-label {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}

.filter-row {
  display: flex;
  gap: dp(8);
  margin: dp(14) 0 dp(4);
  overflow-x: auto;
}

.filter-chip {
  padding: dp(6) dp(12);
  border: 1px solid #efe6de;
  border-radius: dp(999);
  background: #fff;
  color: #8b8179;
  font-size: dp(11);
  white-space: nowrap;
  flex-shrink: 0;
}

.filter-chip--active {
  border-color: #f6c5ae;
  background: #fdebe4;
  color: #eb5c20;
  font-weight: 600;
}

.stage-group {
  margin-top: dp(14);
}

.stage-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 dp(4) dp(8);
}

.stage-title {
  color: #241c17;
  font-size: dp(14);
  font-weight: 700;
}

.stage-count {
  color: #a79c92;
  font-size: dp(10);
}

.report-card {
  display: flex;
  align-items: center;
  margin-bottom: dp(10);
  padding: dp(13);
  border: 1px solid #f1e9e2;
  border-radius: dp(16);
  background: #fff;
  box-shadow: 0 dp(4) dp(14) rgba(94, 52, 25, 0.04);
}

.report-card:active {
  background: #fffaf6;
}

.report-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(38);
  height: dp(38);
  margin-right: dp(11);
  border-radius: dp(11);
  background: #fff2e8;
  flex-shrink: 0;
}

.report-icon-img {
  width: dp(20);
  height: dp(20);
}

.report-main {
  flex: 1;
  min-width: 0;
}

.report-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
  min-width: 0;
}

.report-title {
  overflow: hidden;
  color: #241c17;
  font-size: dp(13);
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.report-type {
  padding: dp(1) dp(5);
  border-radius: dp(4);
  background: #fdebe4;
  color: #c44710;
  font-size: dp(8);
  font-weight: 600;
  flex-shrink: 0;
}

.report-meta {
  display: block;
  overflow: hidden;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.report-status-row {
  display: flex;
  align-items: center;
  margin-top: dp(5);
}

.status-dot {
  width: dp(6);
  height: dp(6);
  margin-right: dp(4);
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot--success {
  background: #00b42a;
}

.status-dot--danger {
  background: #f53f3f;
}

.status-dot--pending {
  background: #ff9a2e;
}

.report-status {
  color: #a79c92;
  font-size: dp(9);
}

.report-actions {
  display: flex;
  align-items: center;
  margin-left: dp(8);
  flex-shrink: 0;
}

.report-btn {
  padding: dp(6) dp(10);
  border: none;
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(10);
  font-weight: 600;
  line-height: 1;
}

.report-btn::after {
  border: none;
}

.report-btn:active {
  background: #c44710;
}

.detail-link {
  color: #a79c92;
  font-size: dp(10);
}

.state-block {
  padding-top: dp(80);
}

.state-card {
  margin-top: dp(22);
  padding: dp(30) dp(18);
  border: 1px solid #f1e9e2;
  border-radius: dp(18);
  background: #fff;
  text-align: center;
}

.state-icon {
  width: dp(54);
  height: dp(54);
  opacity: 0.8;
}

.state-title {
  display: block;
  margin-top: dp(10);
  color: #241c17;
  font-size: dp(14);
  font-weight: 700;
}

.state-text {
  display: block;
  margin-top: dp(6);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.7;
}

.state-btn {
  width: dp(140);
  height: dp(36);
  margin-top: dp(14);
  border: 1px solid #f6c5ae;
  border-radius: dp(999);
  background: #fff7f2;
  color: #eb5c20;
  font-size: dp(12);
  line-height: dp(36);
}

/* ── 项目切换面板 ── */
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
  max-height: 78vh;
  padding: dp(8) dp(16) dp(18);
  overflow-y: auto;
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
  padding-bottom: dp(10);
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
  color: #8b8179;
  font-size: dp(10);
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
  max-height: 56vh;
}

.project-option {
  display: flex;
  align-items: center;
  padding: dp(12) dp(2);
  border-bottom: 1px solid rgba(120, 82, 58, 0.08);
}

.project-option:last-child {
  border-bottom: none;
}

.project-option--active {
  background: rgba(253, 235, 228, 0.5);
}

.project-option-main {
  flex: 1;
  min-width: 0;
}

.project-option-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
  min-width: 0;
}

.project-option-name {
  overflow: hidden;
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-option-role {
  padding: dp(1) dp(5);
  border-radius: dp(4);
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(8);
  flex-shrink: 0;
}

.project-option-address {
  display: block;
  overflow: hidden;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-option-check {
  margin-left: dp(10);
  color: #eb5c20;
  font-size: dp(17);
  font-weight: 700;
}
</style>
