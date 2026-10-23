<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <text class="nav-title">订阅消息管理</text>
    </view>

    <view class="content">
      <view class="intro-card">
        <view class="intro-icon-wrap">
          <image class="intro-icon" src="/static/images/icon-bell-accent.png" mode="aspectFit" />
        </view>
        <view class="intro-main">
          <text class="intro-title">按业务场景授权</text>
          <text class="intro-text">
            订阅消息由微信逐次询问。拒绝或关闭后，相关提醒仍会完整保留在消息中心。
          </text>
        </view>
      </view>

      <view v-if="loading" class="state">
        <text class="state-text">加载中…</text>
      </view>

      <view v-else-if="error" class="state">
        <text class="state-title">加载失败</text>
        <text class="state-text">{{ error }}</text>
        <button class="state-btn" @tap="load">重新加载</button>
      </view>

      <view v-else class="list-card">
        <view
          v-for="(item, index) in list"
          :key="item.type"
          class="sub-row"
          :class="{ 'sub-row--divided': index > 0 }"
        >
          <view class="sub-icon-wrap">
            <text class="sub-icon-text">{{ typeInitial(item.type) }}</text>
          </view>
          <view class="sub-main">
            <view class="sub-title-row">
              <text class="sub-title">{{ item.typeLabel }}</text>
              <text class="status-chip" :class="statusClass(item)">{{ statusLabel(item) }}</text>
            </view>
            <text class="sub-text">{{ statusHint(item) }}</text>
          </view>
          <button
            v-if="item.canRequest"
            class="sub-btn"
            :disabled="submittingType === item.type"
            @tap="requestPermission(item)"
          >
            {{ submittingType === item.type ? '处理中' : item.status ? '重新授权' : '授权' }}
          </button>
        </view>
      </view>

      <view class="footnote">
        当前微信订阅消息是否可用取决于后端是否配置了模板 ID。未配置时，站内消息不受影响。
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import { fetchSubscriptions, recordSubscription } from '../../api/notification'

defineOptions({ name: 'SubscriptionsPage' })

const safeTop = ref(0)
const tenantId = ref(null)
const loading = ref(true)
const error = ref('')
const list = ref([])
const submittingType = ref('')

