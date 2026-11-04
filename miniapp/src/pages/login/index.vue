<template>
  <view class="page">
    <!-- 背景：装修实景与阳光插画（由设计稿 SVG 栅格化） -->
    <image class="bg-art" src="/static/images/login-bg.png" mode="aspectFill" />

    <view class="top" :style="{ paddingTop: `${safeTop}px` }">
      <!-- 品牌 -->
      <view class="brand">
        <image class="brand-logo" :src="branding.logoUrl || '/static/images/logo.png'" mode="aspectFit" />
        <view class="brand-text">
          <text class="brand-name">{{ branding.name }}</text>
          <text class="brand-slogan">让装修工程更透明、更可控</text>
        </view>
      </view>

      <!-- 手绘标语 -->
      <view class="handwriting">
        <text class="handwriting-line">从开工到竣工</text>
        <text class="handwriting-line">全程在线管理</text>
        <image class="handwriting-underline" src="/static/images/login-underline.png" mode="aspectFit" />
      </view>

      <!-- 登录卡 -->
      <view class="login-card">
        <view class="field">
          <image class="field-icon" src="/static/images/icon-phone.png" mode="aspectFit" />
          <input
            v-model="phone"
            class="field-input"
            type="number"
            maxlength="11"
            placeholder="请输入手机号"
            placeholder-class="field-placeholder"
          />
        </view>

        <view class="field field--code">
          <image class="field-icon" src="/static/images/icon-shield-check.png" mode="aspectFit" />
          <input
            v-model="smsCode"
            class="field-input"
            type="number"
            maxlength="6"
            placeholder="请输入验证码"
            placeholder-class="field-placeholder"
          />
          <view class="field-divider" />
          <text class="code-btn" @tap="onGetCode">获取验证码</text>
        </view>

        <button class="login-btn" :disabled="loading" @tap="onLogin">
          {{ loading ? '登录中…' : '登 录' }}
        </button>

        <view class="agreement" @tap="agreed = !agreed">
          <view class="checkbox" :class="{ 'checkbox--checked': agreed }">
            <image
              v-if="agreed"
              class="checkbox-icon"
              src="/static/images/icon-check-white.png"
              mode="aspectFit"
            />
          </view>
          <text class="agreement-text">
            我已阅读并同意
            <text class="agreement-link" @tap.stop="openLegal('agreement')">《用户协议》</text>
            和
            <text class="agreement-link" @tap.stop="openLegal('privacy')">《隐私政策》</text>
          </text>
        </view>
      </view>

      <!-- 微信登录 / 管理员登录：同一行水平分布 -->
      <view class="third-party">
        <view class="divider">
          <view class="divider-line" />
          <text class="divider-label">其他登录方式</text>
        </view>
        <view class="login-actions">
          <button class="wechat-btn" :disabled="loading" @tap="onWechatLogin">
            <image
              class="wechat-icon"
              :src="wechatIcon"
              mode="aspectFit"
              @error="onWechatIconError"
            />
            <text class="wechat-text">微信登录</text>
          </button>
          <view class="admin-login-btn" @tap="goAdminLogin">
            <view
              class="admin-login-icon"
              :class="{ 'admin-login-icon--fallback': adminIconFailed }"
            >
              <image
                v-if="!adminIconFailed"
                class="admin-login-svg"
                :src="adminIcon"
                mode="aspectFit"
                @error="onAdminIconError"
              />
              <image
                v-else
                class="admin-login-icon-img"
                src="/static/images/icon-gear-white.png"
                mode="aspectFit"
              />
            </view>
            <text class="admin-login-text">管理员登录</text>
          </view>
        </view>
        <text class="admin-login-hint">租户管理员使用后台账号进入管理端</text>
      </view>
    </view>

    <!-- 底部四大特色 + 城市剪影 -->
    <view class="footer">
      <view class="features">
        <view v-for="item in features" :key="item.title" class="feature">
          <view class="feature-icon-wrap">
            <image class="feature-icon" :src="item.icon" mode="aspectFit" />
          </view>
          <text class="feature-title">{{ item.title }}</text>
          <text class="feature-sub">{{ item.sub }}</text>
        </view>
      </view>
      <image class="skyline" src="/static/images/login-skyline.png" mode="aspectFill" />
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { DEV_PHONE_BIND, DEV_WX_CODE, DEV_MP_WX_CODE } from '../../config'
import { login, bindPhone } from '../../api/auth'
import { myProjects } from '../../api/project'
import {
  getToken,
  getUser,
  setToken,
  setUser,
  setCachedProjects,
} from '../../store/session'
import { resolveProjectsLanding } from '../../store/projectContext'
import { branding, loadBranding } from '../../store/branding'

