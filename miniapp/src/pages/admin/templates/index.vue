<template>
  <view class="admin-page admin-page--cool template-page">
    <AdminNav
      title="阶段模板"
      fallback="/pages/admin/profile/index"
      background="#F6F7F9"
      glass
    >
      <template #right>
        <view class="new-pill" @tap="openCreate">
          <text class="new-plus">+</text>
          <text>新建模板</text>
        </view>
      </template>
    </AdminNav>

    <view class="content">
      <AdminPageState
        :loading="initialLoading && !detail"
        :error="initialError"
        :empty="!initialLoading && !initialError && !detail && !templates.length"
        empty-title="还没有阶段模板"
        empty-text="新建模板后，创建项目时可以直接套用阶段与工序。"
        @retry="loadInitial"
      >
        <template #empty-action>
          <view class="empty-action" @tap="openCreate">新建模板</view>
        </template>

        <template v-if="detail">
          <!-- 模板概览 -->
          <view class="template-card" @tap="openPicker">
            <view class="template-icon">
              <image
                class="template-icon-img"
                src="/static/images/icon-admin-stage-accent.png"
                mode="aspectFit"
              />
            </view>
            <view class="template-main">
              <view class="template-title-row">
                <text class="template-name">{{ detail.name }}</text>
                <text v-if="detail.isDefault" class="default-badge">默认模板</text>
              </view>
              <text class="template-meta">
                {{ detail.stages.length }} 个阶段 · {{ itemCount }} 道工序
              </text>
              <text class="template-meta">
                已被 {{ detail.referencingProjectCount }} 个项目引用
              </text>
            </view>
            <image class="template-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>

          <!-- 阶段结构 -->
          <view class="section-head">
            <text class="section-title">阶段结构</text>
            <view class="section-link" @tap="openPreview">
              <text>预览</text>
              <text class="section-link-arrow">›</text>
            </view>
          </view>

          <view v-if="detail.stages.length" class="stage-list gc-stagger">
            <view
              v-for="stage in detail.stages"
              :key="stage.id"
              class="stage-card"
              @tap="openStage(stage)"
            >
              <view class="stage-index">{{ seqText(stage.seq) }}</view>
              <view class="stage-main">
                <text class="stage-name">{{ stage.name }}</text>
                <text class="stage-meta">
                  {{ stage.items.length }} 个工序 · 计划工期 {{ stage.planDays }} 天
                </text>
              </view>
              <image class="stage-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>
          </view>
          <view v-else class="empty-inline">该模板还没有阶段</view>

          <view class="notice-card">
            <text class="notice-title">编辑提示</text>
            <text class="notice-text">
              模板修改不会影响已创建的项目；已被引用的模板无法删除，保存前请检查阶段和工序顺序。
            </text>
          </view>
        </template>
      </AdminPageState>
    </view>

    <!-- 选择模板 -->
    <view v-if="pickerOpen" class="admin-sheet-mask" @tap="pickerOpen = false">
      <view class="admin-sheet picker-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">选择模板</text>
            <text class="admin-sheet-sub">当前租户下可用的阶段模板</text>
          </view>
          <view class="admin-sheet-close" @tap="pickerOpen = false">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="picker-search">
          <image class="picker-search-icon" src="/static/images/icon-search.png" mode="aspectFit" />
          <input
            v-model="pickerKeyword"
            class="picker-search-input"
            confirm-type="search"
            placeholder="搜索模板名称"
            placeholder-class="picker-placeholder"
            @input="onPickerKeyword"
          />
        </view>

        <gc-loading v-if="pickerLoading && !pickerTemplates.length" text="加载中" />
        <text v-else-if="pickerError" class="picker-error">{{ pickerError }}</text>
        <view v-else class="picker-list">
          <view
            v-for="template in pickerTemplates"
            :key="template.id"
            class="picker-row"
            :class="{ 'picker-row--active': detail && detail.id === template.id }"
            @tap="chooseTemplate(template)"
          >
            <view class="picker-main">
              <view class="picker-title-row">
                <text class="picker-name">{{ template.name }}</text>
                <text v-if="template.isDefault" class="default-badge">默认</text>
              </view>
              <text class="picker-meta">
                {{ template.stageCount }} 个阶段 · {{ template.itemCount }} 道工序 ·
                {{ template.referencingProjectCount }} 个项目引用
              </text>
            </view>
            <text v-if="detail && detail.id === template.id" class="picker-current">当前</text>
            <image v-else class="picker-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>

          <view v-if="!pickerTemplates.length" class="picker-empty">没有符合条件的模板</view>
          <view v-if="pickerTemplates.length < pickerTotal" class="picker-more" @tap="loadMoreTemplates">
            {{ pickerLoadingMore ? '加载中…' : '加载更多' }}
          </view>
        </view>
      </view>
    </view>

    <!-- 模板预览 -->
    <view v-if="previewOpen" class="admin-sheet-mask" @tap="previewOpen = false">
      <view class="admin-sheet preview-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">{{ detail ? detail.name : '模板预览' }}</text>
            <text class="admin-sheet-sub">
              {{ detail ? detail.stages.length : 0 }} 个阶段 · {{ itemCount }} 道工序 ·
              已被 {{ detail ? detail.referencingProjectCount : 0 }} 个项目引用
            </text>
          </view>
          <view class="admin-sheet-close" @tap="previewOpen = false">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="preview-body">
          <view v-for="stage in previewStages" :key="stage.id" class="preview-stage">
            <view class="preview-stage-head">
              <text class="preview-stage-seq">{{ seqText(stage.seq) }}</text>
              <text class="preview-stage-name">{{ stage.name }}</text>
              <text class="preview-stage-days">计划 {{ stage.planDays }} 天</text>
            </view>
            <view class="preview-items">
              <view v-for="item in stage.items" :key="item.id" class="preview-item">
                <text class="preview-item-dot" />
                <text class="preview-item-name">{{ item.name }}</text>
                <text v-if="item.checklist && item.checklist.length" class="preview-item-check">
                  {{ item.checklist.length }} 项验收
                </text>
              </view>
              <text v-if="!stage.items.length" class="preview-item-empty">暂无工序</text>
            </view>
          </view>
          <view v-if="!previewStages.length" class="empty-inline">该模板还没有阶段</view>
        </view>

        <view class="preview-actions">
          <button class="admin-btn admin-btn--ghost" @tap="openEditFromPreview">编辑模板</button>
        </view>
      </view>
    </view>

    <!-- 阶段预览 -->
    <view v-if="stageSheetOpen && stageSheetStage" class="admin-sheet-mask" @tap="stageSheetOpen = false">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">{{ stageSheetStage.name }}</text>
            <text class="admin-sheet-sub">
              {{ stageSheetStage.items.length }} 个工序 · 计划工期 {{ stageSheetStage.planDays }} 天
            </text>
          </view>
          <view class="admin-sheet-close" @tap="stageSheetOpen = false">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="stage-sheet-list">
          <view v-for="item in stageSheetStage.items" :key="item.id" class="stage-sheet-item">
            <view class="stage-sheet-item-main">
              <text class="stage-sheet-item-name">{{ item.name }}</text>
              <text v-if="item.checklist && item.checklist.length" class="stage-sheet-item-check">
                {{ item.checklist.length }} 项验收
              </text>
            </view>
          </view>
          <view v-if="!stageSheetStage.items.length" class="empty-inline">该阶段还没有工序</view>
        </view>
      </view>
    </view>

    <!-- 新建 / 编辑模板 -->
    <view v-if="formOpen" class="admin-sheet-mask" @tap="closeForm">
      <view class="admin-sheet form-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">{{ formMode === 'create' ? '新建模板' : '编辑模板' }}</text>
            <text class="admin-sheet-sub">
              {{ formMode === 'edit' && formReferencingCount > 0
                ? `该模板已被 ${formReferencingCount} 个项目引用，修改不会影响已生成的项目`
                : '阶段与工序会作为项目阶段的初始结构' }}
            </text>
          </view>
          <view class="admin-sheet-close" @tap="closeForm">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="form-body">
          <view class="admin-form-group">
            <text class="admin-form-label">模板名称</text>
            <input
              v-model="form.name"
              class="admin-input"
              maxlength="50"
              placeholder="例如：家装标准施工模板"
              placeholder-class="admin-placeholder"
            />
          </view>

          <view class="form-switch-row">
            <view class="form-switch-main">
              <text class="form-switch-title">设为默认模板</text>
              <text class="form-switch-sub">新建项目未指定模板时使用</text>
            </view>
            <switch :checked="form.isDefault" color="#EB5C20" @change="onDefaultChange" />
          </view>

          <view class="form-stage-head">
            <text class="form-stage-title">阶段与工序</text>
            <text class="form-stage-count">{{ form.stages.length }} 个阶段</text>
          </view>
          <text class="form-preserve-hint">
            小程序只编辑阶段名、计划工期与工序名；权重与验收项清单按原位置保留，可在网页后台继续维护。
          </text>

          <view v-for="(stage, index) in form.stages" :key="stage.key" class="form-stage">
            <view class="form-stage-top">
              <text class="form-stage-index">阶段 {{ seqText(index + 1) }}</text>
              <text
                v-if="form.stages.length > 1"
                class="form-stage-remove"
                @tap="removeFormStage(index)"
              >
                删除
              </text>
            </view>

            <view class="admin-form-group form-field">
              <text class="admin-form-label">阶段名称</text>
              <input
                v-model="stage.name"
                class="admin-input"
                maxlength="50"
                placeholder="例如：水电工程"
                placeholder-class="admin-placeholder"
              />
            </view>

            <view class="admin-form-group form-field">
              <text class="admin-form-label">计划工期（天）</text>
              <input
                v-model="stage.planDays"
                class="admin-input"
                type="number"
                placeholder="例如：20"
                placeholder-class="admin-placeholder"
              />
            </view>

            <view class="admin-form-group form-field">
              <text class="admin-form-label">工序（每行一个）</text>
              <textarea
                v-model="stage.itemsText"
                class="admin-textarea form-items"
                maxlength="2000"
                placeholder="每行一个工序"
                placeholder-class="admin-placeholder"
              />
            </view>
          </view>

          <view class="add-stage" @tap="addFormStage">+ 添加阶段</view>

          <view
            v-if="formMode === 'edit' && formReferencingCount === 0"
            class="delete-template"
            @tap="removeTemplate"
          >
            删除模板
          </view>

          <text v-if="formError" class="form-error">{{ formError }}</text>

          <view class="admin-sheet-actions">
            <button class="admin-btn admin-btn--ghost" @tap="closeForm">取消</button>
            <button
              class="admin-btn"
              :class="{ 'admin-btn--disabled': formSubmitting }"
              :disabled="formSubmitting"
              @tap="submitForm"
            >
              {{ formSubmitting ? '保存中…' : '保存模板' }}
            </button>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import {
  fetchAdminTemplates,
  fetchAdminTemplate,
  createAdminTemplate,
  updateAdminTemplate,
  deleteAdminTemplate,
} from '../../../api/admin/project'
import { requireAdminSession, showAdminError } from '../../../utils/admin'

