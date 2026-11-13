<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { VueDraggable } from 'vue-draggable-plus';
import {
  fetchCreateTemplate,
  fetchDeleteTemplate,
  fetchDuplicateTemplate,
  fetchSetDefaultTemplate,
  fetchTemplateDetail,
  fetchTemplateList,
  fetchUpdateTemplate,
  type TemplateDetail,
  type TemplateItem,
  type TemplateListItem,
  type TemplateStage
} from '@/service/api/template';
import { useTenantReadOnly } from '@/hooks/common/tenant';
import { formatDate } from '@/utils/format';

defineOptions({ name: 'TemplatePage' });

/**
 * 编辑器里的阶段 / 工序需要一个稳定 key。
 *
 * 拖拽会改变数组顺序，如果用下标做 key，Vue 会把「位置」当成身份 ——
 * 输入框的焦点会跟着位置走，而不是跟着它编辑的那一行走。
 * 新建的行还没有数据库 id，因此本地补一个自增 uid。
 */
interface EditorItem extends TemplateItem {
  uid: number;
}

interface EditorStage extends Omit<TemplateStage, 'items'> {
  uid: number;
  items: EditorItem[];
}

let uidSeed = 0;

function nextUid() {
  uidSeed += 1;
  return uidSeed;
}

const readOnly = useTenantReadOnly();
const loading = ref(false);
const list = ref<TemplateListItem[]>([]);
const total = ref(0);

const query = reactive({ page: 1, pageSize: 20, keyword: '' });

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchTemplateList({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined
    });

    if (!error && data) {
      list.value = data.list;
      total.value = data.total;
    } else {
      list.value = [];
      total.value = 0;
    }
  } finally {
    loading.value = false;
  }
}

function search() {
  query.page = 1;
  load();
}

// ── 编辑器 ──

const editor = reactive({
  visible: false,
  mode: 'create' as 'create' | 'edit',
  id: 0,
  loading: false,
  submitting: false,
  referencingProjectCount: 0
});

const editorForm = reactive({
  name: '',
  isDefault: false,
  stages: [] as EditorStage[]
});

function blankItem(): EditorItem {
  return { uid: nextUid(), name: '', weight: '', checklist: [] };
}

function blankStage(): EditorStage {
  return { uid: nextUid(), name: '', planDays: 7, weight: '', items: [blankItem()] };
}

function resetEditor() {
  editorForm.name = '';
  editorForm.isDefault = false;
  editorForm.stages = [blankStage()];
  editor.referencingProjectCount = 0;
}

function openCreate() {
  editor.mode = 'create';
  editor.id = 0;
  resetEditor();
  editor.visible = true;
}

async function openEdit(row: TemplateListItem) {
  editor.mode = 'edit';
  editor.id = row.id;
  editor.loading = true;
  editor.visible = true;
  resetEditor();

  try {
    const { data, error } = await fetchTemplateDetail(row.id);

    if (error || !data) return;

    editorForm.name = data.name;
    editorForm.isDefault = data.isDefault;
    editor.referencingProjectCount = data.referencingProjectCount;
    editorForm.stages = data.stages.map(stage => ({
      uid: nextUid(),
      id: stage.id,
      name: stage.name,
      planDays: Number(stage.planDays),
      weight: stage.weight == null ? '' : String(stage.weight),
      items: stage.items.map(item => ({
        uid: nextUid(),
        id: item.id,
        name: item.name,
        weight: item.weight == null ? '' : String(item.weight),
        checklist: [...(item.checklist || [])]
      }))
    }));
  } finally {
    editor.loading = false;
  }
}

function addStage() {
  editorForm.stages.push(blankStage());
}

function removeStage(index: number) {
  if (editorForm.stages.length <= 1) {
    ElMessage.warning('模板至少需要 1 个阶段');
    return;
  }

  editorForm.stages.splice(index, 1);
}

function addItem(stage: EditorStage) {
  stage.items.push(blankItem());
}

function removeItem(stage: EditorStage, index: number) {
  if (stage.items.length <= 1) {
    ElMessage.warning('每个阶段至少需要 1 个工序');
    return;
  }

  stage.items.splice(index, 1);
}

// 排序全部交给 VueDraggable（AC-AD62）：拖拽直接改写数组顺序，
// 保存时服务端按数组下标重写 seq，前端不需要再维护一个 seq 字段。

// ── 默认验收项 ──

const checklistDialog = reactive({
  visible: false,
  stageIndex: 0,
  itemIndex: 0,
  title: ''
});

const checklistItem = ref<TemplateItem | null>(null);

