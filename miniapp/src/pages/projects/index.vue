<template>
  <view class="page">
    <!-- 待确认邀请（登录后的第一优先级） -->
    <view v-if="invitations.length" class="section section--invites">
      <view class="section-head">
        <text class="section-title">待确认邀请</text>
        <text class="invite-count">{{ invitations.length }}</text>
      </view>

      <view v-for="inv in invitations" :key="inv.memberId" class="invite-card">
        <view class="invite-top">
          <text class="invite-tenant">{{ inv.tenantName }}</text>
          <text class="gc-chip" :class="roleChipClass(inv.role)">{{ inv.roleLabel }}</text>
        </view>
        <text class="invite-project">{{ inv.projectName }}</text>
        <text class="invite-address">{{ inv.projectAddress }}</text>
        <view class="invite-meta">
          <text>邀请人：{{ inv.invitedBy || '管理员' }}</text>
          <text>{{ formatTime(inv.invitedAt) }}</text>
        </view>
        <view class="invite-actions">
          <button class="invite-reject" @tap="onReject(inv)">拒绝</button>
          <button class="invite-accept" @tap="onAccept(inv)">确认加入</button>
        </view>
      </view>
    </view>

    <!-- 多租户切换 -->
    <scroll-view v-if="allTenants.length > 1" class="tenant-bar" scroll-x :show-scrollbar="false">
      <view class="tenant-row">
        <view
          class="tenant-chip"
          :class="{ 'tenant-chip--active': activeTenant === null }"
          @tap="switchTenant(null)"
        >
          全部
        </view>
        <view
          v-for="tenant in allTenants"
          :key="tenant.id"
          class="tenant-chip"
          :class="{ 'tenant-chip--active': activeTenant === tenant.id }"
          @tap="switchTenant(tenant.id)"
        >
          {{ tenant.name }}
        </view>
      </view>
    </scroll-view>

    <!-- 项目分组 -->
    <view v-for="group in groups" :key="group.key" class="section">
      <view class="section-head">
        <text class="section-title">{{ group.label }}</text>
        <text class="section-count">{{ group.items.length }}</text>
      </view>

      <view
        v-for="project in group.items"
        :key="project.id"
        class="project-card"
        @tap="openProject(project)"
      >
        <view class="project-top">
          <text class="project-name">{{ project.name }}</text>
          <text class="gc-chip" :class="statusChipClass(project.status)">
            {{ project.statusLabel }}
          </text>
        </view>

        <text class="project-address">{{ project.address }}</text>

        <view class="project-meta">
          <text class="tenant-tag">{{ project.tenantName }}</text>
          <text class="role-tag" :class="roleTagClass(project.myRole)">
            {{ project.myRoleLabel }}
          </text>
        </view>

        <view class="progress-row">
          <view class="progress-track">
            <view class="progress-fill" :style="{ width: `${project.progress}%` }" />
          </view>
          <text class="progress-number">{{ project.progress }}%</text>
        </view>

        <view class="project-foot">
          <text class="project-stage">{{ project.currentStageName || '尚未开始' }}</text>
          <text v-if="project.isOverdue" class="overdue">已延期</text>
        </view>
      </view>
    </view>

    <!-- 空态 -->
    <view v-if="!loading && !invitations.length && !groups.length" class="empty">
      <image class="empty-icon" src="/static/images/logo.png" mode="aspectFit" />
      <text class="empty-title">还没有项目</text>
      <text class="empty-text">被邀请加入项目后，它会出现在这里。</text>
      <text v-if="supportContact" class="empty-contact">管理员联系方式：{{ supportContact }}</text>
      <button class="empty-refresh" @tap="load">刷新</button>
    </view>

    <!-- 加载态 -->
    <view v-if="loading" class="loading">
      <text class="loading-text">加载中…</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { myProjects, confirmInvitation, rejectInvitation } from '../../api/project'
import { setCachedProjects, getToken } from '../../store/session'

