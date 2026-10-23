<template>
  <view class="admin-page admin-login-page">
    <AdminNav title="管理员登录" fallback="/pages/login/index" />

    <view class="admin-content">
      <view class="login-hero">
        <image class="login-logo" src="/static/images/logo.png" mode="aspectFit" />
        <view class="login-hero-text">
          <text class="login-title">柏总管 · 管理端</text>
          <text class="login-sub">使用租户管理员账号登录，与网页后台同一套数据</text>
        </view>
      </view>

      <!-- 已绑定微信：免密进入 -->
      <view v-if="bindings.length" class="admin-card">
        <view class="admin-section-head">
          <view>
            <text class="admin-section-title">微信免密进入</text>
            <text class="admin-section-sub">选择要使用的管理身份</text>
          </view>
        </view>

        <view class="binding-list">
          <view
            v-for="binding in bindings"
            :key="binding.bindingId"
            class="binding-card"
            @tap="loginByBinding(binding)"
          >
            <view class="binding-main">
              <view class="binding-title-row">
                <text class="binding-username">{{ binding.username }}</text>
                <text class="admin-badge admin-badge--accent">{{ binding.roleLabel }}</text>
              </view>
              <text class="binding-tenant">{{ binding.tenantName }} · {{ binding.tenantCode }}</text>
            </view>
            <text class="binding-enter">{{ loggingBindingId === binding.bindingId ? '进入中…' : '进入 ›' }}</text>
          </view>
        </view>
      </view>

      <!-- 账号密码登录 -->
      <view class="admin-card">
        <view class="admin-section-head">
          <view>
            <text class="admin-section-title">账号密码登录</text>
            <text class="admin-section-sub">租户标识、用户名与密码由所属装修公司提供</text>
          </view>
        </view>

        <view class="admin-form-group">
          <text class="admin-form-label">租户标识</text>
          <input
            v-model="form.tenantCode"
            class="admin-input"
            maxlength="32"
            placeholder="例如 default"
            placeholder-class="admin-placeholder"
          />
        </view>

        <view class="admin-form-group">
          <text class="admin-form-label">用户名</text>
          <input
            v-model="form.username"
            class="admin-input"
            maxlength="50"
            placeholder="请输入管理员用户名"
            placeholder-class="admin-placeholder"
          />
        </view>

        <view class="admin-form-group">
          <text class="admin-form-label">密码</text>
          <input
            v-model="form.password"
            class="admin-input"
            type="password"
            maxlength="72"
            placeholder="请输入密码"
            placeholder-class="admin-placeholder"
          />
        </view>

        <view class="admin-form-group">
          <text class="admin-form-label">图形验证码</text>
          <view class="captcha-row">
            <input
              v-model="form.captchaAnswer"
              class="admin-input captcha-input"
              maxlength="10"
              placeholder="输入右侧字符"
              placeholder-class="admin-placeholder"
            />
            <view class="captcha-image-wrap" @tap="loadCaptcha">
              <image v-if="captchaImage" class="captcha-image" :src="captchaImage" mode="aspectFit" />
              <text v-else class="captcha-loading">{{ captchaLoading ? '加载中' : '点击刷新' }}</text>
            </view>
          </view>
          <text v-if="debugAnswer" class="admin-form-hint">开发环境验证码：{{ debugAnswer }}</text>
          <text v-else class="admin-form-hint">验证码一次性有效，登录失败后会自动刷新</text>
        </view>

        <text v-if="error" class="login-error">{{ error }}</text>

        <button
          class="admin-btn admin-btn--block"
          :class="{ 'admin-btn--disabled': submitting }"
          :disabled="submitting"
          @tap="submitPasswordLogin"
        >
          {{ submitting ? '登录中…' : '登录管理端' }}
        </button>
      </view>

      <view class="admin-note">
        管理端与业主/工长/监理身份相互独立：C 端账号的角色在邀请时固定，
        同时用管理员账号进入管理端。普通用户继续使用微信登录，管理员从这里进入管理端。
      </view>
    </view>
  </view>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import {
  fetchAdminCaptchaPng,
  loginAdmin,
  fetchAdminProfile,
  fetchAdminWechatBinding,
  bindAdminWechat,
} from '../../../api/admin/auth'
import { listAdminBindings, wechatAdminLogin } from '../../../api/auth'
import { getToken } from '../../../store/session'
import {
  setAdminSession,
  setAdminUser,
  getLastAdminTenantCode,
  setLastAdminTenantCode,
  setBindingHint,
  consumeAdminRedirect,
  clearAdminSession,
} from '../../../store/adminSession'
import {
  sanitizeAdminRedirect,
  redirectToAdminChangePassword,
  isAdminFresh,
  showAdminError,
} from '../../../utils/admin'