defineOptions({ name: 'AdminTemplatesPage' })

const PAGE_SIZE = 20

const templates = ref([])
const detail = ref(null)
const initialLoading = ref(false)
const initialError = ref('')
let loadedOnce = false

// 模板选择
const pickerOpen = ref(false)
const pickerTemplates = ref([])
const pickerTotal = ref(0)
const pickerPage = ref(1)
const pickerTotalPages = ref(1)
const pickerKeyword = ref('')
const pickerLoading = ref(false)
const pickerLoadingMore = ref(false)
const pickerError = ref('')
let pickerSeq = 0
let pickerTimer = null

// 预览
const previewOpen = ref(false)
const stageSheetOpen = ref(false)
const stageSheetStage = ref(null)

// 新建 / 编辑
const formOpen = ref(false)
const formMode = ref('create')
const formSubmitting = ref(false)
const formError = ref('')
const formReferencingCount = ref(0)
let editingId = null
const form = reactive({ name: '', isDefault: false, stages: [] })

const itemCount = computed(() =>
  detail.value
    ? detail.value.stages.reduce((total, stage) => total + stage.items.length, 0)
    : 0
)

const previewStages = computed(() => (detail.value ? detail.value.stages : []))

onLoad(async () => {
  try {
    const profile = await requireAdminSession()
    if (!profile) return
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
    return
  }
  await loadInitial()
  loadedOnce = true
})

