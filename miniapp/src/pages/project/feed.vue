<template>
  <view class="page" :class="{ 'page--no-contact': isForeman }">
    <!-- 自定义导航：不绘制假的 iOS 状态栏与微信胶囊 -->
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <text class="nav-title">工程动态</text>
      <view class="nav-filter" @tap="openFilterMenu">
        <image class="nav-filter-icon" src="/static/images/icon-filter-accent.png" mode="aspectFit" />
        <text>筛选</text>
      </view>
    </view>

    <view v-if="loading && !detail" class="state-block">
      <gc-loading text="正在加载工程动态…" />
    </view>

    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-acceptance-empty.png" mode="aspectFit" />
      <text class="state-title">加载失败</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="load">重新加载</button>
    </view>

    <template v-else>
      <view class="content">
        <!-- 顶部汇总：项目名是卡片内的标题，不做下拉 -->
        <view class="summary-card">
          <image class="summary-cover" :src="coverUrl" mode="aspectFill" />
          <view class="summary-main">
            <text class="summary-project-name">{{ detail ? detail.name : '项目' }}</text>
            <view class="summary-stats">
              <view class="summary-stat">
                <text class="summary-label">最近汇报</text>
                <text class="summary-value">{{ latestReportText }}</text>
              </view>
              <view class="summary-divider" />
              <view class="summary-stat">
                <text class="summary-label">近 7 天</text>
                <text class="summary-value">{{ recentCount }} 条动态</text>
              </view>
              <view class="summary-divider" />
              <view class="summary-stat">
                <text class="summary-label">当前阶段</text>
                <text class="summary-value summary-value--brand">{{ currentStageName }}</text>
              </view>
            </view>
          </view>
        </view>

        <!-- 分类筛选 -->
        <scroll-view class="filter-scroll" scroll-x :show-scrollbar="false">
          <view class="filter-row">
            <view class="filter-chip" :class="{ 'filter-chip--active': activeFilter === 'all' }" @tap="setFilter('all')">
              全部
            </view>
            <view
              v-for="stage in stageList"
              :key="stage.id"
              class="filter-chip"
              :class="{ 'filter-chip--active': activeFilter === String(stage.id) }"
              @tap="setFilter(String(stage.id))"
            >
              {{ stage.name }}
            </view>
            <view
              class="filter-chip filter-chip--icon"
              :class="{ 'filter-chip--active': activeFilter === 'images' }"
              @tap="setFilter('images')"
            >
              <image class="filter-icon" src="/static/images/icon-image-gray.png" mode="aspectFit" />
              <text>仅看图片</text>
            </view>
            <view
              class="filter-chip filter-chip--icon"
              :class="{ 'filter-chip--active': activeFilter === 'recent7' }"
              @tap="setFilter('recent7')"
            >
              <image class="filter-icon" src="/static/images/icon-calendar-gray.png" mode="aspectFit" />
              <text>最近7天</text>
            </view>
          </view>
        </scroll-view>

        <!-- 动态列表 -->
        <view v-if="loading && !reports.length" class="empty-card">
          <gc-loading text="正在加载动态…" />
        </view>

        <view v-else-if="!filteredReports.length" class="empty-card">
          <image class="empty-icon" src="/static/images/icon-camera-gray.png" mode="aspectFit" />
          <text class="empty-title">暂无工程动态</text>
          <text class="empty-text">{{ emptyHint }}</text>
        </view>

        <view v-else class="feed-list">
          <view v-for="report in filteredReports" :key="report.id" class="feed-card">
            <!-- 作者 -->
            <view class="feed-head">
              <view class="author-left">
                <view class="avatar-wrap">
                  <image
                    v-if="authorAvatar(report)"
                    class="avatar-img"
                    :src="authorAvatar(report)"
                    mode="aspectFill"
                  />
                  <text v-else class="avatar-letter">{{ authorInitial(report) }}</text>
                  <view v-if="!isSupervisorReport(report)" class="online-dot" />
                </view>
                <view class="author-info">
                  <view class="author-line">
                    <text class="author-name">{{ authorName(report) }} · {{ authorRole(report) }}</text>
                    <text class="author-time">{{ timeAgo(report.createdAt) }}</text>
                  </view>
                  <view v-if="!isSupervisorReport(report)" class="chip-row">
                    <view class="place-chip">
                      <image class="chip-icon" src="/static/images/icon-location.png" mode="aspectFit" />
                      <text>{{ report.stageName || '项目' }} · {{ report.itemName || '进度' }}</text>
                    </view>
                    <view class="delta-chip" :class="{ 'delta-chip--down': deltaOf(report).down }">
                      <text class="delta-arrow">{{ deltaOf(report).arrow }}</text>
                      <text>{{ deltaOf(report).text }}</text>
                    </view>
                  </view>
                </view>
              </view>
              <view class="feed-more" @tap="openReportMore(report)">
                <image class="feed-more-icon" src="/static/images/icon-more.png" mode="aspectFit" />
              </view>
            </view>

            <!-- 监理巡检：设计稿里的浅橙通知卡片 -->
            <view v-if="isSupervisorReport(report)" class="inspection-card" @tap="openReportMedia(report)">
              <view class="inspection-icon-wrap">
                <image class="inspection-icon" src="/static/images/icon-shield-accent.png" mode="aspectFit" />
              </view>
              <view class="inspection-body">
                <text class="inspection-title">{{ inspectionTitle(report) }}</text>
                <text class="inspection-desc">{{ report.content || '本次巡检记录已归档。' }}</text>
              </view>
              <image class="inspection-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>

            <!-- 正文 -->
            <text v-if="!isSupervisorReport(report) && report.content" class="feed-content">{{ report.content }}</text>

            <!-- 媒体 -->
            <view
              v-if="!isSupervisorReport(report) && gridMedia(report).length"
              class="media-grid"
              :class="`media-grid--${gridMedia(report).length}`"
            >
              <view
                v-for="(media, index) in gridMedia(report)"
                :key="media.id"
                class="media-tile"
                @tap="onMediaTap(report, media, index)"
              >
                <image
                  v-if="media.type === 'image'"
                  class="media-image"
                  :src="resolveMediaUrl(media.url)"
                  mode="aspectFill"
                />
                <view v-else class="video-tile">
                  <image class="video-play" src="/static/images/icon-play-white.png" mode="aspectFit" />
                  <text v-if="media.duration" class="video-duration">{{ formatDuration(media.duration) }}</text>
                </view>
                <view v-if="index === 2 && mediaExtra(report) > 0" class="media-more">
                  +{{ mediaExtra(report) }}
                </view>
              </view>
            </view>

            <!-- 底部操作 -->
            <view v-if="!isSupervisorReport(report)" class="feed-footer">
              <view class="comment-action" @tap="openComments(report)">
                <image class="comment-icon" src="/static/images/icon-comment-gray.png" mode="aspectFit" />
                <text>评论 {{ report.commentCount || 0 }}</text>
              </view>
              <view class="detail-action" @tap="openReportMedia(report)">
                <image
                  v-if="hasVideo(report)"
                  class="detail-icon"
                  src="/static/images/icon-document.png"
                  mode="aspectFit"
                />
                <image v-else class="detail-icon" src="/static/images/icon-image-gray.png" mode="aspectFit" />
                <text>{{ hasVideo(report) ? '查看详情' : '查看大图' }}</text>
                <image class="detail-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
              </view>
            </view>
          </view>

          <view v-if="loadingMore" class="load-more"><gc-loading inline text="加载中" /></view>
          <view v-else-if="!hasMore && filteredReports.length >= 8" class="load-more">没有更多了</view>
        </view>
      </view>

      <!-- 固定底部：联系工长（工长自己看时不需要联系自己） -->
      <view v-if="!isForeman" class="bottom-bar">
        <view class="contact-btn" @tap="contactForeman">
          <image class="contact-btn-icon" src="/static/images/icon-phone-white.png" mode="aspectFit" />
          <text>联系工长</text>
        </view>
      </view>

      <!-- 工长：提交进度汇报 -->
      <view v-if="canReportProgress" class="report-fab" @tap="goReport">
        <image class="report-fab-icon" src="/static/images/icon-plus-white.png" mode="aspectFit" />
        <text>汇报进度</text>
      </view>
    </template>

    <!-- 评论面板 -->
    <view v-if="commentsOpen" class="sheet-mask" @touchmove.stop.prevent="sheetSwipe.onMaskTouchMove" @tap="closeComments">
      <view class="sheet" :style="sheetSwipeStyle" @tap.stop>
        <view class="sheet-head" @touchstart="sheetSwipe.onTouchStart" @touchmove.stop.prevent="sheetSwipe.onTouchMove" @touchend="sheetSwipe.onTouchEnd">
          <view>
            <text class="sheet-title">评论</text>
            <text class="sheet-sub">{{ activeReport ? `${activeReport.commentCount || 0} 条评论` : '' }}</text>
          </view>
          <view class="sheet-close" @tap="closeComments">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <scroll-view class="comment-scroll" scroll-y>
          <view v-if="commentsLoading" class="sheet-state"><gc-loading inline text="加载中" /></view>
          <view v-else-if="!comments.length" class="sheet-state">还没有评论，来说一句吧</view>
          <view v-else class="comment-list">
            <view v-for="comment in comments" :key="comment.id" class="comment-row">
              <view class="comment-avatar">{{ (comment.author.nickname || '用').slice(0, 1) }}</view>
              <view class="comment-main">
                <view class="comment-head">
                  <text class="comment-name">{{ comment.author.nickname || '项目成员' }}</text>
                  <text class="comment-time">{{ formatDateTime(comment.createdAt) }}</text>
                </view>
                <text class="comment-content">{{ comment.content }}</text>
              </view>
            </view>
          </view>
        </scroll-view>

        <view class="comment-input-row">
          <input
            v-model="commentInput"
            class="comment-input"
            confirm-type="send"
            placeholder="写评论…"
            placeholder-class="comment-placeholder"
            @confirm="submitComment"
          />
          <view
            class="comment-submit"
            :class="{ 'comment-submit--disabled': commentSubmitting || !commentInput.trim() }"
            @tap="submitComment"
          >
            {{ commentSubmitting ? '发送中' : '发送' }}
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import {
  projectDetail,
  projectStages,
  projectReports,
  projectContacts,
} from '../../api/project'
import { fetchReportComments, addReportComment } from '../../api/report'
import { resolveMediaUrl } from '../../api/request'
import { getToken } from '../../store/session'
import { getCurrentProject, setCurrentProject, clearCurrentProject } from '../../store/projectContext'
import { useSwipeClose } from '../../composables/useSwipeClose'

