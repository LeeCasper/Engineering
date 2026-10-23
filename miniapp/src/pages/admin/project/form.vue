<template>
  <view class="admin-page">
    <AdminNav :title="isEdit ? '编辑项目' : '新建项目'" fallback="/pages/admin/projects/index" />

    <view class="admin-content">
      <view v-if="loading" class="admin-card">
        <gc-loading text="正在加载…" />
      </view>

      <view v-else-if="loadError" class="admin-card">
        <text class="admin-muted">{{ loadError }}</text>
        <button class="admin-btn admin-btn--ghost admin-btn--block retry-btn" @tap="loadProject">重新加载</button>
      </view>

      <template v-else>
        <view class="admin-card">
          <view class="admin-section-head">
            <view>
              <text class="admin-section-title">基础信息</text>
              <text class="admin-section-sub">项目名、地址与合同金额会同步到网页后台</text>
            </view>
          </view>

          <view class="admin-form-group">
            <text class="admin-form-label">项目名称</text>
            <input
              v-model="form.name"
              class="admin-input"
              maxlength="50"
              placeholder="例如：阳光花园 3 栋 1201"
              placeholder-class="admin-placeholder"
            />
          </view>

          <view class="admin-form-group">
            <text class="admin-form-label">项目地址</text>
            <input
              v-model="form.address"
              class="admin-input"
              maxlength="200"
              placeholder="请输入详细地址"
              placeholder-class="admin-placeholder"
            />
            <text class="admin-form-hint">地址解析坐标失败时仍可保存，坐标可在网页后台手工拾取。</text>
          </view>

          <view class="form-grid">
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">合同金额</text>
              <input
                v-model="form.contractAmount"
                class="admin-input"
                type="digit"
                maxlength="20"
                placeholder="例如 200000"
                placeholder-class="admin-placeholder"
              />
            </view>
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">面积（可选）</text>
              <input
                v-model="form.area"
                class="admin-input"
                type="digit"
                maxlength="20"
                placeholder="例如 120.5"
                placeholder-class="admin-placeholder"
              />
            </view>
          </view>

          <view class="form-grid">
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">开工日期</text>
              <picker mode="date" :value="form.startDate" @change="onStartDate">
                <view class="admin-picker-row">
                  <text :class="form.startDate ? 'admin-picker-value' : 'admin-placeholder'">
                    {{ form.startDate || '选择日期' }}
                  </text>
                </view>
              </picker>
            </view>
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">计划竣工</text>
              <picker mode="date" :value="form.planEndDate" @change="onPlanEndDate">
                <view class="admin-picker-row">
                  <text :class="form.planEndDate ? 'admin-picker-value' : 'admin-placeholder'">
                    {{ form.planEndDate || '选择日期' }}
                  </text>
                </view>
              </picker>
            </view>
          </view>

          <view v-if="!isEdit" class="admin-form-group">
            <text class="admin-form-label">阶段模板</text>
            <view class="admin-picker-row" @tap="openTemplateSheet">
              <text :class="selectedTemplateName ? 'admin-picker-value' : 'admin-placeholder'">
                {{ selectedTemplateName || (templatesLoading ? '加载中…' : '使用默认模板') }}
              </text>
              <image class="picker-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>
            <text class="admin-form-hint">模板决定项目生成哪些阶段与工序；模板编辑仍在网页后台。</text>
          </view>

          <view class="admin-form-group">
            <text class="admin-form-label">备注（可选）</text>
            <textarea
              v-model="form.remark"
              class="admin-textarea"
              maxlength="500"
              placeholder="补充说明"
              placeholder-class="admin-placeholder"
            />
          </view>
        </view>

        <text v-if="error" class="form-error">{{ error }}</text>

        <button
          class="admin-btn admin-btn--block save-btn"
          :class="{ 'admin-btn--disabled': saving }"
          :disabled="saving"
          @tap="submit"
        >
          {{ saving ? '保存中…' : isEdit ? '保存修改' : '创建项目' }}
        </button>
      </template>
    </view>

    <view v-if="templateSheetOpen" class="admin-sheet-mask" @tap="templateSheetOpen = false">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">选择阶段模板</text>
            <text class="admin-sheet-sub">创建后项目结构是模板的副本，修改模板不影响已建项目</text>
          </view>
          <view class="admin-sheet-close" @tap="templateSheetOpen = false">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="!templates.length" class="admin-empty-inline">暂无可用模板</view>
        <view v-else class="template-list">
          <view
            v-for="template in templates"
            :key="template.id"
            class="template-row"
            :class="{ 'template-row--active': Number(form.templateId) === Number(template.id) }"
            @tap="chooseTemplate(template)"
          >
            <view class="template-main">
              <view class="template-title-row">
                <text class="template-name">{{ template.name }}</text>
                <text v-if="template.isDefault" class="admin-badge admin-badge--accent">默认</text>
              </view>
              <text class="template-meta">{{ template.stageCount }} 个阶段 · {{ template.itemCount }} 个工序</text>
            </view>
            <text v-if="Number(form.templateId) === Number(template.id)" class="template-check">已选择</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import {
  createAdminProject,
  updateAdminProject,
  fetchAdminProject,
} from '../../../api/admin/project'
import { fetchAdminTemplates } from '../../../api/admin/template'
import { requireAdminSession, formatDate, showAdminError } from '../../../utils/admin'

defineOptions({ name: 'AdminProjectFormPage' })

const projectId = ref(null)
const isEdit = computed(() => Boolean(projectId.value))
const form = reactive({
  name: '',
  address: '',
  area: '',
  contractAmount: '',
  startDate: '',
  planEndDate: '',
  templateId: '',
  remark: '',
})

