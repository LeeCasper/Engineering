<template>
  <view class="admin-page">
    <AdminNav title="阶段与工序" :fallback="`/pages/admin/project/detail?id=${projectId}`">
      <template #right>
        <text v-if="canWrite" class="admin-nav-action" @tap="openCreateStage">加阶段</text>
      </template>
    </AdminNav>

    <view class="admin-content">
      <AdminPageState
        :loading="loading && !project"
        :error="error"
        :empty="false"
        @retry="load"
      >
        <template v-if="project">
          <view class="admin-note top-note">
            完成度只能由 C 端进度汇报写入，管理端只读；这里可以维护阶段/工序的名称、权重与计划日期。
          </view>

          <view v-if="!stages.length" class="admin-card">
            <text class="admin-empty-inline">暂无阶段</text>
            <button v-if="canWrite" class="admin-btn admin-btn--block" @tap="openCreateStage">添加阶段</button>
          </view>

          <view v-else class="admin-list">
            <view v-for="stage in stages" :key="stage.id" class="stage-card">
              <view class="stage-head" @tap="toggleStage(stage)">
                <view class="stage-index">{{ stage.seq }}</view>
                <view class="stage-main">
                  <view class="stage-title-row">
                    <text class="stage-name">{{ stage.name }}</text>
                    <text class="admin-badge" :class="gateTone(stage.gateStatus)">{{ gateLabel(stage.gateStatus) }}</text>
                  </view>
                  <text class="stage-meta">
                    进度 {{ percent(stage.progress) }}% · {{ stageRange(stage) }}
                  </text>
                  <view class="stage-progress">
                    <view class="admin-progress-track stage-progress-track">
                      <view class="admin-progress-fill" :style="{ width: `${percent(stage.progress)}%` }" />
                    </view>
                  </view>
                </view>
                <text class="stage-expand">{{ expandedStageId === stage.id ? '收起' : '展开' }}</text>
              </view>

              <view v-if="canWrite" class="stage-actions">
                <text class="stage-action" @tap.stop="openEditStage(stage)">编辑阶段</text>
                <text class="stage-action stage-action--danger" @tap.stop="removeStage(stage)">删除阶段</text>
                <text class="stage-action stage-action--accent" @tap.stop="openCreateItem(stage)">加工序</text>
              </view>

              <view v-if="expandedStageId === stage.id" class="item-list">
                <view v-if="!stage.items.length" class="admin-empty-inline">该阶段还没有工序</view>
                <view v-for="item in stage.items" :key="item.id" class="item-row">
                  <view class="item-main">
                    <view class="item-title-row">
                      <text class="item-name">{{ item.name }}</text>
                      <text class="admin-badge admin-badge--gray">{{ percent(item.progress) }}%</text>
                    </view>
                    <text class="item-meta">{{ itemRange(item) }}</text>
                  </view>
                  <view v-if="canWrite" class="item-actions">
                    <text class="item-action" @tap="openEditItem(stage, item)">编辑</text>
                    <text class="item-action item-action--danger" @tap="removeItem(item)">删除</text>
                  </view>
                </view>
              </view>
            </view>
          </view>
        </template>
      </AdminPageState>
    </view>

    <!-- 阶段表单 -->
    <view v-if="stageSheetOpen" class="admin-sheet-mask" @tap="closeStageSheet">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">{{ stageForm.id ? '编辑阶段' : '新增阶段' }}</text>
            <text class="admin-sheet-sub">完成度不会在这里修改</text>
          </view>
          <view class="admin-sheet-close" @tap="closeStageSheet">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="sheet-form">
          <view class="admin-form-group">
            <text class="admin-form-label">阶段名称</text>
            <input
              v-model="stageForm.name"
              class="admin-input"
              maxlength="50"
              placeholder="例如：水电工程"
              placeholder-class="admin-placeholder"
            />
          </view>

          <view class="admin-form-group">
            <text class="admin-form-label">权重（可选）</text>
            <input
              v-model="stageForm.weight"
              class="admin-input"
              type="digit"
              maxlength="10"
              placeholder="不填则等权"
              placeholder-class="admin-placeholder"
            />
          </view>

          <view class="form-grid">
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">计划开始</text>
              <picker mode="date" :value="stageForm.planStart" @change="stagePlanStart">
                <view class="admin-picker-row">
                  <text :class="stageForm.planStart ? 'admin-picker-value' : 'admin-placeholder'">
                    {{ stageForm.planStart || '选择日期' }}
                  </text>
                </view>
              </picker>
            </view>
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">计划结束</text>
              <picker mode="date" :value="stageForm.planEnd" @change="stagePlanEnd">
                <view class="admin-picker-row">
                  <text :class="stageForm.planEnd ? 'admin-picker-value' : 'admin-placeholder'">
                    {{ stageForm.planEnd || '选择日期' }}
                  </text>
                </view>
              </picker>
            </view>
          </view>

          <template v-if="stageForm.id">
            <view class="form-grid">
              <view class="admin-form-group form-grid-item">
                <text class="admin-form-label">实际开始</text>
                <picker mode="date" :value="stageForm.actualStart" @change="stageActualStart">
                  <view class="admin-picker-row">
                    <text :class="stageForm.actualStart ? 'admin-picker-value' : 'admin-placeholder'">
                      {{ stageForm.actualStart || '未设置' }}
                    </text>
                  </view>
                </picker>
              </view>
              <view class="admin-form-group form-grid-item">
                <text class="admin-form-label">实际结束</text>
                <picker mode="date" :value="stageForm.actualEnd" @change="stageActualEnd">
                  <view class="admin-picker-row">
                    <text :class="stageForm.actualEnd ? 'admin-picker-value' : 'admin-placeholder'">
                      {{ stageForm.actualEnd || '未设置' }}
                    </text>
                  </view>
                </picker>
              </view>
            </view>
          </template>

          <text v-if="stageError" class="form-error">{{ stageError }}</text>

          <view class="admin-sheet-actions">
            <button class="admin-btn admin-btn--ghost" :disabled="stageSaving" @tap="closeStageSheet">取消</button>
            <button
              class="admin-btn"
              :class="{ 'admin-btn--disabled': stageSaving }"
              :disabled="stageSaving"
              @tap="saveStage"
            >
              {{ stageSaving ? '保存中…' : '保存' }}
            </button>
          </view>
        </view>
      </view>
    </view>

    <!-- 工序表单 -->
    <view v-if="itemSheetOpen" class="admin-sheet-mask" @tap="closeItemSheet">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">{{ itemForm.id ? '编辑工序' : '新增工序' }}</text>
            <text class="admin-sheet-sub">{{ itemStageName }}</text>
          </view>
          <view class="admin-sheet-close" @tap="closeItemSheet">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="sheet-form">
          <view class="admin-form-group">
            <text class="admin-form-label">工序名称</text>
            <input
              v-model="itemForm.name"
              class="admin-input"
              maxlength="50"
              placeholder="例如：强电布线"
              placeholder-class="admin-placeholder"
            />
          </view>

          <view class="admin-form-group">
            <text class="admin-form-label">权重（可选）</text>
            <input
              v-model="itemForm.weight"
              class="admin-input"
              type="digit"
              maxlength="10"
              placeholder="不填则等权"
              placeholder-class="admin-placeholder"
            />
          </view>

          <view class="form-grid">
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">计划开始</text>
              <picker mode="date" :value="itemForm.planStart" @change="itemPlanStart">
                <view class="admin-picker-row">
                  <text :class="itemForm.planStart ? 'admin-picker-value' : 'admin-placeholder'">
                    {{ itemForm.planStart || '选择日期' }}
                  </text>
                </view>
              </picker>
            </view>
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">计划结束</text>
              <picker mode="date" :value="itemForm.planEnd" @change="itemPlanEnd">
                <view class="admin-picker-row">
                  <text :class="itemForm.planEnd ? 'admin-picker-value' : 'admin-placeholder'">
                    {{ itemForm.planEnd || '选择日期' }}
                  </text>
                </view>
              </picker>
            </view>
          </view>

          <view v-if="!itemForm.id" class="admin-form-group">
            <text class="admin-form-label">验收项（可选，一行一条）</text>
            <textarea
              v-model="itemForm.checklistText"
              class="admin-textarea"
              maxlength="2000"
              placeholder="例如：强弱电分管分槽，间距 ≥ 30cm"
              placeholder-class="admin-placeholder"
            />
          </view>

          <text v-if="itemError" class="form-error">{{ itemError }}</text>

          <view class="admin-sheet-actions">
            <button class="admin-btn admin-btn--ghost" :disabled="itemSaving" @tap="closeItemSheet">取消</button>
            <button
              class="admin-btn"
              :class="{ 'admin-btn--disabled': itemSaving }"
              :disabled="itemSaving"
              @tap="saveItem"
            >
              {{ itemSaving ? '保存中…' : '保存' }}
            </button>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import {
  fetchAdminProject,
  addAdminStage,
  updateAdminStage,
  deleteAdminStage,
  addAdminItem,
  updateAdminItem,
  deleteAdminItem,
} from '../../../api/admin/project'
import { requireAdminSession, formatDate, percent, showAdminError } from '../../../utils/admin'

