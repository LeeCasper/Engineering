<template>
  <view class="admin-page admin-page--cool admin-page--tabbar profile-page">
    <view class="profile-header" :style="{ paddingTop: `${safeTop + 8}px` }">
      <text class="profile-header-title">我的 · 管理设置</text>
    </view>

    <view class="profile-body gc-stagger">
      <view v-if="profile" class="profile-card">
        <view class="profile-card-top">
          <view class="profile-avatar">{{ avatarText }}</view>
          <view class="profile-main">
            <text class="profile-name">管理员 · {{ profile.username }}</text>
            <text class="profile-sub">账号 ID #{{ profile.id }} · {{ authMethodLabel }}</text>
          </view>
          <text class="profile-role">{{ roleLabel }}</text>
        </view>
        <view class="tenant-row">
          <text class="tenant-label">所属租户</text>
          <text class="tenant-name">{{ tenantName }}</text>
        </view>
      </view>
      <view v-else class="profile-card profile-card--loading">
        <gc-loading inline text="加载中" />
      </view>

      <view class="section">
        <text class="section-title">管理工具</text>
        <view class="tool-card">
          <view class="tool-row" @tap="goTemplates">
            <view class="tool-icon">
              <image
                class="tool-icon-img"
                src="/static/images/icon-admin-stage-accent.png"
                mode="aspectFit"
              />
            </view>
            <view class="tool-main">
              <text class="tool-title">阶段模板</text>
              <text class="tool-sub">施工阶段与工序模板</text>
            </view>
            <image class="row-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>

          <view class="tool-row" @tap="goMembers">
            <view class="tool-icon">
              <image
                class="tool-icon-img"
                src="/static/images/icon-admin-members-accent.png"
                mode="aspectFit"
              />
            </view>
            <view class="tool-main">
              <text class="tool-title">成员管理</text>
              <text class="tool-sub">邀请成员、设置主工长</text>
            </view>
            <image class="row-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>

          <view class="tool-row" @tap="goCreateProject">
            <view class="tool-icon">
              <image
                class="tool-icon-img"
                src="/static/images/icon-admin-create-accent.png"
                mode="aspectFit"
              />
            </view>
            <view class="tool-main">
              <text class="tool-title">新建项目</text>
              <text class="tool-sub">创建项目并套用阶段模板</text>
            </view>
            <image class="row-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>

          <view class="tool-row" @tap="goProjects">
            <view class="tool-icon">
              <image
                class="tool-icon-img"
                src="/static/images/icon-admin-project-accent.png"
                mode="aspectFit"
              />
            </view>
            <view class="tool-main">
              <text class="tool-title">项目管理</text>
              <text class="tool-sub">搜索、筛选与状态流转</text>
            </view>
            <image class="row-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>
      </view>

      <view class="section">
        <text class="section-title">服务与安全</text>
        <view class="security-card">
          <view class="security-row" @tap="openBinding">
            <text class="security-title">微信免密</text>
            <view class="security-right">
              <text class="security-status" :class="bindingStatusTone">{{ bindingStatusText }}</text>
              <image class="row-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>
          </view>

          <view class="security-row" @tap="goChangePassword">
            <text class="security-title">修改密码</text>
            <image class="row-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>

          <view class="security-row" @tap="switchAccount">
            <text class="security-title">切换管理账号</text>
            <image class="row-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
        </view>
      </view>

      <view class="logout-btn" @tap="logout">退出管理端</view>
      <text class="web-note">
        账号管理、数据看板、系统配置、操作日志与导出仍在网页后台；小程序与网页共用同一套数据。
      </text>
    </view>

    <AdminTabBar active="profile" />

    <!-- 微信免密 -->
    <view v-if="bindingOpen" class="admin-sheet-mask" @tap="bindingOpen = false">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">微信免密</text>
            <text class="admin-sheet-sub">绑定后可用当前微信直接进入管理端</text>
          </view>
          <view class="admin-sheet-close" @tap="bindingOpen = false">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="binding-status-row">
          <text class="binding-status-label">当前状态</text>
          <text class="admin-badge" :class="binding && binding.bound ? 'admin-badge--green' : 'admin-badge--gray'">
            {{ bindingStatusText }}
          </text>
        </view>

        <view v-if="binding && binding.bound" class="binding-body">
          <view class="binding-info-row">
            <text class="binding-info-label">绑定时间</text>
            <text class="binding-info-value">{{ formatDateTime(binding.binding.boundAt) }}</text>
          </view>
          <view class="binding-info-row">
            <text class="binding-info-label">最近使用</text>
            <text class="binding-info-value">{{ formatDateTime(binding.binding.lastUsedAt) || '尚未使用' }}</text>
          </view>
          <button class="admin-btn admin-btn--danger admin-btn--block binding-action" @tap="unbind">
            解除微信绑定
          </button>
        </view>

        <view v-else class="binding-body">
          <text class="binding-desc">
            绑定后，当前微信下次可以免密进入管理端。修改密码、禁用账号或注销 C 端账号都会自动解除绑定。
          </text>
          <button
            v-if="canBind"
            class="admin-btn admin-btn--block binding-action"
            :class="{ 'admin-btn--disabled': bindingAction }"
            :disabled="bindingAction"
            @tap="bind"
          >
            {{ bindingAction ? '绑定中…' : '绑定当前微信' }}
          </button>
          <text v-else class="admin-form-hint">{{ bindHint }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import AdminTabBar from '../../../components/admin/AdminTabBar.vue'
import {
  fetchAdminWechatBinding,
  bindAdminWechat,
  unbindAdminWechat,
  logoutAdmin,
} from '../../../api/admin/auth'
import { getToken } from '../../../store/session'
import { clearAdminSession, setBindingHint } from '../../../store/adminSession'
import {
  requireAdminSession,
  isAdminFresh,
  formatDateTime,
  showAdminError,
  ADMIN_ROLE_LABELS,
} from '../../../utils/admin'

defineOptions({ name: 'AdminProfilePage' })

const info = uni.getSystemInfoSync()
const safeTop = info.statusBarHeight || 12

const profile = ref(null)
const binding = ref(null)
const bindingLoading = ref(false)
const bindingAction = ref(false)
const bindingOpen = ref(false)

let loadedOnce = false

const avatarText = computed(() => {
  const name = profile.value && profile.value.username ? String(profile.value.username) : ''
  const first = name.slice(0, 1)
  // 账号名可能是 admin 这类英文，头像用「管」比字母 A 更符合管理端语境
  return /[\u4e00-\u9fa5]/.test(first) ? first : '管'
})
const roleLabel = computed(() => ADMIN_ROLE_LABELS[profile.value && profile.value.role] || '管理员')
const tenantName = computed(() => {
  if (!profile.value) return '—'
  if (profile.value.tenantName && profile.value.tenantCode) {
    return `${profile.value.tenantName} · ${profile.value.tenantCode}`
  }
  return profile.value.tenantName || profile.value.tenantCode || '—'
})
const authMethodLabel = computed(() =>
  profile.value && profile.value.authMethod === 'wechat' ? '微信免密' : '账号密码'
)
const bindingStatusText = computed(() => {
  if (bindingLoading.value) return '检查中'
  return binding.value && binding.value.bound ? '已绑定' : '未绑定'
})
const bindingStatusTone = computed(() =>
  binding.value && binding.value.bound ? 'security-status--on' : 'security-status--off'
)
const canBind = computed(
  () =>
    Boolean(getToken()) &&
    profile.value &&
    profile.value.authMethod === 'password' &&
    isAdminFresh(profile.value)
)
const bindHint = computed(() => {
  if (!getToken()) return '当前未登录微信，无法绑定；请先回到小程序登录。'
  if (profile.value && profile.value.authMethod === 'wechat') {
    return '免密登录状态下不能绑定新的微信，请使用账号密码重新登录。'
  }
  return '登录状态已超过 30 分钟，请重新登录后再绑定微信。'
})

onLoad(async () => {
  try {
    profile.value = await requireAdminSession()
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
  }
  if (profile.value) {
    await loadBinding()
    loadedOnce = true
  }
})

onShow(() => {
  if (loadedOnce && profile.value) {
    loadBinding()
    refreshProfile()
  }
})

onPullDownRefresh(async () => {
  try {
    if (loadedOnce) {
      await refreshProfile()
      await loadBinding()
    }
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function refreshProfile() {
  try {
    const data = await requireAdminSession()
    if (data) profile.value = data
  } catch (err) {
    showAdminError(err, '账号信息刷新失败')
  }
}

async function loadBinding() {
  bindingLoading.value = true
  try {
    binding.value = await fetchAdminWechatBinding()
  } catch (err) {
    showAdminError(err, '绑定状态加载失败')
  } finally {
    bindingLoading.value = false
  }
}

function openBinding() {
  bindingOpen.value = true
  loadBinding()
}

async function bind() {
  if (bindingAction.value) return
  if (!getToken()) {
    uni.showToast({ title: '请先登录微信', icon: 'none' })
    return
  }
  bindingAction.value = true
  try {
    await bindAdminWechat(getToken())
    setBindingHint(1)
    uni.showToast({ title: '绑定成功', icon: 'success' })
    await loadBinding()
  } catch (err) {
    showAdminError(err, '绑定失败')
  } finally {
    bindingAction.value = false
  }
}

function unbind() {
  if (bindingAction.value) return
  uni.showModal({
    title: '解除微信绑定',
    content: '解除后，当前微信将不能再免密进入管理端。仍可使用账号密码登录。',
    success: async (res) => {
      if (!res.confirm) return
      bindingAction.value = true
      try {
        await unbindAdminWechat()
        setBindingHint(0)
        uni.showToast({ title: '已解除绑定', icon: 'success' })
        await loadBinding()
      } catch (err) {
        showAdminError(err, '解除失败')
      } finally {
        bindingAction.value = false
      }
    },
  })
}

function goTemplates() {
  uni.navigateTo({ url: '/pages/admin/templates/index' })
}

function goMembers() {
  uni.redirectTo({ url: '/pages/admin/members/index' })
}

function goCreateProject() {
  uni.navigateTo({ url: '/pages/admin/project/form' })
}

function goProjects() {
  uni.redirectTo({ url: '/pages/admin/projects/index' })
}

function goChangePassword() {
  uni.navigateTo({ url: '/pages/admin/change-password/index' })
}

function switchAccount() {
  uni.showModal({
    title: '切换管理账号',
    content: '将退出当前管理员会话，并使用另一个账号登录。',
    success: (res) => {
      if (!res.confirm) return
      const hadBinding = Boolean(binding.value && binding.value.bound)
      clearAdminSession()
      setBindingHint(hadBinding ? 1 : 0)
      uni.redirectTo({ url: '/pages/admin/login/index' })
    },
  })
}

async function logout() {
  uni.showModal({
    title: '退出管理端',
    content: '只退出管理员会话，不会退出微信登录。',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await logoutAdmin()
      } catch (err) {
        // 会话过期也按退出处理
      }
      const hadBinding = Boolean(binding.value && binding.value.bound)
      clearAdminSession()
      setBindingHint(hadBinding ? 1 : 0)
      uni.switchTab({ url: '/pages/projects/index' })
    },
  })
}
</script>

<style scoped lang="scss">
.profile-page {
  min-height: 100vh;
}

.profile-header {
  padding-right: dp(20);
  padding-bottom: dp(80);
  padding-left: dp(20);
  background:
    radial-gradient(circle at 84% 0%, rgba(255, 255, 255, 0.26) 0%, rgba(255, 255, 255, 0) 44%),
    linear-gradient(180deg, #f85a2a 0%, #fa753f 55%, #ffa366 100%);
}

.profile-header-title {
  display: block;
  color: #fff;
  font-size: dp(26);
  font-weight: 800;
  letter-spacing: -0.4px;
  line-height: 1.3;
}

.profile-body {
  position: relative;
  z-index: 2;
  padding: 0 dp(16) dp(24);
  margin-top: dp(-56);
}

.profile-card {
  padding: dp(20);
  @include glass-surface(dp(24), 26px);
  /* 卡片压在橙色渐变上，底色略提高一档，保证深色文字对比度 */
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.94) 0%,
    rgba(255, 255, 255, 0.74) 46%,
    rgba(255, 255, 255, 0.84) 100%
  );
  box-shadow:
    0 dp(12) dp(32) rgba(183, 70, 24, 0.12),
    0 dp(2) dp(6) rgba(29, 33, 41, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
}

.profile-card--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: dp(100);
}

.profile-card-top {
  display: flex;
  align-items: flex-start;
}

.profile-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(58);
  height: dp(58);
  margin-right: dp(14);
  border-radius: 50%;
  background: #ffefeb;
  color: #f25822;
  font-size: dp(24);
  font-weight: 700;
  flex-shrink: 0;
}