function openChecklist(stageIndex: number, itemIndex: number) {
  const item = editorForm.stages[stageIndex].items[itemIndex];

  if (!Array.isArray(item.checklist)) item.checklist = [];

  checklistItem.value = item;
  checklistDialog.stageIndex = stageIndex;
  checklistDialog.itemIndex = itemIndex;
  checklistDialog.title = `验收项 · ${item.name || '未命名工序'}`;
  checklistDialog.visible = true;
}

function addChecklist() {
  checklistItem.value?.checklist.push('');
}

function removeChecklist(index: number) {
  checklistItem.value?.checklist.splice(index, 1);
}

// ── 保存 ──

function validateEditor() {
  if (!editorForm.name.trim()) {
    ElMessage.warning('请输入模板名称');
    return false;
  }

  if (!editorForm.stages.length) {
    ElMessage.warning('模板至少需要包含 1 个阶段');
    return false;
  }

  for (let si = 0; si < editorForm.stages.length; si += 1) {
    const stage = editorForm.stages[si];

    if (!stage.name.trim()) {
      ElMessage.warning(`第 ${si + 1} 个阶段缺少名称`);
      return false;
    }

    if (!Number.isInteger(Number(stage.planDays)) || Number(stage.planDays) <= 0) {
      ElMessage.warning(`阶段「${stage.name}」的计划工期必须是正整数`);
      return false;
    }

    if (!stage.items.length) {
      ElMessage.warning(`阶段「${stage.name}」至少需要 1 个工序`);
      return false;
    }

    for (let ii = 0; ii < stage.items.length; ii += 1) {
      if (!stage.items[ii].name.trim()) {
        ElMessage.warning(`阶段「${stage.name}」的第 ${ii + 1} 个工序缺少名称`);
        return false;
      }
    }
  }

  return true;
}

async function submitEditor() {
  if (!validateEditor()) return;

  editor.submitting = true;

  try {
    const payload = {
      name: editorForm.name.trim(),
      isDefault: editorForm.isDefault,
      stages: editorForm.stages.map(stage => ({
        name: stage.name.trim(),
        planDays: Number(stage.planDays),
        weight: stage.weight === '' ? null : stage.weight,
        items: stage.items.map(item => ({
          name: item.name.trim(),
          weight: item.weight === '' ? null : item.weight,
          checklist: (item.checklist || []).map(text => text.trim()).filter(Boolean)
        }))
      }))
    };

    const { error } =
      editor.mode === 'create'
        ? await fetchCreateTemplate(payload)
        : await fetchUpdateTemplate(editor.id, payload);

    if (error) return;

    ElMessage.success(editor.mode === 'create' ? '模板已创建' : '模板已保存');
    editor.visible = false;
    await load();
  } finally {
    editor.submitting = false;
  }
}

// ── 预览 / 复制 / 默认 / 删除 ──

const preview = reactive({ visible: false, loading: false });
const previewData = ref<TemplateDetail | null>(null);

async function openPreview(row: TemplateListItem) {
  preview.visible = true;
  preview.loading = true;

  try {
    const { data } = await fetchTemplateDetail(row.id);

    if (data) previewData.value = data;
  } finally {
    preview.loading = false;
  }
}

async function duplicate(row: TemplateListItem) {
  let name = '';

  try {
    const result = await ElMessageBox.prompt('请输入副本名称', '复制模板', {
      confirmButtonText: '复制',
      cancelButtonText: '取消',
      inputValue: `${row.name}（副本）`,
      inputValidator: (value: string) => Boolean(value && value.trim()) || '请输入副本名称'
    });

    name = String(result.value || '').trim();
  } catch {
    return;
  }

  const { error } = await fetchDuplicateTemplate(row.id, name);

  if (!error) {
    ElMessage.success('模板已复制');
    await load();
  }
}

async function setDefault(row: TemplateListItem) {
  try {
    await ElMessageBox.confirm(`将「${row.name}」设为默认模板？新建项目的默认选中项会随之改变。`, '设为默认', {
      type: 'warning',
      confirmButtonText: '确认',
      cancelButtonText: '取消'
    });
  } catch {
    return;
  }

  const { error } = await fetchSetDefaultTemplate(row.id);

  if (!error) {
    ElMessage.success('默认模板已更新');
    await load();
  }
}