const phone = ref('')
const smsCode = ref('')
const agreed = ref(true)
const loading = ref(false)
const safeTop = ref(0)

const WECHAT_ICON_SVG =
  'data:image/svg+xml;base64,PHN2ZyB0PSIxNzkyOTk1Mzk3ODUzIiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjU4NjkiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNNjgzLjA1OCAzNjQuNjk1YzExIDAgMjIgMS4wMTYgMzIuOTQzIDEuOTc2QzY4Ni41NjQgMjMwLjA2NCA1MzguODk2IDEyOCAzNzAuNjgxIDEyOGMtMTg4LjEwNCAwLjY2LTM0Mi4yMzcgMTI3Ljc5My0zNDIuMjM3IDI4OS4yMjYgMCA5My4wNjggNTEuMzc5IDE2OS44MjcgMTM2LjcyNSAyMjkuMjU2TDEzMC43MiA3NDguNDNsMTE5Ljc5Ni01OS4zNjhjNDIuOTE4IDguMzk1IDc3LjM3IDE2Ljc5IDExOS43NDIgMTYuNzkgMTEgMCAyMS40Ni0wLjQ4IDMxLjkxNC0xLjQ0MmEyNTkuMTY4IDI1OS4xNjggMCAwIDEtMTAuNDU1LTcxLjM1OGMwLjQ4NS0xNDguMDAyIDEyOC43NDQtMjY4LjI5NyAyOTEuNDAzLTI2OC4yOTdsLTAuMDYtMC4wNnogbS0xODQuMTEzLTkxLjk5MmMyNS45OSAwIDQyLjkxMyAxNi43OSA0Mi45MTMgNDIuNTc1IDAgMjUuMTg4LTE2LjkyMyA0Mi41NzktNDIuOTEzIDQyLjU3OS0yNS40NSAwLTUxLjM4LTE2Ljg1LTUxLjM4LTQyLjU4IDAtMjUuNzg0IDI1LjkzLTQyLjU3NCA1MS4zOC00Mi41NzR6IG0tMjM5LjU0NCA4NS4xNTRjLTI1LjM4NCAwLTUxLjM3NC0xNi44NS01MS4zNzQtNDIuNTggMC0yNS43ODQgMjUuOTktNDIuNTc0IDUxLjM3NC00Mi41NzQgMjUuNDUgMCA0Mi45MTggMTYuNzkgNDIuOTE4IDQyLjU3NSAwIDI1LjE4OC0xNi45MjQgNDIuNTc5LTQyLjkxOCA0Mi41Nzl6IG03MzYuMTU1IDI3MS42NTVjMC0xMzUuNjQ3LTEzNi43MjUtMjQ2LjUyNy0yOTAuOTgzLTI0Ni41MjctMTYyLjY1NSAwLTI5MC45MTggMTEwLjg4LTI5MC45MTggMjQ2LjUyNyAwIDEzNi4xMjggMTI4LjI2MyAyNDYuNTg3IDI5MC45MTggMjQ2LjU4NyAzMy45NzIgMCA2OC40MjMtOC4zOTUgMTAyLjgxOC0xNi44NWw5My44MDkgNTAuOTczLTI1LjkzLTg0LjY3N2M2OC45MDctNTEuOTMgMTIwLjI4Ni0xMTkuODE1IDEyMC4yODYtMTk2LjAzM3ogbS0zODUuMjc1LTQyLjU4Yy0xNi45MjMgMC0zNC40NTItMTYuNzktMzQuNDUyLTM0LjE3OSAwLTE2Ljc5IDE3LjUyOS0zNC4xOCAzNC40NTItMzQuMTggMjUuOTkgMCA0Mi45MTggMTYuODUgNDIuOTE4IDM0LjE4IDAgMTcuMzktMTYuOTI4IDM0LjE4LTQyLjkxOCAzNC4xOHogbTE4OC4xNjUgMGMtMTYuOTg0IDAtMzMuOTcyLTE2Ljc5LTMzLjk3Mi0zNC4xNzkgMC0xNi43OSAxNi45MjctMzQuMTggMzMuOTcyLTM0LjE4IDI1LjkzIDAgNDIuOTEzIDE2Ljg1IDQyLjkxMyAzNC4xOCAwIDE3LjM5LTE2Ljk4MyAzNC4xOC00Mi45MTMgMzQuMTh6IiBmaWxsPSIjMDlCQjA3IiBwLWlkPSI1ODcwIj48L3BhdGg+PC9zdmc+'
