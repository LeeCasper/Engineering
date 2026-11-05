<template>
  <view class="page" :class="{ 'page--with-actions': hasFooterActions }">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <text class="nav-title">阶段结算</text>
      <view class="nav-placeholder" />
    </view>

    <view v-if="loading && !settlement" class="state-block">
      <gc-loading text="正在加载阶段结算…" />
    </view>

    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
      <text class="state-title">加载失败</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="load">重新加载</button>
    </view>

    <template v-else-if="settlement">
      <view class="content gc-stagger">
        <!-- 阶段与状态 -->
        <view class="card status-card" :class="`status-card--${statusTone}`">
          <view class="status-top">
            <view class="status-text">
              <text class="status-eyebrow">阶段结算</text>
              <text class="stage-name">{{ settlement.stageName || '当前阶段' }}</text>
            </view>
            <text class="status-badge" :class="`status-badge--${statusTone}`">
              {{ settlement.statusLabel }}
            </text>
          </view>
          <text class="status-desc">{{ statusDescription }}</text>
        </view>

        <!-- 金额总览 -->
        <view class="card amount-card">
          <text class="card-title">金额总览</text>
          <view class="amount-grid">
            <view class="amount-item">
              <text class="amount-label">本阶段应收</text>
              <text class="amount-value amount-value--primary">¥ {{ formatMoney(settlement.receivableAmount) }}</text>
            </view>
            <view class="amount-item">
              <text class="amount-label">已收</text>
              <text class="amount-value">¥ {{ formatMoney(settlement.incomeAmount) }}</text>
            </view>
            <view class="amount-item">
              <text class="amount-label">支出</text>
              <text class="amount-value">¥ {{ formatMoney(settlement.expenseAmount) }}</text>
            </view>
            <view class="amount-item">
              <text class="amount-label">结余（已收 − 支出）</text>
              <text class="amount-value" :class="{ 'amount-value--negative': isNegative(settlement.balanceAmount) }">
                ¥ {{ formatMoney(settlement.balanceAmount) }}
              </text>
            </view>
          </view>
          <text class="amount-note">
            应收为关联本阶段的付款节点金额之和；已收与支出来自归属本阶段的流水。系统内不发生任何资金划转。
          </text>
        </view>

        <!-- 应收明细 -->
        <view class="card list-card">
          <view class="card-head">
            <text class="card-title">本阶段应收（付款节点）</text>
            <text class="card-count">{{ paymentNodes.length }} 项</text>
          </view>
          <view v-if="!paymentNodes.length" class="empty-text">本阶段没有关联的付款节点</view>
          <view v-for="node in paymentNodes" :key="node.id" class="row">
            <view class="row-main">
              <text class="row-title">{{ node.name }}</text>
              <text class="row-sub">{{ node.statusLabel }}</text>
            </view>
            <text class="row-amount">¥ {{ formatMoney(node.amount) }}</text>
          </view>
        </view>

        <!-- 流水明细 -->
        <view class="card list-card">
          <view class="card-head">
            <text class="card-title">本阶段流水</text>
            <text class="card-count">{{ details.length }} 条</text>
          </view>
          <view v-if="!details.length" class="empty-text">本阶段暂未登记收支流水</view>
          <view v-for="detail in details" :key="detail.id" class="detail-row">
            <view class="detail-top">
              <view class="detail-main">
                <text class="detail-title">
                  {{ detail.typeLabel }} · {{ categoryLabel(detail.category) }}
                  <text v-if="detail.isReversal" class="reversal-tag">红冲</text>
                </text>
                <text class="detail-sub">{{ formatDate(detail.occurredAt) }}<text v-if="detail.remark"> · {{ detail.remark }}</text></text>
              </view>
              <text class="detail-amount" :class="detail.type === 'income' ? 'detail-amount--income' : 'detail-amount--expense'">
                {{ detail.type === 'income' ? '+' : '−' }}¥ {{ formatMoney(detail.amount) }}
              </text>
            </view>

            <view v-if="detail.dispute" class="dispute-box">
              <text class="dispute-title">有异议</text>
              <text class="dispute-text">{{ detail.disputeRemark }}</text>
            </view>
            <view v-else-if="detail.disputeRemark" class="dispute-box dispute-box--resolved">
              <text class="dispute-title">此前的异议已处理</text>
              <text class="dispute-text">{{ detail.disputeRemark }}</text>
            </view>

            <view
              v-if="canDispute && !detail.dispute"
              class="dispute-action"
              @tap="openDispute(detail)"
            >
              对此条提异议
            </view>
          </view>
        </view>

        <!-- 说明 -->
        <view class="notice">
          <view class="notice-icon">i</view>
          <text class="notice-text">{{ noticeText }}</text>
        </view>

        <view v-if="settlement.settlementPdfSignedPath" class="pdf-entry" @tap="openPdf">
          <image class="pdf-icon" src="/static/images/icon-document-amber.png" mode="aspectFit" />
          <text>查看阶段结算单 PDF</text>
          <image class="pdf-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
        </view>
      </view>

      <view v-if="hasFooterActions" class="action-bar">
        <button
          v-if="canSubmit"
          class="action-primary"
          :disabled="submitting"
          @tap="submitSettlement"
        >
          {{ submitting ? '提交中…' : settlement.status === 'disputed' ? '重新提交给主业主' : '提交给主业主确认' }}
        </button>
        <button
          v-if="canConfirm"
          class="action-primary"
          :disabled="submitting"
          @tap="confirmSettlement"
        >
          {{ submitting ? '确认中…' : '确认无异议并结清' }}
        </button>
      </view>
    </template>

    <!-- 提异议 -->
    <view v-if="disputeOpen" class="sheet-mask" @tap="closeDispute" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove">
      <view class="sheet" :style="sheetSwipe.style" @tap.stop>
        <view
          class="sheet-handle"
          @touchstart="sheetSwipe.onTouchStart"
          @touchmove.stop.prevent="sheetSwipe.onTouchMove"
          @touchend="sheetSwipe.onTouchEnd"
        />
        <view
          class="sheet-head"
          @touchstart="sheetSwipe.onTouchStart"
          @touchmove.stop.prevent="sheetSwipe.onTouchMove"
          @touchend="sheetSwipe.onTouchEnd"
        >
          <text class="sheet-title">对这条明细提异议</text>
          <view class="sheet-close" @tap="closeDispute">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>
        <text class="sheet-detail">
          {{ disputeTarget ? `${disputeTarget.typeLabel} · ${categoryLabel(disputeTarget.category)} · ¥ ${formatMoney(disputeTarget.amount)}` : '' }}
        </text>
        <textarea
          v-model="disputeRemark"
          class="dispute-input"
          maxlength="500"
          placeholder="请说明哪里有异议（必填）"
          placeholder-class="input-placeholder"
        />
        <view class="sheet-actions">
          <button class="sheet-cancel" @tap="closeDispute">取消</button>
          <button class="sheet-submit" :disabled="disputeSubmitting" @tap="submitDispute">
            {{ disputeSubmitting ? '提交中…' : '提交异议' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import {
  confirmReconciliation,
  disputeReconciliation,
  fetchReconciliationDetail,
  fetchStageSettlement,
  submitStageSettlement,
} from '../../api/ledger'
import { resolveMediaUrl } from '../../api/request'
import { useSwipeClose } from '../../composables/useSwipeClose'
import { getToken } from '../../store/session'

defineOptions({ name: 'StageSettlementPage' })

const safeTop = ref(12)
const settlement = ref(null)
const loading = ref(false)
const loadError = ref('')
const submitting = ref(false)

const settlementId = ref(0)
const projectId = ref(0)
const stageId = ref(0)

const disputeOpen = ref(false)
const disputeTarget = ref(null)
const disputeRemark = ref('')
const disputeSubmitting = ref(false)

const sheetSwipe = useSwipeClose(closeDispute)

let loadedOnce = false

const paymentNodes = computed(() => (settlement.value && settlement.value.paymentNodes) || [])
const details = computed(() => (settlement.value && settlement.value.details) || [])
const myActions = computed(() => (settlement.value && settlement.value.myActions) || [])
const canSubmit = computed(() => myActions.value.includes('submit'))
const canConfirm = computed(() => myActions.value.includes('confirm'))
const canDispute = computed(
  () => settlement.value && settlement.value.status === 'pending' && settlement.value.isPrimaryOwner
)
const hasFooterActions = computed(() => canSubmit.value || canConfirm.value)

const statusTone = computed(() => {
  if (!settlement.value) return 'pending'
  return (
    {
      draft: 'draft',
      pending: 'pending',
      disputed: 'danger',
      confirmed: 'success',
    }[settlement.value.status] || 'pending'
  )
})

const statusDescription = computed(() => {
  if (!settlement.value) return ''
  if (settlement.value.status === 'draft') {
    return '验收已通过，系统已生成本阶段结算单。请主工长核对金额后提交主业主。'
  }
  if (settlement.value.status === 'pending') {
    return '等待主业主核对。确认无异议后，本阶段结清，下一阶段自动解锁。'
  }
  if (settlement.value.status === 'disputed') {
    return '主业主提出了异议。请主工长核对并在调整后重新提交。'
  }
  return '本阶段已结清。下一阶段已解锁，相关流水已锁定。'
})

const noticeText = computed(() => {
  if (!settlement.value) return ''
  if (settlement.value.status === 'confirmed') {
    return '阶段结算已归档。任何更正都需要通过红冲或后续对账处理，不能直接修改已锁定流水。'
  }
  if (settlement.value.status === 'disputed') {
    return '异议未处理前，本阶段不会结清，下一阶段保持锁定。重新提交后，此前的异议说明会保留在记录中。'
  }
  return '只有主业主能确认或提异议；主工长提交后，金额与流水在确认前应保持不变。'
})

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }

  settlementId.value = Number((options && options.id) || 0)
  projectId.value = Number((options && options.projectId) || 0)
  stageId.value = Number((options && options.stageId) || 0)

  if (!settlementId.value && (!projectId.value || !stageId.value)) {
    loadError.value = '缺少阶段结算单参数'
    return
  }

  load()
})

