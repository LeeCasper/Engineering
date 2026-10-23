<template>
  <view class="admin-page">
    <AdminNav title="管理账号" fallback="/pages/admin/projects/index" />

    <view class="admin-content">
      <view v-if="profile" class="admin-card">
        <view class="account-head">
          <view class="account-avatar">{{ (profile.username || '管').slice(0, 1).toUpperCase() }}</view>
          <view class="account-main">
            <view class="account-name-row">
              <text class="account-name">{{ profile.username }}</text>
              <text class="admin-badge admin-badge--accent">{{ roleLabel }}</text>
            </view>
            <text class="account-tenant">{{ profile.tenantName }} · {{ profile.tenantCode }}</text>
            <text class="account-method">登录方式：{{ authMethodLabel }}</text>
          </view>
        </view>
      </view>

      <view class="admin-card">
        <view class="admin-section-head">
          <view>
            <text class="admin-section-title">微信免密</text>
            <text class="admin-section-sub">绑定后可用当前微信直接进入管理端</text>
          </view>
          <text
            class="admin-badge"
            :class="binding && binding.bound ? 'admin-badge--green' : 'admin-badge--gray'"
          >
            {{ bindingLoading ? '检查中' : binding && binding.bound ? '已绑定' : '未绑定' }}
          </text>
        </view>

        <view v-if="binding && binding.bound" class="binding-info">
          <view class="admin-row">
            <text class="admin-label">绑定时间</text>
            <text class="admin-value">{{ formatDateTime(binding.binding.boundAt) }}</text>
          </view>
          <view class="admin-row">
            <text class="admin-label">最近使用</text>
            <text class="admin-value">{{ formatDateTime(binding.binding.lastUsedAt) || '尚未使用' }}</text>
          </view>
          <button class="admin-btn admin-btn--danger admin-btn--block unbind-btn" @tap="unbind">
            解除微信绑定
          </button>
        </view>

        <view v-else class="binding-empty">
          <text class="admin-muted">
            绑定后，当前微信下次可以免密进入管理端。修改密码、禁用账号或注销 C 端账号都会自动解除绑定。
          </text>
          <button
            v-if="canBind"
            class="admin-btn admin-btn--block bind-btn"
            :class="{ 'admin-btn--disabled': bindingAction }"
            :disabled="bindingAction"
            @tap="bind"
          >
            {{ bindingAction ? '绑定中…' : '绑定当前微信' }}
          </button>
          <text v-else class="admin-form-hint">{{ bindHint }}</text>
        </view>
      </view>

      <view class="admin-card menu-card">
        <view class="menu-row" @tap="goChangePassword">
          <view class="menu-main">
            <text class="menu-title">修改密码</text>
            <text class="menu-sub">修改后所有设备和微信绑定都会失效</text>
          </view>
          <image class="menu-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
        </view>

        <view class="menu-row" @tap="switchAccount">
          <view class="menu-main">
            <text class="menu-title">切换管理账号</text>
            <text class="menu-sub">使用另一个租户管理员账号登录</text>
          </view>
          <image class="menu-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
        </view>

        <view class="menu-row menu-row--danger" @tap="logout">
          <view class="menu-main">
            <text class="menu-title">退出管理端</text>
            <text class="menu-sub">不会退出微信登录，只退出管理员会话</text>
          </view>
          <image class="menu-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
        </view>
      </view>

      <view class="admin-note">
        账号管理、阶段模板、系统配置、内容页、反馈、日志与导出仍在网页后台。
        小程序与网页共用同一套后台接口，任何一端修改后另一端立即生效。
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import {
  fetchAdminWechatBinding,
  bindAdminWechat,
  unbindAdminWechat,
  logoutAdmin,
} from '../../../api/admin/auth'
import { getToken } from '../../../store/session'
import {
  clearAdminSession,
  setBindingHint,
} from '../../../store/adminSession'
import {
  requireAdminSession,
  isAdminFresh,
  formatDateTime,
  showAdminError,
  ADMIN_ROLE_LABELS,
} from '../../../utils/admin'

defineOptions({ name: 'AdminProfilePage' })

const profile = ref(null)
const binding = ref(null)
const bindingLoading = ref(false)
const bindingAction = ref(false)

let loadedOnce = false

const roleLabel = computed(() => ADMIN_ROLE_LABELS[profile.value && profile.value.role] || '管理员')
const authMethodLabel = computed(() =>
  profile.value && profile.value.authMethod === 'wechat' ? '微信免密' : '账号密码'
)
const canBind = computed(
  () => Boolean(getToken()) && profile.value && profile.value.authMethod === 'password' && isAdminFresh(profile.value)
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
  if (loadedOnce && profile.value) loadBinding()
})

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

function goChangePassword() {
  uni.navigateTo({ url: '/pages/admin/change-password/index' })
}

function switchAccount() {
  const hadBinding = Boolean(binding.value && binding.value.bound)
  clearAdminSession()
  setBindingHint(hadBinding ? 1 : 0)
  uni.redirectTo({ url: '/pages/admin/login/index' })
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
.account-head {
  display: flex;
  align-items: center;
}

.account-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(50);
  height: dp(50);
  margin-right: dp(12);
  border-radius: 50%;
  background: linear-gradient(135deg, #f07a3a, #eb5c20);
  color: #fff;
  font-size: dp(20);
  font-weight: 700;
  flex-shrink: 0;
}

.account-main {
  min-width: 0;
}

.account-name-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.account-name {
  overflow: hidden;
  color: #241c17;
  font-size: dp(16);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.account-tenant {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(11);
}

.account-method {
  display: block;
  margin-top: dp(3);
  color: #a79c92;
  font-size: dp(10);
}

.binding-info {
  margin-top: dp(2);
}

.unbind-btn,
.bind-btn {
  margin-top: dp(12);
}

.binding-empty {
  padding-top: dp(2);
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

.menu-row--danger .menu-title {
  color: #f53f3f;
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
  line-height: 1.5;
}

.menu-chevron {
  width: dp(13);
  height: dp(13);
  margin-left: dp(8);
  flex-shrink: 0;
}
</style>