defineOptions({ name: 'AdminProjectStagesPage' })

const GATE_LABELS = {
  active: '进行中',
  locked: '未解锁',
  pending_acceptance: '待验收',
  accepted: '已验收',
  settled: '已结清',
  disputed: '结算有异议',
}

const projectId = ref(null)
const project = ref(null)
const loading = ref(false)
const error = ref('')
const expandedStageId = ref(null)

const stageSheetOpen = ref(false)
const stageSaving = ref(false)
const stageError = ref('')
const stageForm = reactive({
  id: null,
  name: '',
  weight: '',
  planStart: '',
  planEnd: '',
  actualStart: '',
  actualEnd: '',
})

const itemSheetOpen = ref(false)
const itemSaving = ref(false)
const itemError = ref('')
const itemStageId = ref(null)
const itemStageName = ref('')
const itemForm = reactive({
  id: null,
  name: '',
  weight: '',
  planStart: '',
  planEnd: '',
  checklistText: '',
})

let loadedOnce = false

const stages = computed(() => (project.value && project.value.stages) || [])
const canWrite = computed(() => Boolean(project.value && project.value.status !== 'archived'))

onLoad(async (options) => {
  const id = options && options.id ? Number(options.id) : null
  projectId.value = Number.isInteger(id) && id > 0 ? id : null
  if (!projectId.value) {
    error.value = '缺少项目 id'
    return
  }
  try {
    await requireAdminSession()
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
    return
  }
  await load()
  loadedOnce = true
})