const ADMIN_ICON_SVG =
  'data:image/svg+xml;base64,PHN2ZyB0PSIxNzkyOTk1MjYyOTYxIiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjM2NDYiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNNDM1Ljk1MDkzMyA2MzcuNzQ3MmEzNC4xMzMzMzMgMzQuMTMzMzMzIDAgMCAxIDMyLjM5MjUzNC0yMy4zNDcyaDg3LjMxMzA2NmEzNC4xMzMzMzMgMzQuMTMzMzMzIDAgMCAxIDMyLjM5MjUzNCAyMy4zNDcybDIwLjY4NDggNjIuMDg4NTMzYTM0LjEzMzMzMyAzNC4xMzMzMzMgMCAwIDEtNS4wNTE3MzQgMzEuMjY2MTM0TDUzOS4zMDY2NjcgODE2LjkxMzA2N2EzNC4xMzMzMzMgMzQuMTMzMzMzIDAgMCAxLTU0LjYxMzMzNCAwbC02NC4zNzU0NjYtODUuODExMmEzNC4xMzMzMzMgMzQuMTMzMzMzIDAgMCAxLTUuMDUxNzM0LTMxLjI2NjEzNGwyMC42ODQ4LTYyLjEyMjY2NnoiIGZpbGw9IiNGRkFBNDQiIHAtaWQ9IjM2NDciPjwvcGF0aD48cGF0aCBkPSJNNzE2LjggMjczLjA2NjY2N0EyMDQuOCAyMDQuOCAwIDAgMCAzMDcuMiAyNzMuMDY2NjY3djY4LjI2NjY2NmEyMDQuOCAyMDQuOCAwIDAgMCA0MDkuNiAwVjI3My4wNjY2Njd6TTIzOC45MzMzMzMgNjE0LjRhMjA0LjggMjA0LjggMCAwIDAtMjA0LjggMjA0Ljh2NjguMjY2NjY3YTY4LjI2NjY2NyA2OC4yNjY2NjcgMCAwIDAgNjguMjY2NjY3IDY4LjI2NjY2Nmg4MTkuMmE2OC4yNjY2NjcgNjguMjY2NjY3IDAgMCAwIDY4LjI2NjY2Ny02OC4yNjY2NjZ2LTY4LjI2NjY2N2EyMDQuOCAyMDQuOCAwIDAgMC0yMDQuOC0yMDQuOGgtMTcuNDA4YTM0LjEzMzMzMyAzNC4xMzMzMzMgMCAwIDAtMjYuOTY1MzM0IDEzLjE3NTQ2N2wtMTc0Ljc5NjggMjI0LjczMzg2NmE2OC4yNjY2NjcgNjguMjY2NjY3IDAgMCAxLTEwNy43OTMwNjYgMGwtMTc0Ljc2MjY2Ny0yMjQuNzMzODY2QTM0LjEzMzMzMyAzNC4xMzMzMzMgMCAwIDAgMjU2LjM0MTMzMyA2MTQuNEgyMzguOTMzMzMzeiIgZmlsbD0iI0ZGNzc0NCIgcC1pZD0iMzY0OCI+PC9wYXRoPjwvc3ZnPg=='