onShow(() => {
  if (!loadedOnce || loading.value || !getToken()) return
  load(true)
})

onPullDownRefresh(async () => {
  await load(true)
  uni.stopPullDownRefresh()
})

async function load(silent = false) {
  if (loading.value) return
  if (!settlementId.value && (!projectId.value || !stageId.value)) return

  loading.value = true
  if (!silent) loadError.value = ''

  try {
    let data
    if (settlementId.value) {
      data = await fetchReconciliationDetail(settlementId.value)
      if (data && data.scopeType !== 'stage') {
        throw new Error('该单据不是阶段结算单')
      }
    } else {
      data = await fetchStageSettlement(projectId.value, stageId.value)
    }

    settlement.value = data
    if (data) {
      settlementId.value = data.id || 0
      projectId.value = data.projectId || projectId.value
      stageId.value = data.stageId || stageId.value
    }
    loadedOnce = true
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }
    if (settlement.value) {
      uni.showToast({ title: err.message || '加载失败', icon: 'none' })
    } else {
      loadError.value = err.message || '加载失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

function goBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/projects/index' }),
  })
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '0.00'
  const text = String(value)
  const negative = text.startsWith('-')
  const [intPart, decimalPart = ''] = text.replace('-', '').split('.')
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const decimals = decimalPart.padEnd(2, '0').slice(0, 2)
  return `${negative ? '-' : ''}${formatted}.${decimals}`
}