.profile-main {
  flex: 1;
  min-width: 0;
  padding-top: dp(2);
}

.profile-name {
  display: block;
  overflow: hidden;
  color: #111827;
  font-size: dp(19);
  font-weight: 700;
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.profile-sub {
  display: block;
  margin-top: dp(5);
  color: #9ca3af;
  font-size: dp(13);
  font-weight: 500;
  line-height: 1.3;
}

.profile-role {
  margin-left: dp(8);
  padding: dp(4) dp(10);
  border-radius: dp(999);
  background: #fff1e8;
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  flex-shrink: 0;
}

.tenant-row {
  display: flex;
  align-items: center;
  margin-top: dp(16);
  padding-top: dp(14);
  border-top: 1px solid #f3f4f6;
  font-size: dp(13);
}

.tenant-label {
  margin-right: dp(12);
  color: #9ca3af;
  flex-shrink: 0;
}

.tenant-name {
  overflow: hidden;
  color: #4b5563;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.section {
  margin-top: dp(22);
}

.section-title {
  display: block;
  padding: 0 dp(4);
  margin-bottom: dp(10);
  color: #111827;
  font-size: dp(18);
  font-weight: 700;
  letter-spacing: -0.2px;
}

.tool-card,
.security-card {
  padding: 0 dp(16);
  @include glass-surface(dp(24), 22px);
}

.tool-row {
  display: flex;
  align-items: center;
  padding: dp(14) 0;
  border-bottom: 1px solid #f3f4f6;
}

.tool-row:last-child,
.security-row:last-child {
  border-bottom: none;
}

.tool-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(44);
  height: dp(44);
  margin-right: dp(14);
  border-radius: dp(16);
  background: #fff3ee;
  flex-shrink: 0;
}

