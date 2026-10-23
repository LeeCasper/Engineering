<template>
  <view class="admin-page">
    <AdminNav title="项目详情" fallback="/pages/admin/projects/index">
      <template #right>
        <text v-if="detail && !isArchived" class="admin-nav-action" @tap="goEdit">编辑</text>
      </template>
    </AdminNav>

    <view class="admin-content">
      <AdminPageState
        :loading="loading && !detail"
        :error="error"
        :empty="false"
        @retry="load"
      >
        <template v-if="detail">
          <view v-if="isArchived" class="archive-banner">
            项目已归档，全部数据只读。{{ isOwner ? '可在下方恢复为「已完工」。' : '仅租户管理员可恢复。' }}
          </view>

          <view class="admin-card overview-card">
            <view class="overview-top">
              <view class="overview-main">
                <view class="overview-title-row">
                  <text class="overview-name">{{ detail.name }}</text>
                  <text class="admin-badge" :class="statusTone(detail.status)">{{ detail.statusLabel }}</text>
                </view>
                <view class="overview-address-row">
                  <image class="overview-address-icon" src="/static/images/icon-location.png" mode="aspectFit" />
                  <text class="overview-address">{{ detail.address || '未填写地址' }}</text>
                </view>
              </view>
            </view>

            <view class="overview-progress-row">
              <text class="overview-progress-label">总进度 {{ percent(detail.progress) }}%</text>
              <view class="admin-progress-track overview-progress-track">
                <view class="admin-progress-fill" :style="{ width: `${percent(detail.progress)}%` }" />
              </view>
            </view>

            <view class="overview-grid">
              <view class="overview-cell">
                <text class="overview-cell-label">合同金额</text>
                <text class="overview-cell-value">¥{{ formatMoney(detail.contractAmount) }}</text>
              </view>
              <view class="overview-cell">
                <text class="overview-cell-label">开工日期</text>
                <text class="overview-cell-value">{{ formatDate(detail.startDate) || '未设置' }}</text>
              </view>
              <view class="overview-cell">
                <text class="overview-cell-label">计划完工</text>
                <text class="overview-cell-value">{{ formatDate(detail.planEndDate) || '未设置' }}</text>
              </view>
              <view class="overview-cell">
                <text class="overview-cell-label">面积</text>
                <text class="overview-cell-value">{{ detail.area ? `${detail.area} ㎡` : '未填写' }}</text>
              </view>
            </view>

            <view v-if="detail.remark" class="overview-remark">{{ detail.remark }}</view>

            <view v-if="detail.needsCoordinates" class="admin-warning overview-warning">
              地址尚未解析出坐标，C 端无法直接导航；可在网页后台手工拾取坐标。
            </view>
          </view>

          <view class="admin-card">
            <view class="admin-section-head">
              <view>
                <text class="admin-section-title">人员配置</text>
                <text class="admin-section-sub">进入施工前必须至少配置 1 名工长、1 名主工长与 1 名业主</text>
              </view>
            </view>
            <view class="composition-row">
              <view class="composition-item">
                <text class="composition-value">{{ memberComposition.foremanCount }}</text>
                <text class="composition-label">工长</text>
              </view>
              <view class="composition-item">
                <text class="composition-value">{{ memberComposition.ownerCount }}</text>
                <text class="composition-label">业主</text>
              </view>
              <view class="composition-item">
                <text class="composition-value composition-value--text">
                  {{ memberComposition.primaryForemanName || '未指定' }}
                </text>
                <text class="composition-label">主工长</text>
              </view>
            </view>
            <view v-if="!memberComposition.meetsRequirement" class="admin-warning composition-warning">
              人员尚未配齐，项目暂时无法进入「施工中」。请先在成员管理中邀请并确认成员。
            </view>
          </view>

          <view class="admin-card action-card">
            <view class="action-row">
              <button class="admin-btn admin-btn--ghost" :disabled="isArchived" @tap="openStatusSheet">
                状态流转
              </button>
              <button
                v-if="!isArchived"
                class="admin-btn admin-btn--ghost"
                @tap="archive"
              >
                归档项目
              </button>
            </view>
            <button
              v-if="isArchived && isOwner"
              class="admin-btn admin-btn--ghost action-full"
              @tap="restoreArchived"
            >
              恢复为已完工
            </button>
            <button
              v-if="isOwner && !isArchived"
              class="admin-btn admin-btn--danger action-full"
              @tap="removeProject"
            >
              删除项目
            </button>
            <text v-if="isOwner && !isArchived" class="admin-form-hint">
              删除为软删除，小程序首期不提供恢复入口，请谨慎操作。
            </text>
          </view>

          <view class="admin-card menu-card">
            <view class="menu-row" @tap="goMembers">
              <image class="menu-icon" src="/static/images/icon-members-accent.png" mode="aspectFit" />
              <view class="menu-main">
                <text class="menu-title">成员管理</text>
                <text class="menu-sub">邀请工长 / 业主 / 监理，指定主工长</text>
              </view>
              <image class="menu-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>

            <view class="menu-row" @tap="goPayments">
              <image class="menu-icon" src="/static/images/icon-wallet-amber.png" mode="aspectFit" />
              <view class="menu-main">
                <text class="menu-title">付款节点</text>
                <text class="menu-sub">{{ paymentNodes.length }} 个节点 · 支持手工解锁</text>
              </view>
              <image class="menu-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>

            <view class="menu-row" @tap="goStages">
              <image class="menu-icon" src="/static/images/icon-document.png" mode="aspectFit" />
              <view class="menu-main">
                <text class="menu-title">阶段与工序</text>
                <text class="menu-sub">{{ detail.stages.length }} 个阶段 · 完成度只读</text>
              </view>
              <image class="menu-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>
          </view>
        </template>
      </AdminPageState>
    </view>

    <!-- 状态流转 -->
    <view v-if="statusSheetOpen" class="admin-sheet-mask" @tap="statusSheetOpen = false">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">项目状态流转</text>
            <text class="admin-sheet-sub">当前状态：{{ detail ? detail.statusLabel : '' }}</text>
          </view>
          <view class="admin-sheet-close" @tap="statusSheetOpen = false">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="status-list">
          <view
            v-for="option in statusOptions"
            :key="option.key"
            class="status-option"
            @tap="chooseStatus(option)"
          >
            <view class="status-option-main">
              <text class="status-option-label">{{ option.label }}</text>
              <text class="status-option-sub">{{ option.hint }}</text>
            </view>
            <text class="status-option-enter">选择 ›</text>
          </view>
        </view>

        <view v-if="!statusOptions.length" class="admin-empty-inline">当前状态没有可执行的正向流转</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import {
  fetchAdminProject,
  changeAdminProjectStatus,
  archiveAdminProject,
  deleteAdminProject,
} from '../../../api/admin/project'
import { PROJECT_STATUS_LABELS } from '../../../config'
import {
  requireAdminSession,
  formatDate,
  formatMoney,
  percent,
  showAdminError,
} from '../../../utils/admin'

