<template>
  <view class="admin-page admin-page--cool">
    <AdminNav
      title="项目详情"
      fallback="/pages/admin/projects/index"
      background="#F6F7F9"
      glass
    >
      <template #right>
        <view v-if="detail" class="nav-actions">
          <AdminHeaderAction v-if="!isArchived" label="编辑项目" @tap="goEdit" />
          <AdminHeaderAction
            v-if="hasActions"
            variant="icon"
            @tap="moreSheetOpen = true"
          >
            <image class="more-icon" src="/static/images/icon-admin-more-gray.png" mode="aspectFit" />
          </AdminHeaderAction>
        </view>
      </template>
    </AdminNav>

    <view class="content">
      <AdminPageState
        :loading="loading && !detail"
        :error="error"
        :empty="false"
        @retry="load"
      >
        <template v-if="detail">
          <view class="detail-stagger gc-stagger">
            <view v-if="isArchived" class="archive-banner">
              项目已归档，全部数据只读。{{ isOwner ? '可在右上角「更多」恢复为「已完工」。' : '仅租户管理员可恢复。' }}
            </view>

            <!-- 项目概览 -->
            <view class="overview-card">
              <view class="overview-head">
                <text class="overview-name">{{ detail.name }}</text>
                <view class="overview-badges">
                  <text v-if="detail.isOverdue && !isArchived" class="overdue-pill">延期</text>
                  <text class="status-pill" :class="statusTone(detail.status)">
                    {{ detail.statusLabel }}
                  </text>
                </view>
              </view>

              <text class="overview-address">{{ detail.address || '未填写地址' }}</text>

              <view class="progress-head">
                <text class="progress-label">总体进度</text>
                <text class="progress-percent">{{ percent(detail.progress) }}%</text>
              </view>
              <view class="progress-track">
                <view class="progress-fill" :style="{ width: `${percent(detail.progress)}%` }" />
              </view>
              <text class="progress-sub">
                当前：{{ currentStageName }}
                <text class="progress-dot">·</text>
                计划完工 {{ planEndText }}
              </text>

              <view class="overview-metrics">
                <view class="metric">
                  <text class="metric-label">合同金额</text>
                  <text class="metric-value">¥{{ formatMoney(detail.contractAmount) }}</text>
                </view>
                <view class="metric">
                  <text class="metric-label">开工日期</text>
                  <text class="metric-value">{{ formatDate(detail.startDate) || '未设置' }}</text>
                </view>
                <view class="metric">
                  <text class="metric-label">面积</text>
                  <text class="metric-value">{{ detail.area ? `${detail.area} ㎡` : '未填写' }}</text>
                </view>
              </view>

              <text v-if="detail.remark" class="overview-remark">{{ detail.remark }}</text>
              <view v-if="detail.needsCoordinates" class="overview-warning">
                地址尚未解析出坐标，C 端无法直接导航；可在网页后台手工拾取坐标。
              </view>
            </view>

            <!-- 项目成员 -->
            <view class="section">
              <view class="section-head">
                <text class="section-title">项目成员</text>
                <view class="section-link" @tap="goMembers">
                  <text>全部</text>
                  <text class="section-link-arrow">›</text>
                </view>
              </view>

              <view class="member-list-card">
                <view
                  v-for="member in previewMembers"
                  :key="member.id"
                  class="member-row"
                  @tap="goMembers"
                >
                  <image
                    v-if="member.avatar"
                    class="member-avatar member-avatar--image"
                    :src="resolveMediaUrl(member.avatar)"
                    mode="aspectFill"
                  />
                  <view v-else class="member-avatar">{{ memberInitial(member) }}</view>
                  <text class="member-name">{{ memberDisplayName(member) }}</text>
                  <text class="member-role">{{ memberRoleText(member) }}</text>
                  <text class="member-status" :class="memberStatusTone(member.status)">
                    {{ memberStatusText(member) }}
                  </text>
                </view>
                <view v-if="!previewMembers.length" class="member-empty">
                  还没有成员，邀请后对方确认即可加入
                </view>
              </view>

              <view v-if="canWrite" class="invite-strip" @tap="goInvite">
                <text class="invite-strip-plus">+</text>
                <text>邀请项目成员</text>
              </view>

              <view v-if="!memberComposition.meetsRequirement" class="member-warning">
                人员尚未配齐，暂时不能进入「施工中」。还需要：{{ missingParts.join('、') }}。
              </view>
            </view>

            <!-- 阶段与付款节点 -->
            <view class="section">
              <view class="section-head">
                <text class="section-title">阶段与付款节点</text>
                <view class="section-link" @tap="goStages">
                  <text>配置</text>
                  <text class="section-link-arrow">›</text>
                </view>
              </view>

              <view class="config-card">
                <view class="config-row" @tap="goStages">
                  <view class="config-icon">
                    <image
                      class="config-icon-img"
                      src="/static/images/icon-admin-stage-accent.png"
                      mode="aspectFit"
                    />
                  </view>
                  <view class="config-main">
                    <text class="config-title">阶段模板</text>
                    <text class="config-sub">
                      共 {{ detail.stages.length }} 阶段 / {{ itemCount }} 工序
                    </text>
                  </view>
                  <text class="config-chevron">›</text>
                </view>

                <view class="config-row" @tap="goPayments">
                  <view class="config-icon">
                    <image
                      class="config-icon-img"
                      src="/static/images/icon-admin-payment-accent.png"
                      mode="aspectFit"
                    />
                  </view>
                  <view class="config-main">
                    <text class="config-title">付款节点</text>
                    <text class="config-sub">
                      共 {{ paymentNodes.length }} 个节点 · 已确认 {{ confirmedNodes }} 个
                    </text>
                  </view>
                  <text class="config-chevron">›</text>
                </view>
              </view>
            </view>
          </view>
        </template>
      </AdminPageState>
    </view>

    <!-- 项目操作 -->
    <view v-if="moreSheetOpen" class="admin-sheet-mask" @tap="moreSheetOpen = false">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">项目操作</text>
            <text class="admin-sheet-sub">{{ detail ? detail.statusLabel : '' }}</text>
          </view>
          <view class="admin-sheet-close" @tap="moreSheetOpen = false">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="action-list">
          <view v-if="!isArchived && statusOptions.length" class="action-row" @tap="openStatusSheet">
            <text>状态流转</text>
            <image class="action-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
          <view v-if="!isArchived" class="action-row" @tap="archive">
            <text>归档项目</text>
            <image class="action-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
          <view v-if="isArchived && isOwner" class="action-row" @tap="restoreArchived">
            <text>恢复为已完工</text>
            <image class="action-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
          <view v-if="isOwner && !isArchived" class="action-row action-row--danger" @tap="removeProject">
            <text>删除项目</text>
            <image class="action-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>

        <text v-if="isOwner && !isArchived" class="action-note">
          删除为软删除，小程序首期不提供恢复入口，请谨慎操作。
        </text>
      </view>
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
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import AdminHeaderAction from '../../../components/admin/AdminHeaderAction.vue'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import { resolveMediaUrl } from '../../../api/request'
import {
  fetchAdminProject,
  changeAdminProjectStatus,
  archiveAdminProject,
  deleteAdminProject,
} from '../../../api/admin/project'
import { PROJECT_STATUS_LABELS } from '../../../config'
import {
  formatDate,
  formatMoney,
  memberRoleText,
  memberStatusText,
  percent,
  requireAdminSession,
  showAdminError,
} from '../../../utils/admin'