onShow(() => {
  if (loadedOnce && !stageSheetOpen.value && !itemSheetOpen.value) load(true)
})

onPullDownRefresh(async () => {
  try {
    await load(true)
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function load(silent = false) {
  if (!projectId.value) return
  if (!silent) loading.value = true
  error.value = ''
  try {
    project.value = await fetchAdminProject(projectId.value)
    if (expandedStageId.value && !stages.value.some((stage) => stage.id === expandedStageId.value)) {
      expandedStageId.value = null
    }
  } catch (err) {
    error.value = err.message || '阶段加载失败'
    showAdminError(err, '阶段加载失败')
  } finally {
    loading.value = false
  }
}

function toggleStage(stage) {
  expandedStageId.value = expandedStageId.value === stage.id ? null : stage.id
}

function gateLabel(gate) {
  return GATE_LABELS[gate] || gate || '未知'
}

function gateTone(gate) {
  if (gate === 'settled' || gate === 'accepted') return 'admin-badge--green'
  if (gate === 'pending_acceptance' || gate === 'disputed') return 'admin-badge--orange'
  if (gate === 'active') return 'admin-badge--accent'
  return 'admin-badge--gray'
}

function stageRange(stage) {
  const start = formatDate(stage.planStart)
  const end = formatDate(stage.planEnd)
  if (start && end) return `${start} ~ ${end}`
  if (start) return `${start} 起`
  return '未设置计划日期'
}

function itemRange(item) {
  const start = formatDate(item.planStart)
  const end = formatDate(item.planEnd)
  if (start && end) return `${start} ~ ${end}`
  if (start) return `${start} 起`
  return '未设置计划日期'
}

function openCreateStage() {
  if (!canWrite.value) return
  Object.assign(stageForm, {
    id: null,
    name: '',
    weight: '',
    planStart: '',
    planEnd: '',
    actualStart: '',
    actualEnd: '',
  })
  stageError.value = ''
  stageSheetOpen.value = true
}

function openEditStage(stage) {
  if (!canWrite.value) return
  Object.assign(stageForm, {
    id: stage.id,
    name: stage.name,
    weight: stage.weight || '',
    planStart: formatDate(stage.planStart),
    planEnd: formatDate(stage.planEnd),
    actualStart: formatDate(stage.actualStart),
    actualEnd: formatDate(stage.actualEnd),
  })
  stageError.value = ''
  stageSheetOpen.value = true
}

function closeStageSheet() {
  if (stageSaving.value) return
  stageSheetOpen.value = false
}

function stagePlanStart(event) {
  stageForm.planStart = event.detail.value
}

function stagePlanEnd(event) {
  stageForm.planEnd = event.detail.value
}

function stageActualStart(event) {
  stageForm.actualStart = event.detail.value
}

function stageActualEnd(event) {
  stageForm.actualEnd = event.detail.value
}

function validateStage() {
  if (!stageForm.name.trim()) return '请输入阶段名称'
  if (stageForm.weight && (!/^\d+(\.\d{1,2})?$/.test(stageForm.weight) || Number(stageForm.weight) <= 0)) {
    return '权重必须是大于 0 的数字'
  }
  if (stageForm.planStart && stageForm.planEnd && stageForm.planEnd < stageForm.planStart) {
    return '计划结束日期不得早于开始日期'
  }
  return ''
}

async function saveStage() {
  if (stageSaving.value) return
  stageError.value = validateStage()
  if (stageError.value) return

  const payload = {
    name: stageForm.name.trim(),
    weight: stageForm.weight ? String(stageForm.weight) : null,
    planStart: stageForm.planStart || null,
    planEnd: stageForm.planEnd || null,
  }
  if (stageForm.id) {
    payload.actualStart = stageForm.actualStart || null
    payload.actualEnd = stageForm.actualEnd || null
  }

  stageSaving.value = true
  try {
    if (stageForm.id) {
      await updateAdminStage(projectId.value, stageForm.id, payload)
    } else {
      await addAdminStage(projectId.value, payload)
    }
    uni.showToast({ title: '阶段已保存', icon: 'success' })
    stageSheetOpen.value = false
    await load(true)
  } catch (err) {
    stageError.value = err.message || '保存失败'
    showAdminError(err, '保存失败')
  } finally {
    stageSaving.value = false
  }
}

function removeStage(stage) {
  uni.showModal({
    title: '删除阶段',
    content: `确定删除「${stage.name}」吗？阶段下的工序会一起删除；最后一个阶段不能删除。`,
    confirmText: '删除',
    confirmColor: '#f53f3f',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await deleteAdminStage(projectId.value, stage.id)
        uni.showToast({ title: '已删除', icon: 'success' })
        await load(true)
      } catch (err) {
        showAdminError(err, '删除失败')
      }
    },
  })
}

function openCreateItem(stage) {
  if (!canWrite.value) return
  itemStageId.value = stage.id
  itemStageName.value = stage.name
  Object.assign(itemForm, {
    id: null,
    name: '',
    weight: '',
    planStart: '',
    planEnd: '',
    checklistText: '',
  })
  itemError.value = ''
  itemSheetOpen.value = true
}

function openEditItem(stage, item) {
  if (!canWrite.value) return
  itemStageId.value = stage.id
  itemStageName.value = stage.name
  Object.assign(itemForm, {
    id: item.id,
    name: item.name,
    weight: item.weight || '',
    planStart: formatDate(item.planStart),
    planEnd: formatDate(item.planEnd),
    checklistText: '',
  })
  itemError.value = ''
  itemSheetOpen.value = true
}

function closeItemSheet() {
  if (itemSaving.value) return
  itemSheetOpen.value = false
}

function itemPlanStart(event) {
  itemForm.planStart = event.detail.value
}

function itemPlanEnd(event) {
  itemForm.planEnd = event.detail.value
}

function validateItem() {
  if (!itemForm.name.trim()) return '请输入工序名称'
  if (itemForm.weight && (!/^\d+(\.\d{1,2})?$/.test(itemForm.weight) || Number(itemForm.weight) <= 0)) {
    return '权重必须是大于 0 的数字'
  }
  if (itemForm.planStart && itemForm.planEnd && itemForm.planEnd < itemForm.planStart) {
    return '计划结束日期不得早于开始日期'
  }
  return ''
}

async function saveItem() {
  if (itemSaving.value) return
  itemError.value = validateItem()
  if (itemError.value) return

  itemSaving.value = true
  try {
    if (itemForm.id) {
      await updateAdminItem(projectId.value, itemForm.id, {
        name: itemForm.name.trim(),
        weight: itemForm.weight ? String(itemForm.weight) : null,
        planStart: itemForm.planStart || null,
        planEnd: itemForm.planEnd || null,
      })
    } else {
      const checklist = itemForm.checklistText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      await addAdminItem(projectId.value, itemStageId.value, {
        name: itemForm.name.trim(),
        weight: itemForm.weight ? String(itemForm.weight) : null,
        planStart: itemForm.planStart || null,
        planEnd: itemForm.planEnd || null,
        ...(checklist.length ? { checklist } : {}),
      })
    }
    uni.showToast({ title: '工序已保存', icon: 'success' })
    itemSheetOpen.value = false
    await load(true)
  } catch (err) {
    itemError.value = err.message || '保存失败'
    showAdminError(err, '保存失败')
  } finally {
    itemSaving.value = false
  }
}

function removeItem(item) {
  uni.showModal({
    title: '删除工序',
    content: `确定删除「${item.name}」吗？每个阶段最后一个工序不能删除。`,
    confirmText: '删除',
    confirmColor: '#f53f3f',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await deleteAdminItem(projectId.value, item.id)
        uni.showToast({ title: '已删除', icon: 'success' })
        await load(true)
      } catch (err) {
        showAdminError(err, '删除失败')
      }
    },
  })
}
</script>