defineOptions({ name: 'AdminProjectDetailPage' })

const STATUS_ORDER = ['pending', 'building', 'finished', 'archived']

const projectId = ref(null)
const profile = ref(null)
const detail = ref(null)
const loading = ref(false)
const error = ref('')
const statusSheetOpen = ref(false)

let loadedOnce = false

const isOwner = computed(() => Boolean(profile.value && profile.value.role === 'owner'))
const isArchived = computed(() => Boolean(detail.value && detail.value.status === 'archived'))
const memberComposition = computed(
  () =>
    (detail.value && detail.value.memberComposition) || {
      foremanCount: 0,
      ownerCount: 0,
      primaryForemanName: null,
      meetsRequirement: false,
    }
)
const paymentNodes = computed(() => (detail.value && detail.value.paymentNodes) || [])

const statusOptions = computed(() => {
  if (!detail.value) return []
  const current = detail.value.status
  if (current === 'archived') {
    if (!isOwner.value) return []
    return [{ key: 'finished', label: '恢复为已完工', hint: '归档是终态，仅租户管理员可恢复' }]
  }

  const currentIndex = STATUS_ORDER.indexOf(current)
  return STATUS_ORDER.filter((key) => key !== current).map((key) => {
    const index = STATUS_ORDER.indexOf(key)
    const reverse = index < currentIndex || key === 'archived'
    return {
      key,
      label: PROJECT_STATUS_LABELS[key] || key,
      hint: key === 'archived'
        ? '归档后全链路只读，需要二次确认'
        : reverse
          ? '反向流转，需要二次确认'
          : key === 'building'
            ? '进入施工中前会校验成员配置'
            : '正常流转',
    }
  })
})