// 底部弹窗下滑关闭：绑定把手 / 标题区，不干扰表单滚动
const sheetSwipe = useSwipeClose(() => closeActiveSheet())
const sheetSwipeStyle = sheetSwipe.style

const ROLE_LABELS = { foreman: '工长', supervisor: '监理', owner: '业主' }

const projectId = ref(null)
const safeTop = ref(12)
const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref('')
const detail = ref(null)
const stageList = ref([])
const reports = ref([])
const totalReports = ref(0)
const page = ref(1)
const pageSize = 20
const contacts = ref([])
const activeFilter = ref('all')

const commentsOpen = ref(false)
const commentsLoading = ref(false)
const comments = ref([])
const commentInput = ref('')
const commentSubmitting = ref(false)
const activeReport = ref(null)

let loadedOnce = false

const coverUrl = computed(() => {
  const index = (Math.abs(Number(projectId.value) || 0) % 4) + 1
  return `/static/images/project-cover-${index}.jpg`
})

const currentStageName = computed(
  () => detail.value?.currentStageName || stageList.value.find((stage) => stage.gateStatus !== 'settled')?.name || '—'
)

// 工长自己看工程动态时，「联系工长」是在联系自己，隐藏
const isForeman = computed(() => detail.value?.myRole === 'foreman')