defineOptions({ name: 'AdminProjectDetailPage' })

const STATUS_ORDER = ['pending', 'building', 'finished', 'archived']

const projectId = ref(null)
const profile = ref(null)
const detail = ref(null)
const loading = ref(false)
const error = ref('')

const moreSheetOpen = ref(false)
const statusSheetOpen = ref(false)

let loadedOnce = false

const isOwner = computed(() => Boolean(profile.value && profile.value.role === 'owner'))
const isArchived = computed(() => Boolean(detail.value && detail.value.status === 'archived'))
const canWrite = computed(() => Boolean(detail.value && !isArchived.value))
const hasActions = computed(() => Boolean(detail.value && (!isArchived.value || isOwner.value)))

const memberComposition = computed(
  () =>
    (detail.value && detail.value.memberComposition) || {
      foremanCount: 0,
      ownerCount: 0,
      primaryForemanName: null,
      primaryOwnerUserId: null,
      primaryOwnerName: null,
      primaryOwnerActive: false,
      temporaryOwnerCount: 0,
      meetsRequirement: false,
    }
)

const paymentNodes = computed(() => (detail.value && detail.value.paymentNodes) || [])
const confirmedNodes = computed(
  () => paymentNodes.value.filter((node) => node.status === 'confirmed').length
)
const itemCount = computed(() =>
  ((detail.value && detail.value.stages) || []).reduce(
    (total, stage) => total + ((stage.items && stage.items.length) || 0),
    0
  )
)