const wechatIcon = ref(WECHAT_ICON_SVG)
const adminIcon = ref(ADMIN_ICON_SVG)
const adminIconFailed = ref(false)

function onWechatIconError() {
  // 极少数旧版 WebView 不认 SVG data URI，退回原来的 PNG
  if (wechatIcon.value !== '/static/images/wechat.png') {
    wechatIcon.value = '/static/images/wechat.png'
  }
}

function onAdminIconError() {
  adminIconFailed.value = true
}

const features = [
  {
    title: '进度透明',
    sub: '实时汇报 · 图文留痕',
    icon: '/static/images/icon-login-progress.png',
  },
  {
    title: '验收可溯',
    sub: '多级审核 · 电子签名',
    icon: '/static/images/icon-login-acceptance.png',
  },
  {
    title: '账目清晰',
    sub: '双向账目 · 阶段结算',
    icon: '/static/images/icon-login-ledger.png',
  },
  {
    title: '管理高效',
    sub: '统一建档 · 数据看板',
    icon: '/static/images/icon-login-management.png',
  },
]

onLoad(() => {
  loadBranding()
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  // 已有登录态时直接进入，避免每次冷启动都停在登录页。
  // token 失效会由请求层清理，用户回到登录页重新授权。
  if (getToken()) bootstrap()
})

async function bootstrap() {
  try {
    const data = await myProjects()
    setCachedProjects(data)
    // 登录只解决身份；项目上下文由 /projects 的结果决定。
    // 有待确认邀请先去邀请列表，否则直接进项目列表 —— 不再经过角色选择页。
    // 用 reLaunch 清空页面栈，避免已登录用户还能返回登录页。
    uni.reLaunch({ url: resolveProjectsLanding(data) })
  } catch (err) {
    // 401 已在请求层清理登录态；其他错误留在登录页，让用户重试
  }
}

/** 微信端取 code；H5 / 其他端用固定开发 code（后端 WX_MOCK 派生稳定账号） */
function getWxCode() {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    // dev 构建固定 code：开发者工具的 code 每次都变，清缓存后会变成新账号，
    // 手机号就会撞上旧账号。正式构建（import.meta.env.DEV=false）走真实 login。
    if (import.meta.env.DEV) {
      resolve(DEV_MP_WX_CODE)
      return
    }
    uni.login({
      provider: 'weixin',
      success: (res) => (res.code ? resolve(res.code) : reject(new Error('微信登录失败'))),
      fail: () => reject(new Error('微信登录失败，请重试')),
    })
    // #endif
    // #ifndef MP-WEIXIN
    resolve(DEV_WX_CODE)
    // #endif
  })
}

function onGetCode() {
  // 后端目前没有短信验证码登录接口：C 端身份由微信 openid 决定。
  // 这里如实提示，而不是做一个永远收不到验证码的假倒计时。
  uni.showToast({ title: '短信登录暂未开通，请使用微信登录', icon: 'none' })
}

async function onLogin() {
  await doLogin({ bindPhone: true })
}

async function onWechatLogin() {
  await doLogin({ bindPhone: false })
}

function goAdminLogin() {
  uni.navigateTo({ url: '/pages/admin/login/index' })
}