onPullDownRefresh(async () => {
  try {
    if (loadedOnce) {
      if (detail.value) {
        await loadDetail(detail.value.id, { silent: true })
        await loadTemplateList()
      } else {
        await loadInitial()
      }
    }
  } finally {
    uni.stopPullDownRefresh()
  }
})

function seqText(value) {
  return String(value || 0).padStart(2, '0')
}

async function loadInitial() {
  initialLoading.value = true
  initialError.value = ''
  try {
    const list = await loadTemplateList()
    templates.value = list
    if (!list.length) {
      detail.value = null
      return
    }
    const preferred = list.find((item) => item.isDefault) || list[0]
    await loadDetail(preferred.id)
  } catch (err) {
    initialError.value = err.message || '模板加载失败'
    showAdminError(err, '模板加载失败')
  } finally {
    initialLoading.value = false
  }
}

async function loadTemplateList() {
  const data = await fetchAdminTemplates({ page: 1, pageSize: 50 })
  return (data && data.list) || []
}

async function loadDetail(id, { silent = false } = {}) {
  try {
    const data = await fetchAdminTemplate(id)
    detail.value = data
    if (!silent) initialError.value = ''
  } catch (err) {
    if (!silent) initialError.value = err.message || '模板加载失败'
    showAdminError(err, '模板加载失败')
  }
}