const templates = ref([])
const templatesLoading = ref(false)
const templateSheetOpen = ref(false)
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const error = ref('')

const selectedTemplateName = computed(() => {
  const item = templates.value.find((template) => Number(template.id) === Number(form.templateId))
  return item ? item.name : ''
})

onLoad(async (options) => {
  const id = options && options.id ? Number(options.id) : null
  projectId.value = Number.isInteger(id) && id > 0 ? id : null

  try {
    await requireAdminSession()
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
    return
  }

  if (isEdit.value) {
    await loadProject()
  } else {
    const today = new Date()
    const plan = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
    form.startDate = formatDate(today)
    form.planEndDate = formatDate(plan)
    await loadTemplates()
  }
})

async function loadTemplates() {
  templatesLoading.value = true
  try {
    const data = await fetchAdminTemplates()
    templates.value = (data && data.list) || []
    if (!form.templateId && templates.value.length) {
      const defaultTemplate = templates.value.find((item) => item.isDefault) || templates.value[0]
      form.templateId = defaultTemplate.id
    }
  } catch (err) {
    showAdminError(err, '模板加载失败')
  } finally {
    templatesLoading.value = false
  }
}

async function loadProject() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await fetchAdminProject(projectId.value)
    if (!data) throw new Error('项目不存在')
    if (data.status === 'archived') throw new Error('已归档项目只读，无法编辑')

    form.name = data.name || ''
    form.address = data.address || ''
    form.area = data.area || ''
    form.contractAmount = data.contractAmount || ''
    form.startDate = formatDate(data.startDate)
    form.planEndDate = formatDate(data.planEndDate)
    form.remark = data.remark || ''
    form.templateId = data.templateId || ''
  } catch (err) {
    loadError.value = err.message || '项目加载失败'
    showAdminError(err, '项目加载失败')
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (saving.value) return
  error.value = validate()
  if (error.value) return

  saving.value = true
  try {
    if (isEdit.value) {
      await updateAdminProject(projectId.value, buildPayload(false))
      uni.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 350)
      return
    }

    const created = await createAdminProject(buildPayload(true))
    const messages = []
    if (created && created.duplicates) messages.push('存在同名项目，已按允许重复的规则创建')
    if (created && created.needsCoordinates) messages.push('地址未解析出坐标，可稍后在网页后台手工拾取')

    if (messages.length) {
      uni.showModal({
        title: '项目已创建',
        content: messages.join('\n'),
        showCancel: false,
        success: () => {
          uni.redirectTo({ url: `/pages/admin/project/detail?id=${created.id}` })
        },
      })
    } else {
      uni.redirectTo({ url: `/pages/admin/project/detail?id=${created.id}` })
    }
  } catch (err) {
    error.value = err.message || '保存失败'
    showAdminError(err, '保存失败')
  } finally {
    saving.value = false
  }
}

function buildPayload(includeTemplate) {
  const payload = {
    name: form.name.trim(),
    address: form.address.trim(),
    contractAmount: String(form.contractAmount).trim(),
    startDate: form.startDate,
    planEndDate: form.planEndDate,
  }

  if (form.area && String(form.area).trim()) payload.area = String(form.area).trim()
  if (form.remark && form.remark.trim()) payload.remark = form.remark.trim()
  if (includeTemplate && form.templateId) payload.templateId = Number(form.templateId)
  return payload
}

function validate() {
  if (!form.name.trim()) return '请输入项目名称'
  if (!form.address.trim()) return '请输入项目地址'
  if (!/^\d+(\.\d{1,2})?$/.test(String(form.contractAmount).trim()) || Number(form.contractAmount) <= 0) {
    return '合同金额必须大于 0，且最多两位小数'
  }
  if (form.area && !/^\d+(\.\d{1,2})?$/.test(String(form.area).trim())) {
    return '面积必须大于 0，且最多两位小数'
  }
  if (!form.startDate) return '请选择开工日期'
  if (!form.planEndDate) return '请选择计划竣工日期'
  if (form.planEndDate < form.startDate) return '计划竣工日期不得早于开工日期'
  if (!isEdit.value && !form.templateId) return '请选择阶段模板'
  return ''
}

function onStartDate(event) {
  form.startDate = event.detail.value
}

function onPlanEndDate(event) {
  form.planEndDate = event.detail.value
}

function openTemplateSheet() {
  templateSheetOpen.value = true
  if (!templates.value.length) loadTemplates()
}

function chooseTemplate(template) {
  form.templateId = template.id
  templateSheetOpen.value = false
}
</script>

<style scoped lang="scss">
.form-grid {
  display: flex;
  gap: dp(10);
}

.form-grid-item {
  flex: 1;
  min-width: 0;
}

.picker-chevron {
  width: dp(12);
  height: dp(12);
}

.form-error {
  display: block;
  margin: dp(2) 0 dp(10);
  color: #f53f3f;
  font-size: dp(11);
  line-height: 1.5;
}

.save-btn {
  margin-bottom: dp(10);
}

.retry-btn {
  margin-top: dp(10);
}

.template-list {
  padding-top: dp(8);
}

.template-row {
  display: flex;
  align-items: center;
  padding: dp(12) dp(2);
  border-bottom: 1px solid #f8f4ef;
}

.template-row:last-child {
  border-bottom: none;
}

.template-row--active {
  background: #fff8f4;
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
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.template-meta {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}

.template-check {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(11);
  flex-shrink: 0;
}
</style>