async function remove(row: TemplateListItem) {
  try {
    await ElMessageBox.confirm(
      `确认删除模板「${row.name}」？被项目引用的模板不能删除；默认模板也不能删除。`,
      '删除模板',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchDeleteTemplate(row.id);

  if (!error) {
    ElMessage.success('模板已删除');
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <span class="font-600">阶段模板</span>
          <div class="flex items-center gap-8px">
            <ElInput
              v-model="query.keyword"
              class="w-220px"
              clearable
              placeholder="模板名称"
              @keyup.enter="search"
            />
            <ElButton type="primary" @click="search">查询</ElButton>
            <ElButton v-if="!readOnly" type="primary" plain @click="openCreate">新建模板</ElButton>
          </div>
        </div>
      </template>

      <ElTable v-loading="loading" :data="list" row-key="id" stripe>
        <ElTableColumn prop="name" label="模板名称" min-width="180">
          <template #default="{ row }">
            <span class="font-500">{{ row.name }}</span>
            <ElTag v-if="row.isDefault" class="ml-6px" type="success" size="small">默认</ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="结构" width="150">
          <template #default="{ row }">{{ row.stageCount }} 阶段 / {{ row.itemCount }} 工序</template>
        </ElTableColumn>

        <ElTableColumn label="引用项目" width="110" align="center">
          <template #default="{ row }">
            <ElTag :type="row.referencingProjectCount ? 'warning' : 'info'" size="small">
              {{ row.referencingProjectCount }}
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="更新时间" width="150">
          <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
        </ElTableColumn>

        <ElTableColumn label="操作" width="270" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" @click="openPreview(row)">预览</ElButton>
            <template v-if="!readOnly">
              <ElButton link type="primary" @click="openEdit(row)">编辑</ElButton>
              <ElButton link type="primary" @click="duplicate(row)">复制</ElButton>
              <ElButton v-if="!row.isDefault" link type="primary" @click="setDefault(row)">设默认</ElButton>
              <ElButton link type="danger" @click="remove(row)">删除</ElButton>
            </template>
          </template>
        </ElTableColumn>

        <template #empty>
          <ElEmpty description="还没有阶段模板" />
        </template>
      </ElTable>

      <div class="mt-16px flex justify-end">
        <ElPagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </ElCard>

    <!-- 编辑器 -->
    <ElDrawer v-model="editor.visible" :title="editor.mode === 'create' ? '新建阶段模板' : '编辑阶段模板'" size="90%">
      <div v-loading="editor.loading">
        <ElAlert
          v-if="editor.referencingProjectCount"
          class="mb-14px"
          type="warning"
          :closable="false"
          show-icon
          title="修改不影响已生成的项目"
          :description="`该模板已被 ${editor.referencingProjectCount} 个项目引用。项目里的阶段与工序是建档时拷贝的副本，本次修改只影响之后新建的项目。`"
        />

        <ElForm label-width="90px" class="max-w-520px">
          <ElFormItem label="模板名称" required>
            <ElInput v-model="editorForm.name" maxlength="50" placeholder="例如：家装标准流程" />
          </ElFormItem>
          <ElFormItem label="设为默认">
            <ElSwitch v-model="editorForm.isDefault" />
            <span class="ml-8px text-12px text-#86909c">
              全租户至多 1 个默认模板；默认模板不可删除
            </span>
          </ElFormItem>
        </ElForm>

        <div class="mb-10px mt-18px flex items-center justify-between">
          <div>
            <span class="font-600">阶段与工序</span>
            <span class="ml-8px text-12px text-#86909c">
              顺序按下列从上到下保存；阶段至少 1 个，每个阶段至少 1 个工序
            </span>
          </div>
          <ElButton type="primary" plain @click="addStage">新增阶段</ElButton>
        </div>

        <!-- 拖拽排序（AC-AD62）：拖动顺序即保存顺序，服务端按数组下标重写 seq -->
        <VueDraggable v-model="editorForm.stages" :animation="180" handle=".stage-drag" class="flex flex-col">
          <ElCard v-for="(stage, si) in editorForm.stages" :key="stage.uid" class="mb-12px" shadow="never">
            <template #header>
              <div class="flex flex-wrap items-center gap-8px">
                <icon-mdi-drag class="stage-drag cursor-move text-#86909c" />
                <span class="text-13px text-#86909c">阶段 {{ si + 1 }}</span>
                <ElInput v-model="stage.name" class="w-220px" maxlength="50" placeholder="阶段名称" />
                <span class="text-12px text-#86909c">计划工期</span>
                <ElInputNumber v-model="stage.planDays" :min="1" :max="9999" :precision="0" />
                <span class="text-12px text-#86909c">天</span>
                <ElInput v-model="stage.weight" class="w-110px" placeholder="权重（可选）" />
                <ElButton link type="danger" @click="removeStage(si)">删除阶段</ElButton>
              </div>
            </template>

            <!-- 工序同样用拖拽排序；表头单独一行，行内容保持表格的密度 -->
            <div class="item-head">
              <span class="w-18px" />
              <span class="w-28px text-center">#</span>
              <span class="flex-1">工序名称</span>
              <span class="w-120px">权重</span>
              <span class="w-84px text-center">默认验收项</span>
              <span class="w-72px text-center">操作</span>
            </div>
            <VueDraggable v-model="stage.items" :animation="150" handle=".item-drag" class="item-list">
              <div v-for="(item, ii) in stage.items" :key="item.uid" class="item-row">
                <icon-mdi-drag class="item-drag w-18px cursor-move text-#86909c" />
                <span class="w-28px text-center text-13px text-#86909c">{{ ii + 1 }}</span>
                <div class="min-w-0 flex-1">
                  <ElInput v-model="item.name" maxlength="50" placeholder="工序名称" />
                </div>
                <div class="w-120px">
                  <ElInput v-model="item.weight" placeholder="可选" />
                </div>
                <div class="w-84px text-center">
                  <ElButton link type="primary" @click="openChecklist(si, ii)">
                    {{ item.checklist?.length || 0 }} 项
                  </ElButton>
                </div>
                <div class="w-72px text-center">
                  <ElButton link type="danger" @click="removeItem(stage, ii)">删除</ElButton>
                </div>
              </div>
            </VueDraggable>

            <ElButton class="mt-10px" plain @click="addItem(stage)">添加工序</ElButton>
          </ElCard>
        </VueDraggable>

        <div class="mt-18px flex gap-8px">
          <ElButton type="primary" :loading="editor.submitting" @click="submitEditor">保存</ElButton>
          <ElButton @click="editor.visible = false">取消</ElButton>
        </div>
      </div>
    </ElDrawer>

    <!-- 默认验收项 -->
    <ElDialog v-model="checklistDialog.visible" :title="checklistDialog.title" width="520px">
      <ElAlert
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        title="生成项目验收单时默认带入这些验收项"
        description="只影响之后按此模板生成的项目；已生成项目的验收项不回溯。"
      />

      <div v-if="checklistItem" class="flex flex-col gap-8px">
        <div v-for="(_, ci) in checklistItem.checklist" :key="ci" class="flex items-center gap-8px">
          <span class="w-20px text-center text-13px text-#86909c">{{ ci + 1 }}</span>
          <ElInput v-model="checklistItem.checklist[ci]" maxlength="200" placeholder="例如：水管打压合格" />
          <ElButton link type="danger" @click="removeChecklist(ci)">删除</ElButton>
        </div>
      </div>

      <ElButton class="mt-10px" plain @click="addChecklist">添加验收项</ElButton>

      <template #footer>
        <ElButton type="primary" @click="checklistDialog.visible = false">完成</ElButton>
      </template>
    </ElDialog>

    <!-- 预览 -->
    <ElDrawer v-model="preview.visible" title="模板预览" size="620px">
      <div v-loading="preview.loading">
        <template v-if="previewData">
          <div class="mb-14px flex items-center gap-8px">
            <span class="text-18px font-600">{{ previewData.name }}</span>
            <ElTag v-if="previewData.isDefault" type="success" size="small">默认</ElTag>
            <ElTag v-if="previewData.referencingProjectCount" type="warning" size="small">
              被 {{ previewData.referencingProjectCount }} 个项目引用
            </ElTag>
          </div>

          <ElCollapse>
            <ElCollapseItem
              v-for="(stage, si) in previewData.stages"
              :key="si"
              :name="String(si)"
              :title="`${si + 1}. ${stage.name}（${stage.planDays} 天${stage.weight ? ` · 权重 ${stage.weight}` : ''}）`"
            >
              <div v-for="(item, ii) in stage.items" :key="ii" class="mb-10px">
                <div class="text-14px font-500">{{ ii + 1 }}. {{ item.name }}</div>
                <div v-if="item.checklist?.length" class="pt-4px">
                  <ElTag
                    v-for="(check, ci) in item.checklist"
                    :key="ci"
                    class="mr-4px mb-4px"
                    size="small"
                    type="info"
                  >
                    {{ check }}
                  </ElTag>
                </div>
              </div>
            </ElCollapseItem>
          </ElCollapse>
        </template>
      </div>
    </ElDrawer>
  </div>
</template>

<style scoped>
/* 工序行的表头与数据行用同一套宽度，避免和「默认验收项 / 操作」错位 */
.item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 6px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  font-size: 12px;
  color: #86909c;
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.item-row:hover {
  border-color: var(--el-border-color);
}
</style>
