<template>
  <view v-if="open" class="admin-sheet-mask" @tap="close">
    <view class="admin-sheet picker-sheet" @tap.stop>
      <view class="admin-sheet-handle" />
      <view class="admin-sheet-head">
        <view>
          <text class="admin-sheet-title">{{ title }}</text>
          <text v-if="subtitle" class="admin-sheet-sub">{{ subtitle }}</text>
        </view>
        <view class="admin-sheet-close" @tap="close">
          <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
        </view>
      </view>

      <view class="picker-search">
        <image class="picker-search-icon" src="/static/images/icon-search.png" mode="aspectFit" />
        <input
          v-model="keyword"
          class="picker-search-input"
          confirm-type="search"
          placeholder="搜索项目名称"
          placeholder-class="picker-placeholder"
          @input="onKeywordInput"
        />
      </view>

      <view v-if="showAll" class="picker-all" @tap="chooseAll">
        <view class="picker-all-main">
          <text class="picker-all-title">{{ allLabel }}</text>
          <text class="picker-all-sub">不限定项目，展示全部可见成员</text>
        </view>
        <text v-if="selectedId === null" class="picker-current">当前</text>
        <image v-else class="picker-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
      </view>

      <gc-loading v-if="loading && !projects.length" text="加载中" />
      <text v-else-if="error" class="picker-error">{{ error }}</text>

      <view v-else class="picker-list">
        <view
          v-for="project in projects"
          :key="project.id"
          class="picker-item"
          :class="{ 'picker-item--disabled': isDisabled(project) }"
          @tap="chooseProject(project)"
        >
          <view class="picker-item-main">
            <view class="picker-item-title-row">
              <text class="picker-item-name">{{ project.name }}</text>
              <text class="picker-item-status" :class="statusTone(project.status)">
                {{ project.statusLabel || statusLabel(project.status) }}
              </text>
            </view>
            <text class="picker-item-address">{{ project.address || '未填写地址' }}</text>
          </view>
          <text v-if="selectedId === project.id" class="picker-current">当前</text>
          <text v-else-if="isDisabled(project)" class="picker-disabled-text">不可邀请</text>
          <image v-else class="picker-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
        </view>

        <view v-if="!projects.length" class="picker-empty">没有符合条件的项目</view>
        <view v-if="projects.length < total" class="picker-more" @tap="loadMore">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, watch } from 'vue'
import { fetchAdminProjects } from '../../api/admin/project'
import { statusLabel } from '../../utils/admin'

defineOptions({ name: 'AdminProjectPickerSheet' })

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '选择项目' },
  subtitle: { type: String, default: '' },
  showAll: { type: Boolean, default: false },
  allLabel: { type: String, default: '全部可见项目' },
  selectedId: { type: Number, default: null },
  allowArchived: { type: Boolean, default: true },
})

const emit = defineEmits(['close', 'select'])

const projects = ref([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const keyword = ref('')
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')

let seq = 0
let debounceTimer = null

watch(
  () => props.open,
  (open) => {
    if (open) {
      keyword.value = ''
      load(true)
    }
  }
)

async function load(reset = false) {
  if (!reset && (loading.value || loadingMore.value || page.value >= totalPages.value)) return

  const current = ++seq
  if (reset) {
    loading.value = true
    error.value = ''
    page.value = 1
  } else {
    loadingMore.value = true
  }

  try {
    const data = await fetchAdminProjects({
      page: reset ? 1 : page.value + 1,
      pageSize: 20,
      name: keyword.value.trim() || undefined,
    })
    if (current !== seq) return

    const list = (data && data.list) || []
    projects.value = reset ? list : projects.value.concat(list)
    total.value = (data && data.total) || 0
    page.value = (data && data.page) || 1
    totalPages.value = (data && data.totalPages) || 1
  } catch (err) {
    if (current !== seq) return
    error.value = err.message || '项目加载失败'
  } finally {
    if (current === seq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function loadMore() {
  load(false)
}

function onKeywordInput() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    load(true)
  }, 320)
}

function isDisabled(project) {
  return !props.allowArchived && project.status === 'archived'
}

function chooseProject(project) {
  if (isDisabled(project)) {
    uni.showToast({ title: '归档项目不能邀请成员', icon: 'none' })
    return
  }
  emit('select', project)
}

function chooseAll() {
  emit('select', null)
}

function close() {
  emit('close')
}

function statusTone(status) {
  if (status === 'building') return 'picker-status--building'
  if (status === 'finished') return 'picker-status--finished'
  if (status === 'pending') return 'picker-status--pending'
  return 'picker-status--archived'
}
</script>

<style scoped lang="scss">
.picker-sheet {
  display: flex;
  flex-direction: column;
  max-height: 80vh;
}

.picker-search {
  display: flex;
  align-items: center;
  height: dp(42);
  margin-top: dp(12);
  flex-shrink: 0;
  padding: 0 dp(12);
  @include glass-surface(dp(12), 16px);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.82) 0%,
    rgba(246, 247, 249, 0.62) 100%
  );
}

