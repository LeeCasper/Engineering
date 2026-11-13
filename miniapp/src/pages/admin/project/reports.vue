<template>
  <view class="admin-page admin-page--cool">
    <AdminNav
      title="验收报告"
      :fallback="`/pages/admin/project/detail?id=${projectId}`"
      background="#F6F7F9"
      glass
    />

    <view class="content">
      <AdminPageState
        :loading="loading && !items.length"
        :error="error"
        :empty="!loading && !error && !items.length && !filterActive"
        empty-title="暂无验收单"
        empty-text="项目还没有发起验收；阶段或工序验收提交后会显示在这里。"
        @retry="() => load()"
      >
        <!-- 汇总 -->
        <view class="summary-card">
          <view class="summary-cell">
            <text class="summary-value">{{ summary.total }}</text>
            <text class="summary-label">验收单总数</text>
          </view>
          <view class="summary-cell">
            <text class="summary-value summary-value--green">{{ summary.passed }}</text>
            <text class="summary-label">已通过</text>
          </view>
          <view class="summary-cell">
            <text class="summary-value summary-value--orange">{{ summary.inProgress }}</text>
            <text class="summary-label">进行中</text>
          </view>
          <view class="summary-cell">
            <text class="summary-value summary-value--accent">{{ summary.reportReady }}</text>
            <text class="summary-label">报告已就绪</text>
          </view>
        </view>

        <!-- 搜索 -->
        <view class="admin-search search-wrap">
          <image class="search-icon" src="/static/images/icon-search.png" mode="aspectFit" />
          <input
            v-model="keyword"
            class="admin-search-input"
            confirm-type="search"
            placeholder="搜索报告编号 / 阶段 / 工序 / 提交人"
            placeholder-class="admin-placeholder"
          />
          <text v-if="keyword" class="search-clear" @tap="keyword = ''">清除</text>
        </view>

        <!-- 状态筛选：4 等分 -->
        <view class="filter-row">
          <view
            v-for="option in statusOptions"
            :key="option.key"
            class="admin-chip filter-chip"
            :class="{ 'admin-chip--active': statusFilter === option.key }"
            @tap="statusFilter = option.key"
          >
            <text class="filter-label">{{ option.label }}</text>
          </view>
        </view>

        <!-- 类型筛选：3 等分 -->
        <view class="filter-row filter-row--type">
          <view
            v-for="option in typeOptions"
            :key="option.key"
            class="admin-chip filter-chip"
            :class="{ 'admin-chip--active': typeFilter === option.key }"
            @tap="typeFilter = option.key"
          >
            <text class="filter-label">{{ option.label }}</text>
          </view>
        </view>

        <view class="list-head">
          <text class="list-title">验收记录</text>
          <text class="list-total">共 {{ total }} 条</text>
        </view>

        <!-- 筛选后为空：分页接口只返回当前页，筛选结果为空要单独提示 -->
        <view v-if="!loading && !items.length && filterActive" class="admin-card">
          <text class="admin-empty-inline">当前筛选下没有验收记录</text>
        </view>

        <view v-else-if="items.length" class="admin-list">
          <view v-for="item in items" :key="item.id" class="admin-card report-card">
            <view class="report-head">
              <view class="report-main">
                <view class="report-title-row">
                  <text
                    class="admin-badge"
                    :class="item.type === 'item' ? 'admin-badge--gray' : 'admin-badge--accent'"
                  >
                    {{ typeLabel(item) }}
                  </text>
                  <text class="report-name">{{ objectLabel(item) }}</text>
                </view>
                <text v-if="objectSub(item)" class="report-sub">{{ objectSub(item) }}</text>
              </view>
              <text class="admin-badge report-status" :class="statusTone(item.status)">
                {{ statusLabel(item) }}
              </text>
            </view>

            <view class="report-no-row">
              <text class="report-no-label">报告编号</text>
              <text class="report-no" :class="{ 'report-no--pending': !item.reportNo }">
                {{ item.reportNo || '待生成' }}
              </text>
            </view>

            <view class="report-meta-row">
              <text>第 {{ roundOf(item) }} 轮</text>
              <text class="meta-dot">·</text>
              <text>提交人 {{ item.submitter || '—' }}</text>
            </view>

            <view class="report-time-row">
              <text>提交 {{ formatDateTime(item.submittedAt) || '—' }}</text>
              <text v-if="item.finishedAt"> · 通过 {{ formatDateTime(item.finishedAt) }}</text>
            </view>

            <view class="report-foot">
              <view class="report-tags">
                <text class="admin-badge" :class="signatureTone(item)">{{ signatureLabel(item) }}</text>
                <text class="admin-badge" :class="reportMeta(item).tone">{{ reportMeta(item).label }}</text>
              </view>
              <button
                v-if="item.reportPdf && item.reportPdf.signedPath"
                class="admin-btn admin-btn--ghost admin-btn--small download-btn"
                @tap.stop="downloadReport(item)"
              >
                下载报告
              </button>
            </view>
          </view>

          <view v-if="page < totalPages" class="load-more">
            <button
              class="admin-btn admin-btn--ghost admin-btn--small"
              :disabled="loadingMore"
              @tap="loadMore"
            >
              {{ loadingMore ? '加载中…' : '加载更多' }}
            </button>
          </view>

          <text class="list-note">仅「已通过」的验收单会生成 PDF 报告；草稿与流转中的单子只展示进度。</text>
        </view>
      </AdminPageState>
    </view>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { onLoad, onPullDownRefresh, onShow, onUnload } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import { resolveMediaUrl } from '../../../api/request'