/**
 * 当前阶段 = 第一个尚未结清的阶段。
 * 与后端 pickCurrentStage 同一口径；前端不按 gateStatus 猜门禁。
 */
const currentStage = computed(() => {
  const stages = ((detail.value && detail.value.stages) || [])
    .slice()
    .sort((a, b) => a.seq - b.seq)
  if (!stages.length) return null
  return stages.find((stage) => stage.gateStatus !== 'settled') || stages[stages.length - 1]
})
const currentStageName = computed(() => (currentStage.value ? currentStage.value.name : '暂无阶段'))
const planEndText = computed(() => {
  const date = detail.value && detail.value.planEndDate
  if (!date) return '未设置'
  const text = formatDate(date)
  return text ? text.slice(5) : '未设置'
})

const visibleMembers = computed(() =>
  ((detail.value && detail.value.members) || []).filter((member) => member.status !== 'removed')
)
const previewMembers = computed(() => visibleMembers.value.slice(0, 4))

const missingParts = computed(() => {
  const parts = []
  if (Number(memberComposition.value.foremanCount) < 1) parts.push('工长')
  if (!memberComposition.value.primaryForemanUserId) parts.push('主工长')
  if (Number(memberComposition.value.ownerCount) < 1) parts.push('业主')
  if (!memberComposition.value.primaryOwnerActive) parts.push('主业主')
  return parts
})

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
      hint:
        key === 'archived'
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
  if (value === 'building') return 'status-pill--building'
  if (value === 'pending') return 'status-pill--pending'
  if (value === 'finished') return 'status-pill--finished'
  return 'status-pill--archived'
}

function memberStatusTone(status) {
  if (status === 'active') return 'member-status--green'
  if (status === 'pending') return 'member-status--orange'
  return 'member-status--gray'
}

function memberDisplayName(member) {
  return member.nickname || member.phoneMasked || '待确认用户'
}

function memberInitial(member) {
  const name = memberDisplayName(member)
  if (name && name !== '待确认用户') return name.slice(0, 1)
  return (member.roleLabel || '成').slice(0, 1)
}

