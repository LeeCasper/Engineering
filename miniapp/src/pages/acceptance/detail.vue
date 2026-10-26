<template>
  <view class="page" :class="{ 'page--with-actions': hasActions }">
    <!-- 自定义导航 -->
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-left">
        <view class="nav-back" @tap="goBack">
          <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
        </view>
        <text class="nav-title">{{ displayTitle }}</text>
        <text v-if="detail" class="round-badge">第 {{ detail.round }} 轮</text>
      </view>
      <view class="nav-more" @tap="openMore">
        <image class="nav-more-icon" src="/static/images/icon-more.png" mode="aspectFit" />
      </view>
    </view>

    <view v-if="loading && !detail" class="state-block">
      <gc-loading text="正在加载验收详情…" />
    </view>

    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
      <text class="state-title">加载失败</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="load">重新加载</button>
    </view>

    <template v-else-if="detail">
      <view class="content">
        <!-- 项目概览 -->
        <view class="overview-card">
          <view class="overview-top">
            <view class="overview-left">
              <image class="project-logo" src="/static/images/logo.png" mode="aspectFit" />
              <view class="overview-text">
                <text class="project-name">{{ detail.projectName }}</text>
                <view class="address-row">
                  <image class="address-icon" src="/static/images/icon-location.png" mode="aspectFit" />
                  <text class="address-text">{{ detail.projectAddress || '未填写地址' }}</text>
                </view>
              </view>
            </view>
            <text class="overview-status" :class="overviewStatusClass">{{ overviewStatusLabel }}</text>
          </view>

          <view class="overview-progress">
            <text class="progress-label">进度 {{ percent(detail.stageProgress) }}%</text>
            <view class="progress-track">
              <view class="progress-fill" :style="{ width: `${percent(detail.stageProgress)}%` }" />
            </view>
            <view class="waiting">
              <image class="waiting-icon" src="/static/images/icon-clock.png" mode="aspectFit" />
              <text>{{ waitingText }}</text>
            </view>
          </view>
        </view>

        <!-- 五步流程 -->
        <view class="stepper">
          <view v-for="(step, index) in steps" :key="step.key" class="step">
            <view class="step-dot" :class="`step-dot--${step.state}`">
              <image
                v-if="step.state === 'done'"
                class="step-check"
                src="/static/images/icon-check-white.png"
                mode="aspectFit"
              />
              <text v-else-if="step.state === 'skipped'" class="step-skip">跳</text>
              <text v-else-if="step.state === 'rejected'" class="step-reject">!</text>
              <text v-else class="step-number">{{ index + 1 }}</text>
            </view>
            <text class="step-label" :class="`step-label--${step.state}`">{{ step.label }}</text>
            <text class="step-state" :class="`step-state--${step.state}`">{{ step.stateLabel }}</text>
            <view
              v-if="index < steps.length - 1"
              class="step-line"
              :class="`step-line--${step.lineState}`"
            />
          </view>
        </view>

        <!-- 状态 / 门禁说明 -->
        <view class="notice">
          <view class="notice-icon">i</view>
          <text class="notice-text">{{ noticeText }}</text>
        </view>

        <!-- 四个 tab -->
        <view class="tabs">
          <view
            v-for="tab in TABS"
            :key="tab.key"
            class="tab"
            :class="{ 'tab--active': activeTab === tab.key }"
            @tap="activeTab = tab.key"
          >
            <text>{{ tab.label }}</text>
            <view v-if="activeTab === tab.key" class="tab-underline" />
          </view>
        </view>

        <!-- 验收项 -->
        <view v-if="activeTab === 'items'" class="panel">
          <view class="panel-head">
            <view class="panel-title-wrap">
              <text class="panel-title">验收项</text>
              <text class="panel-count">（共 {{ detail.items.length }} 项）</text>
            </view>
            <view
              v-if="detail.items.length > 6"
              class="panel-more"
              @tap="showAllItems = !showAllItems"
            >
              <text>{{ showAllItems ? '收起' : '查看全部' }}</text>
              <image
                class="panel-more-arrow"
                :src="showAllItems ? '/static/images/icon-caret-down-gray.png' : '/static/images/icon-chevron-right.png'"
                mode="aspectFit"
              />
            </view>
          </view>

          <view v-if="!detail.items.length" class="panel-empty">
            暂无验收项
          </view>

          <view v-for="(item, index) in visibleItems" :key="item.id" class="item-row">
            <view class="item-top">
              <text class="item-seq">{{ index + 1 }}.</text>
              <text class="item-name">{{ item.name }}</text>
              <text class="item-result" :class="resultClass(item)">
                {{ resultLabel(item) }}
              </text>
            </view>

            <view v-if="canEditItems" class="item-edit-row">
              <view
                class="result-btn"
                :class="{ 'result-btn--active': resultOf(item) === 'pass' }"
                @tap="setItemResult(item.id, 'pass')"
              >
                合格
              </view>
              <view
                class="result-btn result-btn--fail"
                :class="{ 'result-btn--active': resultOf(item) === 'fail' }"
                @tap="setItemResult(item.id, 'fail')"
              >
                不合格
              </view>
            </view>

            <text v-if="item.remark" class="item-remark">{{ item.remark }}</text>
          </view>
        </view>

        <!-- 现场照片 -->
        <view v-if="activeTab === 'photos'" class="panel">
          <view class="panel-head">
            <text class="panel-title">现场照片</text>
            <text class="panel-count">（{{ photoUrls.length }} 张）</text>
          </view>

          <view v-if="!photoUrls.length" class="panel-empty">暂无现场照片</view>
          <view v-else class="photo-grid">
            <image
              v-for="(url, index) in photoUrls"
              :key="url"
              class="photo-item"
              :src="url"
              mode="aspectFill"
              @tap="previewPhoto(index)"
            />
          </view>
        </view>

        <!-- 流转记录 -->
        <view v-if="activeTab === 'flow'" class="panel">
          <view class="panel-head">
            <text class="panel-title">流转记录</text>
            <text class="panel-count">只读</text>
          </view>

          <view v-if="!flowRounds.length" class="panel-empty">暂无流转记录</view>
          <view v-for="round in flowRounds" :key="round.round" class="flow-round">
            <text class="flow-round-title">第 {{ round.round }} 轮</text>
            <view v-for="entry in round.entries" :key="entry.id" class="flow-entry">
              <view class="flow-dot" :class="flowDotClass(entry)" />
              <view class="flow-body">
                <view class="flow-line">
                  <text class="flow-step">{{ entry.stepLabel }}</text>
                  <text class="flow-action" :class="flowActionClass(entry)">{{ entry.actionLabel }}</text>
                  <text class="flow-operator">{{ entry.operator }}</text>
                  <text class="flow-time">{{ formatTime(entry.operatedAt) }}</text>
                </view>
                <text v-if="entry.reason" class="flow-reason">{{ entry.reason }}</text>
                <view v-if="entry.images && entry.images.length" class="flow-images">
                  <image
                    v-for="(image, imageIndex) in entry.images"
                    :key="imageIndex"
                    class="flow-image"
                    :src="resolveMediaUrl(image.url)"
                    mode="aspectFill"
                    @tap="previewFlowImage(entry.images, imageIndex)"
                  />
                </view>
              </view>
            </view>
          </view>
        </view>

        <!-- 验收报告 -->
        <view v-if="activeTab === 'report'" class="panel">
          <view class="panel-head">
            <text class="panel-title">验收报告</text>
          </view>

          <view v-if="reportStatus === 'success'" class="report-state">
            <text class="report-title">{{ isEsignSigned ? '验收确认书已签署' : '验收报告已生成' }}</text>
            <text class="report-text">
              {{
                isEsignSigned
                  ? '已由电子签服务商完成实名核验、数字签名与可信时间戳，可下载已签 PDF 与证据报告。'
                  : '包含验收项、现场照片、审核意见与主业主签名。'
              }}
            </text>
            <button class="report-btn" @tap="openReport">
              {{ isEsignSigned ? '打开已签确认书' : '打开验收报告' }}
            </button>
            <button
              v-if="isEsignSigned && detail.esign && detail.esign.evidencePath"
              class="report-btn report-btn--outline"
              @tap="openEvidence"
            >
              查看证据报告
            </button>
          </view>
          <view v-else-if="reportStatus === 'failed'" class="report-state">
            <text class="report-title report-title--danger">报告生成失败</text>
            <text class="report-text">{{ detail.reportPdf.error || '可以重试生成，不会影响验收结果。' }}</text>
            <button class="report-btn report-btn--outline" :disabled="retryingReport" @tap="retryReport">
              {{ retryingReport ? '生成中…' : '重新生成' }}
            </button>
          </view>
          <view v-else-if="reportStatus === 'pending'" class="report-state">
            <text class="report-title">报告生成中…</text>
            <text class="report-text">验收已通过，报告稍后生成，不影响验收结果。</text>
          </view>
          <view v-else class="report-state">
            <text class="report-title">验收通过后生成报告</text>
            <text class="report-text">
              {{
                detail.esign && detail.esign.required
                  ? '主业主完成可靠电子签名后，系统会归档已签确认书与证据报告。'
                  : '主业主确认并签名后，系统会自动生成 PDF 验收报告。'
              }}
            </text>
          </view>
        </view>
      </view>

      <!-- 底部操作栏 -->
      <view v-if="hasActions" class="action-bar">
        <button v-if="canSaveDraft" class="action-secondary" :disabled="submitting" @tap="saveDraft">
          保存草稿
        </button>
        <button v-if="canReject" class="action-secondary" :disabled="submitting" @tap="openReject">
          驳回
        </button>
        <button v-if="canEsign" class="action-primary" :disabled="esignBusy" @tap="openConsent">
          {{ esignBusy ? '发起中…' : '去签署' }}
        </button>
        <button v-if="esignActive" class="action-secondary" :disabled="esignBusy" @tap="refreshEsign">
          刷新签署状态
        </button>
        <button
          v-if="canCancelEsign"
          class="action-secondary"
          :disabled="esignBusy"
          @tap="cancelEsignConfirm"
        >
          取消签署
        </button>
        <button v-if="canApprove" class="action-primary" :disabled="submitting" @tap="onApprove">
          {{ approveLabel }}
        </button>
        <button v-if="canSubmit || canResubmit" class="action-primary" :disabled="submitting" @tap="submitCheck">
          {{ canResubmit ? '重新提交' : '提交自检' }}
        </button>
      </view>
    </template>

    <!-- 电子签名知情同意 -->
    <view v-if="consentOpen" class="consent-mask" @tap="closeConsent">
      <view class="consent-card" @tap.stop>
        <text class="consent-title">电子签名知情同意</text>
        <text class="consent-text">
          本次验收将使用第三方电子签服务商完成实名认证、人脸核验与数字签名。签署完成后，验收确认书将带有服务商数字证书与可信时间戳。
        </text>
        <text class="consent-link" @tap="openConsentDoc">查看《电子签名知情同意书》</text>
        <view class="consent-check" @tap="consentAccepted = !consentAccepted">
          <view class="consent-box" :class="{ 'consent-box--on': consentAccepted }">
            <text v-if="consentAccepted" class="consent-tick">✓</text>
          </view>
          <text class="consent-check-text">
            我已阅读并同意《电子签名知情同意书》《隐私政策》，同意使用电子签名完成本次验收
          </text>
        </view>
        <view class="consent-actions">
          <button class="consent-cancel" @tap="closeConsent">取消</button>
          <button class="consent-submit" :disabled="!consentAccepted || esignBusy" @tap="startEsign">
            {{ esignBusy ? '发起中…' : '同意并去签署' }}
          </button>
        </view>
      </view>
    </view>

    <!-- 主业主签名 -->
    <view v-if="signatureOpen" class="signature-mask">
      <view class="signature-sheet">
        <view class="signature-head">
          <text class="signature-title">主业主签名</text>
          <view class="signature-close" @tap="closeSignature">
            <image class="signature-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>
        <text class="signature-desc">请在下方手写签名，签名将作为验收凭证与验收单一起归档。</text>
        <view class="signature-pad" :style="{ height: `${canvasHeight}px` }">
          <canvas
            id="signatureCanvas"
            canvas-id="signatureCanvas"
            class="signature-canvas"
            :style="{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }"
            disable-scroll="true"
            @touchstart.stop.prevent="onSignStart"
            @touchmove.stop.prevent="onSignMove"
            @touchend.stop.prevent="onSignEnd"
          />
          <text v-if="!signatureTouched" class="signature-placeholder">请在此签名</text>
        </view>
        <view class="signature-actions">
          <button class="signature-clear" @tap="clearSignature">清空</button>
          <button class="signature-cancel" @tap="closeSignature">取消</button>
          <button class="signature-confirm" :disabled="signing" @tap="confirmSignature">
            {{ signing ? '提交中…' : '确认并提交' }}
          </button>
        </view>
      </view>
    </view>

    <!-- 驳回 -->
    <view v-if="rejectOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeReject">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-handle" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd" />
        <view class="sheet-header" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <text class="sheet-title">驳回验收</text>
          <view class="sheet-close" @tap="closeReject">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <textarea
          v-model="rejectReason"
          class="reject-textarea"
          maxlength="500"
          placeholder="请填写驳回原因（必填）"
          placeholder-class="reject-placeholder"
        />

        <view class="reject-photo-row">
          <view v-if="rejectPhoto" class="reject-photo-wrap">
            <image class="reject-photo" :src="rejectPhoto" mode="aspectFill" />
            <view class="reject-photo-remove" @tap="rejectPhoto = ''">×</view>
          </view>
          <view v-else class="reject-photo-add" @tap="chooseRejectPhoto">
            <text class="reject-photo-plus">＋</text>
            <text class="reject-photo-label">凭证照片</text>
          </view>
        </view>

        <view class="sheet-actions">
          <button class="sheet-reset" @tap="closeReject">取消</button>
          <button class="sheet-apply sheet-apply--danger" :disabled="rejecting" @tap="submitReject">
            {{ rejecting ? '提交中…' : '确认驳回' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, getCurrentInstance, nextTick, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  approveAcceptance,
  approveAcceptanceWithSignature,
  cancelEsignTask,
  createEsignTask,
  fetchAcceptanceDetail,
  rejectAcceptance,
  resubmitAcceptance,
  retryAcceptanceReport,
  saveAcceptanceDraft,
  submitSelfCheck,
  syncEsignTask,
} from '../../api/acceptance'
import { resolveMediaUrl } from '../../api/request'
import { getToken } from '../../store/session'
import { getCurrentProject, setCurrentProject } from '../../store/projectContext'
import { useSwipeClose } from '../../composables/useSwipeClose'

// 底部弹窗下滑关闭：绑定把手 / 标题区，不干扰表单滚动
const sheetSwipe = useSwipeClose(() => closeActiveSheet())
const sheetSwipeStyle = sheetSwipe.style

const TABS = [
  { key: 'items', label: '验收项' },
  { key: 'photos', label: '现场照片' },
  { key: 'flow', label: '流转记录' },
  { key: 'report', label: '验收报告' },
]

const instance = getCurrentInstance()

const id = ref(0)
const detail = ref(null)
const loading = ref(false)
const loadError = ref('')
const safeTop = ref(12)
const activeTab = ref('items')
const showAllItems = ref(false)
const submitting = ref(false)
const retryingReport = ref(false)

const draftResults = ref({})

const signatureOpen = ref(false)
const signatureTouched = ref(false)
const signing = ref(false)
const canvasWidth = ref(310)
const canvasHeight = ref(180)
let canvasCtx = null
let canvasRect = null
let drawing = false
let signatureMoved = false

const rejectOpen = ref(false)
const rejectReason = ref('')
const rejectPhoto = ref('')
const rejecting = ref(false)

const consentOpen = ref(false)
const consentAccepted = ref(false)
const esignBusy = ref(false)

const myActions = computed(() => (detail.value && detail.value.myActions) || [])
const canApprove = computed(() => myActions.value.includes('approve'))
const canReject = computed(() => myActions.value.includes('reject'))
const canSubmit = computed(() => myActions.value.includes('submit'))
const canResubmit = computed(() => myActions.value.includes('resubmit'))
const canEditItems = computed(() => canSubmit.value || canResubmit.value)
const canSaveDraft = computed(
  () => canEditItems.value && myActions.value.includes('saveDraft')
)
const esign = computed(() => (detail.value && detail.value.esign) || null)
const canEsign = computed(() => myActions.value.includes('esign'))
const esignActive = computed(
  () => Boolean(esign.value && ['creating', 'pending', 'archiving'].includes(esign.value.status))
)
const canCancelEsign = computed(
  () => Boolean(esign.value && ['creating', 'pending'].includes(esign.value.status))
)
const esignStatusText = computed(() => {
  if (!esign.value) return ''
  return (
    {
      creating: '正在发起签署…',
      pending: '等待完成电子签名',
      archiving: '签署成功，正在验证归档…',
      signed: '电子签名已完成',
      failed: '电子签名失败，可重新发起',
      expired: '签署已过期，可重新发起',
      cancelled: '已取消签署',
      legacy: '存量手写签名',
      none: '',
    }[esign.value.status] || ''
  )
})
const isEsignSigned = computed(() => Boolean(esign.value && esign.value.status === 'signed'))
const isArchived = computed(
  () => Boolean(detail.value && detail.value.projectStatus === 'archived')
)
const hasActions = computed(
  () =>
    !isArchived.value &&
    (canApprove.value ||
      canReject.value ||
      canSubmit.value ||
      canResubmit.value ||
      canSaveDraft.value ||
      canEsign.value ||
      esignActive.value)
)

const approveLabel = computed(() => {
  if (!detail.value) return '通过'
  return detail.value.currentStep === 'owner' ? '通过并签名' : '通过'
})

const displayTitle = computed(() => {
  if (!detail.value) return '验收详情'
  const subject = detail.value.itemName || detail.value.stageName || '验收'
  // 阶段本身可能就叫「竣工验收」，不要再拼出「竣工验收验收」
  return subject.endsWith('验收') ? subject : `${subject}验收`
})

const overviewStatusLabel = computed(() => {
  if (!detail.value) return ''
  if (detail.value.status === 'pending_owner' && esignStatusText.value) return esignStatusText.value
  const labels = {
    draft: '草稿',
    pending_supervisor: '待监理审核',
    pending_owner: '待主业主签字',
    pending_rectify: '待整改',
    passed: '已通过',
  }
  return labels[detail.value.status] || detail.value.statusLabel || ''
})

const overviewStatusClass = computed(() => {
  if (!detail.value) return ''
  return `overview-status--${detail.value.status}`
})

const waitingText = computed(() => {
  if (!detail.value) return ''
  if (detail.value.waitingHours !== null) return `已等待 ${detail.value.waitingHours} 小时`
  if (detail.value.status === 'passed') return '已完成'
  return '尚未提交'
})

const visibleItems = computed(() => {
  if (!detail.value) return []
  return showAllItems.value ? detail.value.items : detail.value.items.slice(0, 6)
})

const photoUrls = computed(() => {
  if (!detail.value) return []
  return (detail.value.photos || []).map((photo) => resolveMediaUrl(photo.url))
})

const reportStatus = computed(() => {
  if (!detail.value) return null
  // 未通过验收时后端 report_pdf_status 仍是默认的 pending，
  // 不能据此显示「报告生成中」—— 它根本还没开始生成
  if (detail.value.status !== 'passed') return 'not_ready'
  return (detail.value.reportPdf && detail.value.reportPdf.status) || 'pending'
})

const flowRounds = computed(() => {
  if (!detail.value) return []
  const buckets = new Map()
  for (const entry of detail.value.flow || []) {
    const bucket = buckets.get(entry.round) || { round: entry.round, entries: [] }
    bucket.entries.push(entry)
    buckets.set(entry.round, bucket)
  }
  return [...buckets.values()].sort((a, b) => a.round - b.round)
})

const lastRejectStep = computed(() => {
  if (!detail.value) return null
  const rejects = (detail.value.flow || []).filter((entry) => entry.action === 'reject')
  return rejects.length ? rejects[rejects.length - 1].step : null
})

const steps = computed(() => computeSteps())

const noticeText = computed(() => computeNotice())

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12
  id.value = Number((options && options.id) || 0)

  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }
  if (!id.value) {
    loadError.value = '缺少验收单参数'
    return
  }
  load()
})