// 有可汇报阶段时才显示「汇报进度」入口；具体权限后端还会再校验
const canReportProgress = computed(
  () =>
    isForeman.value &&
    detail.value?.status !== 'archived' &&
    stageList.value.some((stage) => stage.canReport)
)

// 筛选栏是「全部 + 项目的全部阶段 + 仅看图片 + 最近7天」，
// 阶段数量随模板变化，整行放在 scroll-view 里横向滑动，不截断阶段。


const latestReportText = computed(() => {
  if (!reports.value.length) return '暂无汇报'
  return timeAgo(reports.value[0].createdAt)
})

const recentCount = computed(() => {
  const cutoff = Date.now() - 7 * 86400000
  return reports.value.filter((report) => {
    const date = parseDateTime(report.createdAt)
    return date && date.getTime() >= cutoff
  }).length
})

const filteredReports = computed(() => {
  if (activeFilter.value === 'all') return reports.value
  if (activeFilter.value === 'images') {
    return reports.value.filter((report) => (report.media || []).some((item) => item.type === 'image'))
  }
  if (activeFilter.value === 'recent7') {
    const cutoff = Date.now() - 7 * 86400000
    return reports.value.filter((report) => {
      const date = parseDateTime(report.createdAt)
      return date && date.getTime() >= cutoff
    })
  }
  return reports.value.filter((report) => String(report.stageId) === activeFilter.value)
})

const hasMore = computed(() => reports.value.length < totalReports.value)