defineOptions({ name: 'AdminLoginPage' })

const form = reactive({
  tenantCode: getLastAdminTenantCode(),
  username: '',
  password: '',
  captchaAnswer: '',
})

const captchaId = ref('')
const captchaImage = ref('')
const captchaLoading = ref(false)
const debugAnswer = ref('')
const submitting = ref(false)
const error = ref('')
const bindings = ref([])
const loggingBindingId = ref(null)
const redirect = ref('/pages/admin/projects/index')

onLoad((options) => {
  // 401 跳转时把原路径放进 storage；兼容直接把 redirect 放在 query 的旧链接
  const stored = consumeAdminRedirect()
  const queryTarget = options && options.redirect ? decodeTarget(options.redirect) : ''
  redirect.value = sanitizeAdminRedirect(stored || queryTarget)
  if (options && options.reason === 'expired') {
    uni.showToast({ title: '管理登录已失效，请重新登录', icon: 'none' })
  }
  loadCaptcha()
  loadBindings()
})

function decodeTarget(value) {
  let text = String(value || '')
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(text)
      if (next === text) break
      text = next
    } catch (err) {
      break
    }
  }
  return text
}

async function loadCaptcha() {
  if (captchaLoading.value) return
  captchaLoading.value = true
  captchaImage.value = ''
  try {
    const data = await fetchAdminCaptchaPng()
    captchaId.value = data.captchaId
    captchaImage.value = data.pngDataUrl
    debugAnswer.value = data.debugAnswer || ''
  } catch (err) {
    error.value = err.message || '验证码加载失败'
  } finally {
    captchaLoading.value = false
  }
}

async function loadBindings() {
  if (!getToken()) return
  try {
    const data = await listAdminBindings()
    bindings.value = data.bindings || []
  } catch (err) {
    // 绑定列表失败不影响密码登录
    bindings.value = []
  }
}

function validateForm() {
  if (!form.tenantCode.trim()) return '请输入租户标识'
  if (!form.username.trim()) return '请输入用户名'
  if (!form.password) return '请输入密码'
  if (!form.captchaAnswer.trim()) return '请输入图形验证码'
  return ''
}

async function submitPasswordLogin() {
  if (submitting.value) return
  error.value = validateForm()
  if (error.value) return

  submitting.value = true
  try {
    const result = await loginAdmin({
      tenantCode: form.tenantCode.trim(),
      username: form.username.trim(),
      password: form.password,
      captchaId: captchaId.value,
      captchaAnswer: form.captchaAnswer.trim(),
    })

    setLastAdminTenantCode(form.tenantCode.trim())
    setAdminSession({
      token: result.token,
      admin: result.admin,
      meta: {
        authMethod: result.authMethod || 'password',
        issuedAt: result.issuedAt,
        tenantCode: form.tenantCode.trim(),
      },
    })

    const profile = await fetchAdminProfile()
    if (!profile || profile.role === 'platform' || profile.tenantId == null) {
      clearAdminSession()
      throw new Error('该账号不能进入租户管理端')
    }
    setAdminUser(profile)

    if (profile.mustChangePassword) {
      uni.showToast({ title: '请先修改初始密码', icon: 'none' })
      redirectToAdminChangePassword(true)
      return
    }

    await maybeBindWechat(profile)
    uni.redirectTo({ url: redirect.value })
  } catch (err) {
    error.value = err.message || '登录失败'
    form.password = ''
    form.captchaAnswer = ''
    await loadCaptcha()
  } finally {
    submitting.value = false
  }
}