function isNegative(value) {
  return Number(value) < 0
}

function categoryLabel(category) {
  return (
    {
      material: '材料费',
      labor: '人工费',
      transport: '运输费',
      other: '其他',
    }[category] || '未分类'
  )
}

function formatDate(value) {
  if (!value) return '—'
  return String(value).slice(0, 10)
}

function submitSettlement() {
  if (submitting.value) return
  uni.showModal({
    title: settlement.value.status === 'disputed' ? '重新提交阶段结算' : '提交阶段结算',
    content:
      settlement.value.status === 'disputed'
        ? '确认已完成调整并重新提交给主业主？此前的异议说明会保留。'
        : '提交后主业主将核对结算金额，确认前请不要修改本阶段流水。',
    success: async (res) => {
      if (!res.confirm) return
      submitting.value = true
      try {
        await submitStageSettlement(projectId.value, stageId.value)
        uni.showToast({ title: '已提交主业主确认', icon: 'success' })
        await load(true)
      } catch (err) {
        uni.showToast({ title: err.message || '提交失败', icon: 'none' })
      } finally {
        submitting.value = false
      }
    },
  })
}

function confirmSettlement() {
  if (submitting.value || !settlement.value || !settlement.value.id) return
  uni.showModal({
    title: '确认阶段结算',
    content: '确认无异议后，本阶段将结清并解锁下一阶段，相关流水会被锁定。是否继续？',
    success: async (res) => {
      if (!res.confirm) return
      submitting.value = true
      try {
        const data = await confirmReconciliation(settlement.value.id)
        const next = data && data.stageSettlement && data.stageSettlement.nextStageName
        uni.showToast({
          title: next ? `${next}已解锁` : '阶段已结清',
          icon: 'success',
        })
        await load(true)
      } catch (err) {
        uni.showToast({ title: err.message || '确认失败', icon: 'none' })
      } finally {
        submitting.value = false
      }
    },
  })
}