const emptyHint = computed(() => {
  if (activeFilter.value === 'images') return '当前分类下还没有带图片的汇报'
  if (activeFilter.value === 'recent7') return '最近 7 天还没有新的进度汇报'
  if (activeFilter.value !== 'all') return '这个阶段还没有进度汇报'
  return '工长提交进度汇报后，会显示在这里'
})

const foremanContact = computed(
  () =>
    contacts.value.find((contact) => contact.role === 'foreman' && contact.isPrimaryForeman) ||
    contacts.value.find((contact) => contact.role === 'foreman') ||
    null
)

function roleLabel(role) {
  return ROLE_LABELS[role] || '项目成员'
}

function authorName(report) {
  return report.author?.nickname || '项目成员'
}

function authorRole(report) {
  return report.author?.roleLabel || roleLabel(report.author?.role)
}

function isSupervisorReport(report) {
  return report.author?.role === 'supervisor'
}

function inspectionTitle(report) {
  const item = report.itemName || report.stageName || '阶段'
  // 后端 itemName 可能已经是「阶段巡检」，直接拼「巡检」会出现「巡检巡检」
  const label = String(item).includes('巡检') ? item : `${item}巡检`
  return `监理已完成${label}，现场照片已归档。`
}

function authorAvatar(report) {
  return resolveMediaUrl(report.author?.avatar)
}

function authorInitial(report) {
  return (authorName(report) || '工').slice(0, 1)
}

function deltaOf(report) {
  const to = percent(report.progress)
  if (report.fromProgress === null || report.fromProgress === undefined) {
    return { arrow: '↑', text: `更新至 ${to}%`, down: false }
  }
  const from = percent(report.fromProgress)
  const change = to - from
  return {
    arrow: change < 0 ? '↓' : change > 0 ? '↑' : '→',
    text: `${from}% → ${to}%`,
    down: change < 0,
  }
}

function gridMedia(report) {
  return (report.media || []).slice(0, 3)
}

function mediaExtra(report) {
  return Math.max(0, (report.media || []).length - 3)
}

function hasImages(report) {
  return (report.media || []).some((item) => item.type === 'image')
}

function hasVideo(report) {
  return (report.media || []).some((item) => item.type === 'video')
}

function onMediaTap(report, media, index) {
  if (media.type === 'video') {
    previewVideo(media)
    return
  }
  const urls = (report.media || [])
    .filter((item) => item.type === 'image')
    .map((item) => resolveMediaUrl(item.url))
  const imageIndex = (report.media || [])
    .filter((item) => item.type === 'image')
    .findIndex((item) => item.id === media.id)
  uni.previewImage({ urls, current: urls[imageIndex >= 0 ? imageIndex : index] })
}

function previewVideo(media) {
  const url = resolveMediaUrl(media.url)
  // previewMedia 在微信端支持视频；失败时退回提示，避免点击后毫无反馈
  if (typeof uni.previewMedia === 'function') {
    uni.previewMedia({
      sources: [{ url, type: 'video', poster: '' }],
      current: 0,
      fail: () => uni.showToast({ title: '视频预览失败', icon: 'none' }),
    })
    return
  }
  uni.showToast({ title: '当前环境不支持视频预览', icon: 'none' })
}

function openReportMedia(report) {
  // 有视频时按钮文案是「查看详情」，优先打开视频；纯图片才进大图预览
  const video = (report.media || []).find((item) => item.type === 'video')
  if (video) {
    previewVideo(video)
    return
  }
  const images = (report.media || []).filter((item) => item.type === 'image')
  if (images.length) {
    const urls = images.map((item) => resolveMediaUrl(item.url))
    uni.previewImage({ urls, current: urls[0] })
    return
  }
  uni.showToast({ title: '这条汇报没有附件', icon: 'none' })
}

function openReportMore(report) {
  uni.showActionSheet({
    itemList: ['复制汇报内容', '查看项目详情'],
    success: (res) => {
      if (res.tapIndex === 0) {
        const text = [report.content, report.stageName, report.itemName].filter(Boolean).join(' · ')
        if (!text) {
          uni.showToast({ title: '这条汇报没有文字内容', icon: 'none' })
          return
        }
        uni.setClipboardData({
          data: text,
          success: () => uni.showToast({ title: '已复制', icon: 'none' }),
        })
      }
      if (res.tapIndex === 1) goProject()
    },
  })
}

function setFilter(key) {
  activeFilter.value = key
}