// ── 模板选择 ──────────────────────────────────────────────

function openPicker() {
  pickerOpen.value = true
  pickerKeyword.value = ''
  loadPicker(true)
}

function onPickerKeyword() {
  if (pickerTimer) clearTimeout(pickerTimer)
  pickerTimer = setTimeout(() => {
    pickerTimer = null
    loadPicker(true)
  }, 320)
}

async function loadPicker(reset = false) {
  if (!reset && (pickerLoading.value || pickerLoadingMore.value || pickerPage.value >= pickerTotalPages.value)) {
    return
  }

  const seq = ++pickerSeq
  if (reset) {
    pickerLoading.value = true
    pickerError.value = ''
    pickerPage.value = 1
  } else {
    pickerLoadingMore.value = true
  }

  try {
    const data = await fetchAdminTemplates({
      page: reset ? 1 : pickerPage.value + 1,
      pageSize: PAGE_SIZE,
      keyword: pickerKeyword.value.trim() || undefined,
    })
    if (seq !== pickerSeq) return

    const list = (data && data.list) || []
    pickerTemplates.value = reset ? list : pickerTemplates.value.concat(list)
    pickerTotal.value = (data && data.total) || 0
    pickerPage.value = (data && data.page) || 1
    pickerTotalPages.value = (data && data.totalPages) || 1
  } catch (err) {
    if (seq !== pickerSeq) return
    pickerError.value = err.message || '模板加载失败'
  } finally {
    if (seq === pickerSeq) {
      pickerLoading.value = false
      pickerLoadingMore.value = false
    }
  }
}

function loadMoreTemplates() {
  loadPicker(false)
}

function chooseTemplate(template) {
  pickerOpen.value = false
  if (!template || !template.id) return
  if (detail.value && detail.value.id === template.id) return
  loadDetail(template.id)
}

// ── 预览 ──────────────────────────────────────────────────

function openPreview() {
  if (!detail.value) return
  previewOpen.value = true
}

function openStage(stage) {
  stageSheetStage.value = stage
  stageSheetOpen.value = true
}

function openEditFromPreview() {
  previewOpen.value = false
  openEdit()
}

// ── 新建 / 编辑 ───────────────────────────────────────────

let formKey = 0

function blankStage() {
  formKey += 1
  return {
    key: formKey,
    name: '',
    planDays: 7,
    itemsText: '',
    weight: null,
    sourceItems: [],
  }
}

function openCreate() {
  formMode.value = 'create'
  editingId = null
  formReferencingCount.value = 0
  form.name = ''
  form.isDefault = false
  form.stages = [blankStage()]
  formError.value = ''
  formOpen.value = true
}

function openEdit() {
  if (!detail.value) return
  formMode.value = 'edit'
  editingId = detail.value.id
  formReferencingCount.value = detail.value.referencingProjectCount || 0
  form.name = detail.value.name
  form.isDefault = Boolean(detail.value.isDefault)
  form.stages = detail.value.stages.map((stage) => ({
    key: (formKey += 1),
    name: stage.name,
    planDays: Number(stage.planDays) || 7,
    itemsText: stage.items.map((item) => item.name).join('\n'),
    // 小程序不展示权重与验收项清单，但保存时必须按原位置带回，
    // 否则一次改名就会把它们清空
    weight: stage.weight,
    sourceItems: stage.items.map((item) => ({
      weight: item.weight,
      checklist: Array.isArray(item.checklist) ? [...item.checklist] : [],
    })),
  }))
  if (!form.stages.length) form.stages = [blankStage()]
  formError.value = ''
  formOpen.value = true
}

