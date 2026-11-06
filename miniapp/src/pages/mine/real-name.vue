<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <text class="nav-title">实名认证</text>
    </view>

    <view class="content">
      <view v-if="loading" class="loading-wrap">
        <gc-loading />
      </view>

      <template v-else>
        <view class="status-card" :class="{ 'status-card--verified': verified }">
          <view class="status-icon">{{ verified ? '✓' : '!' }}</view>
          <view class="status-main">
            <text class="status-title">{{ verified ? '已完成实名认证' : '尚未完成实名认证' }}</text>
            <text class="status-desc">
              {{ verified ? '你的实名信息已用于项目协作与单据署名。' : '被邀请加入项目后，需要完成实名认证才能确认邀请。' }}
            </text>
          </view>
        </view>

        <view v-if="verified" class="info-card">
          <view class="info-row">
            <text class="info-label">姓名</text>
            <text class="info-value">{{ status.realName || '—' }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">身份证号</text>
            <text class="info-value">{{ status.idCardMask || '—' }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">认证方式</text>
            <text class="info-value">{{ status.verifyMethodLabel || '证件信息校验' }}</text>
          </view>
          <view class="info-row">
            <text class="info-label">认证时间</text>
            <text class="info-value">{{ verifiedAtText }}</text>
          </view>
          <text class="info-note">
            姓名是验收、结算单据上的署名，认证后不可修改；如确需变更请联系平台处理。
          </text>
        </view>

        <view v-else class="form-card">
          <view class="field">
            <text class="field-label">真实姓名</text>
            <input
              v-model="realName"
              class="field-input"
              type="text"
              maxlength="50"
              placeholder="请输入身份证上的姓名"
              placeholder-class="field-placeholder"
              @blur="realName = realName.trim()"
            />
          </view>

          <view class="field">
            <text class="field-label">身份证号</text>
            <input
              v-model="idCardNo"
              class="field-input"
              type="idcard"
              maxlength="18"
              placeholder="请输入 18 位身份证号"
              placeholder-class="field-placeholder"
              @blur="idCardNo = idCardNo.trim()"
            />
          </view>

          <view class="consent-row" @tap="consent = !consent">
            <view class="checkbox" :class="{ 'checkbox--checked': consent }">
              <text v-if="consent" class="checkbox-mark">✓</text>
            </view>
            <view class="consent-text">
              <text>我已阅读并同意</text>
              <text class="consent-link" @tap.stop="openPrivacy">《隐私政策》</text>
              <text>，并授权将姓名与身份证号用于实名认证{{ isProvider ? '（含传输至阿里云实人认证服务）' : '' }}。</text>
            </view>
          </view>

          <text v-if="error" class="error-text">{{ error }}</text>

          <button
            class="submit-btn"
            :class="{ 'submit-btn--disabled': submitting }"
            :disabled="submitting"
            @tap="submit"
          >
            {{ submitting ? '提交中…' : '提交认证' }}
          </button>

          <text class="footnote">
            {{
              isProvider
                ? '提交后将由阿里云实人认证核验姓名与身份证号的一致性，证件信息会传输至阿里云；本系统不保存完整证件号，仅保留脱敏结果与核验结论。'
                : '当前为基础证件校验（校验位、出生日期、行政区划），不会向第三方服务商传输你的证件信息。证件号不会保存在服务器，仅保留脱敏结果。'
            }}
          </text>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import { getRealNameStatus, verifyRealName } from '../../api/auth'

defineOptions({ name: 'RealNamePage' })

const safeTop = ref(0)
const loading = ref(true)
const status = ref(null)
const realName = ref('')
const idCardNo = ref('')
const consent = ref(false)
const error = ref('')
const submitting = ref(false)
const from = ref('')

const verified = computed(() => Boolean(status.value && status.value.verified))

// 后端返回当前配置的核验通道；aliyun 时必须在授权文案里说明会传输给服务商
const isProvider = computed(
  () => Boolean(status.value && status.value.provider === 'aliyun')
)

const verifiedAtText = computed(() => {
  const value = status.value && status.value.verifiedAt
  if (!value) return '—'
  return String(value).replace('T', ' ').slice(0, 16)
})

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12
  from.value = (options && options.from) || ''

  if (!getToken()) {
    uni.reLaunch({ url: '/pages/login/index' })
  }
})

onShow(() => {
  load()
})

async function load() {
  if (!getToken()) return
  try {
    const data = await getRealNameStatus()
    status.value = data
    if (!realName.value && data.realName) realName.value = data.realName
  } catch (err) {
    error.value = err.message || '实名认证状态加载失败'
  } finally {
    loading.value = false
  }
}

function validate() {
  const name = String(realName.value || '').trim()
  const id = String(idCardNo.value || '').trim()
  if (name.length < 2) return '请输入真实姓名'
  if (id.length !== 18) return '身份证号应为 18 位'
  if (!consent.value) return '请先阅读并同意实名认证授权说明'
  return ''
}