import { fetchAdminProjectAcceptances } from '../../../api/admin/project'
import { formatDateTime, requireAdminSession, showAdminError } from '../../../utils/admin'

defineOptions({ name: 'AdminProjectReportsPage' })

// 与网页后台的验收报告 tab 保持同一套状态语义
const STATUS_META = {
  draft: { label: '草稿', tone: 'admin-badge--gray' },
  pending_supervisor: { label: '待监理审核', tone: 'admin-badge--orange' },
  pending_owner: { label: '待业主确认', tone: 'admin-badge--orange' },
  pending_rectify: { label: '待整改', tone: 'admin-badge--red' },
  passed: { label: '已通过', tone: 'admin-badge--green' },
}

const EMPTY_SUMMARY = { total: 0, passed: 0, inProgress: 0, reportReady: 0 }
// 服务端签名有效期 2 小时，超过 90 分钟先刷新列表再下载
const SIGNED_URL_STALE_MS = 90 * 60 * 1000

const PAGE_SIZE = 20

const projectId = ref(null)
const items = ref([])
const summary = ref({ ...EMPTY_SUMMARY })
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const keyword = ref('')
const statusFilter = ref('all')
const typeFilter = ref('all')
const page = ref(1)
const total = ref(0)
const totalPages = ref(0)

let loadedOnce = false
let loadedAt = 0
let keywordTimer = null
// 连续切筛选时只认最后一次请求，防止慢响应覆盖新结果
let loadSeq = 0

const statusOptions = [
  { key: 'all', label: '全部' },
  { key: 'passed', label: '已通过' },
  { key: 'pending', label: '进行中' },
  { key: 'rectify', label: '待整改' },
]

const typeOptions = [
  { key: 'all', label: '全部类型' },
  { key: 'stage', label: '阶段验收' },
  { key: 'item', label: '工序验收' },
]

// 筛选与搜索都在服务端做（AC-AD45 分页后不能再拿当前页做前端过滤）
const filterActive = computed(
  () => statusFilter.value !== 'all' || typeFilter.value !== 'all' || !!keyword.value.trim()
)

function queryParams(nextPage) {
  const params = { page: nextPage, pageSize: PAGE_SIZE }
  if (statusFilter.value !== 'all') params.status = statusFilter.value
  if (typeFilter.value !== 'all') params.type = typeFilter.value
  const term = keyword.value.trim()
  if (term) params.keyword = term
  return params
}

onLoad(async (options) => {
  const id = options && options.id ? Number(options.id) : null
  projectId.value = Number.isInteger(id) && id > 0 ? id : null
  if (!projectId.value) {
    error.value = '缺少项目 id'
    return
  }

  let profile = null
  try {
    profile = await requireAdminSession()
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
    return
  }
  // null 表示已经在 requireAdminSession 里跳转登录
  if (!profile) return

  await load()
  loadedOnce = true
})

onShow(() => {
  if (loadedOnce && projectId.value) load({ silent: true })
})

onPullDownRefresh(async () => {
  try {
    if (loadedOnce) await load({ silent: true })
  } finally {
    uni.stopPullDownRefresh()
  }
})

