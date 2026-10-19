<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  fetchAddItem,
  fetchAddStage,
  fetchDeleteItem,
  fetchDeleteStage,
  fetchUpdateItem,
  fetchUpdateStage,
  type ProjectDetail,
  type ProjectStage,
  type StageItem
} from '@/service/api/project';
import { useTenantReadOnly } from '@/hooks/common/tenant';
import { formatDate, GATE_STATUS_META } from '@/utils/format';

defineOptions({ name: 'ProjectStructureTab' });

const props = defineProps<{ projectId: number; detail: ProjectDetail }>();
const emit = defineEmits<{ refresh: [] }>();

const readOnly = useTenantReadOnly();

// ── 阶段 ──

const stageDialog = reactive({
  visible: false,
  mode: 'create' as 'create' | 'edit',
  stageId: 0,
  submitting: false
});

const stageForm = reactive({
  name: '',
  weight: '',
  planStart: '',
  planEnd: '',
  actualStart: '',
  actualEnd: ''
});

function openAddStage() {
  stageDialog.mode = 'create';
  stageDialog.stageId = 0;
  stageForm.name = '';
  stageForm.weight = '';
  stageForm.planStart = '';
  stageForm.planEnd = '';
  stageForm.actualStart = '';
  stageForm.actualEnd = '';
  stageDialog.visible = true;
}

function openEditStage(stage: ProjectStage) {
  stageDialog.mode = 'edit';
  stageDialog.stageId = stage.id;
  stageForm.name = stage.name;
  stageForm.weight = stage.weight ?? '';
  stageForm.planStart = stage.planStart ?? '';
  stageForm.planEnd = stage.planEnd ?? '';
  stageForm.actualStart = stage.actualStart ?? '';
  stageForm.actualEnd = stage.actualEnd ?? '';
  stageDialog.visible = true;
}

async function submitStage() {
  if (!stageForm.name.trim()) {
    ElMessage.warning('请输入阶段名称');
    return;
  }

  stageDialog.submitting = true;

  try {
    const payload = {
      name: stageForm.name.trim(),
      weight: stageForm.weight === '' ? null : stageForm.weight,
      planStart: stageForm.planStart || null,
      planEnd: stageForm.planEnd || null
    };

    const { error } =
      stageDialog.mode === 'create'
        ? await fetchAddStage(props.projectId, payload)
        : await fetchUpdateStage(props.projectId, stageDialog.stageId, {
            ...payload,
            actualStart: stageForm.actualStart || null,
            actualEnd: stageForm.actualEnd || null
          });

    if (error) return;

    ElMessage.success(stageDialog.mode === 'create' ? '阶段已添加' : '阶段已更新');
    stageDialog.visible = false;
    emit('refresh');
  } finally {
    stageDialog.submitting = false;
  }
}