function openDispute(detail) {
  disputeTarget.value = detail
  disputeRemark.value = ''
  disputeOpen.value = true
}

function closeDispute() {
  if (disputeSubmitting.value) return
  disputeOpen.value = false
}

async function submitDispute() {
  if (disputeSubmitting.value) return
  if (!settlement.value || !disputeTarget.value) return
  const remark = String(disputeRemark.value || '').trim()
  if (!remark) {
    uni.showToast({ title: '异议说明必填', icon: 'none' })
    return
  }

  disputeSubmitting.value = true
  try {
    await disputeReconciliation(settlement.value.id, {
      detailId: disputeTarget.value.id,
      remark,
    })
    uni.showToast({ title: '已提交异议', icon: 'success' })
    disputeOpen.value = false
    await load(true)
  } catch (err) {
    uni.showToast({ title: err.message || '提交失败', icon: 'none' })
  } finally {
    disputeSubmitting.value = false
  }
}

function openPdf() {
  const path = settlement.value && settlement.value.settlementPdfSignedPath
  if (!path) {
    uni.showToast({ title: '结算单尚未生成', icon: 'none' })
    return
  }

  const url = resolveMediaUrl(path)

  // #ifdef H5
  window.open(url, '_blank')
  // #endif
  // #ifndef H5
  uni.showLoading({ title: '下载中…' })
  uni.downloadFile({
    url,
    success: (res) => {
      uni.hideLoading()
      uni.openDocument({ filePath: res.tempFilePath, fileType: 'pdf', showMenu: true })
    },
    fail: () => {
      uni.hideLoading()
      uni.showToast({ title: '结算单下载失败', icon: 'none' })
    },
  })
  // #endif
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding-bottom: calc(#{dp(28)} + env(safe-area-inset-bottom));
  background: #faf7f4;
}

.page--with-actions {
  padding-bottom: calc(#{dp(94)} + env(safe-area-inset-bottom));
}

.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: dp(14);
  padding-bottom: dp(8);
  padding-left: dp(8);
}

.nav-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(36);
  height: dp(36);
}

.nav-back-icon {
  width: dp(20);
  height: dp(20);
}

.nav-title {
  font-size: dp(17);
  font-weight: 600;
  color: $color-ink;
}

.nav-placeholder {
  width: dp(36);
}

.content {
  padding: dp(8) dp(16) 0;
}

.card {
  @include glass-surface(dp(18), 20px);
  padding: dp(16);
  margin-bottom: dp(12);
}