function openFilterMenu() {
  uni.showActionSheet({
    itemList: ['全部动态', '仅看图片', '最近7天'],
    success: (res) => {
      if (res.tapIndex === 0) setFilter('all')
      if (res.tapIndex === 1) setFilter('images')
      if (res.tapIndex === 2) setFilter('recent7')
    },
  })
}

function goProject() {
  uni.navigateBack({
    fail: () => uni.redirectTo({ url: `/pages/project/index?id=${projectId.value}` }),
  })
}

function goBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/projects/index' }),
  })
}

function goReport() {
  uni.navigateTo({ url: `/pages/report/submit?projectId=${projectId.value}` })
}

function contactForeman() {
  if (!foremanContact.value?.phone) {
    uni.showToast({ title: '暂无工长联系方式', icon: 'none' })
    return
  }
  uni.makePhoneCall({ phoneNumber: String(foremanContact.value.phone) })
}

function percent(value) {
  const number = Number(value) || 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

function parseDateTime(value) {
  if (!value) return null
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function timeAgo(value) {
  const date = parseDateTime(value)
  if (!date) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000))
  if (minutes < 5) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return formatDateTime(value).slice(5, 16)
}

function formatDateTime(value) {
  if (!value) return ''
  const text = String(value)
  return text.length >= 16 ? text.slice(0, 16) : text
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(Math.floor(total % 60)).padStart(2, '0')
  return `${mm}:${ss}`
}

async function load(silent = false) {
  if (!projectId.value) return
  if (!silent) loading.value = true
  loadError.value = ''

  try {
    const [project, stageData, reportData, contactData] = await Promise.all([
      projectDetail(projectId.value),
      projectStages(projectId.value).catch(() => null),
      projectReports(projectId.value, { page: 1, pageSize }).catch(() => null),
      projectContacts(projectId.value).catch(() => null),
    ])

    detail.value = project
    stageList.value = (stageData && stageData.stages) || project.stages || []
    reports.value = (reportData && reportData.list) || []
    totalReports.value = reportData ? reportData.total : reports.value.length
    page.value = 1
    contacts.value = (contactData && contactData.contacts) || []

    const current = getCurrentProject()
    if (!current || Number(current.id) !== Number(project.id)) {
      setCurrentProject({ ...project, myRole: project.myRole })
    }

    loadedOnce = true
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }
    if (err.statusCode === 404) {
      clearCurrentProject()
      loadError.value = '项目不存在，或您已不在该项目中'
      return
    }
    if (detail.value) {
      uni.showToast({ title: err.message || '刷新失败，请稍后重试', icon: 'none' })
    } else {
      loadError.value = err.message || '加载失败，请稍后重试'
    }
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const next = page.value + 1
    const data = await projectReports(projectId.value, { page: next, pageSize })
    const list = (data && data.list) || []
    const existing = new Set(reports.value.map((report) => report.id))
    reports.value = [...reports.value, ...list.filter((report) => !existing.has(report.id))]
    totalReports.value = data ? data.total : totalReports.value
    page.value = next
  } catch (err) {
    uni.showToast({ title: err.message || '加载更多失败', icon: 'none' })
  } finally {
    loadingMore.value = false
  }
}

async function openComments(report) {
  activeReport.value = report
  commentsOpen.value = true
  comments.value = []
  commentsLoading.value = true
  try {
    const data = await fetchReportComments(report.id)
    comments.value = data.list || []
  } catch (err) {
    uni.showToast({ title: err.message || '评论加载失败', icon: 'none' })
  } finally {
    commentsLoading.value = false
  }
}

function closeComments() {
  if (commentSubmitting.value) return
  commentsOpen.value = false
}

async function submitComment() {
  const content = commentInput.value.trim()
  if (!content || commentSubmitting.value || !activeReport.value) return
  commentSubmitting.value = true
  try {
    await addReportComment(activeReport.value.id, content)
    commentInput.value = ''
    uni.showToast({ title: '评论已发送', icon: 'success' })
    const data = await fetchReportComments(activeReport.value.id)
    comments.value = data.list || []
    activeReport.value.commentCount = (activeReport.value.commentCount || 0) + 1
  } catch (err) {
    uni.showToast({ title: err.message || '评论失败', icon: 'none' })
  } finally {
    commentSubmitting.value = false
  }
}

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }

  const current = getCurrentProject()
  projectId.value = Number(options?.projectId) || Number(options?.id) || current?.id || null
  if (!projectId.value) {
    uni.redirectTo({ url: '/pages/projects/index' })
    return
  }

  load()
})

onShow(() => {
  if (loadedOnce && !loading.value) load(true)
})