onUnload(() => clearTimeout(keywordTimer))

// 筛选变化回到第 1 页重新取数
watch([statusFilter, typeFilter], () => load({ reset: true }))

// 与服务端筛选配合：输入防抖，避免每个字都打一次接口
watch(keyword, () => {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(() => load({ reset: true }), 300)
})

async function load({ reset = true, silent = false } = {}) {
  if (!projectId.value) return

  const seq = ++loadSeq
  if (!silent) {
    loading.value = true
    error.value = ''
  }

  try {
    const data = await fetchAdminProjectAcceptances(
      projectId.value,
      queryParams(reset ? 1 : page.value)
    )

    if (seq !== loadSeq) return

    items.value = (data && data.list) || []
    summary.value = (data && data.summary) || { ...EMPTY_SUMMARY }
    page.value = (data && data.page) || 1
    total.value = (data && data.total) || 0
    totalPages.value = (data && data.totalPages) || 0
    loadedAt = Date.now()
    error.value = ''
  } catch (err) {
    if (seq !== loadSeq) return
    if (!silent || !items.value.length) {
      error.value = err.message || '验收报告加载失败'
    }
    showAdminError(err, '验收报告加载失败')
  } finally {
    if (seq === loadSeq && !silent) loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || page.value >= totalPages.value) return

  const nextPage = page.value + 1
  const seq = loadSeq
  loadingMore.value = true
  try {
    const data = await fetchAdminProjectAcceptances(projectId.value, queryParams(nextPage))
    // 加载期间用户切了筛选，这一页已经不属于当前结果，直接丢弃
    if (seq !== loadSeq) return
    items.value = items.value.concat((data && data.list) || [])
    page.value = (data && data.page) || nextPage
    total.value = (data && data.total) || total.value
    totalPages.value = (data && data.totalPages) || totalPages.value
  } catch (err) {
    showAdminError(err, '加载更多失败')
  } finally {
    loadingMore.value = false
  }
}

function statusLabel(item) {
  const meta = STATUS_META[item.status]
  return (meta && meta.label) || item.statusLabel || item.status || '未知'
}

function statusTone(status) {
  return (STATUS_META[status] && STATUS_META[status].tone) || 'admin-badge--gray'
}

function typeLabel(item) {
  if (item.typeLabel) return item.typeLabel
  return item.type === 'item' ? '工序验收' : '阶段验收'
}

function objectLabel(item) {
  if (item.type === 'item') return item.itemName || '工序验收'
  return item.stageName || '阶段验收'
}

function objectSub(item) {
  return item.type === 'item' ? item.stageName || '' : ''
}

function roundOf(item) {
  const round = Number(item.round)
  if (round > 0) return round
  return Number(item.resubmitCount || 0) + 1
}

function signatureLabel(item) {
  if (item.esignStatus === 'signed' || item.signatureMode === 'provider') return '可靠电子签'
  if (item.hasSignature) return '手写签名（业主）'
  return '未签名'
}

function signatureTone(item) {
  return item.hasSignature || item.esignStatus === 'signed'
    ? 'admin-badge--green'
    : 'admin-badge--gray'
}

function reportMeta(item) {
  if (item.status !== 'passed') return { label: '—', tone: 'admin-badge--gray' }
  const status = item.reportPdf && item.reportPdf.status
  if (status === 'success') return { label: '报告已生成', tone: 'admin-badge--green' }
  if (status === 'failed') return { label: '报告生成失败', tone: 'admin-badge--red' }
  return { label: '报告生成中', tone: 'admin-badge--orange' }
}

async function downloadReport(item) {
  if (!item || !item.reportPdf || !item.reportPdf.signedPath) return

  // 签名链接 2 小时过期：页面停留过久时先刷新拿新链接
  if (Date.now() - loadedAt > SIGNED_URL_STALE_MS) {
    await load(true)
    const fresh = items.value.find((row) => Number(row.id) === Number(item.id))
    if (!fresh || !fresh.reportPdf || !fresh.reportPdf.signedPath) {
      uni.showToast({ title: '报告链接已过期，请下拉刷新后重试', icon: 'none', duration: 2800 })
      return
    }
    openPdfPath(fresh.reportPdf.signedPath)
    return
  }

  openPdfPath(item.reportPdf.signedPath)
}