onShow(async () => {
  if (!detail.value || loading.value || !getToken()) return
  const active =
    detail.value.esign &&
    ['creating', 'pending', 'archiving'].includes(detail.value.esign.status)
  if (active) {
    try {
      await syncEsignTask(id.value)
    } catch {
      // 查单失败不阻断页面刷新；回调/定时任务仍是权威
    }
  }
  await load()
})

async function load() {
  if (!id.value) return
  loading.value = true
  loadError.value = ''

  try {
    const data = await fetchAcceptanceDetail(id.value)
    detail.value = data
    showAllItems.value = false

    // 本地自检勾选状态与服务端结果分开保存，提交前不污染详情数据
    const results = {}
    for (const item of data.items || []) {
      results[item.id] = item.result
    }
    draftResults.value = results

    const current = getCurrentProject()
    const sameProject = current && Number(current.id) === Number(data.projectId)
    setCurrentProject({
      id: data.projectId,
      name: data.projectName,
      role: sameProject ? current.role : null,
      tenantId: sameProject ? current.tenantId : null,
      tenantName: sameProject ? current.tenantName : null,
    })
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }
    if (detail.value) {
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
    fail: () => uni.reLaunch({ url: '/pages/acceptance/index' }),
  })
}

function openMore() {
  uni.showActionSheet({
    itemList: ['刷新', '复制验收单号'],
    success: (res) => {
      if (res.tapIndex === 0) {
        load()
        return
      }
      if (res.tapIndex === 1) {
        uni.setClipboardData({
          data: String(id.value),
          success: () => uni.showToast({ title: '验收单号已复制', icon: 'none' }),
        })
      }
    },
  })
}