.status-card--draft,
.status-card--pending {
  background-color: rgba(255, 247, 242, 0.86);
}

.status-card--danger {
  background-color: rgba(255, 236, 232, 0.88);
}

.status-card--success {
  background-color: rgba(232, 255, 234, 0.82);
}

.status-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.status-text {
  display: flex;
  flex-direction: column;
}

.status-eyebrow {
  font-size: dp(11);
  color: $color-ink-tertiary;
  letter-spacing: 1px;
}

.stage-name {
  margin-top: dp(4);
  font-size: dp(20);
  font-weight: 700;
  color: $color-ink;
}

.status-badge {
  padding: dp(4) dp(10);
  border-radius: dp(999);
  font-size: dp(11);
  font-weight: 600;
  white-space: nowrap;
}

.status-badge--draft,
.status-badge--pending {
  color: $color-primary-pressed;
  background: $color-primary-soft;
}

.status-badge--danger {
  color: $color-danger-ink;
  background: $color-danger-soft;
}

.status-badge--success {
  color: $color-success-ink;
  background: $color-success-soft;
}

.status-desc {
  display: block;
  margin-top: dp(10);
  font-size: dp(12);
  line-height: 1.6;
  color: $color-ink-secondary;
}

.card-title {
  font-size: dp(14);
  font-weight: 600;
  color: $color-ink;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(8);
}

.card-count {
  font-size: dp(11);
  color: $color-ink-tertiary;
}

.amount-grid {
  display: flex;
  flex-wrap: wrap;
  margin-top: dp(12);
}

.amount-item {
  display: flex;
  flex-direction: column;
  width: 50%;
  margin-bottom: dp(14);
}

.amount-label {
  font-size: dp(11);
  color: $color-ink-tertiary;
}

.amount-value {
  margin-top: dp(4);
  font-size: dp(17);
  font-weight: 600;
  color: $color-ink;
}

.amount-value--primary {
  color: $color-primary;
}

.amount-value--negative {
  color: $color-danger;
}

.amount-note {
  display: block;
  font-size: dp(11);
  line-height: 1.6;
  color: $color-ink-tertiary;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(11) 0;
  border-bottom: 1px solid $color-hairline;
}

.row:last-child {
  border-bottom: none;
}

.row-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.row-title {
  font-size: dp(13);
  color: $color-ink;
}

.row-sub {
  margin-top: dp(3);
  font-size: dp(11);
  color: $color-ink-tertiary;
}

.row-amount {
  margin-left: dp(10);
  font-size: dp(13);
  font-weight: 600;
  color: $color-ink;
}

.detail-row {
  padding: dp(12) 0;
  border-bottom: 1px solid $color-hairline;
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.detail-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.detail-title {
  font-size: dp(13);
  color: $color-ink;
}

.reversal-tag {
  margin-left: dp(6);
  font-size: dp(10);
  color: $color-warning-ink;
}

.detail-sub {
  margin-top: dp(4);
  font-size: dp(11);
  line-height: 1.5;
  color: $color-ink-tertiary;
}

.detail-amount {
  margin-left: dp(10);
  font-size: dp(14);
  font-weight: 600;
  white-space: nowrap;
}

.detail-amount--income {
  color: $color-success-ink;
}

.detail-amount--expense {
  color: $color-danger-ink;
}

.dispute-box {
  margin-top: dp(8);
  padding: dp(9) dp(10);
  border-radius: dp(10);
  background: $color-danger-soft;
}

.dispute-box--resolved {
  background: $color-neutral-soft;
}

.dispute-title {
  font-size: dp(11);
  font-weight: 600;
  color: $color-danger-ink;
}

.dispute-box--resolved .dispute-title {
  color: $color-neutral-ink;
}

.dispute-text {
  display: block;
  margin-top: dp(4);
  font-size: dp(11);
  line-height: 1.5;
  color: $color-ink-secondary;
}

.dispute-action {
  align-self: flex-start;
  margin-top: dp(8);
  padding: dp(5) dp(10);
  border: 1px solid $color-danger;
  border-radius: dp(999);
  font-size: dp(11);
  color: $color-danger;
}

.empty-text {
  padding: dp(14) 0;
  font-size: dp(12);
  color: $color-ink-tertiary;
  text-align: center;
}

.notice {
  display: flex;
  align-items: flex-start;
  padding: dp(12) dp(14);
  margin-bottom: dp(12);
  border-radius: dp(14);
  background: $color-warning-soft;
}

.notice-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(16);
  height: dp(16);
  margin-right: dp(8);
  border-radius: 50%;
  font-size: dp(10);
  font-weight: 700;
  color: #fff;
  background: $color-warning;
  flex-shrink: 0;
}