const loading = ref(false)
const groups = ref([])
const invitations = ref([])
const allTenants = ref([])
const supportContact = ref('')
const activeTenant = ref(null)
const focusInvitations = ref(false)

onLoad((options) => {
  focusInvitations.value = options && options.focus === 'invitations'
  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }
  load()
})

onShow(() => {
  // 从法律页等返回时刷新；首次 onLoad 已经加载过
  if (!loading.value && getToken()) load()
})

onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

async function load() {
  loading.value = true
  try {
    const data = await myProjects(activeTenant.value)
    setCachedProjects(data)
    groups.value = data.groups || []
    invitations.value = data.pendingInvitations || []
    supportContact.value = data.supportContact || ''

    // 首次（或不过滤时）缓存完整租户列表；按租户筛选后响应只包含该租户，
    // 用它覆盖会让切换器消失
    if (activeTenant.value === null) {
      allTenants.value = data.tenants || []
    } else if (!allTenants.value.length) {
      allTenants.value = data.tenants || []
    }
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }
    uni.showToast({ title: err.message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function switchTenant(tenantId) {
  if (activeTenant.value === tenantId) return
  activeTenant.value = tenantId
  load()
}

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

function openProject() {
  // 项目详情（进度 / 验收 / 记账）是下一批页面；这里先明确提示，
  // 避免跳到一个空白页让用户以为数据丢了
  uni.showToast({ title: '项目详情开发中', icon: 'none' })
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

function formatTime(value) {
  if (!value) return ''
  return String(value).slice(5, 16)
}

function roleChipClass(role) {
  if (role === 'foreman') return 'gc-chip--success'
  if (role === 'supervisor') return 'gc-chip--primary'
  return 'gc-chip--warning'
}

function statusChipClass(status) {
  if (status === 'building') return 'gc-chip--primary'
  if (status === 'finished') return 'gc-chip--success'
  if (status === 'pending') return 'gc-chip--warning'
  return ''
}

function roleTagClass(role) {
  if (role === 'foreman') return 'role-tag--foreman'
  if (role === 'supervisor') return 'role-tag--supervisor'
  return 'role-tag--owner'
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding: dp(12) dp(16) dp(24);
  background: $color-canvas;
}

.section {
  margin-bottom: dp(20);
}

.section--invites {
  margin-bottom: dp(24);
}

.section-head {
  display: flex;
  align-items: center;
  margin-bottom: dp(10);
}

.section-title {
  font-size: dp(17);
  font-weight: 600;
  color: $color-ink;
}

.section-count,
.invite-count {
  margin-left: dp(8);
  min-width: dp(20);
  height: dp(20);
  padding: 0 dp(6);
  border-radius: dp(10);
  background: $color-primary-soft;
  color: $color-primary-pressed;
  font-size: dp(11);
  line-height: dp(20);
  text-align: center;
}

/* ── 邀请卡 ── */
.invite-card {
  padding: dp(16);
  margin-bottom: dp(12);
  background: $color-surface;
  border: 1px solid $color-hairline;
  border-radius: $radius-lg;
  box-shadow: 0 dp(2) dp(10) rgba(15, 39, 74, 0.04);
}

.invite-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(8);
}

.invite-tenant {
  font-size: dp(13);
  font-weight: 600;
  color: $color-primary-pressed;
}

.invite-project {
  display: block;
  font-size: dp(17);
  font-weight: 600;
  color: $color-ink;
}

.invite-address {
  display: block;
  margin-top: dp(4);
  font-size: dp(13);
  color: $color-ink-secondary;
}

.invite-meta {
  display: flex;
  justify-content: space-between;
  margin-top: dp(10);
  font-size: dp(11);
  color: $color-ink-tertiary;
}

.invite-actions {
  display: flex;
  margin-top: dp(14);
}

.invite-reject,
.invite-accept {
  flex: 1;
  height: dp(42);
  border-radius: $radius-md;
  font-size: dp(15);
  font-weight: 600;
}

.invite-reject {
  margin-right: dp(10);
  background: $color-surface;
  border: 1px solid $color-hairline;
  color: $color-ink-secondary;
}

.invite-accept {
  background: $color-primary;
  color: $color-on-primary;
}

.invite-accept:active {
  background: $color-primary-pressed;
}

/* ── 租户切换 ── */
.tenant-bar {
  margin-bottom: dp(16);
  white-space: nowrap;
}

.tenant-row {
  display: flex;
}

.tenant-chip {
  flex-shrink: 0;
  height: dp(32);
  padding: 0 dp(14);
  margin-right: dp(8);
  border-radius: dp(999);
  background: $color-surface;
  border: 1px solid $color-hairline;
  color: $color-ink-secondary;
  font-size: dp(13);
  line-height: dp(32);
}

.tenant-chip--active {
  background: $color-primary-soft;
  border-color: $color-primary-soft;
  color: $color-primary-pressed;
  font-weight: 600;
}

/* ── 项目卡 ── */
.project-card {
  padding: dp(16);
  margin-bottom: dp(12);
  background: $color-surface;
  border: 1px solid $color-hairline;
  border-radius: $radius-lg;
}

.project-card:active {
  background: #fafbfc;
}

.project-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.project-name {
  flex: 1;
  margin-right: dp(10);
  font-size: dp(17);
  font-weight: 600;
  color: $color-ink;
}

.project-address {
  display: block;
  margin-top: dp(4);
  font-size: dp(13);
  color: $color-ink-secondary;
}

.project-meta {
  display: flex;
  align-items: center;
  margin-top: dp(10);
}

.tenant-tag {
  padding: dp(2) dp(6);
  margin-right: dp(8);
  border-radius: $radius-xs;
  background: $color-surface-sunken;
  color: $color-ink-tertiary;
  font-size: dp(11);
}

.role-tag {
  padding: dp(2) dp(6);
  border-radius: $radius-xs;
  font-size: dp(11);
  font-weight: 500;
}

.role-tag--foreman {
  background: $color-success-soft;
  color: $color-success-ink;
}

.role-tag--supervisor {
  background: $color-primary-soft;
  color: $color-primary-pressed;
}

.role-tag--owner {
  background: $color-warning-soft;
  color: $color-warning-ink;
}

.progress-row {
  display: flex;
  align-items: center;
  margin-top: dp(14);
}

.progress-track {
  flex: 1;
  height: dp(6);
  border-radius: dp(999);
  background: $color-neutral-soft;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: dp(999);
  background: $color-primary;
}

.progress-number {
  width: dp(48);
  text-align: right;
  font-size: dp(13);
  font-weight: 600;
  color: $color-primary;
}

.project-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(10);
}

.project-stage {
  font-size: dp(12);
  color: $color-ink-tertiary;
}

.overdue {
  font-size: dp(11);
  color: $color-danger-ink;
}

/* ── 空 / 加载 ── */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 62vh;
  padding: dp(24);
}

.empty-icon {
  width: dp(56);
  height: dp(56);
  border-radius: dp(15);
  opacity: 0.55;
}

.empty-title {
  margin-top: dp(18);
  font-size: dp(17);
  font-weight: 600;
  color: $color-ink;
}

.empty-text {
  margin-top: dp(8);
  font-size: dp(13);
  color: $color-ink-tertiary;
}

.empty-contact {
  margin-top: dp(16);
  font-size: dp(13);
  color: $color-primary;
}

.empty-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(160);
  height: dp(40);
  margin-top: dp(24);
  border-radius: $radius-md;
  border: 1px solid $color-hairline;
  background: $color-surface;
  color: $color-primary;
  font-size: dp(14);
  font-weight: 600;
}

.loading {
  padding: dp(40) 0;
  text-align: center;
}

.loading-text {
  font-size: dp(13);
  color: $color-ink-tertiary;
}
</style>