const TYPE_INITIALS = {
  acceptance: '验',
  progress: '进',
  payment: '款',
  comment: '评',
  system: '系',
}

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12
  tenantId.value = options && options.tenantId ? Number(options.tenantId) : null

  if (!getToken()) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchSubscriptions(tenantId.value || undefined)
    list.value = (data && data.list) || []
  } catch (err) {
    if (err.statusCode === 401) {
      uni.reLaunch({ url: '/pages/login/index' })
      return
    }
    error.value = err.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function typeInitial(type) {
  return TYPE_INITIALS[type] || '通'
}

function statusLabel(item) {
  if (!item.available) return '仅站内信'
  if (item.status === 'accepted') return '已允许'
  if (item.status === 'rejected') return '已拒绝'
  if (item.status === 'ban') return '已关闭'
  return '未授权'
}

function statusClass(item) {
  if (!item.available) return 'status-chip--muted'
  if (item.status === 'accepted') return 'status-chip--green'
  if (item.status === 'ban') return 'status-chip--gray'
  if (item.status === 'rejected') return 'status-chip--orange'
  return 'status-chip--accent'
}

function statusHint(item) {
  if (!item.available) return '该类消息暂未开通订阅推送，站内消息仍会正常收到。'
  if (item.status === 'accepted') return '已允许接收该类微信订阅消息。'
  if (item.status === 'rejected') return '上次授权被拒绝；可以在需要时重新授权。'
  if (item.status === 'ban') return '已勾选不再询问，需在微信小程序设置中重新开启。'
  return '尚未授权，点击右侧按钮在微信中开启。'
}

async function requestPermission(item) {
  if (submittingType.value || !item.templateId) return

  submittingType.value = item.type

  // #ifndef MP-WEIXIN
  submittingType.value = ''
  uni.showToast({ title: '请在微信小程序中授权订阅消息', icon: 'none' })
  return
  // #endif

  // #ifdef MP-WEIXIN
  uni.requestSubscribeMessage({
    tmplIds: [item.templateId],
    success: async (res) => {
      const result = res[item.templateId]
      const status = result === 'accept' ? 'accepted' : result === 'ban' ? 'ban' : 'rejected'

      try {
        await recordSubscription({
          type: item.type,
          status,
          tenantId: tenantId.value || undefined,
        })
        uni.showToast({
          title: status === 'accepted' ? '已授权' : '已记录授权结果',
          icon: status === 'accepted' ? 'success' : 'none',
        })
        await load()
      } catch (err) {
        uni.showToast({ title: err.message || '授权结果保存失败', icon: 'none' })
      } finally {
        submittingType.value = ''
      }
    },
    fail: () => {
      submittingType.value = ''
      uni.showToast({ title: '微信授权未完成', icon: 'none' })
    },
  })
  // #endif
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

.intro-card {
  display: flex;
  align-items: flex-start;
  padding: dp(14);
  border: 1px solid #f0eae4;
  border-radius: dp(14);
  background: #fff;
}

.intro-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(36);
  height: dp(36);
  margin-right: dp(11);
  border-radius: dp(11);
  background: #fdebe4;
  flex-shrink: 0;
}

.intro-icon {
  width: dp(20);
  height: dp(20);
}

.intro-main {
  flex: 1;
  min-width: 0;
}

.intro-title {
  display: block;
  color: #241c17;
  font-size: dp(14);
  font-weight: 600;
}

.intro-text {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.6;
}

.list-card {
  margin-top: dp(12);
  padding: 0 dp(14);
  border: 1px solid #f0eae4;
  border-radius: dp(14);
  background: #fff;
}

.sub-row {
  display: flex;
  align-items: center;
  padding: dp(13) 0;
}

.sub-row--divided {
  border-top: 1px solid #f3efea;
}

.sub-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(32);
  height: dp(32);
  margin-right: dp(10);
  border-radius: dp(10);
  background: #fff3e8;
  flex-shrink: 0;
}

.sub-icon-text {
  color: #eb5c20;
  font-size: dp(13);
  font-weight: 700;
}

.sub-main {
  flex: 1;
  min-width: 0;
}

.sub-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.sub-title {
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.status-chip {
  padding: dp(1) dp(5);
  border-radius: dp(4);
  font-size: dp(9);
  white-space: nowrap;
}

.status-chip--accent {
  background: #fdebe4;
  color: #eb5c20;
}

.status-chip--green {
  background: #e8ffea;
  color: #087a1e;
}

.status-chip--orange {
  background: #fff4e0;
  color: #d97706;
}

.status-chip--gray,
.status-chip--muted {
  background: #f3efea;
  color: #8b8179;
}

.sub-text {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
  line-height: 1.5;
}

.sub-btn {
  min-width: dp(58);
  height: dp(28);
  margin-left: dp(8);
  padding: 0 dp(8);
  border: 1px solid #f7c7b1;
  border-radius: dp(999);
  background: #fff7f2;
  color: #eb5c20;
  font-size: dp(10);
  line-height: dp(28);
  flex-shrink: 0;
}

.sub-btn[disabled] {
  opacity: 0.5;
}

.footnote {
  margin-top: dp(12);
  padding: 0 dp(4);
  color: #a79c92;
  font-size: dp(10);
  line-height: 1.6;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(64) dp(24);
  text-align: center;
}

.state-title {
  color: #241c17;
  font-size: dp(15);
  font-weight: 600;
}

.state-text {
  margin-top: dp(7);
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.6;
}

.state-btn {
  min-width: dp(120);
  height: dp(34);
  margin-top: dp(14);
  border: none;
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  line-height: dp(34);
}
</style>