.notice-text {
  font-size: dp(11);
  line-height: 1.6;
  color: $color-warning-ink;
}

.pdf-entry {
  display: flex;
  align-items: center;
  padding: dp(14) dp(16);
  border-radius: dp(16);
  background: #fff;
  font-size: dp(13);
  color: $color-ink;
}

.pdf-icon {
  width: dp(18);
  height: dp(18);
  margin-right: dp(8);
}

.pdf-chevron {
  width: dp(14);
  height: dp(14);
  margin-left: auto;
}

.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 30vh dp(24) 0;
}

.state-icon {
  width: dp(72);
  height: dp(72);
  margin-bottom: dp(16);
}

.state-title {
  font-size: dp(16);
  font-weight: 600;
  color: $color-ink;
}

.state-text {
  margin-top: dp(8);
  font-size: dp(12);
  line-height: 1.6;
  color: $color-ink-tertiary;
  text-align: center;
}

.state-btn {
  margin-top: dp(18);
  padding: 0 dp(20);
  height: dp(38);
  line-height: dp(38);
  border: none;
  border-radius: dp(999);
  font-size: dp(13);
  color: #fff;
  background: $color-primary;
}

.action-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1001;
  display: flex;
  padding: dp(10) dp(16) calc(#{dp(10)} + env(safe-area-inset-bottom));
  background: rgba(255, 252, 248, 0.96);
  border-top: 1px solid $color-hairline;
}

.action-primary {
  flex: 1;
  height: dp(46);
  line-height: dp(46);
  border: none;
  border-radius: dp(999);
  font-size: dp(15);
  font-weight: 600;
  color: #fff;
  background: $color-primary;
}

.action-primary[disabled] {
  opacity: 0.6;
}

.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: flex-end;
  background: rgba(24, 18, 14, 0.42);
}

.sheet {
  width: 100%;
  padding: dp(18) dp(18) calc(#{dp(18)} + env(safe-area-inset-bottom));
  border-radius: dp(22) dp(22) 0 0;
  background: #fff;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sheet-title {
  font-size: dp(16);
  font-weight: 600;
  color: $color-ink;
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(30);
  height: dp(30);
}

.sheet-close-icon {
  width: dp(16);
  height: dp(16);
}

.sheet-detail {
  display: block;
  margin-top: dp(10);
  font-size: dp(12);
  color: $color-ink-tertiary;
}

.dispute-input {
  width: 100%;
  height: dp(110);
  margin-top: dp(12);
  padding: dp(10);
  box-sizing: border-box;
  border: 1px solid $color-hairline;
  border-radius: dp(12);
  font-size: dp(13);
  line-height: 1.6;
  color: $color-ink;
  background: $color-surface-sunken;
}

.input-placeholder {
  color: $color-ink-tertiary;
}

.sheet-actions {
  display: flex;
  margin-top: dp(16);
}

.sheet-cancel,
.sheet-submit {
  flex: 1;
  height: dp(42);
  line-height: dp(42);
  border: none;
  border-radius: dp(999);
  font-size: dp(14);
  font-weight: 600;
}

.sheet-cancel {
  margin-right: dp(10);
  color: $color-ink-secondary;
  background: $color-neutral-soft;
}

.sheet-submit {
  color: #fff;
  background: $color-danger;
}

.sheet-submit[disabled] {
  opacity: 0.6;
}
</style>
