<template>
  <view class="admin-page">
    <AdminNav title="付款节点" :fallback="`/pages/admin/project/detail?id=${projectId}`">
      <template #right>
        <text v-if="canWrite && !editing" class="admin-nav-action" @tap="startEdit">编辑</text>
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
            付款节点只是约定金额与提醒，系统内不发生任何资金划转。节点配置会被 C 端记账与验收共用。
          </view>

          <!-- 查看模式 -->
          <template v-if="!editing">
            <view v-if="!nodes.length" class="admin-card">
              <text class="admin-empty-inline">暂无付款节点</text>
              <button v-if="canWrite" class="admin-btn admin-btn--block" @tap="startEdit">添加节点</button>
            </view>

            <view v-else class="admin-list">
              <view v-for="node in nodes" :key="node.id" class="admin-card node-card">
                <view class="node-top">
                  <view class="node-main">
                    <view class="node-title-row">
                      <text class="node-name">{{ node.name }}</text>
                      <text class="admin-badge" :class="nodeTone(node.status)">{{ nodeStatusLabel(node.status) }}</text>
                    </view>
                    <text class="node-trigger">{{ triggerLabel(node.triggerType) }}</text>
                  </view>
                  <text class="node-amount">¥{{ formatMoney(node.amount) }}</text>
                </view>

                <view v-if="canWrite && node.triggerType === 'manual' && node.status === 'not_started'" class="node-actions">
                  <button class="admin-btn admin-btn--ghost admin-btn--small" @tap="unlock(node)">手工解锁</button>
                </view>
              </view>
            </view>

            <view v-if="canWrite" class="admin-note">
              一旦有流水关联了付款节点，整表替换会被后端拒绝；那时只能在记账模块内处理。
            </view>
          </template>

          <!-- 编辑模式 -->
          <template v-else>
            <view class="admin-card edit-head">
              <view>
                <text class="admin-section-title">编辑付款节点</text>
                <text class="admin-section-sub">保存时会整表替换现有节点</text>
              </view>
              <text class="node-count">{{ draftNodes.length }} 个</text>
            </view>

            <view v-for="(node, index) in draftNodes" :key="node.localId" class="admin-card draft-card">
              <view class="draft-head">
                <text class="draft-index">节点 {{ index + 1 }}</text>
                <text class="draft-remove" @tap="removeDraft(index)">删除</text>
              </view>

              <view class="admin-form-group">
                <text class="admin-form-label">名称</text>
                <input
                  v-model="node.name"
                  class="admin-input"
                  maxlength="50"
                  placeholder="例如：水电验收款"
                  placeholder-class="admin-placeholder"
                />
              </view>

              <view class="admin-form-group">
                <text class="admin-form-label">金额</text>
                <input
                  v-model="node.amount"
                  class="admin-input"
                  type="digit"
                  maxlength="20"
                  placeholder="必须大于 0"
                  placeholder-class="admin-placeholder"
                />
              </view>

              <view class="admin-form-group">
                <text class="admin-form-label">触发方式</text>
                <view class="role-options">
                  <view
                    class="admin-chip"
                    :class="{ 'admin-chip--active': node.triggerType === 'manual' }"
                    @tap="setTrigger(node, 'manual')"
                  >
                    手动解锁
                  </view>
                  <view
                    class="admin-chip"
                    :class="{ 'admin-chip--active': node.triggerType === 'stage_acceptance' }"
                    @tap="setTrigger(node, 'stage_acceptance')"
                  >
                    阶段验收后解锁
                  </view>
                </view>
              </view>

              <view v-if="node.triggerType === 'stage_acceptance'" class="admin-form-group">
                <text class="admin-form-label">关联阶段</text>
                <picker
                  mode="selector"
                  :range="stageNames"
                  :value="stagePickerIndex(node)"
                  @change="onStageChange(node, $event)"
                >
                  <view class="admin-picker-row">
                    <text :class="stageName(node.triggerStageId) ? 'admin-picker-value' : 'admin-placeholder'">
                      {{ stageName(node.triggerStageId) || '选择阶段' }}
                    </text>
                  </view>
                </picker>
              </view>
            </view>

            <button class="admin-btn admin-btn--ghost add-node-btn" @tap="addDraft">添加节点</button>

            <text v-if="editError" class="edit-error">{{ editError }}</text>

            <view class="admin-sheet-actions edit-actions">
              <button class="admin-btn admin-btn--ghost" :disabled="saving" @tap="cancelEdit">取消</button>
              <button
                class="admin-btn"
                :class="{ 'admin-btn--disabled': saving }"
                :disabled="saving"
                @tap="saveNodes"
              >
                {{ saving ? '保存中…' : '保存节点' }}
              </button>
            </view>
          </template>
        </template>
      </AdminPageState>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import {
  fetchAdminProject,
  fetchAdminPaymentNodes,
  replaceAdminPaymentNodes,
  unlockAdminPaymentNode,
} from '../../../api/admin/project'
import {
  requireAdminSession,
  formatMoney,
  nodeStatusLabel,
  triggerLabel,
  showAdminError,
} from '../../../utils/admin'

defineOptions({ name: 'AdminProjectPaymentsPage' })

const projectId = ref(null)
const project = ref(null)
const nodes = ref([])
const loading = ref(false)
const error = ref('')
const editing = ref(false)
const draftNodes = ref([])
const saving = ref(false)
const editError = ref('')

let loadedOnce = false
let localSeq = 0