async function removeStage(stage: ProjectStage) {
  try {
    await ElMessageBox.confirm(
      `确认删除阶段「${stage.name}」？阶段下的工序会一并删除；项目不能没有阶段。`,
      '删除阶段',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchDeleteStage(props.projectId, stage.id);

  if (!error) {
    ElMessage.success('阶段已删除');
    emit('refresh');
  }
}

// ── 工序 ──

const itemDialog = reactive({
  visible: false,
  mode: 'create' as 'create' | 'edit',
  stageId: 0,
  itemId: 0,
  submitting: false
});

const itemForm = reactive({
  name: '',
  weight: '',
  planStart: '',
  planEnd: ''
});

function openAddItem(stage: ProjectStage) {
  itemDialog.mode = 'create';
  itemDialog.stageId = stage.id;
  itemDialog.itemId = 0;
  itemForm.name = '';
  itemForm.weight = '';
  itemForm.planStart = '';
  itemForm.planEnd = '';
  itemDialog.visible = true;
}

function openEditItem(stage: ProjectStage, item: StageItem) {
  itemDialog.mode = 'edit';
  itemDialog.stageId = stage.id;
  itemDialog.itemId = item.id;
  itemForm.name = item.name;
  itemForm.weight = item.weight ?? '';
  itemForm.planStart = item.planStart ?? '';
  itemForm.planEnd = item.planEnd ?? '';
  itemDialog.visible = true;
}

async function submitItem() {
  if (!itemForm.name.trim()) {
    ElMessage.warning('请输入工序名称');
    return;
  }

  itemDialog.submitting = true;

  try {
    const payload = {
      name: itemForm.name.trim(),
      weight: itemForm.weight === '' ? null : itemForm.weight,
      planStart: itemForm.planStart || null,
      planEnd: itemForm.planEnd || null
    };

    const { error } =
      itemDialog.mode === 'create'
        ? await fetchAddItem(props.projectId, itemDialog.stageId, payload)
        : await fetchUpdateItem(props.projectId, itemDialog.itemId, payload);

    if (error) return;

    ElMessage.success(itemDialog.mode === 'create' ? '工序已添加' : '工序已更新');
    itemDialog.visible = false;
    emit('refresh');
  } finally {
    itemDialog.submitting = false;
  }
}

async function removeItem(item: StageItem) {
  try {
    await ElMessageBox.confirm(
      `确认删除工序「${item.name}」？阶段不能没有工序，最后一个工序会被拒绝删除。`,
      '删除工序',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchDeleteItem(props.projectId, item.id);

  if (!error) {
    ElMessage.success('工序已删除');
    emit('refresh');
  }
}
</script>

<template>
  <div>
    <div class="mb-12px flex items-center justify-between">
      <span class="text-13px text-#86909c">
        阶段与工序是建档时从模板拷贝出来的实例副本，这里的修改不影响源模板；完成度只能在 C 端通过进度汇报变更。
      </span>
      <ElButton v-if="!readOnly" type="primary" plain @click="openAddStage">新增阶段</ElButton>
    </div>

    <ElCard v-for="stage in detail.stages" :key="stage.id" class="mb-12px" shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <div class="flex flex-wrap items-center gap-8px">
            <span class="font-600">#{{ stage.seq }} {{ stage.name }}</span>
            <ElTag :type="GATE_STATUS_META[stage.gateStatus]?.type || 'info'" size="small">
              {{ GATE_STATUS_META[stage.gateStatus]?.label || stage.gateStatus }}
            </ElTag>
            <span class="text-12px text-#86909c">
              完成度 {{ Number(stage.progress).toFixed(2) }}% · 权重 {{ stage.weight ?? '等权' }}
            </span>
          </div>

          <div v-if="!readOnly" class="flex gap-4px">
            <ElButton link type="primary" @click="openAddItem(stage)">添加工序</ElButton>
            <ElButton link type="primary" @click="openEditStage(stage)">编辑阶段</ElButton>
            <ElButton link type="danger" @click="removeStage(stage)">删除阶段</ElButton>
          </div>
        </div>
      </template>

      <ElTable :data="stage.items" row-key="id" size="small" border>
        <ElTableColumn prop="seq" label="#" width="56" align="center" />
        <ElTableColumn prop="name" label="工序" min-width="200" />
        <ElTableColumn label="完成度" width="180">
          <template #default="{ row }">
            <ElProgress :percentage="Number(row.progress) || 0" :stroke-width="7" />
          </template>
        </ElTableColumn>
        <ElTableColumn label="权重" width="90" align="center">
          <template #default="{ row }">{{ row.weight ?? '等权' }}</template>
        </ElTableColumn>
        <ElTableColumn label="计划起止" width="200">
          <template #default="{ row }">
            {{ formatDate(row.planStart) }} ~ {{ formatDate(row.planEnd) }}
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="!readOnly" label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <ElButton link type="primary" @click="openEditItem(stage, row)">编辑</ElButton>
            <ElButton link type="danger" @click="removeItem(row)">删除</ElButton>
          </template>
        </ElTableColumn>
        <template #empty>
          <ElEmpty description="该阶段下还没有工序" :image-size="56" />
        </template>
      </ElTable>
    </ElCard>

    <ElEmpty v-if="!detail.stages.length" description="项目没有阶段" />

    <!-- 阶段弹窗 -->
    <ElDialog
      v-model="stageDialog.visible"
      :title="stageDialog.mode === 'create' ? '新增阶段' : '编辑阶段'"
      width="520px"
    >
      <ElForm label-width="90px">
        <ElFormItem label="阶段名称" required>
          <ElInput v-model="stageForm.name" maxlength="50" placeholder="例如：水电工程" />
        </ElFormItem>
        <ElFormItem label="权重">
          <ElInput v-model="stageForm.weight" placeholder="正数；留空表示等权" />
        </ElFormItem>
        <ElFormItem label="计划开始">
          <ElDatePicker v-model="stageForm.planStart" class="w-full" type="date" value-format="YYYY-MM-DD" />
        </ElFormItem>
        <ElFormItem label="计划结束">
          <ElDatePicker v-model="stageForm.planEnd" class="w-full" type="date" value-format="YYYY-MM-DD" />
        </ElFormItem>
        <template v-if="stageDialog.mode === 'edit'">
          <ElFormItem label="实际开始">
            <ElDatePicker v-model="stageForm.actualStart" class="w-full" type="date" value-format="YYYY-MM-DD" />
          </ElFormItem>
          <ElFormItem label="实际结束">
            <ElDatePicker v-model="stageForm.actualEnd" class="w-full" type="date" value-format="YYYY-MM-DD" />
          </ElFormItem>
        </template>
      </ElForm>
      <template #footer>
        <ElButton @click="stageDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="stageDialog.submitting" @click="submitStage">保存</ElButton>
      </template>
    </ElDialog>

    <!-- 工序弹窗 -->
    <ElDialog
      v-model="itemDialog.visible"
      :title="itemDialog.mode === 'create' ? '新增工序' : '编辑工序'"
      width="520px"
    >
      <ElForm label-width="90px">
        <ElFormItem label="工序名称" required>
          <ElInput v-model="itemForm.name" maxlength="50" placeholder="例如：水管铺设" />
        </ElFormItem>
        <ElFormItem label="权重">
          <ElInput v-model="itemForm.weight" placeholder="正数；留空表示等权" />
        </ElFormItem>
        <ElFormItem label="计划开始">
          <ElDatePicker v-model="itemForm.planStart" class="w-full" type="date" value-format="YYYY-MM-DD" />
        </ElFormItem>
        <ElFormItem label="计划结束">
          <ElDatePicker v-model="itemForm.planEnd" class="w-full" type="date" value-format="YYYY-MM-DD" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="itemDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="itemDialog.submitting" @click="submitItem">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped></style>