function percent(value) {
  const number = Number(value) || 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

function formatTime(value) {
  if (!value) return ''
  return String(value).slice(5, 16)
}

// ── 流程条 ──

function computeSteps() {
  if (!detail.value) return []
  const status = detail.value.status
  const hasSupervisor = detail.value.hasSupervisor
  const gate = detail.value.stageGateStatus
  const lastReject = lastRejectStep.value

  const selfCheck = {
    key: 'self_check',
    label: '自检',
    state: 'pending',
    stateLabel: '待提交',
    lineState: 'pending',
  }
  const supervisor = {
    key: 'supervisor',
    label: '监理审核',
    state: hasSupervisor ? 'pending' : 'skipped',
    stateLabel: hasSupervisor ? '待审核' : '已跳过',
    lineState: 'pending',
  }
  const owner = {
    key: 'owner',
    label: '主业主签名',
    state: 'pending',
    stateLabel: '待签名',
    lineState: 'pending',
  }
  const passed = {
    key: 'passed',
    label: '验收通过',
    state: 'pending',
    stateLabel: '待签名',
    lineState: 'pending',
  }
  const settlement = {
    key: 'settlement',
    label: '阶段结算',
    state: 'pending',
    stateLabel: '待对账',
    lineState: 'pending',
  }

  if (status === 'draft') {
    selfCheck.state = 'active'
    selfCheck.stateLabel = '待提交'
  }

  if (status === 'pending_supervisor') {
    selfCheck.state = 'done'
    selfCheck.stateLabel = '已完成'
    supervisor.state = 'active'
    supervisor.stateLabel = '待审核'
  }

  if (status === 'pending_owner') {
    selfCheck.state = 'done'
    selfCheck.stateLabel = '已完成'
    supervisor.state = hasSupervisor ? 'done' : 'skipped'
    supervisor.stateLabel = hasSupervisor ? '已完成' : '已跳过'
    owner.state = 'active'
    owner.stateLabel = '待确认'
  }

  if (status === 'pending_rectify') {
    selfCheck.state = 'active'
    selfCheck.stateLabel = '待整改'
    if (lastReject === 'supervisor') {
      supervisor.state = 'rejected'
      supervisor.stateLabel = '已驳回'
    } else if (lastReject === 'owner') {
      supervisor.state = hasSupervisor ? 'done' : 'skipped'
      supervisor.stateLabel = hasSupervisor ? '已完成' : '已跳过'
      owner.state = 'rejected'
      owner.stateLabel = '已驳回'
    }
  }

  if (status === 'passed') {
    selfCheck.state = 'done'
    selfCheck.stateLabel = '已完成'
    supervisor.state = hasSupervisor ? 'done' : 'skipped'
    supervisor.stateLabel = hasSupervisor ? '已完成' : '已跳过'
    owner.state = 'done'
    owner.stateLabel = '已签名'
    passed.state = 'done'
    passed.stateLabel = '已通过'
    if (gate === 'settled') {
      settlement.state = 'done'
      settlement.stateLabel = '已结清'
    } else if (gate === 'disputed') {
      settlement.state = 'rejected'
      settlement.stateLabel = '有异议'
    } else {
      settlement.state = 'active'
      settlement.stateLabel = '待对账'
    }
  }

  // 连接线颜色跟随右侧步骤：右侧完成 → 绿色；右侧进行中 → 橙色；否则灰色
  const list = [selfCheck, supervisor, owner, passed, settlement]
  for (let index = 0; index < list.length - 1; index += 1) {
    const next = list[index + 1]
    list[index].lineState =
      next.state === 'done' ? 'done' : next.state === 'active' ? 'active' : 'pending'
  }

  return list
}

function computeNotice() {
  if (!detail.value) return ''
  const status = detail.value.status
  const gate = detail.value.stageGateStatus
  const hasSupervisor = detail.value.hasSupervisor

  if (detail.value.projectStatus === 'archived') {
    return '项目已归档，验收记录只读，不能再提交或审核。'
  }
  if (status === 'draft') {
    return '验收单尚未提交，请主工长完成自检后提交。'
  }
  if (status === 'pending_supervisor') {
    return '工长已完成自检，等待监理审核。审核通过后由主业主确认并签名。'
  }
  if (status === 'pending_owner') {
    return hasSupervisor
      ? '本阶段已通过监理审核，等待主业主确认并签名。签名后解锁付款节点，完成结算后解锁下一阶段。'
      : '本项目未配置监理，工长已完成自检，等待主业主确认并签名。签名后解锁付款节点，完成结算后解锁下一阶段。'
  }
  if (status === 'pending_rectify') {
    return '验收被驳回，等待工长整改后重新提交。整改过程与多轮记录会完整保留。'
  }
  if (status === 'passed') {
    if (gate === 'settled') return '本阶段已结清，下一阶段已解锁。'
    if (gate === 'disputed') return '本阶段已验收，但阶段结算存在异议，请工长与主业主核对后重新提交。'
    return '本阶段已验收，付款节点已解锁。请完成阶段结算，主业主确认无异议后解锁下一阶段。'
  }
  return ''
}

function flowDotClass(entry) {
  if (entry.action === 'reject') return 'flow-dot--danger'
  if (entry.action === 'approve') return 'flow-dot--success'
  return 'flow-dot--primary'
}

function flowActionClass(entry) {
  if (entry.action === 'reject') return 'flow-action--danger'
  if (entry.action === 'approve') return 'flow-action--success'
  return 'flow-action--primary'
}

// ── 验收项编辑与提交 ──

function resultOf(item) {
  if (!canEditItems.value) return item.result
  return draftResults.value[item.id] ?? null
}

function resultLabel(item) {
  const result = resultOf(item)
  if (result === 'pass') return '合格'
  if (result === 'fail') return '待整改'
  return '未勾选'
}

function resultClass(item) {
  const result = resultOf(item)
  if (result === 'pass') return 'item-result--pass'
  if (result === 'fail') return 'item-result--fail'
  return 'item-result--empty'
}

function setItemResult(itemId, result) {
  draftResults.value = { ...draftResults.value, [itemId]: result }
}

function buildItemsPayload() {
  return (detail.value.items || []).map((item) => ({
    id: item.id,
    result: draftResults.value[item.id] ?? null,
  }))
}

async function submitCheck() {
  if (submitting.value) return
  const items = buildItemsPayload()
  const missing = items.filter((item) => !item.result)
  if (missing.length) {
    uni.showToast({ title: `还有 ${missing.length} 项未勾选`, icon: 'none' })
    return
  }
  const failed = items.filter((item) => item.result === 'fail')
  if (failed.length) {
    uni.showToast({ title: `有 ${failed.length} 项不合格，请整改后再提交`, icon: 'none' })
    return
  }

  submitting.value = true
  try {
    if (canResubmit.value) {
      await resubmitAcceptance(id.value, { items })
    } else {
      await submitSelfCheck(id.value, { items })
    }
    uni.showToast({ title: '已提交自检', icon: 'success' })
    await load()
  } catch (err) {
    uni.showToast({ title: err.message || '提交失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

async function saveDraft() {
  if (submitting.value) return
  submitting.value = true
  try {
    await saveAcceptanceDraft(id.value, { items: buildItemsPayload() })
    uni.showToast({ title: '草稿已保存', icon: 'none' })
    await load()
  } catch (err) {
    uni.showToast({ title: err.message || '保存失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

// ── 通过 / 驳回 ──

function openConsent() {
  consentAccepted.value = false
  consentOpen.value = true
}

function closeConsent() {
  if (esignBusy.value) return
  consentOpen.value = false
}

function openConsentDoc() {
  consentOpen.value = false
  uni.navigateTo({ url: '/pages/legal/index?key=esign_agreement' })
}

async function startEsign() {
  if (!consentAccepted.value || esignBusy.value) return
  esignBusy.value = true
  try {
    const data = await createEsignTask(id.value, {
      consentAccepted: true,
      consentVersion: esign.value ? esign.value.consentVersion : undefined,
    })
    consentOpen.value = false
    detail.value.esign = data

    if (data.status === 'signed') {
      uni.showToast({ title: '电子签名已完成', icon: 'success' })
      await load()
      return
    }
    if (!data.signUrl) {
      uni.showToast({ title: '签署链接生成中，请稍后刷新', icon: 'none' })
      return
    }
    if (data.signMode === 'miniprogram' && data.appId) {
      uni.navigateToMiniProgram({
        appId: data.appId,
        path: data.path || '',
        fail: () => {
          uni.showToast({ title: '打开电子签小程序失败，请稍后重试', icon: 'none' })
        },
      })
      return
    }
    uni.navigateTo({
      url: `/pages/esign/sign?url=${encodeURIComponent(data.signUrl)}&id=${id.value}`,
    })
  } catch (err) {
    uni.showToast({ title: err.message || '发起签署失败', icon: 'none' })
  } finally {
    esignBusy.value = false
  }
}

async function refreshEsign() {
  if (esignBusy.value) return
  esignBusy.value = true
  try {
    await syncEsignTask(id.value)
    await load()
    uni.showToast({ title: '已刷新签署状态', icon: 'none' })
  } catch (err) {
    uni.showToast({ title: err.message || '刷新失败', icon: 'none' })
  } finally {
    esignBusy.value = false
  }
}

function cancelEsignConfirm() {
  uni.showModal({
    title: '取消签署',
    content: '取消后本次签署任务失效，可重新发起。确定取消吗？',
    success: async (res) => {
      if (!res.confirm) return
      esignBusy.value = true
      try {
        await cancelEsignTask(id.value)
        await load()
        uni.showToast({ title: '已取消签署', icon: 'none' })
      } catch (err) {
        uni.showToast({ title: err.message || '取消失败', icon: 'none' })
      } finally {
        esignBusy.value = false
      }
    },
  })
}

function onApprove() {
  if (!detail.value) return
  if (detail.value.currentStep === 'owner') {
    openSignature()
    return
  }
  approveSupervisor()
}

async function approveSupervisor() {
  if (submitting.value) return
  submitting.value = true
  try {
    await approveAcceptance(id.value)
    uni.showToast({ title: '已通过', icon: 'success' })
    await load()
  } catch (err) {
    uni.showToast({ title: err.message || '操作失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

function openReject() {
  rejectReason.value = ''
  rejectPhoto.value = ''
  rejectOpen.value = true
}

function closeReject() {
  if (rejecting.value) return
  rejectOpen.value = false
}

function chooseRejectPhoto() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['camera', 'album'],
    success: (res) => {
      rejectPhoto.value = res.tempFilePaths[0]
    },
  })
}

async function submitReject() {
  if (rejecting.value) return
  const reason = rejectReason.value.trim()
  if (!reason) {
    uni.showToast({ title: '驳回原因必填', icon: 'none' })
    return
  }

  rejecting.value = true
  try {
    await rejectAcceptance(id.value, reason, rejectPhoto.value)
    rejectOpen.value = false
    uni.showToast({ title: '已驳回', icon: 'none' })
    await load()
  } catch (err) {
    uni.showToast({ title: err.message || '驳回失败', icon: 'none' })
  } finally {
    rejecting.value = false
  }
}

// ── 业主签名 ──

function openSignature() {
  signatureOpen.value = true
  signatureTouched.value = false
  const info = uni.getSystemInfoSync()
  canvasWidth.value = Math.min(340, (info.windowWidth || 375) - 56)
  nextTick(() => initCanvas())
}

function closeSignature() {
  if (signing.value) return
  signatureOpen.value = false
  canvasCtx = null
  canvasRect = null
}

function initCanvas() {
  canvasCtx = uni.createCanvasContext('signatureCanvas', instance.proxy)
  canvasCtx.setFillStyle('#FFFFFF')
  canvasCtx.fillRect(0, 0, canvasWidth.value, canvasHeight.value)
  canvasCtx.setStrokeStyle('#241C17')
  canvasCtx.setLineWidth(3)
  canvasCtx.setLineCap('round')
  canvasCtx.setLineJoin('round')
  canvasCtx.draw()

  const query = uni.createSelectorQuery().in(instance.proxy)
  query
    .select('#signatureCanvas')
    .boundingClientRect((rect) => {
      canvasRect = rect
    })
    .exec()
}

function pointOf(event) {
  const touch =
    (event.touches && event.touches[0]) ||
    (event.changedTouches && event.changedTouches[0]) ||
    {}
  let x = touch.x
  let y = touch.y

  // H5 的 touch 没有相对 canvas 的 x/y，用 clientX/Y 减去 canvas 位置
  if ((x === undefined || y === undefined) && canvasRect) {
    x = touch.clientX - canvasRect.left
    y = touch.clientY - canvasRect.top
  }

  return { x: Number(x) || 0, y: Number(y) || 0 }
}

function onSignStart(event) {
  if (!canvasCtx) initCanvas()
  const point = pointOf(event)
  drawing = true
  signatureMoved = false
  canvasCtx.beginPath()
  canvasCtx.moveTo(point.x, point.y)
  canvasCtx.setStrokeStyle('#241C17')
  canvasCtx.setLineWidth(3)
  canvasCtx.setLineCap('round')
  canvasCtx.setLineJoin('round')
}

function onSignMove(event) {
  if (!drawing || !canvasCtx) return
  const point = pointOf(event)
  canvasCtx.lineTo(point.x, point.y)
  canvasCtx.stroke()
  canvasCtx.draw(true)
  signatureMoved = true
  signatureTouched.value = true
}

function onSignEnd() {
  if (!drawing) return
  drawing = false
  if (canvasCtx) canvasCtx.draw(true)
  if (!signatureMoved) signatureTouched.value = false
}

function clearSignature() {
  if (!canvasCtx) return
  canvasCtx.setFillStyle('#FFFFFF')
  canvasCtx.fillRect(0, 0, canvasWidth.value, canvasHeight.value)
  canvasCtx.draw()
  signatureTouched.value = false
  signatureMoved = false
}

function confirmSignature() {
  if (!signatureTouched.value) {
    uni.showToast({ title: '请先手写签名', icon: 'none' })
    return
  }
  if (signing.value) return
  signing.value = true

  uni.canvasToTempFilePath(
    {
      canvasId: 'signatureCanvas',
      success: async (res) => {
        try {
          await approveAcceptanceWithSignature(id.value, res.tempFilePath)
          signatureOpen.value = false
          uni.showToast({ title: '验收已通过', icon: 'success' })
          await load()
        } catch (err) {
          uni.showToast({ title: err.message || '提交失败', icon: 'none' })
        } finally {
          signing.value = false
        }
      },
      fail: () => {
        signing.value = false
        uni.showToast({ title: '签名图片生成失败，请重试', icon: 'none' })
      },
    },
    instance.proxy
  )
}

// ── 照片 / 报告 ──

function previewPhoto(index) {
  uni.previewImage({ urls: photoUrls.value, current: photoUrls.value[index] })
}

function previewFlowImage(images, index) {
  const urls = images.map((image) => resolveMediaUrl(image.url))
  uni.previewImage({ urls, current: urls[index] })
}

function openReport() {
  if (!detail.value || !detail.value.reportPdf) return
  const path = detail.value.reportPdf.signedPath
  if (!path) {
    uni.showToast({ title: '报告链接尚未生成', icon: 'none' })
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
      uni.openDocument({
        filePath: res.tempFilePath,
        fileType: 'pdf',
        showMenu: true,
      })
    },
    fail: () => {
      uni.hideLoading()
      uni.showToast({ title: '报告下载失败', icon: 'none' })
    },
  })
  // #endif
}

function openEvidence() {
  if (!detail.value || !detail.value.esign || !detail.value.esign.evidencePath) {
    uni.showToast({ title: '证据报告尚未生成', icon: 'none' })
    return
  }
  const path = detail.value.esign.evidencePath
  const url = resolveMediaUrl(path)
  const isJson = path.split('?')[0].endsWith('.json')

  // #ifdef H5
  window.open(url, '_blank')
  // #endif
  // #ifndef H5
  uni.showLoading({ title: '下载中…' })
  uni.downloadFile({
    url,
    success: (res) => {
      uni.hideLoading()
      if (isJson) {
        uni.showModal({
          title: '证据报告已下载',
          content: res.tempFilePath,
          showCancel: false,
        })
        return
      }
      uni.openDocument({
        filePath: res.tempFilePath,
        fileType: 'pdf',
        showMenu: true,
      })
    },
    fail: () => {
      uni.hideLoading()
      uni.showToast({ title: '证据报告下载失败', icon: 'none' })
    },
  })
  // #endif
}

async function retryReport() {
  if (retryingReport.value) return
  retryingReport.value = true
  try {
    const data = await retryAcceptanceReport(id.value)
    detail.value = data
    const results = {}
    for (const item of data.items || []) results[item.id] = item.result
    draftResults.value = results
    uni.showToast({ title: '报告已重新生成', icon: 'none' })
  } catch (err) {
    uni.showToast({ title: err.message || '重试失败', icon: 'none' })
  } finally {
    retryingReport.value = false
  }
}
function closeActiveSheet() {
  if (rejectOpen.value) closeReject()
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

/* ── 导航 ── */
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: dp(14);
  padding-bottom: dp(8);
  padding-left: dp(8);
}

.nav-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.nav-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(36);
  height: dp(36);
  flex-shrink: 0;
}

.nav-back-icon {
  width: dp(22);
  height: dp(22);
}

.nav-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #241c17;
  font-size: dp(19);
  font-weight: 700;
  letter-spacing: dp(-0.2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.round-badge {
  margin-left: dp(6);
  padding: dp(2) dp(8);
  border-radius: dp(999);
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.nav-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(32);
  height: dp(32);
  flex-shrink: 0;
}

.nav-more-icon {
  width: dp(18);
  height: dp(18);
}

/* 小程序右上角有微信原生胶囊，更多按钮往左让位 */
/* #ifdef MP-WEIXIN */
.nav {
  padding-right: dp(96);
}
/* #endif */

/* ── 内容 ── */
.content {
  padding: 0 dp(16);
}

.overview-card {
  padding: dp(16);
  border: 1px solid rgba(0, 0, 0, 0.02);
  border-radius: dp(16);
  background: #fff;
  box-shadow: 0 dp(2) dp(12) rgba(0, 0, 0, 0.03);
}

.overview-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.overview-left {
  display: flex;
  align-items: center;
  min-width: 0;
}

.project-logo {
  width: dp(48);
  height: dp(48);
  margin-right: dp(12);
  border-radius: dp(12);
  flex-shrink: 0;
}

.overview-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.project-name {
  color: #241c17;
  font-size: dp(17);
  font-weight: 700;
  letter-spacing: dp(-0.2);
}

.address-row {
  display: flex;
  align-items: center;
  margin-top: dp(4);
  min-width: 0;
}

.address-icon {
  width: dp(13);
  height: dp(13);
  margin-right: dp(3);
  flex-shrink: 0;
}

.address-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #8b8179;
  font-size: dp(12);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.overview-status {
  flex-shrink: 0;
  margin-left: dp(8);
  padding: dp(2) dp(8);
  border-radius: dp(999);
  font-size: dp(11);
  font-weight: 500;
}

.overview-status--pending_owner {
  background: #fff7e8;
  color: #ff7d00;
  border: 1px solid rgba(255, 228, 186, 0.4);
}

.overview-status--pending_supervisor {
  background: #fdebe4;
  color: #eb5c20;
  border: 1px solid #f4b392;
}

.overview-status--pending_rectify {
  background: #ffece8;
  color: #b22a26;
}

.overview-status--passed {
  background: #e8ffea;
  color: #087a1e;
}

.overview-status--draft {
  background: #f3efea;
  color: #8b8179;
}

.overview-progress {
  display: flex;
  align-items: center;
  margin-top: dp(16);
}

.progress-label {
  flex-shrink: 0;
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 700;
}

.progress-track {
  flex: 1;
  height: dp(6);
  margin: 0 dp(10);
  overflow: hidden;
  border-radius: dp(999);
  background: #f3efea;
}

.progress-fill {
  height: 100%;
  border-radius: dp(999);
  background: #eb5c20;
}

.waiting {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: #8b8179;
  font-size: dp(12);
}

.waiting-icon {
  width: dp(13);
  height: dp(13);
  margin-right: dp(3);
}

/* ── 五步流程 ── */
.stepper {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: dp(14) dp(2) dp(10);
}

.step {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.step-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(24);
  height: dp(24);
  border-radius: 50%;
  font-size: dp(12);
  font-weight: 600;
}

.step-dot--done {
  background: #00b42a;
}

.step-dot--active {
  border: 2px solid #eb5c20;
  background: #fff;
  color: #eb5c20;
}

.step-dot--pending {
  background: #e8e1da;
  color: #8b8179;
}

.step-dot--skipped {
  background: #e8e1da;
  color: #8b8179;
}

.step-dot--rejected {
  background: #f53f3f;
  color: #fff;
}

.step-check {
  width: dp(13);
  height: dp(13);
}

.step-skip {
  font-size: dp(9);
}

.step-reject {
  font-size: dp(13);
  font-weight: 700;
}

.step-number {
  line-height: 1;
}

.step-label {
  margin-top: dp(5);
  color: #241c17;
  font-size: dp(12);
  font-weight: 500;
}

.step-label--active {
  color: #eb5c20;
  font-weight: 700;
}

.step-label--rejected {
  color: #b22a26;
}

.step-label--skipped,
.step-label--pending {
  color: #51463e;
}

.step-state {
  margin-top: dp(2);
  font-size: dp(10);
}

.step-state--done {
  color: #00b42a;
}

.step-state--active {
  color: #eb5c20;
  font-weight: 500;
}

.step-state--rejected {
  color: #f53f3f;
}

.step-state--pending,
.step-state--skipped {
  color: #8b8179;
}

.step-line {
  position: absolute;
  top: dp(11);
  left: calc(50% + dp(15));
  width: calc(100% - #{dp(30)});
  border-top: 1px dashed #cfc6bd;
}

.step-line--done {
  border-top-color: #7be18a;
}

.step-line--active {
  border-top-color: #efa37c;
}

/* ── 提示条 ── */
.notice {
  display: flex;
  align-items: flex-start;
  padding: dp(12);
  border: 1px solid rgba(243, 190, 163, 0.4);
  border-radius: dp(12);
  background: #fff4ed;
}

.notice-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(16);
  height: dp(16);
  margin-top: dp(1);
  margin-right: dp(8);
  border-radius: 50%;
  background: #eb5c20;
  color: #fff;
  font-family: Georgia, serif;
  font-size: dp(11);
  font-style: italic;
  font-weight: 700;
  flex-shrink: 0;
}

.notice-text {
  flex: 1;
  color: #51463e;
  font-size: dp(12);
  line-height: 1.65;
}

/* ── tabs ── */
.tabs {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: dp(14) dp(4) 0;
}

.tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: dp(8);
  color: #51463e;
  font-size: dp(15);
  font-weight: 400;
}

.tab--active {
  color: #eb5c20;
  font-weight: 700;
}

.tab-underline {
  position: absolute;
  bottom: 0;
  width: dp(30);
  height: dp(3);
  border-radius: dp(2);
  background: #eb5c20;
}

/* ── panel ── */
.panel {
  margin-top: dp(10);
  padding: dp(16);
  border: 1px solid rgba(0, 0, 0, 0.02);
  border-radius: dp(16);
  background: #fff;
  box-shadow: 0 dp(2) dp(12) rgba(0, 0, 0, 0.03);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: dp(12);
  border-bottom: 1px solid #f5f0eb;
}

.panel-title-wrap {
  display: flex;
  align-items: baseline;
}

.panel-title {
  color: #241c17;
  font-size: dp(16);
  font-weight: 700;
}

.panel-count {
  margin-left: dp(3);
  color: #8b8179;
  font-size: dp(12);
}

.panel-more {
  display: flex;
  align-items: center;
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 500;
}

.panel-more-arrow {
  width: dp(11);
  height: dp(11);
  margin-left: dp(2);
}

.panel-empty {
  padding: dp(30) 0;
  color: #8b8179;
  font-size: dp(13);
  text-align: center;
}

.item-row {
  padding: dp(11) 0;
  border-bottom: 1px solid #f8f4ef;
}

.item-row:last-child {
  border-bottom: none;
}

.item-top {
  display: flex;
  align-items: center;
}

.item-seq {
  width: dp(20);
  color: #8b8179;
  font-size: dp(13);
  flex-shrink: 0;
}

.item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #241c17;
  font-size: dp(13);
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.item-result {
  flex-shrink: 0;
  margin-left: dp(8);
  padding: dp(2) dp(10);
  border-radius: dp(999);
  font-size: dp(11);
  font-weight: 500;
}

.item-result--pass {
  background: #e8ffea;
  color: #087a1e;
}

.item-result--fail {
  background: #fff7e8;
  color: #a85400;
}

.item-result--empty {
  background: #f3efea;
  color: #8b8179;
}

.item-edit-row {
  display: flex;
  margin: dp(8) 0 0 dp(20);
}

.result-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(28);
  padding: 0 dp(14);
  margin-right: dp(8);
  border: 1px solid #f8cdb9;
  border-radius: dp(999);
  background: #fff8f4;
  color: #eb5c20;
  font-size: dp(12);
}

.result-btn--active {
  border-color: #00b42a;
  background: #e8ffea;
  color: #087a1e;
}

.result-btn--fail {
  border-color: #ffe0d6;
  background: #fffafa;
  color: #b22a26;
}

.result-btn--fail.result-btn--active {
  border-color: #f53f3f;
  background: #ffece8;
}

.item-remark {
  display: block;
  margin: dp(5) 0 0 dp(20);
  color: #8b8179;
  font-size: dp(12);
  line-height: 1.5;
}

/* ── 照片 / 流转 / 报告 ── */
.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: dp(8);
  padding-top: dp(14);
}

.photo-item {
  width: 100%;
  height: dp(100);
  border-radius: dp(8);
  background: #f3efea;
}

.flow-round {
  margin-top: dp(14);
}

.flow-round-title {
  display: block;
  margin-bottom: dp(8);
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.flow-entry {
  display: flex;
  align-items: flex-start;
  padding-bottom: dp(14);
}

.flow-dot {
  width: dp(8);
  height: dp(8);
  margin-top: dp(6);
  margin-right: dp(10);
  border-radius: 50%;
  flex-shrink: 0;
}

.flow-dot--primary {
  background: #eb5c20;
}

.flow-dot--success {
  background: #00b42a;
}

.flow-dot--danger {
  background: #f53f3f;
}

.flow-body {
  flex: 1;
  min-width: 0;
}

.flow-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.flow-step {
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.flow-action {
  margin-left: dp(6);
  font-size: dp(11);
  font-weight: 500;
}

.flow-action--primary {
  color: #eb5c20;
}

.flow-action--success {
  color: #087a1e;
}

.flow-action--danger {
  color: #b22a26;
}

.flow-operator {
  margin-left: auto;
  color: #51463e;
  font-size: dp(12);
}

.flow-time {
  margin-left: dp(8);
  color: #8b8179;
  font-size: dp(11);
}

.flow-reason {
  display: block;
  margin-top: dp(5);
  color: #51463e;
  font-size: dp(12);
  line-height: 1.5;
}

.flow-images {
  display: flex;
  margin-top: dp(6);
}

.flow-image {
  width: dp(56);
  height: dp(56);
  margin-right: dp(6);
  border-radius: dp(6);
}

.report-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding-top: dp(18);
}

.report-title {
  color: #241c17;
  font-size: dp(15);
  font-weight: 600;
}

.report-title--danger {
  color: #b22a26;
}

.report-text {
  margin-top: dp(6);
  color: #8b8179;
  font-size: dp(12);
  line-height: 1.6;
}

.report-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(42);
  margin-top: dp(16);
  padding: 0 dp(22);
  border-radius: dp(8);
  background: #eb5c20;
  color: #fff;
  font-size: dp(14);
  font-weight: 600;
}

.report-btn--outline {
  border: 1px solid #eb5c20;
  background: #fff;
  color: #eb5c20;
}

/* ── 底部操作栏 ── */
.action-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 50;
  display: flex;
  padding: dp(10) dp(16) calc(#{dp(10)} + env(safe-area-inset-bottom));
  border-top: 1px solid #f3efea;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.04);
}

.action-secondary,
.action-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: dp(46);
  border-radius: dp(999);
  /* 原生 button 在微信小程序里不会像 H5 那样自动让文字垂直居中；
     少这一行会出现文字贴在按钮顶部 */
  line-height: 1;
  font-size: dp(15);
  font-weight: 600;
}

.action-secondary {
  margin-right: dp(10);
  border: 1px solid #eb5c20;
  background: #fff;
  color: #eb5c20;
}

.action-primary {
  background: #eb5c20;
  color: #fff;
  box-shadow: 0 dp(4) dp(12) rgba(235, 92, 32, 0.2);
}

.action-secondary[disabled],
.action-primary[disabled] {
  opacity: 0.6;
}

/* ── 签名 ── */
.signature-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;
  background: rgba(29, 33, 41, 0.5);
}

.signature-sheet {
  width: 100%;
  padding: dp(16) dp(16) calc(#{dp(16)} + env(safe-area-inset-bottom));
  border-radius: dp(20) dp(20) 0 0;
  background: #fff;
}

.signature-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.signature-title {
  color: #241c17;
  font-size: dp(18);
  font-weight: 700;
}

.signature-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(28);
  height: dp(28);
}

.signature-close-icon {
  width: dp(16);
  height: dp(16);
}

.signature-desc {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(12);
  line-height: 1.5;
}

.signature-pad {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: dp(14);
  border: 1px solid #e8e1da;
  border-radius: dp(10);
  background: #fcfaf8;
  overflow: hidden;
}

.signature-canvas {
  background: #fff;
}

.signature-placeholder {
  position: absolute;
  color: #cfc6bd;
  font-size: dp(14);
  pointer-events: none;
}

.signature-actions {
  display: flex;
  align-items: center;
  margin-top: dp(16);
}

.signature-clear {
  height: dp(42);
  padding: 0 dp(18);
  border: 1px solid #e8e1da;
  border-radius: dp(8);
  background: #fff;
  color: #51463e;
  font-size: dp(13);
}

.signature-cancel {
  flex: 1;
  height: dp(42);
  margin-left: dp(10);
  border: 1px solid #e8e1da;
  border-radius: dp(8);
  background: #fff;
  color: #51463e;
  font-size: dp(14);
  font-weight: 600;
}

.signature-confirm {
  flex: 1.4;
  height: dp(42);
  margin-left: dp(10);
  border-radius: dp(8);
  background: #eb5c20;
  color: #fff;
  font-size: dp(14);
  font-weight: 600;
}

.signature-confirm[disabled] {
  opacity: 0.65;
}

/* ── 驳回面板 ── */
.sheet-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 160;
  display: flex;
  align-items: flex-end;
  background: rgba(29, 33, 41, 0.45);
}

.sheet {
  width: 100%;
  padding: dp(8) dp(16) calc(#{dp(16)} + env(safe-area-inset-bottom));
  border-radius: dp(20) dp(20) 0 0;
  background: #fff;
}

.sheet-handle {
  width: dp(36);
  height: dp(4);
  margin: 0 auto dp(12);
  border-radius: dp(999);
  background: #cfc6bd;
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(12);
}

.sheet-title {
  color: #241c17;
  font-size: dp(17);
  font-weight: 600;
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(28);
  height: dp(28);
}

.sheet-close-icon {
  width: dp(16);
  height: dp(16);
}

.reject-textarea {
  width: 100%;
  height: dp(96);
  padding: dp(10) dp(12);
  border: 1px solid #e8e1da;
  border-radius: dp(8);
  background: #f8f4ef;
  color: #241c17;
  font-size: dp(13);
  line-height: 1.5;
  box-sizing: border-box;
}

.reject-placeholder {
  color: #a19488;
}

.reject-photo-row {
  display: flex;
  margin-top: dp(12);
}

.reject-photo-wrap {
  position: relative;
  width: dp(72);
  height: dp(72);
  border-radius: dp(8);
  overflow: hidden;
}

.reject-photo {
  width: 100%;
  height: 100%;
}

.reject-photo-remove {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(20);
  height: dp(20);
  border-radius: 0 0 0 dp(8);
  background: rgba(29, 33, 41, 0.6);
  color: #fff;
  font-size: dp(14);
}

.reject-photo-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: dp(72);
  height: dp(72);
  border: 1px dashed #cfc6bd;
  border-radius: dp(8);
  background: #f8f4ef;
}

.reject-photo-plus {
  color: #8b8179;
  font-size: dp(20);
  line-height: 1;
}

.reject-photo-label {
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(10);
}

.sheet-actions {
  display: flex;
  margin-top: dp(20);
}

.sheet-reset,
.sheet-apply {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: dp(46);
  border-radius: dp(8);
  font-size: dp(15);
  font-weight: 600;
}

.sheet-reset {
  margin-right: dp(10);
  border: 1px solid #e8e1da;
  background: #fff;
  color: #51463e;
}

.sheet-apply {
  background: #eb5c20;
  color: #fff;
}

.sheet-apply--danger {
  background: #c62828;
}

.sheet-apply[disabled] {
  opacity: 0.65;
}

/* ── 空/加载 ── */
.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: dp(80) dp(28);
}

.state-icon {
  width: dp(64);
  height: dp(64);
  opacity: 0.85;
}

.state-title {
  margin-top: dp(16);
  color: #241c17;
  font-size: dp(17);
  font-weight: 600;
}

.state-text {
  margin-top: dp(8);
  color: #6d6259;
  font-size: dp(13);
  line-height: 1.7;
  text-align: center;
}

.state-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(40);
  margin-top: dp(20);
  padding: 0 dp(24);
  border: 1px solid #eb5c20;
  border-radius: dp(8);
  background: #fff;
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 600;
}