async function maybeBindWechat(profile) {
  if (!getToken() || !isAdminFresh(profile)) return

  try {
    const status = await fetchAdminWechatBinding()
    if (status && status.bound) return
  } catch (err) {
    return
  }

  const confirmed = await new Promise((resolve) => {
    uni.showModal({
      title: '绑定当前微信',
      content: '绑定后，下次可以直接用当前微信免密进入管理端。密码修改后绑定会自动失效。',
      confirmText: '绑定',
      cancelText: '暂不',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })

  if (!confirmed) return

  try {
    await bindAdminWechat(getToken())
    setBindingHint(1)
    uni.showToast({ title: '微信绑定成功', icon: 'success' })
  } catch (err) {
    showAdminError(err, '绑定失败')
  }
}

async function loginByBinding(binding) {
  if (loggingBindingId.value) return
  error.value = ''
  loggingBindingId.value = binding.bindingId
  try {
    const result = await wechatAdminLogin(binding.bindingId)
    setAdminSession({
      token: result.token,
      admin: result.admin,
      meta: {
        authMethod: result.authMethod || 'wechat',
        issuedAt: result.issuedAt,
        tenantCode: result.admin && result.admin.tenantCode,
      },
    })

    const profile = await fetchAdminProfile()
    if (!profile || profile.role === 'platform' || profile.tenantId == null) {
      clearAdminSession()
      throw new Error('该账号不能进入租户管理端')
    }
    setAdminUser(profile)

    if (profile.mustChangePassword) {
      redirectToAdminChangePassword(true)
      return
    }

    uni.redirectTo({ url: redirect.value })
  } catch (err) {
    error.value = err.message || '免密登录失败'
    await loadBindings()
  } finally {
    loggingBindingId.value = null
  }
}
</script>

<style scoped lang="scss">
.admin-login-page {
  padding-bottom: calc(#{dp(28)} + env(safe-area-inset-bottom));
}

/* 浅色品牌卡：完整 logo 是橙底白字，放在深橙渐变上会糊成一块 */
.login-hero {
  display: flex;
  align-items: center;
  margin: dp(10) 0 dp(16);
  padding: dp(18) dp(16);
  border: 1px solid #f7d9c8;
  border-radius: dp(16);
  background: linear-gradient(135deg, #fff9f5 0%, #fdebe4 100%);
  color: #2b1a12;
  box-shadow: 0 dp(6) dp(16) rgba(235, 92, 32, 0.08);
}

.login-logo {
  width: dp(48);
  height: dp(48);
  margin-right: dp(12);
  border-radius: dp(14);
  box-shadow: 0 dp(4) dp(12) rgba(235, 92, 32, 0.18);
  flex-shrink: 0;
}

.login-hero-text {
  min-width: 0;
}

.login-title {
  display: block;
  font-size: dp(19);
  font-weight: 800;
}

.login-sub {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.5;
}

.binding-list {
  display: flex;
  flex-direction: column;
  gap: dp(8);
}

.binding-card {
  display: flex;
  align-items: center;
  padding: dp(11);
  border: 1px solid #fdebe4;
  border-radius: dp(10);
  background: #fff8f4;
}

.binding-main {
  flex: 1;
  min-width: 0;
}

.binding-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.binding-username {
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.binding-tenant {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}

.binding-enter {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 500;
  white-space: nowrap;
}

.captcha-row {
  display: flex;
  align-items: center;
  gap: dp(8);
}

.captcha-input {
  flex: 1;
  min-width: 0;
}

.captcha-image-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(112);
  height: dp(42);
  overflow: hidden;
  border: 1px solid #e8e1da;
  border-radius: dp(8);
  background: #faf7f3;
  flex-shrink: 0;
}

.captcha-image {
  width: dp(108);
  height: dp(38);
}

.captcha-loading {
  color: #8b8179;
  font-size: dp(10);
}

.login-error {
  display: block;
  margin: dp(2) 0 dp(10);
  color: #f53f3f;
  font-size: dp(11);
  line-height: 1.5;
}
</style>