function closeForm() {
  if (formSubmitting.value) return
  formOpen.value = false
}

function onDefaultChange(event) {
  form.isDefault = Boolean(event && event.detail && event.detail.value)
}

function addFormStage() {
  form.stages.push(blankStage())
}

function removeFormStage(index) {
  if (form.stages.length <= 1) {
    uni.showToast({ title: '模板至少需要 1 个阶段', icon: 'none' })
    return
  }
  form.stages.splice(index, 1)
}

function buildFormPayload() {
  const name = form.name.trim()
  if (!name) return { error: '请输入模板名称' }
  if (!form.stages.length) return { error: '模板至少需要 1 个阶段' }

  const stages = []
  for (let index = 0; index < form.stages.length; index += 1) {
    const stage = form.stages[index]
    const stageName = String(stage.name || '').trim()
    if (!stageName) return { error: `请填写第 ${index + 1} 个阶段的名称` }

    const planDays = Number(stage.planDays)
    if (!Number.isInteger(planDays) || planDays <= 0) {
      return { error: `第 ${index + 1} 个阶段的计划工期必须是正整数` }
    }

    const itemNames = String(stage.itemsText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (!itemNames.length) return { error: `第 ${index + 1} 个阶段至少需要 1 个工序` }

    const items = itemNames.map((itemName, itemIndex) => {
      const source = stage.sourceItems && stage.sourceItems[itemIndex]
      const item = {
        name: itemName,
        checklist: source && Array.isArray(source.checklist) ? source.checklist : [],
      }
      if (source && source.weight !== null && source.weight !== undefined) {
        item.weight = source.weight
      }
      return item
    })

    const payloadStage = { name: stageName, planDays, items }
    if (stage.weight !== null && stage.weight !== undefined) {
      payloadStage.weight = stage.weight
    }
    stages.push(payloadStage)
  }

  return { payload: { name, isDefault: form.isDefault, stages } }
}

async function submitForm() {
  if (formSubmitting.value) return

  const built = buildFormPayload()
  if (built.error) {
    formError.value = built.error
    return
  }

  formSubmitting.value = true
  formError.value = ''
  try {
    const result =
      formMode.value === 'create'
        ? await createAdminTemplate(built.payload)
        : await updateAdminTemplate(editingId, built.payload)

    const savedId = (result && result.id) || editingId
    uni.showToast({ title: '模板已保存', icon: 'success' })
    formOpen.value = false

    // 保存已经成功；列表刷新失败不应再提示「保存失败」
    try {
      templates.value = await loadTemplateList()
    } catch (err) {
      // 列表只是辅助状态，主内容以详情为准
    }
    if (savedId) await loadDetail(savedId)
  } catch (err) {
    formError.value = err.message || '保存失败'
    showAdminError(err, '保存失败')
  } finally {
    formSubmitting.value = false
  }
}

function removeTemplate() {
  if (!editingId) return
  uni.showModal({
    title: '删除模板',
    content: `确定删除「${form.name}」吗？删除后不可恢复。`,
    confirmText: '删除',
    confirmColor: '#f53f3f',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await deleteAdminTemplate(editingId)
        uni.showToast({ title: '模板已删除', icon: 'success' })
        formOpen.value = false
      } catch (err) {
        showAdminError(err, '删除失败')
        return
      }

      try {
        const list = await loadTemplateList()
        templates.value = list
        const preferred = list.find((item) => item.isDefault) || list[0]
        if (preferred) await loadDetail(preferred.id)
        else detail.value = null
      } catch (err) {
        detail.value = null
        initialError.value = err.message || '模板列表刷新失败'
      }
    },
  })
}
</script>

<style scoped lang="scss">
.new-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: dp(30);
  padding: 0 dp(12);
  border: 1px solid rgba(255, 255, 255, 0.76);
  border-radius: dp(999);
  background: linear-gradient(
    135deg,
    rgba(255, 243, 236, 0.94) 0%,
    rgba(255, 227, 214, 0.74) 100%
  );
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  backdrop-filter: blur(14px) saturate(170%);
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 600;
  white-space: nowrap;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.new-plus {
  margin-right: dp(4);
  font-size: dp(14);
  font-weight: 700;
  line-height: 1;
}

