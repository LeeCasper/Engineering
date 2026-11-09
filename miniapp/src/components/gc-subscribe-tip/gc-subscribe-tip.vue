<template>
  <view v-if="visible" class="sub-tip">
    <view class="sub-tip-main">
      <text class="sub-tip-title">{{ title }}</text>
      <text class="sub-tip-text">{{ description }}</text>
    </view>
    <button class="sub-tip-btn" :disabled="busy" @tap="request">
      {{ busy ? '处理中' : '开启通知' }}
    </button>
    <view class="sub-tip-close" @tap="dismiss">
      <text class="sub-tip-close-text">×</text>
    </view>
  </view>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { fetchSubscriptions, recordSubscription } from '../../api/notification'
import { getCurrentProject } from '../../store/projectContext'
import { getToken } from '../../store/session'

/**
 * 业务页面上的订阅消息授权提示。
 *
 * ── 为什么是「点击授权」而不是页面自动弹窗 ──
 * 微信要求 wx.requestSubscribeMessage **必须由用户点击手势触发**，
 * 在 onShow / onMounted 里直接调用会报
 * `requestSubscribeMessage:fail can only be invoked by user TAP gesture`。
 * 因此这里只在页面显示一条轻提示，用户点「开启通知」时才拉授权弹窗。
 *
 * ── 一次性订阅 ──
 * 每次授权只能接收一条消息，所以「已授权」不代表永久有效；
 * 用户下次进入业务页时仍会看到提示（同一会话内每类只提示一次）。
 */
defineOptions({ name: 'GcSubscribeTip' })

const props = defineProps({
  /** 需要的消息分类，取值见通知服务的 FILTERABLE_TYPES */
  types: { type: Array, default: () => [] },
  title: { type: String, default: '开启微信通知' },
  description: {
    type: String,
    default: '授权后可收到一条微信服务通知，站内消息不受影响',
  },
  /** 当前项目租户；不传时从项目上下文取 */
  tenantId: { type: Number, default: null },
})

/** 本次小程序会话内已提示/处理过的「租户:分类」，避免每个页面都弹一遍 */
const handled = new Set()

const visible = ref(false)
const busy = ref(false)
const eligible = ref([])
const resolvedTenantId = ref(null)

function resolveTenantId() {
  if (props.tenantId) return Number(props.tenantId)
  const project = getCurrentProject()
  return project && project.tenantId ? Number(project.tenantId) : undefined
}

function keyOf(type) {
  return `${resolvedTenantId.value ?? 'auto'}:${type}`
}

async function load() {
  // #ifndef MP-WEIXIN
  return
  // #endif

  if (!getToken()) return

  const tenantId = resolveTenantId()
  resolvedTenantId.value = tenantId ?? null

  const wanted = [...new Set(props.types || [])].filter(type => !handled.has(keyOf(type)))
  if (!wanted.length) return

  try {
    const data = await fetchSubscriptions(tenantId)
    const list = (data && data.list) || []

    eligible.value = list
      .filter(
        item =>
          wanted.includes(item.type) &&
          item.available &&
          item.canRequest &&
          item.templateId &&
          // 用户明确拒绝 / 勾选不再询问后，不在业务页面反复打扰；
          // 需要时可以到「订阅消息管理」页手动重新授权（AC-U12）
          item.status !== 'rejected' &&
          item.status !== 'ban'
      )
      .slice(0, 3)

    if (!eligible.value.length) return

    // 展示过就算处理过：用户忽略后，本次会话不在别的页面重复出现
    for (const item of eligible.value) handled.add(keyOf(item.type))
    visible.value = true
  } catch (err) {
    // 多租户且没有当前项目时后端返回 400（不猜租户）；
    // 这类用户进入具体项目后会在项目页看到提示
  }
}

function request() {
  if (busy.value || !eligible.value.length) return

  const tenantId = resolvedTenantId.value || undefined
  const list = eligible.value.slice()
  const tmplIds = list.map(item => item.templateId)
  const typeByTemplate = new Map(list.map(item => [item.templateId, item.type]))

  busy.value = true

  // 必须同步调用：微信只允许在用户点击手势中拉起订阅弹窗，前面不能 await
  uni.requestSubscribeMessage({
    tmplIds,
    success: async res => {
      try {
        for (const [templateId, type] of typeByTemplate) {
          const result = res[templateId]
          // 微信没返回该模板的结果时不要瞎猜成 rejected —— 那会把一次有效授权记成拒绝
          if (result !== 'accept' && result !== 'reject' && result !== 'ban') continue
          const status = result === 'accept' ? 'accepted' : result === 'ban' ? 'ban' : 'rejected'
          // 授权结果必须回传服务端：推送判定按「用户 + 租户 + 模板」查这张表
          await recordSubscription({ type, status, tenantId }).catch(() => {})
          handled.add(keyOf(type))
        }
        uni.showToast({ title: '通知授权已更新', icon: 'none' })
      } finally {
        busy.value = false
        visible.value = false
      }
    },
    fail: () => {
      busy.value = false
      visible.value = false
    },
  })
}

function dismiss() {
  for (const item of eligible.value) handled.add(keyOf(item.type))
  visible.value = false
}

onMounted(load)

// 切换项目后租户可能变化（记账页可切项目），重新判断一次
watch(
  () => [props.types.join(','), props.tenantId],
  () => {
    visible.value = false
    eligible.value = []
    load()
  }
)
</script>

<style scoped lang="scss">
.sub-tip {
  display: flex;
  align-items: center;
  gap: dp(10);
  // 左右不留边距：由所在页面的内容容器统一控制卡片宽度，
  // 避免提示卡比其他卡片窄一圈（各页卡片内缩都是 dp(14)）
  margin: dp(12) 0;
  padding: dp(12) dp(14);
  /* 与其他业务卡片保持同一套液态玻璃材质：暖白半透明 + 顶光 + 细边框 */
  @include glass-surface(dp(14), 20px);
}

.sub-tip-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: dp(3);
}

.sub-tip-title {
  font-size: dp(14);
  font-weight: 600;
  color: #2b2119;
}

.sub-tip-text {
  font-size: dp(12);
  line-height: 1.45;
  color: #8b8179;
}

.sub-tip-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 0 dp(14);
  height: dp(32);
  line-height: dp(32);
  font-size: dp(12);
  font-weight: 600;
  color: #fff;
  background: #eb5c20;
  border-radius: dp(16);
}

.sub-tip-btn::after {
  border: none;
}

.sub-tip-btn[disabled] {
  opacity: 0.6;
}

.sub-tip-close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: dp(22);
  height: dp(22);
}

.sub-tip-close-text {
  font-size: dp(18);
  line-height: 1;
  color: #b3a89f;
}
</style>