const canWrite = computed(() => Boolean(project.value && project.value.status !== 'archived'))
const stages = computed(() => (project.value && project.value.stages) || [])
const stageNames = computed(() => stages.value.map((stage) => stage.name))

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
  if (loadedOnce && !editing.value) load(true)
})

onPullDownRefresh(async () => {
  try {
    if (!editing.value) await load(true)
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function load(silent = false) {
  if (!projectId.value) return
  if (!silent) loading.value = true
  error.value = ''
  try {
    const [projectData, nodeData] = await Promise.all([
      fetchAdminProject(projectId.value),
      fetchAdminPaymentNodes(projectId.value),
    ])
    project.value = projectData
    nodes.value = (nodeData && nodeData.nodes) || []
  } catch (err) {
    error.value = err.message || '付款节点加载失败'
    showAdminError(err, '付款节点加载失败')
  } finally {
    loading.value = false
  }
}

function nodeTone(status) {
  if (status === 'confirmed') return 'admin-badge--green'
  if (status === 'paid') return 'admin-badge--orange'
  if (status === 'unlocked') return 'admin-badge--accent'
  return 'admin-badge--gray'
}

function stageName(stageId) {
  const stage = stages.value.find((item) => Number(item.id) === Number(stageId))
  return stage ? stage.name : ''
}

function stagePickerIndex(node) {
  const index = stages.value.findIndex((stage) => Number(stage.id) === Number(node.triggerStageId))
  return index >= 0 ? index : 0
}

function onStageChange(node, event) {
  const index = Number(event.detail.value)
  const stage = stages.value[index]
  node.triggerStageId = stage ? stage.id : ''
}

function startEdit() {
  if (!canWrite.value) return
  draftNodes.value = nodes.value.map((node) => ({
    localId: ++localSeq,
    name: node.name,
    amount: node.amount,
    triggerType: node.triggerType,
    triggerStageId: node.triggerStageId || '',
  }))
  if (!draftNodes.value.length) addDraft()
  editError.value = ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  draftNodes.value = []
  editError.value = ''
}

function addDraft() {
  draftNodes.value.push({
    localId: ++localSeq,
    name: '',
    amount: '',
    triggerType: 'manual',
    triggerStageId: '',
  })
}

function removeDraft(index) {
  draftNodes.value.splice(index, 1)
}

function setTrigger(node, triggerType) {
  node.triggerType = triggerType
  if (triggerType === 'manual') node.triggerStageId = ''
}

function validateDrafts() {
  if (!draftNodes.value.length) return '至少保留 1 个付款节点'
  for (let index = 0; index < draftNodes.value.length; index += 1) {
    const node = draftNodes.value[index]
    if (!String(node.name || '').trim()) return `第 ${index + 1} 个节点缺少名称`
    const amount = String(node.amount || '').trim()
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      return `第 ${index + 1} 个节点金额不合法`
    }
    if (node.triggerType === 'stage_acceptance' && !node.triggerStageId) {
      return `第 ${index + 1} 个节点需要选择关联阶段`
    }
  }
  return ''
}

async function saveNodes() {
  if (saving.value) return
  editError.value = validateDrafts()
  if (editError.value) return

  const payload = draftNodes.value.map((node) => ({
    name: String(node.name).trim(),
    amount: String(node.amount).trim(),
    triggerType: node.triggerType,
    ...(node.triggerType === 'stage_acceptance'
      ? { triggerStageId: Number(node.triggerStageId) }
      : {}),
  }))

  saving.value = true
  try {
    const result = await replaceAdminPaymentNodes(projectId.value, payload)
    if (result && result.warning) {
      uni.showModal({ title: '节点已保存', content: result.warning, showCancel: false })
    } else {
      uni.showToast({ title: '节点已保存', icon: 'success' })
    }
    editing.value = false
    draftNodes.value = []
    await load(true)
  } catch (err) {
    editError.value = err.message || '保存失败'
    showAdminError(err, '保存失败')
  } finally {
    saving.value = false
  }
}

function unlock(node) {
  uni.showModal({
    title: '手工解锁',
    content: `确定解锁付款节点「${node.name}」吗？只有手动触发型节点可以手工解锁。`,
    success: async (res) => {
      if (!res.confirm) return
      try {
        await unlockAdminPaymentNode(projectId.value, node.id)
        uni.showToast({ title: '已解锁', icon: 'success' })
        await load(true)
      } catch (err) {
        showAdminError(err, '解锁失败')
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

.node-card {
  padding: dp(13);
}

.node-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.node-main {
  min-width: 0;
}

.node-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.node-name {
  color: #241c17;
  font-size: dp(14);
  font-weight: 600;
}

.node-trigger {
  display: block;
  margin-top: dp(5);
  color: #8b8179;
  font-size: dp(10);
}

.node-amount {
  margin-left: dp(10);
  color: #241c17;
  font-size: dp(14);
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
}

.node-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: dp(10);
}

.edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.node-count {
  color: #8b8179;
  font-size: dp(11);
}

.draft-card {
  padding: dp(13);
}

.draft-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: dp(10);
}

.draft-index {
  color: #241c17;
  font-size: dp(12);
  font-weight: 600;
}

.draft-remove {
  color: #f53f3f;
  font-size: dp(11);
}

.role-options {
  display: flex;
  gap: dp(8);
}

.add-node-btn {
  width: 100%;
  margin-bottom: dp(10);
}

.edit-error {
  display: block;
  margin: dp(2) 0 dp(10);
  color: #f53f3f;
  font-size: dp(11);
  line-height: 1.5;
}

.edit-actions {
  margin-top: dp(4);
}
</style>