onPullDownRefresh(() => {
  load(true)
})

onReachBottom(() => {
  loadMore()
})
function closeActiveSheet() {
  if (commentsOpen.value) closeComments()
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding-bottom: calc(#{dp(92)} + env(safe-area-inset-bottom));
  background: #faf7f4;
}

.page--no-contact {
  padding-bottom: dp(24);
}

/* ── 导航 ── */
.nav {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: dp(14);
  padding-bottom: dp(8);
  padding-left: dp(8);
  background: #faf7f4;
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
  flex: 1;
  min-width: 0;
  margin-left: dp(4);
  overflow: hidden;
  color: #2b2119;
  font-size: dp(17);
  font-weight: 700;
  letter-spacing: dp(-0.2);
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nav-filter {
  display: flex;
  align-items: center;
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 500;
  flex-shrink: 0;
}

.nav-filter-icon {
  width: dp(15);
  height: dp(15);
  margin-right: dp(2);
}

/* 小程序右上角有微信原生胶囊，筛选按钮往左让位 */
/* #ifdef MP-WEIXIN */
.nav {
  padding-right: dp(96);
}
/* #endif */

.content {
  padding: 0 dp(14);
}

/* ── 顶部汇总 ── */
.summary-card {
  display: flex;
  align-items: center;
  padding: dp(14);
  border: 1px solid rgba(229, 231, 235, 0.7);
  border-radius: dp(16);
  background: #fff;
  box-shadow: 0 dp(2) dp(10) rgba(0, 0, 0, 0.025);
}

.summary-cover {
  width: dp(80);
  height: dp(64);
  margin-right: dp(14);
  border-radius: dp(12);
  background: #f0eae4;
  flex-shrink: 0;
}

.summary-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

.summary-project-name {
  display: block;
  overflow: hidden;
  color: #2b2119;
  font-size: dp(14);
  font-weight: 700;
  letter-spacing: dp(-0.2);
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.summary-stats {
  display: flex;
  align-items: center;
  margin-top: dp(6);
  min-width: 0;
}

.summary-stat {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.summary-stat + .summary-divider + .summary-stat {
  padding-left: dp(10);
}

.summary-label {
  color: #c4bbb2;
  font-size: dp(10);
}

.summary-value {
  overflow: hidden;
  margin-top: dp(2);
  color: #2b2119;
  font-size: dp(13);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.summary-value--brand {
  color: #eb5c20;
}

.summary-divider {
  width: 1px;
  height: dp(24);
  margin: 0 dp(8);
  background: #f3efea;
  flex-shrink: 0;
}

/* ── 筛选 ── */
.filter-scroll {
  width: 100%;
  margin-top: dp(12);
  white-space: nowrap;
}

.filter-row {
  display: inline-flex;
  align-items: center;
  gap: dp(6);
  padding: dp(2) 0;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: dp(6) dp(10);
  border-radius: dp(999);
  background: rgba(255, 247, 242, 0.75);
  color: #5a514a;
  font-size: dp(11);
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}

.filter-chip--active {
  background: #eb5c20;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 dp(2) dp(6) rgba(235, 92, 32, 0.2);
  transform-origin: center;
  animation: gc-tab-pop 420ms cubic-bezier(0.2, 1.35, 0.35, 1) both;
}

.filter-chip--icon {
  padding-right: dp(9);
  padding-left: dp(9);
}

.filter-icon {
  width: dp(13);
  height: dp(13);
  margin-right: dp(4);
}

/* ── 动态列表 ── */
.feed-list {
  display: flex;
  flex-direction: column;
  gap: dp(14);
  margin-top: dp(14);
}

.feed-card {
  padding: dp(16);
  border: 1px solid rgba(229, 231, 235, 0.7);
  border-radius: dp(16);
  background: #fff;
  box-shadow: 0 dp(2) dp(10) rgba(0, 0, 0, 0.025);
}

.feed-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.author-left {
  display: flex;
  align-items: flex-start;
  min-width: 0;
  flex: 1;
}

.avatar-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(44);
  height: dp(44);
  margin-right: dp(10);
  overflow: visible;
  border-radius: dp(999);
  background: #fdebe4;
  flex-shrink: 0;
}

.avatar-img {
  width: 100%;
  height: 100%;
  border: 1px solid #e8e1da;
  border-radius: dp(999);
}

.avatar-letter {
  color: #eb5c20;
  font-size: dp(16);
  font-weight: 700;
}

.online-dot {
  position: absolute;
  right: 0;
  bottom: 0;
  width: dp(11);
  height: dp(11);
  border: 2px solid #fff;
  border-radius: dp(999);
  background: #52c41a;
}

.author-info {
  min-width: 0;
  flex: 1;
}

.author-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.author-name {
  color: #2b2119;
  font-size: dp(13);
  font-weight: 700;
}

.author-time {
  margin-left: dp(6);
  color: #c4bbb2;
  font-size: dp(11);
}

.chip-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: dp(5);
  margin-top: dp(4);
}

.place-chip,
.delta-chip {
  display: inline-flex;
  align-items: center;
  padding: dp(2) dp(7);
  border-radius: dp(999);
  font-size: dp(10);
  line-height: 1.5;
  white-space: nowrap;
}

.place-chip {
  background: #f3efea;
  color: #5a514a;
  font-weight: 500;
}

.chip-icon {
  width: dp(10);
  height: dp(10);
  margin-right: dp(3);
}

.delta-chip {
  background: #e8f7f0;
  color: #00b42a;
  font-weight: 700;
}

.delta-chip--down {
  background: #ffece8;
  color: #f53f3f;
}

.delta-arrow {
  margin-right: dp(2);
  font-size: dp(11);
  font-weight: 800;
}

.feed-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(28);
  height: dp(28);
  flex-shrink: 0;
}

.feed-more-icon {
  width: dp(15);
  height: dp(15);
  opacity: 0.65;
}

.feed-content {
  display: block;
  margin-top: dp(9);
  color: #2b2119;
  font-size: dp(13);
  line-height: 1.65;
}

/* 监理巡检通知卡片 */
.inspection-card {
  display: flex;
  align-items: flex-start;
  margin-top: dp(10);
  padding: dp(12);
  border: 1px solid rgba(249, 219, 203, 0.8);
  border-radius: dp(12);
  background: #fff7f2;
}

.inspection-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(32);
  height: dp(32);
  margin-right: dp(10);
  border-radius: dp(999);
  background: rgba(235, 92, 32, 0.1);
  flex-shrink: 0;
}

.inspection-icon {
  width: dp(20);
  height: dp(20);
}

.inspection-body {
  flex: 1;
  min-width: 0;
}

.inspection-title {
  display: block;
  color: #2b2119;
  font-size: dp(13);
  font-weight: 700;
  line-height: 1.45;
}

.inspection-desc {
  display: block;
  margin-top: dp(4);
  overflow: hidden;
  color: #8b8179;
  font-size: dp(11);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.inspection-chevron {
  width: dp(14);
  height: dp(14);
  margin-top: dp(8);
  margin-left: dp(6);
  opacity: 0.7;
  flex-shrink: 0;
}

.media-grid {
  display: grid;
  gap: dp(6);
  margin-top: dp(9);
}

.media-grid--1 {
  display: flex;
}

.media-grid--1 .media-tile {
  width: dp(140);
  height: dp(105);
  flex: none;
}

.media-grid--2 {
  grid-template-columns: repeat(2, 1fr);
}

.media-grid--2 .media-tile {
  height: dp(140);
}

.media-grid--3 {
  grid-template-columns: repeat(3, 1fr);
}

.media-grid--3 .media-tile {
  height: dp(100);
}

.media-tile {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: dp(8);
  background: #f0eae4;
}

.media-image {
  width: 100%;
  height: 100%;
}

.video-tile {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: #2b2119;
}

.video-play {
  width: dp(28);
  height: dp(28);
  padding: dp(6);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: dp(999);
  background: rgba(0, 0, 0, 0.35);
}

.video-duration {
  position: absolute;
  right: dp(5);
  bottom: dp(5);
  padding: dp(1) dp(5);
  border-radius: dp(3);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: dp(9);
}

.media-more {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  font-size: dp(14);
  font-weight: 700;
}

.feed-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(8);
}

.comment-action,
.detail-action {
  display: flex;
  align-items: center;
  font-size: dp(11);
  font-weight: 500;
}

.comment-action {
  color: #5a514a;
}

.comment-icon {
  width: dp(14);
  height: dp(14);
  margin-right: dp(4);
}

.detail-action {
  color: #eb5c20;
}

.detail-icon {
  width: dp(14);
  height: dp(14);
  margin-right: dp(4);
}

.detail-chevron {
  width: dp(10);
  height: dp(10);
  margin-left: dp(2);
}

/* ── 空态 / 加载 ── */
.empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-top: dp(14);
  padding: dp(44) dp(24);
  border: 1px solid rgba(229, 231, 235, 0.7);
  border-radius: dp(16);
  background: #fff;
}

