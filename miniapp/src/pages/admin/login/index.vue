<template>
  <view class="admin-page admin-login-page">
    <AdminNav title="管理员登录" fallback="/pages/login/index" />

    <view class="admin-content">
      <view class="login-hero">
        <image class="login-logo" :src="branding.logoUrl || '/static/images/logo.png'" mode="aspectFit" />
        <view class="login-hero-text">
          <text class="login-title">{{ branding.name }} · 管理端</text>
          <text class="login-sub">使用租户管理员账号登录，与网页后台同一套数据</text>
        </view>
      </view>

      <!-- dev-only:start 开发环境专用一键登录，正式构建由 vite.config.js 整段删除 -->
      <view v-if="devAccount" class="dev-login-card">
        <view class="dev-login-head">
          <text class="dev-login-title">开发调试</text>
          <text class="dev-login-tag">DEV</text>
        </view>
        <text class="dev-login-sub">
          使用内置租户管理员账号（{{ devAccount.tenantCode }} / {{ devAccount.username }}）直接登录。
          仅开发环境显示，正式构建不含此模块。
        </text>
        <button
          class="admin-btn admin-btn--block admin-btn--ghost dev-login-btn"
          :class="{ 'admin-btn--disabled': devLogging }"
          :disabled="devLogging"
          @tap="devQuickLogin"
        >
          <view v-if="devLogging" class="admin-btn-loading">
            <view class="admin-login-spinner admin-login-spinner--ghost" />
            <text>正在登录</text>
          </view>
          <text v-else>一键登录管理端</text>
        </button>
      </view>
      <!-- dev-only:end -->

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
            <view class="binding-enter">
              <view
                v-if="loggingBindingId === binding.bindingId"
                class="binding-spinner"
              />
              <text>{{ loggingBindingId === binding.bindingId ? '进入中' : '进入 ›' }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 账号密码登录 -->
      <view class="admin-card password-card" :class="{ 'password-card--shake': shaking }">
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
          <view v-if="submitting" class="admin-btn-loading">
            <view class="admin-login-spinner" />
            <text>正在登录</text>
          </view>
          <text v-else>登录管理端</text>
        </button>
      </view>

      <view class="admin-note">
        管理端与业主/工长/监理身份相互独立：C 端账号的角色在邀请时固定，
        同时用管理员账号进入管理端。普通用户继续使用微信登录，管理员从这里进入管理端。
      </view>
    </view>

    <!-- 管理端登录成功过场：遮住 redirectTo 的硬切换 -->
    <view v-if="entering" class="enter-overlay">
      <view class="enter-mark">
        <view class="enter-ring enter-ring--outer" />
        <view class="enter-ring enter-ring--inner" />
        <image
          class="enter-logo"
          :src="branding.logoUrl || '/static/images/logo.png'"
          mode="aspectFit"
        />
      </view>
      <text class="enter-name">{{ branding.name }}</text>
      <text class="enter-tip">正在进入管理端</text>
      <view class="enter-dots">
        <view
          v-for="n in 3"
          :key="n"
          class="enter-dot"
          :style="{ animationDelay: `${(n - 1) * 140}ms` }"
        />
      </view>
    </view>
  </view>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { branding, loadBranding } from '../../../store/branding'
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

/* dev-only:start 开发环境一键登录，正式构建由 vite.config.js 整段删除 */
const devAccount = import.meta.env.DEV
  ? { tenantCode: 'default', username: 'admin', password: 'Admin123456' }
  : null
const devLogging = ref(false)
/* dev-only:end */

const captchaId = ref('')
const captchaImage = ref('')
const captchaLoading = ref(false)
const debugAnswer = ref('')
const submitting = ref(false)
const error = ref('')
const bindings = ref([])
const loggingBindingId = ref(null)
const redirect = ref('/pages/admin/workbench/index')
// 登录成功后的全屏过场；与 submitting 分开，避免按钮状态和进入动画互相打断
const entering = ref(false)
// 登录失败的轻微抖动
const shaking = ref(false)

onLoad((options) => {
  loadBranding()
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

/** 登录失败时抖动账号密码卡，避免只剩一行错误文字 */
function shakeForm() {
  shaking.value = true
  setTimeout(() => {
    shaking.value = false
  }, 420)
}

/**
 * 登录成功后的过场。
 *
 * 管理端用 redirectTo 替换当前页，视觉上是硬切；先显示全屏过场，
 * 停留一小段时间再跳。若跳转失败，过场会自动收起并恢复登录按钮。
 */
function playEnterTransition(action) {
  // 先收键盘：微信在键盘收起过程中重排页面，全屏过场容易被顶到页面下方
  if (typeof uni.hideKeyboard === 'function') uni.hideKeyboard()
  entering.value = true
  setTimeout(() => {
    action()
    setTimeout(() => {
      entering.value = false
      submitting.value = false
      devLogging.value = false
      loggingBindingId.value = null
    }, 1500)
  }, 680)
}

async function submitPasswordLogin() {
  if (submitting.value) return
  error.value = validateForm()
  if (error.value) {
    shakeForm()
    return
  }

  submitting.value = true
  try {
    const result = await loginAdmin({
      tenantCode: form.tenantCode.trim(),
      username: form.username.trim(),
      password: form.password,
      captchaId: captchaId.value,
      captchaAnswer: form.captchaAnswer.trim(),
    })
    await completeLogin(result, form.tenantCode.trim())
  } catch (err) {
    shakeForm()
    error.value = err.message || '登录失败'
    form.password = ''
    form.captchaAnswer = ''
    await loadCaptcha()
  } finally {
    // 进入过场期间保留按钮 loading，避免过场下面又变回可点击
    if (!entering.value) submitting.value = false
  }
}

/** 密码登录与开发环境一键登录共用：落会话 → 校验身份 → 跳转 */
async function completeLogin(result, tenantCode, defaultAuthMethod = 'password') {
  setLastAdminTenantCode(tenantCode)
  setAdminSession({
    token: result.token,
    admin: result.admin,
    meta: {
      authMethod: result.authMethod || defaultAuthMethod,
      issuedAt: result.issuedAt,
      tenantCode,
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
    playEnterTransition(() => redirectToAdminChangePassword(true))
    return
  }

  await maybeBindWechat(profile)
  playEnterTransition(() => uni.redirectTo({ url: redirect.value }))
}

/* dev-only:start */
/** 仅开发环境存在（按钮与账号常量都在正式构建中被移除） */
async function devQuickLogin() {
  if (!devAccount || devLogging.value) return

  devLogging.value = true
  error.value = ''
  try {
    // 验证码一次性有效，这里现取一次；开发环境验证码接口会回显答案
    const captcha = await fetchAdminCaptchaPng()
    if (!captcha || !captcha.debugAnswer) {
      throw new Error('开发环境未返回验证码答案，请确认后端 NODE_ENV=development')
    }

    const result = await loginAdmin({
      tenantCode: devAccount.tenantCode,
      username: devAccount.username,
      password: devAccount.password,
      captchaId: captcha.captchaId,
      captchaAnswer: captcha.debugAnswer,
    })
    await completeLogin(result, devAccount.tenantCode)
  } catch (err) {
    shakeForm()
    error.value = err.message || '一键登录失败'
    await loadCaptcha()
  } finally {
    if (!entering.value) devLogging.value = false
  }
}
/* dev-only:end */

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
    // 与密码登录共用同一套「落会话 → 校验身份 → 过场 → 跳转」
    await completeLogin(result, result.admin && result.admin.tenantCode, 'wechat')
  } catch (err) {
    shakeForm()
    error.value = err.message || '免密登录失败'
    await loadBindings()
  } finally {
    if (!entering.value) loggingBindingId.value = null
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

/* dev-only:start 开发环境一键登录，正式构建由 vite.config.js 整段删除 */
/* 虚线边框提示这是调试入口 */
.dev-login-card {
  margin-bottom: dp(16);
  padding: dp(14);
  border: 1px dashed #f0a37c;
  border-radius: dp(14);
  background: #fffaf6;
}

.dev-login-head {
  display: flex;
  align-items: center;
  gap: dp(8);
}

.dev-login-title {
  color: #c44710;
  font-size: dp(13);
  font-weight: 700;
}

.dev-login-tag {
  padding: 0 dp(6);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(9);
  font-weight: 700;
  letter-spacing: dp(0.5);
  line-height: dp(18);
}

.dev-login-sub {
  display: block;
  margin-top: dp(8);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.6;
}

.dev-login-btn {
  margin-top: dp(12);
}
/* dev-only:end */

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
  display: flex;
  align-items: center;
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 500;
  white-space: nowrap;
}

.binding-spinner {
  width: dp(11);
  height: dp(11);
  margin-right: dp(4);
  border: 1.5px solid rgba(235, 92, 32, 0.2);
  border-top-color: #eb5c20;
  border-radius: 50%;
  animation: admin-login-spin 720ms linear infinite;
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

/* ── 登录按钮 loading 与失败抖动 ── */
.admin-btn-loading {
  display: flex;
  align-items: center;
  justify-content: center;
}

.admin-login-spinner {
  width: dp(14);
  height: dp(14);
  margin-right: dp(7);
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: admin-login-spin 720ms linear infinite;
}

.admin-login-spinner--ghost {
  border-color: rgba(235, 92, 32, 0.2);
  border-top-color: #eb5c20;
}

@keyframes admin-login-spin {
  to {
    transform: rotate(360deg);
  }
}

.password-card--shake {
  animation: password-card-shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

@keyframes password-card-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  18% {
    transform: translateX(dp(-7));
  }
  36% {
    transform: translateX(dp(6));
  }
  54% {
    transform: translateX(dp(-4));
  }
  72% {
    transform: translateX(dp(3));
  }
  88% {
    transform: translateX(dp(-1));
  }
}

/* ── 登录成功过场（内联在页面里，避免自定义组件在微信端的定位差异） ── */
.enter-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 50% 38%, rgba(235, 92, 32, 0.14) 0%, rgba(235, 92, 32, 0) 46%),
    radial-gradient(circle at 18% 82%, rgba(255, 196, 150, 0.18) 0%, rgba(255, 196, 150, 0) 42%),
    #faf7f4;
  animation: enter-overlay-in 260ms ease-out both;
}

@keyframes enter-overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.enter-mark {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(124);
  height: dp(124);
  animation: enter-mark-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes enter-mark-in {
  from {
    opacity: 0;
    transform: scale(0.82);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.enter-ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(235, 92, 32, 0.16);
}

.enter-ring--outer {
  width: dp(120);
  height: dp(120);
  border-top-color: rgba(235, 92, 32, 0.82);
  border-right-color: rgba(235, 92, 32, 0.34);
  animation: enter-spin 1100ms linear infinite;
}

.enter-ring--inner {
  width: dp(96);
  height: dp(96);
  border-bottom-color: rgba(235, 92, 32, 0.52);
  animation: enter-spin 1600ms linear infinite reverse;
}

@keyframes enter-spin {
  to {
    transform: rotate(360deg);
  }
}

.enter-logo {
  position: relative;
  z-index: 1;
  width: dp(74);
  height: dp(74);
  border-radius: dp(20);
  background: #fff;
  box-shadow:
    0 dp(12) dp(34) rgba(235, 92, 32, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.enter-name {
  margin-top: dp(22);
  color: #2b1a12;
  font-size: dp(22);
  font-weight: 800;
  letter-spacing: dp(-0.3);
}

.enter-tip {
  margin-top: dp(8);
  color: #8b8179;
  font-size: dp(12);
  letter-spacing: dp(0.2);
}

.enter-dots {
  display: flex;
  align-items: center;
  margin-top: dp(18);
}

.enter-dot {
  width: dp(6);
  height: dp(6);
  margin: 0 dp(3);
  border-radius: 50%;
  background: #eb5c20;
  animation: enter-dot 900ms ease-in-out infinite;
}

@keyframes enter-dot {
  0%,
  80%,
  100% {
    opacity: 0.22;
    transform: translateY(0) scale(0.8);
  }
  40% {
    opacity: 1;
    transform: translateY(dp(-4)) scale(1);
  }
}
</style>