.content {
  padding: dp(4) dp(16) dp(24);
}

.template-card {
  display: flex;
  align-items: flex-start;
  padding: dp(16);
  @include glass-surface(dp(16), 20px);
}

.template-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(48);
  height: dp(48);
  margin-right: dp(14);
  border-radius: dp(12);
  background: #fdf2ec;
  flex-shrink: 0;
}

.template-icon-img {
  width: dp(24);
  height: dp(24);
}

.template-main {
  flex: 1;
  min-width: 0;
}

.template-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.template-name {
  overflow: hidden;
  color: #1d2129;
  font-size: dp(16);
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.default-badge {
  padding: dp(2) dp(7);
  border-radius: dp(999);
  background: #ebf7f1;
  color: #2ea675;
  font-size: dp(10);
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  flex-shrink: 0;
}

.template-meta {
  display: block;
  margin-top: dp(5);
  color: #8f959e;
  font-size: dp(12);
  line-height: 1.3;
}

.template-chevron {
  width: dp(14);
  height: dp(14);
  margin-top: dp(16);
  margin-left: dp(8);
  opacity: 0.55;
  flex-shrink: 0;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 dp(2);
  margin-top: dp(18);
  margin-bottom: dp(10);
}

.section-title {
  color: #1d2129;
  font-size: dp(17);
  font-weight: 700;
}

.section-link {
  display: flex;
  align-items: center;
  color: #eb5c20;
  font-size: dp(12);
}

.section-link-arrow {
  margin-left: dp(2);
  font-size: dp(14);
  font-weight: 700;
  line-height: 1;
}

.stage-list {
  display: flex;
  flex-direction: column;
  gap: dp(10);
}

.stage-card {
  display: flex;
  align-items: center;
  padding: dp(14);
  @include glass-surface(dp(16), 18px);
}

.stage-index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(40);
  height: dp(40);
  margin-right: dp(12);
  border-radius: dp(12);
  background: #fdf2ec;
  color: #eb5c20;
  font-size: dp(15);
  font-weight: 700;
  flex-shrink: 0;
}

.stage-main {
  flex: 1;
  min-width: 0;
}