onLoad(async (options) => {
  const id = options && options.id ? Number(options.id) : null
  projectId.value = Number.isInteger(id) && id > 0 ? id : null
  if (!projectId.value) {
    error.value = '缺少项目 id'
    return
  }

  try {
    profile.value = await requireAdminSession()
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
  }
  if (profile.value) {
    await load()
    loadedOnce = true
  }
})

onShow(() => {
  if (loadedOnce && profile.value) load(true)
})

onPullDownRefresh(async () => {
  try {
    if (profile.value) await load(true)
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function load(silent = false) {
  if (!projectId.value) return
  if (!silent) loading.value = true
  error.value = ''
  try {
    detail.value = await fetchAdminProject(projectId.value)
  } catch (err) {
    error.value = err.message || '项目加载失败'
    showAdminError(err, '项目加载失败')
  } finally {
    loading.value = false
  }
}

function statusTone(value) {
  if (value === 'building') return 'admin-badge--green'
  if (value === 'pending') return 'admin-badge--orange'
  if (value === 'finished') return 'admin-badge--accent'
  return 'admin-badge--gray'
}

function openStatusSheet() {
  if (isArchived.value) return
  statusSheetOpen.value = true
}

function chooseStatus(option) {
  statusSheetOpen.value = false
  const current = detail.value ? detail.value.status : ''
  const currentIndex = STATUS_ORDER.indexOf(current)
  const targetIndex = STATUS_ORDER.indexOf(option.key)
  const needsConfirm =
    current === 'archived' || option.key === 'archived' || targetIndex < currentIndex

  if (!needsConfirm) {
    applyStatus(option.key, false)
    return
  }

  uni.showModal({
    title: '确认状态流转',
    content: `确定将项目改为「${option.label}」吗？反向流转和归档会影响所有端。`,
    success: (res) => {
      if (res.confirm) applyStatus(option.key, true)
    },
  })
}

async function applyStatus(status, confirmReverse) {
  try {
    await changeAdminProjectStatus(projectId.value, status, confirmReverse)
    uni.showToast({ title: '状态已更新', icon: 'success' })
    await load(true)
  } catch (err) {
    showAdminError(err, '状态更新失败')
  }
}

function archive() {
  uni.showModal({
    title: '归档项目',
    content: '归档后项目全链路只读，业主与工长都无法再提交任何数据。确定归档吗？',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await archiveAdminProject(projectId.value)
        uni.showToast({ title: '已归档', icon: 'success' })
        await load(true)
      } catch (err) {
        showAdminError(err, '归档失败')
      }
    },
  })
}

function restoreArchived() {
  uni.showModal({
    title: '恢复项目',
    content: '已归档项目只能恢复到「已完工」。确定恢复吗？',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await changeAdminProjectStatus(projectId.value, 'finished', true)
        uni.showToast({ title: '已恢复', icon: 'success' })
        await load(true)
      } catch (err) {
        showAdminError(err, '恢复失败')
      }
    },
  })
}

function removeProject() {
  uni.showModal({
    title: '删除项目',
    content: '删除后项目会从管理列表移除，小程序首期不提供恢复入口。确定删除吗？',
    confirmText: '删除',
    confirmColor: '#f53f3f',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await deleteAdminProject(projectId.value)
        uni.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => uni.navigateBack(), 350)
      } catch (err) {
        showAdminError(err, '删除失败')
      }
    },
  })
}

function goEdit() {
  uni.navigateTo({ url: `/pages/admin/project/form?id=${projectId.value}` })
}