function openPdfPath(path) {
  if (!path) return
  const url = resolveMediaUrl(path)

  // #ifdef H5
  window.open(url, '_blank')
  // #endif

  // #ifndef H5
  uni.showLoading({ title: '下载中…', mask: true })
  uni.downloadFile({
    url,
    success: (res) => {
      uni.hideLoading()
      // downloadFile 对 4xx / 5xx 也会走 success，必须自己看状态码
      if (res.statusCode !== 200) {
        const expired = [401, 403, 404, 410].includes(res.statusCode)
        uni.showToast({
          title: expired
            ? '报告链接已过期，请下拉刷新后重试'
            : `报告下载失败（${res.statusCode}）`,
          icon: 'none',
          duration: 2800,
        })
        return
      }
      uni.openDocument({
        filePath: res.tempFilePath,
        fileType: 'pdf',
        showMenu: true,
        fail: () => uni.showToast({ title: '打开报告失败', icon: 'none' }),
      })
    },
    fail: () => {
      uni.hideLoading()
      uni.showToast({ title: '报告下载失败，请检查网络', icon: 'none' })
    },
  })
  // #endif
}
</script>

<style scoped lang="scss">
.content {
  padding: dp(10) dp(16) dp(24);
}

.summary-card {
  display: flex;
  align-items: center;
  margin-bottom: dp(12);
  padding: dp(14) dp(8);
  @include glass-surface(dp(16), 18px);
}

.summary-cell {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
}

.summary-value {
  color: #241c17;
  font-size: dp(20);
  font-weight: 800;
  line-height: 1.2;
}

.summary-value--green {
  color: #1f9d55;
}

.summary-value--orange {
  color: #c44710;
}

.summary-value--accent {
  color: #eb5c20;
}

.summary-label {
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}

.search-wrap {
  margin-bottom: dp(10);
}

.search-icon {
  width: dp(16);
  height: dp(16);
  margin-right: dp(8);
  opacity: 0.5;
}

.search-clear {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(11);
}

.filter-row {
  display: flex;
  align-items: center;
  gap: dp(8);
  margin-bottom: dp(8);
}

.filter-row--type {
  margin-bottom: dp(10);
}

/* 胶囊等宽铺满整行：状态 4 等分、类型 3 等分，两行都均衡 */
.filter-chip {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: dp(6) dp(3);
  white-space: nowrap;
}

.filter-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.load-more {
  display: flex;
  justify-content: center;
  padding: dp(12) 0 dp(4);
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(8);
  padding: 0 dp(2);
}

.list-title {
  color: #241c17;
  font-size: dp(12);
  font-weight: 600;
}

.list-total {
  color: #8b8179;
  font-size: dp(10);
}

.report-card {
  padding: dp(13);
}

.report-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: dp(8);
}

.report-main {
  min-width: 0;
}

.report-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.report-name {
  min-width: 0;
  overflow: hidden;
  color: #241c17;
  font-size: dp(14);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.report-status {
  flex-shrink: 0;
}

.report-sub {
  display: block;
  margin-top: dp(5);
  color: #8b8179;
  font-size: dp(10);
}

.report-no-row {
  display: flex;
  align-items: center;
  gap: dp(6);
  margin-top: dp(9);
  padding: dp(5) dp(8);
  border-radius: dp(6);
  background: #f7f4f1;
}

.report-no-label {
  flex-shrink: 0;
  color: #8b8179;
  font-size: dp(10);
}

.report-no {
  min-width: 0;
  overflow: hidden;
  color: #3f3833;
  font-size: dp(11);
  font-weight: 600;
  letter-spacing: dp(0.2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.report-no--pending {
  color: #a89e95;
  font-weight: 400;
}

.report-meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: dp(6);
  margin-top: dp(6);
  color: #5f574f;
  font-size: dp(11);
}

.meta-dot {
  color: #c8bfb6;
}

.report-time-row {
  margin-top: dp(5);
  color: #8b8179;
  font-size: dp(10);
}

.report-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: dp(8);
  margin-top: dp(11);
}

.report-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: dp(6);
}

.download-btn {
  flex-shrink: 0;
}

.list-note {
  display: block;
  padding: dp(8) dp(4) 0;
  color: #a89e95;
  font-size: dp(10);
  line-height: 1.6;
  text-align: center;
}
</style>