.empty-icon {
  width: dp(36);
  height: dp(36);
  margin-bottom: dp(10);
  opacity: 0.8;
}

.empty-title {
  color: #2b2119;
  font-size: dp(14);
  font-weight: 700;
}

.empty-text {
  margin-top: dp(4);
  color: #c4bbb2;
  font-size: dp(11);
  line-height: 1.6;
  text-align: center;
}

.load-more {
  padding: dp(8) 0 dp(4);
  color: #c4bbb2;
  font-size: dp(11);
  text-align: center;
}

/* ── 底部联系工长 ── */
.bottom-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 40;
  padding: dp(10) dp(16) calc(#{dp(10)} + env(safe-area-inset-bottom));
  border-top: 1px solid #f3efea;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 dp(-4) dp(16) rgba(0, 0, 0, 0.05);
}

.contact-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(48);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(15);
  font-weight: 600;
  box-shadow: 0 dp(4) dp(12) rgba(235, 92, 32, 0.25);
}

.report-fab {
  position: fixed;
  right: dp(16);
  bottom: calc(#{dp(24)} + env(safe-area-inset-bottom));
  z-index: 40;
  display: flex;
  align-items: center;
  gap: dp(5);
  height: dp(42);
  padding: 0 dp(16);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(13);
  font-weight: 600;
  box-shadow: 0 dp(6) dp(18) rgba(235, 92, 32, 0.35);
}

.report-fab:active {
  background: #c44710;
}

.report-fab-icon {
  width: dp(14);
  height: dp(14);
}

.contact-btn:active {
  background: #c44710;
}

.contact-btn-icon {
  width: dp(18);
  height: dp(18);
  margin-right: dp(6);
}

/* ── 状态 ── */
.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: dp(90) dp(28);
}

