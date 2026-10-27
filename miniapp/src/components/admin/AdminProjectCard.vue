<template>
  <view v-if="compact" class="compact-card" @tap="$emit('select', project)">
    <text class="status-pill" :class="toneClass">{{ statusText }}</text>
    <view class="compact-main">
      <text class="compact-name">{{ project.name }}</text>
      <text class="compact-sub">
        {{ project.currentStageName || '暂无阶段' }} · 总进度 {{ progressPercent }}%
      </text>
    </view>
    <image class="compact-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
  </view>

  <view v-else class="project-card" @tap="$emit('select', project)">
    <view class="project-top">
      <view class="project-thumb">
        <image class="project-thumb-img" src="/static/images/admin-project-building.png" mode="aspectFit" />
      </view>
      <view class="project-main">
        <view class="project-title-row">
          <text class="project-name">{{ project.name }}</text>
          <text v-if="project.isOverdue && project.status !== 'archived'" class="overdue-pill">延期</text>
          <text class="status-pill" :class="toneClass">{{ statusText }}</text>
        </view>
        <text class="project-address">{{ project.address || '未填写地址' }}</text>
      </view>
    </view>

    <view v-if="showPeople" class="project-people">
      <text class="people-item">主工长：{{ foremanText }}</text>
      <text class="people-dot">·</text>
      <text class="people-item">业主：{{ ownerText }}</text>
    </view>

    <view class="project-progress">
      <view class="progress-track">
        <view class="progress-fill" :style="{ width: `${progressPercent}%` }" />
      </view>
      <text class="progress-value">{{ progressPercent }}%</text>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { percent, statusLabel } from '../../utils/admin'

defineOptions({ name: 'AdminProjectCard' })

const props = defineProps({
  project: { type: Object, required: true },
  compact: { type: Boolean, default: false },
  showPeople: { type: Boolean, default: true },
})

defineEmits(['select'])

const statusText = computed(
  () => props.project.statusLabel || statusLabel(props.project.status)
)
const progressPercent = computed(() => percent(props.project.progress))
const foremanText = computed(
  () => props.project.foremanName || (props.project.foreman && props.project.foreman.nickname) || '待分配'
)
const ownerText = computed(() => props.project.ownerName || '待分配')

const toneClass = computed(() => {
  const status = props.project.status
  if (status === 'building') return 'status-pill--building'
  if (status === 'finished') return 'status-pill--finished'
  if (status === 'pending') return 'status-pill--pending'
  return 'status-pill--archived'
})
</script>

<style scoped lang="scss">
/* ── 完整卡片 ── */
.project-card {
  padding: dp(14);
  @include glass-surface(dp(16), 18px);
}

.project-top {
  display: flex;
  align-items: flex-start;
}

.project-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(62);
  height: dp(62);
  margin-right: dp(12);
  border-radius: dp(14);
  background: #f6e7db;
  flex-shrink: 0;
}

.project-thumb-img {
  width: dp(48);
  height: dp(48);
}

.project-main {
  flex: 1;
  min-width: 0;
}

.project-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.project-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #1d2129;
  font-size: dp(16);
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-address {
  display: block;
  margin-top: dp(6);
  overflow: hidden;
  color: #86909c;
  font-size: dp(12);
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: dp(3) dp(8);
  border-radius: dp(999);
  font-size: dp(11);
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  flex-shrink: 0;
}

.status-pill--building {
  background: #fff2ed;
  color: #eb5c20;
}

.status-pill--finished {
  background: #e8f8f0;
  color: #07a336;
}

.status-pill--pending {
  background: #fff7e8;
  color: #a85400;
}

.status-pill--archived {
  background: #f2f3f5;
  color: #86909c;
}

.overdue-pill {
  padding: dp(2) dp(5);
  border-radius: dp(4);
  background: #ffece8;
  color: #b22a26;
  font-size: dp(10);
  font-weight: 600;
  line-height: 1.2;
  flex-shrink: 0;
}

.project-people {
  display: flex;
  align-items: center;
  margin-top: dp(12);
  overflow: hidden;
  color: #4e5969;
  font-size: dp(13);
  white-space: nowrap;
}

.people-item {
  overflow: hidden;
  text-overflow: ellipsis;
}

.people-dot {
  margin: 0 dp(6);
  color: #c9cdd4;
  flex-shrink: 0;
}

.project-progress {
  display: flex;
  align-items: center;
  margin-top: dp(10);
}

.progress-track {
  height: dp(8);
  overflow: hidden;
  border-radius: dp(999);
  background: #f2f3f5;
  flex: 1;
}

.progress-fill {
  height: 100%;
  border-radius: dp(999);
  background: #eb5c20;
  transition: width 360ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.progress-value {
  width: dp(46);
  color: #eb5c20;
  font-size: dp(13);
  font-weight: 700;
  text-align: right;
  flex-shrink: 0;
}

/* ── 最近项目紧凑卡片 ── */
.compact-card {
  display: flex;
  align-items: center;
  padding: dp(13) dp(14);
  @include glass-surface(dp(16), 18px);
}

.compact-main {
  flex: 1;
  min-width: 0;
  margin-left: dp(10);
}

.compact-name {
  display: block;
  overflow: hidden;
  color: #1d2129;
  font-size: dp(15);
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.compact-sub {
  display: block;
  margin-top: dp(4);
  overflow: hidden;
  color: #86909c;
  font-size: dp(12);
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.compact-chevron {
  width: dp(14);
  height: dp(14);
  margin-left: dp(8);
  flex-shrink: 0;
}
</style>