.tool-icon-img {
  width: dp(24);
  height: dp(24);
}

.tool-main {
  flex: 1;
  min-width: 0;
}

.tool-title {
  display: block;
  color: #111827;
  font-size: dp(16);
  font-weight: 700;
  line-height: 1.3;
}

.tool-sub {
  display: block;
  margin-top: dp(4);
  overflow: hidden;
  color: #9ca3af;
  font-size: dp(12);
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.row-chevron {
  width: dp(15);
  height: dp(15);
  margin-left: dp(8);
  opacity: 0.5;
  flex-shrink: 0;
}

.security-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(16) 0;
  border-bottom: 1px solid #f3f4f6;
}

.security-title {
  color: #111827;
  font-size: dp(16);
  font-weight: 700;
}

.security-right {
  display: flex;
  align-items: center;
}

.security-status {
  margin-right: dp(6);
  font-size: dp(12);
  font-weight: 500;
}

.security-status--on {
  color: #149a5d;
}

.security-status--off {
  color: #9ca3af;
}

.logout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(52);
  margin-top: dp(24);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: dp(16);
  background: linear-gradient(
    135deg,
    rgba(255, 246, 240, 0.94) 0%,
    rgba(255, 233, 222, 0.74) 100%
  );
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
  color: #eb5c20;
  font-size: dp(16);
  font-weight: 700;
  letter-spacing: 0.2px;
  box-shadow:
    0 dp(4) dp(16) rgba(235, 92, 32, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.web-note {
  display: block;
  padding: 0 dp(4);
  margin-top: dp(12);
  color: #9ca3af;
  font-size: dp(11);
  line-height: 1.6;
}

.binding-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(14) 0;
  border-bottom: 1px solid #f2f3f5;
}

.binding-status-label {
  color: #4e5969;
  font-size: dp(13);
}

.binding-body {
  padding-top: dp(12);
}

.binding-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(8) 0;
}

.binding-info-label {
  color: #8f959e;
  font-size: dp(12);
}

.binding-info-value {
  color: #1d2129;
  font-size: dp(12);
  font-weight: 500;
}

.binding-desc {
  display: block;
  color: #8f959e;
  font-size: dp(12);
  line-height: 1.7;
}

.binding-action {
  margin-top: dp(14);
}
</style>