.state-icon {
  width: dp(48);
  height: dp(48);
  margin-bottom: dp(10);
}

.state-title {
  margin-bottom: dp(4);
  color: #2b2119;
  font-size: dp(16);
  font-weight: 700;
}

.state-text {
  color: #8b8179;
  font-size: dp(12);
  line-height: 1.6;
  text-align: center;
}

.state-btn {
  height: dp(38);
  margin-top: dp(14);
  padding: 0 dp(20);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(13);
  font-weight: 600;
  line-height: dp(38);
}

/* ── 评论面板 ── */
.sheet-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  background: rgba(29, 33, 41, 0.5);
}

.sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 75vh;
  padding: dp(16) dp(16) calc(#{dp(16)} + env(safe-area-inset-bottom));
  border-radius: dp(20) dp(20) 0 0;
  background: #fff;
}

.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: dp(12);
  border-bottom: 1px solid #f3efea;
}

.sheet-title {
  display: block;
  color: #2b2119;
  font-size: dp(18);
  font-weight: 700;
}

.sheet-sub {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(11);
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(32);
  height: dp(32);
}

.sheet-close-icon {
  width: dp(18);
  height: dp(18);
}

.sheet-state {
  padding: dp(36) 0;
  color: #8b8179;
  font-size: dp(12);
  text-align: center;
}

.comment-scroll {
  flex: 1;
  max-height: dp(360);
}

.comment-list {
  padding: dp(8) 0;
}

.comment-row {
  display: flex;
  align-items: flex-start;
  padding: dp(8) 0;
}

.comment-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(30);
  height: dp(30);
  margin-right: dp(8);
  border-radius: dp(999);
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 700;
  flex-shrink: 0;
}

.comment-main {
  flex: 1;
  min-width: 0;
}

.comment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.comment-name {
  color: #2b2119;
  font-size: dp(12);
  font-weight: 600;
}

.comment-time {
  color: #c4bbb2;
  font-size: dp(10);
}

.comment-content {
  display: block;
  margin-top: dp(3);
  color: #5a514a;
  font-size: dp(12);
  line-height: 1.5;
}

.comment-input-row {
  display: flex;
  align-items: center;
  padding-top: dp(10);
  border-top: 1px solid #f3efea;
}

.comment-input {
  flex: 1;
  height: dp(38);
  padding: 0 dp(12);
  border-radius: dp(999);
  background: #faf7f4;
  color: #2b2119;
  font-size: dp(12);
}

.comment-placeholder {
  color: #c4bbb2;
}

.comment-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(34);
  margin-left: dp(8);
  padding: 0 dp(14);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  font-weight: 600;
}

.comment-submit--disabled {
  opacity: 0.45;
}
</style>