.picker-search-icon {
  width: dp(16);
  height: dp(16);
  margin-right: dp(7);
  flex-shrink: 0;
}

.picker-search-input {
  flex: 1;
  min-width: 0;
  color: #1d2129;
  font-size: dp(13);
}

.picker-placeholder {
  color: #c9cdd4;
}

.picker-all,
.picker-item {
  display: flex;
  align-items: center;
  padding: dp(12) dp(2);
  border-bottom: 1px solid #f2f3f5;
}

.picker-all {
  margin-top: dp(8);
  flex-shrink: 0;
  padding: dp(13) dp(10);
  @include glass-surface(dp(12), 14px);
  background: linear-gradient(
    135deg,
    rgba(255, 248, 243, 0.92) 0%,
    rgba(255, 238, 228, 0.72) 100%
  );
}

.picker-all-main,
.picker-item-main {
  flex: 1;
  min-width: 0;
}

.picker-all-title {
  display: block;
  color: #1d2129;
  font-size: dp(14);
  font-weight: 600;
}

.picker-all-sub {
  display: block;
  margin-top: dp(3);
  color: #86909c;
  font-size: dp(11);
}

.picker-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.picker-item--disabled {
  opacity: 0.55;
}

.picker-item-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.picker-item-name {
  overflow: hidden;
  color: #1d2129;
  font-size: dp(14);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.picker-item-address {
  display: block;
  margin-top: dp(4);
  overflow: hidden;
  color: #86909c;
  font-size: dp(11);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.picker-item-status {
  padding: dp(2) dp(6);
  border-radius: dp(999);
  font-size: dp(9);
  font-weight: 600;
  line-height: 1.2;
  flex-shrink: 0;
}

.picker-status--building {
  background: #fff2ed;
  color: #eb5c20;
}

.picker-status--finished {
  background: #e8f8f0;
  color: #149a5d;
}

.picker-status--pending {
  background: #fff7e8;
  color: #a85400;
}

.picker-status--archived {
  background: #f2f3f5;
  color: #86909c;
}

.picker-current {
  margin-left: dp(8);
  padding: dp(3) dp(9);
  border-radius: dp(999);
  background: #fff0e6;
  color: #eb5c20;
  font-size: dp(10);
  font-weight: 600;
  flex-shrink: 0;
}

.picker-disabled-text {
  margin-left: dp(8);
  color: #86909c;
  font-size: dp(10);
  flex-shrink: 0;
}

.picker-chevron {
  width: dp(13);
  height: dp(13);
  margin-left: dp(8);
  flex-shrink: 0;
}

.picker-empty,
.picker-error {
  display: block;
  padding: dp(28) 0;
  color: #86909c;
  font-size: dp(12);
  text-align: center;
}

.picker-error {
  color: #f53f3f;
}

.picker-more {
  padding: dp(14) 0 0;
  color: #eb5c20;
  font-size: dp(12);
  text-align: center;
}
</style>