function openStatusSheet() {
  moreSheetOpen.value = false
  if (!statusOptions.value.length) return
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
  moreSheetOpen.value = false
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
  moreSheetOpen.value = false
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
  moreSheetOpen.value = false
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

function goInvite() {
  uni.navigateTo({ url: `/pages/admin/project/members?id=${projectId.value}&invite=1` })
}

function goPayments() {
  uni.navigateTo({ url: `/pages/admin/project/payments?id=${projectId.value}` })
}

function goStages() {
  uni.navigateTo({ url: `/pages/admin/project/stages?id=${projectId.value}` })
}
</script>

<style scoped lang="scss">
.nav-actions {
  display: flex;
  align-items: center;
  gap: dp(8);
}

.more-icon {
  width: dp(18);
  height: dp(18);
}

.content {
  /* 顶部导航是吸顶玻璃，首张卡片不能贴着导航下沿 */
  padding: dp(12) dp(16) dp(24);
}

.archive-banner {
  margin-top: dp(4);
  margin-bottom: dp(12);
  padding: dp(11) dp(12);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: dp(12);
  background: rgba(242, 243, 245, 0.78);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  backdrop-filter: blur(16px) saturate(160%);
  color: #4e5969;
  font-size: dp(11);
  line-height: 1.6;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

/* ── 项目概览 ── */
.overview-card {
  padding: dp(16);
  @include glass-surface(dp(18), 22px);
}

.overview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: dp(10);
}

.overview-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #1d2129;
  font-size: dp(17);
  font-weight: 700;
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.overview-badges {
  display: flex;
  align-items: center;
  gap: dp(5);
  flex-shrink: 0;
}

.status-pill {
  padding: dp(2) dp(9);
  border-radius: dp(6);
  font-size: dp(11);
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
}

.status-pill--building {
  background: #fff2ed;
  color: #eb5c20;
}

.status-pill--finished {
  background: #e8f8f0;
  color: #149a5d;
}

.status-pill--pending {
  background: #fff7e8;
  color: #a85400;
}

.status-pill--archived {
  background: #f2f3f5;
  color: #86909c;
}

.overdue-pill {
  padding: dp(2) dp(6);
  border-radius: dp(4);
  background: #ffece8;
  color: #b22a26;
  font-size: dp(10);
  font-weight: 600;
  line-height: 1.4;
  flex-shrink: 0;
}

.overview-address {
  display: block;
  margin-top: dp(5);
  overflow: hidden;
  color: #86909c;
  font-size: dp(12);
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: dp(14);
  margin-bottom: dp(8);
}

.progress-label {
  color: #86909c;
  font-size: dp(13);
}

.progress-percent {
  color: #eb5c20;
  font-size: dp(26);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.5px;
}

.progress-track {
  height: dp(7);
  overflow: hidden;
  border-radius: dp(999);
  background: #f2f3f5;
}

.progress-fill {
  height: 100%;
  border-radius: dp(999);
  background: #eb5c20;
  transition: width 360ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.progress-sub {
  display: block;
  margin-top: dp(10);
  overflow: hidden;
  color: #86909c;
  font-size: dp(12);
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.progress-dot {
  margin: 0 dp(4);
  color: #c9cdd4;
}

.overview-metrics {
  display: flex;
  margin-top: dp(14);
  padding-top: dp(12);
  border-top: 1px solid #f2f3f5;
}

.metric {
  flex: 1;
  min-width: 0;
}

.metric-label {
  display: block;
  color: #86909c;
  font-size: dp(10);
}

.metric-value {
  display: block;
  margin-top: dp(4);
  overflow: hidden;
  color: #1d2129;
  font-size: dp(12);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.overview-remark {
  display: block;
  margin-top: dp(12);
  color: #4e5969;
  font-size: dp(12);
  line-height: 1.6;
}

.overview-warning {
  margin-top: dp(10);
  padding: dp(9) dp(10);
  border: 1px solid #ffe7d6;
  border-radius: dp(10);
  background: #fff7f2;
  color: #c44710;
  font-size: dp(11);
  line-height: 1.6;
}

/* ── 项目成员 ── */
.section {
  margin-top: dp(18);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 dp(2);
  margin-bottom: dp(10);
}

.section-title {
  color: #1d2129;
  font-size: dp(16);
  font-weight: 700;
}

.section-link {
  display: flex;
  align-items: center;
  color: #eb5c20;
  font-size: dp(13);
}

.section-link-arrow {
  margin-left: dp(2);
  font-size: dp(15);
  font-weight: 700;
  line-height: 1;
}

.member-list-card {
  padding: 0 dp(16);
  @include glass-surface(dp(18), 20px);
}

.member-row {
  display: flex;
  align-items: center;
  padding: dp(12) 0;
  border-bottom: 1px solid #f5f6f8;
}

.member-row:last-child {
  border-bottom: none;
}

.member-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(36);
  height: dp(36);
  margin-right: dp(11);
  border-radius: 50%;
  background: #ffefe6;
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 700;
  flex-shrink: 0;
}

.member-avatar--image {
  display: block;
  object-fit: cover;
}

.member-name {
  width: dp(64);
  overflow: hidden;
  color: #1d2129;
  font-size: dp(14);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.member-role {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #86909c;
  font-size: dp(12);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.member-status {
  margin-left: dp(8);
  padding: dp(3) dp(9);
  border-radius: dp(999);
  font-size: dp(10);
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  flex-shrink: 0;
}

.member-status--green {
  background: #e8f8f0;
  color: #149a5d;
}

.member-status--orange {
  background: #fff2ea;
  color: #ff7d00;
}

.member-status--gray {
  background: #f2f3f5;
  color: #86909c;
}

.member-empty {
  padding: dp(18) 0;
  color: #a79c92;
  font-size: dp(12);
  text-align: center;
}

.invite-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(46);
  margin-top: dp(10);
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: dp(12);
  background: linear-gradient(
    135deg,
    rgba(255, 246, 240, 0.92) 0%,
    rgba(255, 231, 219, 0.72) 100%
  );
  -webkit-backdrop-filter: blur(16px) saturate(170%);
  backdrop-filter: blur(16px) saturate(170%);
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 600;
  box-shadow:
    0 dp(2) dp(8) rgba(235, 92, 32, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.invite-strip-plus {
  margin-right: dp(5);
  font-size: dp(17);
  font-weight: 700;
  line-height: 1;
}

.member-warning {
  margin-top: dp(10);
  padding: dp(10) dp(12);
  border: 1px solid #ffe7d6;
  border-radius: dp(12);
  background: #fff7f2;
  color: #c44710;
  font-size: dp(11);
  line-height: 1.6;
}

/* ── 阶段与付款节点 ── */
.config-card {
  padding: dp(16);
  @include glass-surface(dp(18), 20px);
}

.config-row {
  display: flex;
  align-items: center;
  padding: dp(10) 0;
}

.config-row:first-child {
  padding-top: 0;
}

.config-row:last-child {
  padding-bottom: 0;
}

.config-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(40);
  height: dp(40);
  margin-right: dp(12);
  border-radius: dp(12);
  background: #fff2ea;
  flex-shrink: 0;
}

.config-icon-img {
  width: dp(20);
  height: dp(20);
}

.config-main {
  flex: 1;
  min-width: 0;
}

.config-title {
  display: block;
  color: #1d2129;
  font-size: dp(14);
  font-weight: 700;
  line-height: 1.3;
}

.config-sub {
  display: block;
  margin-top: dp(3);
  overflow: hidden;
  color: #86909c;
  font-size: dp(11);
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.config-chevron {
  margin-left: dp(8);
  color: #c4c7d0;
  font-size: dp(17);
  font-weight: 700;
  line-height: 1;
  flex-shrink: 0;
}

/* ── 底部面板 ── */
.action-list {
  margin-top: dp(8);
}

.action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(15) dp(2);
  border-bottom: 1px solid #f2f3f5;
  color: #1d2129;
  font-size: dp(14);
}

.action-row:last-child {
  border-bottom: none;
}

.action-row--danger {
  color: #f53f3f;
}

.action-chevron {
  width: dp(13);
  height: dp(13);
  opacity: 0.55;
  flex-shrink: 0;
}

.action-note {
  display: block;
  padding: dp(6) dp(2) 0;
  color: #a79c92;
  font-size: dp(11);
  line-height: 1.6;
}

.status-list {
  padding-top: dp(8);
}

.status-option {
  display: flex;
  align-items: center;
  padding: dp(12) dp(2);
  border-bottom: 1px solid #f2f3f5;
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
  color: #1d2129;
  font-size: dp(13);
  font-weight: 600;
}

.status-option-sub {
  display: block;
  margin-top: dp(3);
  color: #86909c;
  font-size: dp(10);
}

.status-option-enter {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(11);
  flex-shrink: 0;
}
</style>