/* ── 电子签名同意书 ── */
.consent-mask {
  position: fixed;
  z-index: 1002;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: flex-end;
  background: rgba(20, 14, 10, 0.46);
}

.consent-card {
  width: 100%;
  padding: dp(24) dp(22) calc(#{dp(20)} + env(safe-area-inset-bottom));
  border-radius: dp(18) dp(18) 0 0;
  background: #fff;
}

.consent-title {
  display: block;
  color: #241c17;
  font-size: dp(18);
  font-weight: 700;
}

.consent-text {
  display: block;
  margin-top: dp(12);
  color: #6d6259;
  font-size: dp(13);
  line-height: 1.7;
}

.consent-link {
  display: block;
  margin-top: dp(10);
  color: #eb5c20;
  font-size: dp(13);
}

.consent-check {
  display: flex;
  align-items: flex-start;
  margin-top: dp(16);
}

.consent-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(18);
  height: dp(18);
  margin-top: dp(1);
  border: 1px solid #c9bdb3;
  border-radius: dp(4);
  flex-shrink: 0;
}

.consent-box--on {
  border-color: #eb5c20;
  background: #eb5c20;
}

.consent-tick {
  color: #fff;
  font-size: dp(12);
  line-height: 1;
}

.consent-check-text {
  margin-left: dp(8);
  color: #4c4138;
  font-size: dp(12);
  line-height: 1.6;
}

.consent-actions {
  display: flex;
  gap: dp(10);
  margin-top: dp(20);
}

.consent-cancel,
.consent-submit {
  flex: 1;
  height: dp(44);
  border-radius: dp(10);
  font-size: dp(14);
  font-weight: 600;
}

.consent-cancel {
  background: #f5f0eb;
  color: #6d6259;
}

.consent-submit {
  background: #eb5c20;
  color: #fff;
}

.consent-submit[disabled] {
  opacity: 0.45;
}
</style>