async function doLogin({ bindPhone: shouldBind }) {
  if (!agreed.value) {
    uni.showToast({ title: '请先阅读并同意用户协议与隐私政策', icon: 'none' })
    return
  }
  if (loading.value) return
  loading.value = true

  try {
    const code = await getWxCode()
    const result = await login({ code })
    setToken(result.token)
    setUser(result.user)

    // 设计稿里的手机号表单：开发/mock 环境下用它顺带绑定手机号，
    // 这样被邀请人不必再走一遍绑定流程。真实环境必须使用微信
    // getPhoneNumber 授权，这里失败不阻断登录。
    if (DEV_PHONE_BIND && shouldBind && /^1[3-9]\d{9}$/.test(phone.value)) {
      try {
        const bound = await bindPhone({ phone: phone.value })
        if (bound && bound.token) setToken(bound.token)
        if (bound && bound.phoneMasked) {
          const nextUser = { ...(getUser() || {}), hasPhone: true, phoneMasked: bound.phoneMasked }
          setUser(nextUser)
        }
      } catch (err) {
        // 手机号绑定失败不影响登录；项目列表的空态还会再引导一次
      }
    }

    const data = await myProjects()
    setCachedProjects(data)
    uni.reLaunch({ url: resolveProjectsLanding(data) })
  } catch (err) {
    uni.showToast({ title: err.message || '登录失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function openLegal(key) {
  uni.navigateTo({ url: `/pages/legal/index?key=${key}` })
}
</script>

<style scoped lang="scss">
.page {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: $color-login-canvas;
  overflow: hidden;
}

.bg-art {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: dp(380);
  z-index: 0;
}

.top {
  position: relative;
  z-index: 10;
  padding-left: dp(24);
  padding-right: dp(24);
}

/* ── 品牌 ── */
.brand {
  display: flex;
  align-items: center;
  margin-top: dp(12);
}

.brand-logo {
  width: dp(52);
  height: dp(52);
  border-radius: dp(14);
  margin-right: dp(14);
  box-shadow: 0 dp(4) dp(12) rgba(235, 92, 32, 0.18);
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-name {
  font-size: dp(30);
  font-weight: 800;
  color: #2b1a12;
  letter-spacing: dp(-0.5);
  line-height: 1.1;
}

.brand-slogan {
  margin-top: dp(5);
  font-size: dp(13);
  font-weight: 500;
  color: #67564A;
  letter-spacing: dp(0.3);
}

/* ── 手绘标语 ── */
.handwriting {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  /* 与品牌区拉开距离，避免手绘标语贴着副标题 */
  margin-top: dp(40);
  padding-left: dp(4);
  transform: rotate(-10deg);
  transform-origin: left top;
}

.handwriting-line {
  font-family: 'KaiTi', 'STKaiti', 'Biaodian', 'Comic Sans MS', cursive, sans-serif;
  font-size: dp(17);
  font-weight: 700;
  color: #b8420e;
  line-height: 1;
  letter-spacing: dp(0.5);
  text-shadow: 0 dp(1) dp(2) rgba(255, 255, 255, 0.6);
}

.handwriting-line + .handwriting-line {
  margin-top: dp(4);
}

.handwriting-underline {
  width: dp(144);
  height: dp(12);
  margin-top: dp(3);
}

/* ── 登录卡 ── */
.login-card {
  /* 手绘标语下移后这里相应收一点，登录卡整体位置保持不变 */
  margin-top: dp(30);
  padding: dp(20);
  @include glass-surface(dp(16), 24px);
  box-shadow:
    0 dp(8) dp(30) rgba(235, 92, 32, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
}

.field {
  display: flex;
  align-items: center;
  height: dp(48);
  padding: 0 dp(14);
  margin-bottom: dp(12);
  background: $color-surface;
  border: 1px solid #e6ddd5;
  border-radius: dp(12);
}

.field--code {
  margin-bottom: dp(4);
}

.field-icon {
  width: dp(20);
  height: dp(20);
  margin-right: dp(12);
  flex-shrink: 0;
}

.field-input {
  flex: 1;
  height: 100%;
  font-size: dp(15);
  color: $color-ink;
}

.field-placeholder {
  color: #a19488;
}

.field-divider {
  width: 1px;
  height: dp(16);
  margin: 0 dp(8);
  background: #e6ddd5;
  flex-shrink: 0;
}

.code-btn {
  font-size: dp(14);
  font-weight: 500;
  color: $color-primary;
  white-space: nowrap;
  padding-left: dp(2);
  padding-right: dp(1);
}

.login-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(50);
  margin-top: dp(10);
  border-radius: dp(999);
  background: $color-primary;
  color: $color-on-primary;
  font-size: dp(16);
  font-weight: 600;
  box-shadow: 0 dp(6) dp(20) rgba(235, 92, 32, 0.35);
}

.login-btn:active {
  background: $color-primary-pressed;
}

.login-btn[disabled] {
  opacity: 0.7;
}

/* ── 协议 ── */
.agreement {
  display: flex;
  align-items: flex-start;
  margin-top: dp(10);
  padding-top: dp(4);
}

.checkbox {
  width: dp(14);
  height: dp(14);
  margin-top: dp(2);
  margin-right: dp(6);
  border: 1px solid #d3c8bd;
  border-radius: 50%;
  background: $color-surface;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.checkbox--checked {
  background: $color-primary;
  border-color: $color-primary;
}

.checkbox-icon {
  width: dp(9);
  height: dp(9);
}

.agreement-text {
  font-size: dp(12);
  line-height: 1.5;
  color: #7f7267;
}

.agreement-link {
  color: $color-primary;
}

/* ── 其他登录方式 ── */
.third-party {
  margin-top: dp(20);
  text-align: center;
}

.divider {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(16);
}

.divider-line {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: dp(240);
  height: 1px;
  background: #e5dcd3;
}

.divider-label {
  position: relative;
  z-index: 1;
  padding: 0 dp(12);
  background: $color-login-canvas;
  font-size: dp(12);
  color: #94887d;
}

.login-actions {
  display: flex;
  align-items: stretch;
  gap: dp(12);
  margin-top: dp(14);
}

.wechat-btn {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: center;
  height: dp(44);
  margin-top: 0;
  padding: 0 dp(10);
  @include glass-surface(dp(999), 14px);
}

.wechat-btn:active {
  background: rgba(255, 255, 255, 0.68);
}

.wechat-icon {
  width: dp(20);
  height: dp(20);
  margin-right: dp(8);
  flex-shrink: 0;
}

.wechat-text {
  font-size: dp(14);
  font-weight: 500;
  color: #33281f;
  white-space: nowrap;
}

/* ── 管理员登录：与微信登录同排 ── */
.admin-login-btn {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: center;
  height: dp(44);
  padding: 0 dp(10);
  @include glass-surface(dp(999), 14px);
}

.admin-login-btn:active {
  background: rgba(255, 255, 255, 0.68);
}

.admin-login-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(26);
  height: dp(26);
  margin-right: dp(7);
  flex-shrink: 0;
}

/* SVG 失败时才显示原来的橙色底 + 白色齿轮 */
.admin-login-icon--fallback {
  border-radius: dp(8);
  background: linear-gradient(135deg, #f07a3a, #eb5c20);
}

.admin-login-svg {
  width: dp(22);
  height: dp(22);
}

.admin-login-icon-img {
  width: dp(14);
  height: dp(14);
}

.admin-login-text {
  font-size: dp(14);
  font-weight: 500;
  color: #33281f;
  white-space: nowrap;
}

.admin-login-hint {
  display: block;
  margin-top: dp(10);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.4;
  text-align: center;
}

/* ── 底部特色 ── */
.footer {
  position: relative;
  z-index: 10;
  margin-top: auto;
  padding-top: dp(24);
}

.features {
  display: flex;
  padding: 0 dp(12) dp(12);
}

.feature {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.feature-icon-wrap {
  width: dp(44);
  height: dp(44);
  display: flex;
  align-items: center;
  justify-content: center;
}

.feature-icon {
  width: dp(30);
  height: dp(30);
}

.feature-title {
  margin-top: dp(6);
  font-size: dp(12);
  font-weight: 700;
  color: #2a211a;
}

.feature-sub {
  margin-top: dp(2);
  font-size: dp(10);
  color: #94887c;
  transform: scale(0.9);
  white-space: nowrap;
}

.skyline {
  display: block;
  width: 100%;
  height: dp(50);
}
</style>