function goMembers() {
  uni.navigateTo({ url: `/pages/admin/project/members?id=${projectId.value}` })
}

function goPayments() {
  uni.navigateTo({ url: `/pages/admin/project/payments?id=${projectId.value}` })
}

function goStages() {
  uni.navigateTo({ url: `/pages/admin/project/stages?id=${projectId.value}` })
}
</script>

<style scoped lang="scss">
.admin-nav-action {
  padding: dp(4) dp(2);
  color: #eb5c20;
  font-size: dp(13);
  font-weight: 500;
}

.archive-banner {
  margin: dp(10) 0 dp(12);
  padding: dp(11) dp(12);
  border: 1px solid #e8e1da;
  border-radius: dp(10);
  background: #f3efea;
  color: #51463e;
  font-size: dp(11);
  line-height: 1.6;
}

.overview-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.overview-name {
  overflow: hidden;
  color: #241c17;
  font-size: dp(17);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.overview-address-row {
  display: flex;
  align-items: center;
  margin-top: dp(6);
}

.overview-address-icon {
  width: dp(12);
  height: dp(12);
  margin-right: dp(4);
  flex-shrink: 0;
}

.overview-address {
  overflow: hidden;
  color: #8b8179;
  font-size: dp(10);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.overview-progress-row {
  display: flex;
  align-items: center;
  margin-top: dp(10);
}

.overview-progress-label {
  width: dp(88);
  color: #51463e;
  font-size: dp(10);
  flex-shrink: 0;
}

.overview-progress-track {
  flex: 1;
}

.overview-grid {
  display: flex;
  flex-wrap: wrap;
  margin-top: dp(12);
  padding: dp(10);
  border-radius: dp(10);
  background: #faf7f3;
}

.overview-cell {
  width: 50%;
  padding: dp(4) 0;
}

.overview-cell-label {
  display: block;
  color: #8b8179;
  font-size: dp(9);
}

.overview-cell-value {
  display: block;
  margin-top: dp(2);
  overflow: hidden;
  color: #241c17;
  font-size: dp(11);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.overview-remark {
  margin-top: dp(10);
  color: #51463e;
  font-size: dp(11);
  line-height: 1.6;
}

.overview-warning {
  margin-top: dp(10);
}

.composition-row {
  display: flex;
  margin-top: dp(2);
}

.composition-item {
  flex: 1;
  text-align: center;
}

.composition-value {
  display: block;
  color: #241c17;
  font-size: dp(18);
  font-weight: 700;
}

.composition-value--text {
  overflow: hidden;
  font-size: dp(12);
  line-height: 1.8;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.composition-label {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(10);
}

.composition-warning {
  margin-top: dp(10);
}

.action-card {
  padding-bottom: dp(12);
}

.action-row {
  display: flex;
  gap: dp(10);
}

.action-row .admin-btn {
  flex: 1;
}

.action-full {
  margin-top: dp(10);
}

.menu-card {
  padding-top: dp(4);
  padding-bottom: dp(4);
}

.menu-row {
  display: flex;
  align-items: center;
  padding: dp(12) 0;
  border-bottom: 1px solid #f8f4ef;
}

.menu-row:last-child {
  border-bottom: none;
}

.menu-icon {
  width: dp(18);
  height: dp(18);
  margin-right: dp(9);
  flex-shrink: 0;
}

.menu-main {
  flex: 1;
  min-width: 0;
}

.menu-title {
  display: block;
  color: #241c17;
  font-size: dp(13);
  font-weight: 500;
}

.menu-sub {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(10);
}

.menu-chevron {
  width: dp(13);
  height: dp(13);
  margin-left: dp(8);
  flex-shrink: 0;
}

.status-list {
  padding-top: dp(8);
}

.status-option {
  display: flex;
  align-items: center;
  padding: dp(12) dp(2);
  border-bottom: 1px solid #f8f4ef;
}

.status-option:last-child {
  border-bottom: none;
}

.status-option-main {
  flex: 1;
  min-width: 0;
}

.status-option-label {
  display: block;
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.status-option-sub {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(10);
}

.status-option-enter {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(11);
  flex-shrink: 0;
}
</style>