<style scoped lang="scss">
.admin-nav-action {
  padding: dp(4) dp(2);
  color: #eb5c20;
  font-size: dp(13);
  font-weight: 500;
}

.top-note {
  margin: dp(10) 0 dp(12);
}

.stage-card {
  padding: dp(13);
  border: 1px solid #f0eae4;
  border-radius: dp(12);
  background: #fff;
}

.stage-head {
  display: flex;
  align-items: flex-start;
}

.stage-index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(24);
  height: dp(24);
  margin-right: dp(9);
  border-radius: dp(7);
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 700;
  flex-shrink: 0;
}

.stage-main {
  flex: 1;
  min-width: 0;
}

.stage-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.stage-name {
  color: #241c17;
  font-size: dp(14);
  font-weight: 600;
}

.stage-meta {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}

.stage-progress {
  margin-top: dp(6);
}

.stage-progress-track {
  height: dp(5);
}

.stage-expand {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(10);
  white-space: nowrap;
  flex-shrink: 0;
}

.stage-actions {
  display: flex;
  justify-content: flex-end;
  gap: dp(12);
  margin-top: dp(10);
}

.stage-action {
  color: #51463e;
  font-size: dp(11);
}

.stage-action--accent {
  color: #eb5c20;
}

.stage-action--danger {
  color: #f53f3f;
}

.item-list {
  margin-top: dp(10);
  padding-top: dp(4);
  border-top: 1px solid #f8f4ef;
}

.item-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: dp(9) 0;
  border-bottom: 1px solid #f8f4ef;
}

.item-row:last-child {
  border-bottom: none;
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: dp(5);
}

.item-name {
  color: #241c17;
  font-size: dp(12);
  font-weight: 500;
}

.item-meta {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(9);
}

.item-actions {
  display: flex;
  gap: dp(8);
  margin-left: dp(8);
  flex-shrink: 0;
}

.item-action {
  color: #eb5c20;
  font-size: dp(10);
}

.item-action--danger {
  color: #f53f3f;
}

.form-grid {
  display: flex;
  gap: dp(10);
}

.form-grid-item {
  flex: 1;
  min-width: 0;
}

.sheet-form {
  padding-top: dp(12);
}

.form-error {
  display: block;
  margin: dp(2) 0 dp(10);
  color: #f53f3f;
  font-size: dp(11);
  line-height: 1.5;
}
</style>