.stage-name {
  display: block;
  overflow: hidden;
  color: #1d2129;
  font-size: dp(14);
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.stage-meta {
  display: block;
  margin-top: dp(4);
  overflow: hidden;
  color: #8f959e;
  font-size: dp(12);
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.stage-chevron {
  width: dp(14);
  height: dp(14);
  margin-left: dp(8);
  opacity: 0.55;
  flex-shrink: 0;
}

.empty-inline {
  padding: dp(20) 0;
  color: #8f959e;
  font-size: dp(12);
  text-align: center;
}

.notice-card {
  margin-top: dp(16);
  padding: dp(16);
  @include glass-surface(dp(16), 18px);
  background: linear-gradient(
    135deg,
    rgba(255, 246, 241, 0.9) 0%,
    rgba(255, 236, 226, 0.68) 100%
  );
}

.notice-title {
  display: block;
  color: #eb5c20;
  font-size: dp(13);
  font-weight: 700;
}

.notice-text {
  display: block;
  margin-top: dp(6);
  color: #9b8c85;
  font-size: dp(12);
  line-height: 1.6;
}

.empty-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: dp(38);
  padding: 0 dp(18);
  margin-top: dp(14);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(13);
  font-weight: 600;
}

/* ── 模板选择 ── */
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
  padding: 0 dp(12);
  border-radius: dp(12);
  background: #f6f7f9;
  flex-shrink: 0;
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

.picker-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.picker-row {
  display: flex;
  align-items: center;
  padding: dp(14) dp(2);
  border-bottom: 1px solid #f2f3f5;
}

.picker-row--active {
  background: #fffaf7;
}

.picker-main {
  flex: 1;
  min-width: 0;
}

.picker-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.picker-name {
  overflow: hidden;
  color: #1d2129;
  font-size: dp(14);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.picker-meta {
  display: block;
  margin-top: dp(4);
  overflow: hidden;
  color: #8f959e;
  font-size: dp(11);
  white-space: nowrap;
  text-overflow: ellipsis;
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

.picker-chevron {
  width: dp(13);
  height: dp(13);
  margin-left: dp(8);
  opacity: 0.55;
  flex-shrink: 0;
}

.picker-empty,
.picker-error {
  display: block;
  padding: dp(28) 0;
  color: #8f959e;
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

/* ── 预览 ── */
.preview-sheet {
  display: flex;
  flex-direction: column;
  max-height: 82vh;
}

.preview-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: dp(4);
}

.preview-stage {
  padding: dp(12) 0;
  border-bottom: 1px solid #f2f3f5;
}

.preview-stage:last-child {
  border-bottom: none;
}

.preview-stage-head {
  display: flex;
  align-items: center;
}

.preview-stage-seq {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(28);
  height: dp(28);
  margin-right: dp(9);
  border-radius: dp(8);
  background: #fdf2ec;
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 700;
  flex-shrink: 0;
}

.preview-stage-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #1d2129;
  font-size: dp(14);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.preview-stage-days {
  margin-left: dp(8);
  color: #8f959e;
  font-size: dp(11);
  flex-shrink: 0;
}

.preview-items {
  margin-top: dp(8);
  padding-left: dp(37);
}

.preview-item {
  display: flex;
  align-items: center;
  padding: dp(4) 0;
}

.preview-item-dot {
  width: dp(4);
  height: dp(4);
  margin-right: dp(8);
  border-radius: 50%;
  background: #c9cdd4;
  flex-shrink: 0;
}

.preview-item-name {
  flex: 1;
  min-width: 0;
  color: #4e5969;
  font-size: dp(12);
  line-height: 1.4;
}

.preview-item-check {
  margin-left: dp(8);
  color: #8f959e;
  font-size: dp(10);
  flex-shrink: 0;
}

.preview-item-empty {
  display: block;
  padding: dp(4) 0;
  color: #a79c92;
  font-size: dp(11);
}

.preview-actions {
  padding-top: dp(14);
  border-top: 1px solid #f2f3f5;
}

.stage-sheet-list {
  padding-top: dp(6);
}

.stage-sheet-item {
  display: flex;
  align-items: center;
  padding: dp(12) dp(2);
  border-bottom: 1px solid #f2f3f5;
}

.stage-sheet-item:last-child {
  border-bottom: none;
}

.stage-sheet-item-main {
  flex: 1;
  min-width: 0;
}

.stage-sheet-item-name {
  display: block;
  color: #1d2129;
  font-size: dp(13);
  font-weight: 500;
}

.stage-sheet-item-check {
  display: block;
  margin-top: dp(3);
  color: #8f959e;
  font-size: dp(10);
}

/* ── 新建 / 编辑 ── */
.form-sheet {
  max-height: 88vh;
}

.form-body {
  padding-top: dp(4);
}

.form-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(12) 0;
  border-bottom: 1px solid #f2f3f5;
}

.form-switch-main {
  flex: 1;
  min-width: 0;
}

.form-switch-title {
  display: block;
  color: #1d2129;
  font-size: dp(13);
  font-weight: 600;
}

.form-switch-sub {
  display: block;
  margin-top: dp(3);
  color: #8f959e;
  font-size: dp(10);
}

.form-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: dp(16);
  margin-bottom: dp(8);
}

.form-stage-title {
  color: #1d2129;
  font-size: dp(14);
  font-weight: 700;
}

.form-stage-count {
  color: #8f959e;
  font-size: dp(11);
}

.form-preserve-hint {
  display: block;
  margin-bottom: dp(10);
  color: #a79c92;
  font-size: dp(10);
  line-height: 1.6;
}

.form-stage {
  margin-bottom: dp(12);
  padding: dp(12);
  border: 1px solid #f0f2f5;
  border-radius: dp(14);
  background: #f9fafb;
}

.form-stage-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(4);
}

.form-stage-index {
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 700;
}

.form-stage-remove {
  padding: dp(2) dp(4);
  color: #f53f3f;
  font-size: dp(11);
}

.form-field {
  margin-bottom: dp(10);
}

.form-field:last-child {
  margin-bottom: 0;
}

.form-items {
  min-height: dp(74);
}

.add-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(40);
  margin-top: dp(2);
  border: 1px dashed #f6c5ae;
  border-radius: dp(10);
  background: #fffaf7;
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 500;
}

.delete-template {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(38);
  margin-top: dp(10);
  color: #f53f3f;
  font-size: dp(12);
}

.form-error {
  display: block;
  margin-top: dp(10);
  color: #f53f3f;
  font-size: dp(11);
  line-height: 1.5;
}
</style>