async function submit() {
  if (submitting.value) return

  error.value = validate()
  if (error.value) return

  submitting.value = true
  try {
    const data = await verifyRealName({
      realName: String(realName.value || '').trim(),
      idCardNo: String(idCardNo.value || '').trim(),
      consent: true,
    })
    status.value = data
    // 证件号只用于本次提交，认证成功后立即从页面内存里清掉
    idCardNo.value = ''
    uni.showToast({ title: '实名认证已完成', icon: 'success' })

    if (from.value === 'invitation') {
      setTimeout(goBack, 800)
    }
  } catch (err) {
    if (err.statusCode === 409 || err.code === 409) {
      // 已认证过（例如上次请求超时后重试）：刷新状态而不是让用户反复提交
      await load()
    }
    error.value = err.message || '认证失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

function openPrivacy() {
  uni.navigateTo({ url: '/pages/legal/index?key=privacy' })
}

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.switchTab({ url: '/pages/mine/index' })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding-bottom: calc(#{dp(24)} + env(safe-area-inset-bottom));
  background: #faf7f4;
}

.nav {
  display: flex;
  align-items: center;
  padding-right: dp(14);
  padding-bottom: dp(8);
  padding-left: dp(6);
}

.nav-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(34);
  height: dp(34);
  flex-shrink: 0;
}

.nav-back-icon {
  width: dp(20);
  height: dp(20);
}

.nav-title {
  color: #241c17;
  font-size: dp(18);
  font-weight: 700;
}

.content {
  padding: dp(4) dp(14) 0;
}

.loading-wrap {
  display: flex;
  justify-content: center;
  padding-top: dp(80);
}

.status-card {
  display: flex;
  align-items: flex-start;
  padding: dp(16);
  border-radius: dp(16);
  background: linear-gradient(135deg, #fff4ed, #fdebe4);
  border: 1px solid rgba(235, 92, 32, 0.14);
}

.status-card--verified {
  background: linear-gradient(135deg, #f0fbf5, #e6f8ee);
  border-color: rgba(0, 180, 95, 0.16);
}

.status-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(30);
  height: dp(30);
  margin-right: dp(12);
  border-radius: 50%;
  background: #eb5c20;
  color: #fff;
  font-size: dp(16);
  font-weight: 700;
  flex-shrink: 0;
}

.status-card--verified .status-icon {
  background: #00b45f;
}

.status-main {
  flex: 1;
  min-width: 0;
}

.status-title {
  display: block;
  color: #241c17;
  font-size: dp(16);
  font-weight: 700;
}

.status-desc {
  display: block;
  margin-top: dp(5);
  color: #7a6d63;
  font-size: dp(12);
  line-height: 1.55;
}

.info-card,
.form-card {
  margin-top: dp(14);
  padding: dp(16);
  @include glass-surface(dp(16), 20px);
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(10) 0;
  border-bottom: 1px solid rgba(81, 70, 62, 0.07);
}

.info-row:last-of-type {
  border-bottom: none;
}

.info-label {
  color: #8b8179;
  font-size: dp(12);
}

.info-value {
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.info-note {
  display: block;
  margin-top: dp(10);
  color: #a79c92;
  font-size: dp(11);
  line-height: 1.6;
}

.field + .field {
  margin-top: dp(16);
}

.field-label {
  display: block;
  margin-bottom: dp(7);
  color: #51463e;
  font-size: dp(12);
  font-weight: 500;
}

.field-input {
  width: 100%;
  height: dp(44);
  padding: 0 dp(12);
  border: 1px solid rgba(81, 70, 62, 0.12);
  border-radius: dp(10);
  background: #fff;
  color: #241c17;
  font-size: dp(14);
  box-sizing: border-box;
}

.field-placeholder {
  color: #b9afa6;
}

.consent-row {
  display: flex;
  align-items: flex-start;
  margin-top: dp(18);
}

.checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(18);
  height: dp(18);
  margin-top: dp(1);
  margin-right: dp(8);
  border: 1px solid #c9beb4;
  border-radius: 50%;
  flex-shrink: 0;
}

.checkbox--checked {
  border-color: #eb5c20;
  background: #eb5c20;
}

.checkbox-mark {
  color: #fff;
  font-size: dp(11);
  font-weight: 700;
}

.consent-text {
  flex: 1;
  color: #7a6d63;
  font-size: dp(11);
  line-height: 1.6;
}

.consent-link {
  color: #eb5c20;
}

.error-text {
  display: block;
  margin-top: dp(12);
  color: #d93a2b;
  font-size: dp(12);
  line-height: 1.5;
}

.submit-btn {
  margin-top: dp(20);
  height: dp(46);
  border-radius: dp(23);
  background: #eb5c20;
  color: #fff;
  font-size: dp(15);
  font-weight: 600;
  line-height: dp(46);
  text-align: center;
}

.submit-btn--disabled {
  opacity: 0.6;
}

.footnote {
  display: block;
  margin-top: dp(14);
  color: #a79c92;
  font-size: dp(11);
  line-height: 1.65;
}
</style>
