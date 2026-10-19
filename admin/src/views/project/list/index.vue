<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
import {
  fetchArchiveProject,
  fetchBatchArchive,
  fetchBatchAssign,
  fetchChangeProjectStatus,
  fetchCreateProject,
  fetchDeleteProject,
  fetchExportProjects,
  fetchProjectDetail,
  fetchProjectList,
  fetchUpdateProject,
  type BatchResult,
  type ProjectListItem,
  type ProjectStatus
} from '@/service/api/project';
import { fetchTemplateList, type TemplateListItem } from '@/service/api/template';
import { useAuthStore } from '@/store/modules/auth';
import { useTenantReadOnly } from '@/hooks/common/tenant';
import { formatDate, formatMoney, PROJECT_STATUS_META } from '@/utils/format';

defineOptions({ name: 'ProjectListPage' });

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();

const isOwner = computed(() => authStore.isTenantOwner);
const readOnly = useTenantReadOnly();

const loading = ref(false);
const list = ref<ProjectListItem[]>([]);
const total = ref(0);
const selectedIds = ref<number[]>([]);

const query = reactive({
  page: 1,
  pageSize: 20,
  name: '',
  address: '',
  status: '' as ProjectStatus | ''
});

const templates = ref<TemplateListItem[]>([]);

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchProjectList({
      page: query.page,
      pageSize: query.pageSize,
      name: query.name.trim() || undefined,
      address: query.address.trim() || undefined,
      status: query.status || undefined
    });

    if (!error && data) {
      list.value = data.list;
      total.value = data.total;
    } else {
      list.value = [];
      total.value = 0;
    }

    // 翻页/筛选后旧选中项已经看不见了，继续保留会让批量操作「凭空」作用到别的项目
    selectedIds.value = [];
  } finally {
    loading.value = false;
  }
}

function onSelectionChange(rows: ProjectListItem[]) {
  selectedIds.value = rows.map(row => row.id);
}

function search() {
  query.page = 1;
  load();
}

function resetQuery() {
  query.name = '';
  query.address = '';
  query.status = '';
  query.page = 1;
  load();
}

async function loadTemplates() {
  if (templates.value.length) return;

  const { data } = await fetchTemplateList({ page: 1, pageSize: 50 });
  templates.value = data?.list ?? [];
}

// ── 新建 / 编辑 ──

const dialog = reactive({
  visible: false,
  mode: 'create' as 'create' | 'edit',
  id: 0,
  submitting: false
});

const formRef = ref<FormInstance>();

const form = reactive({
  name: '',
  address: '',
  area: '',
  contractAmount: '',
  startDate: '',
  planEndDate: '',
  templateId: undefined as number | undefined,
  remark: ''
});

const rules = {
  name: [
    { required: true, message: '请输入项目名称', trigger: 'blur' },
    { max: 50, message: '项目名称不超过 50 字', trigger: 'blur' }
  ],
  address: [
    { required: true, message: '请输入项目地址', trigger: 'blur' },
    { max: 200, message: '项目地址不超过 200 字', trigger: 'blur' }
  ],
  contractAmount: [
    { required: true, message: '请输入合同金额', trigger: 'blur' },
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        // 与后端 money.validate 同口径：> 0 且最多两位小数。
        // 金额全程按字符串传递，不转 Number，避免精度丢失（AC-L11）
        if (!value || !/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0) {
          callback(new Error('合同金额必须大于 0 且最多两位小数'));
          return;
        }
        callback();
      },
      trigger: 'blur'
    }
  ],
  startDate: [{ required: true, message: '请选择开工日期', trigger: 'change' }],
  planEndDate: [
    { required: true, message: '请选择计划竣工日期', trigger: 'change' },
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        if (value && form.startDate && value < form.startDate) {
          callback(new Error('计划竣工日期不得早于开工日期'));
          return;
        }
        callback();
      },
      trigger: 'change'
    }
  ]
};

function resetForm() {
  form.name = '';
  form.address = '';
  form.area = '';
  form.contractAmount = '';
  form.startDate = '';
  form.planEndDate = '';
  form.templateId = undefined;
  form.remark = '';
  formRef.value?.clearValidate();
}

async function openCreate() {
  dialog.mode = 'create';
  dialog.id = 0;
  resetForm();

  await loadTemplates();

  const defaultTemplate = templates.value.find(item => item.isDefault) || templates.value[0];
  form.templateId = defaultTemplate?.id;

  dialog.visible = true;
}

async function openEdit(row: ProjectListItem) {
  dialog.mode = 'edit';
  dialog.id = row.id;
  resetForm();

  const { data, error } = await fetchProjectDetail(row.id);

  if (!error && data) {
    form.name = data.name;
    form.address = data.address;
    form.area = data.area ?? '';
    form.contractAmount = data.contractAmount;
    form.startDate = data.startDate;
    form.planEndDate = data.planEndDate;
    form.templateId = data.templateId;
    form.remark = data.remark ?? '';
  }

  dialog.visible = true;
}

async function submitForm() {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  dialog.submitting = true;

  try {
    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      area: form.area.trim() || undefined,
      contractAmount: form.contractAmount.trim(),
      startDate: form.startDate,
      planEndDate: form.planEndDate,
      remark: form.remark.trim() || undefined
    };

    const { data, error } =
      dialog.mode === 'create'
        ? await fetchCreateProject({ ...payload, templateId: form.templateId })
        : await fetchUpdateProject(dialog.id, payload);

    if (error) return;

    ElMessage.success(dialog.mode === 'create' ? '项目已创建' : '项目已更新');
    dialog.visible = false;

    if (dialog.mode === 'create' && data && 'needsCoordinates' in data && data.needsCoordinates) {
      ElMessage.warning('地址未能自动解析坐标，可在项目详情页手工拾取');
    }

    await load();
  } finally {
    dialog.submitting = false;
  }
}

// ── 状态流转 / 归档 / 删除 ──

const statusOrder: ProjectStatus[] = ['pending', 'building', 'finished', 'archived'];

function availableStatuses(row: ProjectListItem) {
  return statusOrder
    .filter(status => status !== row.status)
    .map(status => ({
      value: status,
      label: PROJECT_STATUS_META[status]?.label || status,
      reverse: statusOrder.indexOf(status) < statusOrder.indexOf(row.status)
    }));
}

async function changeStatus(row: ProjectListItem, target: ProjectStatus, reverse: boolean) {
  const label = PROJECT_STATUS_META[target]?.label || target;

  try {
    await ElMessageBox.confirm(
      reverse
        ? `将「${row.name}」从「${row.statusLabel}」退回「${label}」需要二次确认，且会写入操作日志。`
        : `确认将「${row.name}」流转到「${label}」？`,
      '状态流转',
      { type: 'warning', confirmButtonText: '确认流转', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchChangeProjectStatus(row.id, target, reverse);

  if (!error) {
    ElMessage.success('状态已更新');
    await load();
  }
}

async function archive(row: ProjectListItem) {
  try {
    await ElMessageBox.confirm(
      `归档后「${row.name}」全链路只读，C 端与 B 端的所有写操作都会被拒绝。`,
      '归档项目',
      { type: 'warning', confirmButtonText: '确认归档', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchArchiveProject(row.id, true);

  if (!error) {
    ElMessage.success('项目已归档');
    await load();
  }
}

async function restoreArchived(row: ProjectListItem) {
  try {
    await ElMessageBox.confirm(`确认解除「${row.name}」的归档状态？`, '解除归档', {
      type: 'warning',
      confirmButtonText: '解除归档',
      cancelButtonText: '取消'
    });
  } catch {
    return;
  }

  const { error } = await fetchChangeProjectStatus(row.id, 'finished', true);

  if (!error) {
    ElMessage.success('已解除归档');
    await load();
  }
}

async function remove(row: ProjectListItem) {
  try {
    await ElMessageBox.confirm(
      `确认删除「${row.name}」？这是软删除，数据仍可恢复，但默认列表不再展示。`,
      '删除项目',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchDeleteProject(row.id, true);

  if (!error) {
    ElMessage.success('项目已删除');
    await load();
  }
}

function openDetail(row: ProjectListItem) {
  router.push(`/project/detail/${row.id}`);
}

// ── 批量操作 ──

const batchResult = reactive({
  visible: false,
  title: '',
  result: null as BatchResult | null
});

function showBatchResult(title: string, result: BatchResult) {
  batchResult.title = title;
  batchResult.result = result;
  batchResult.visible = true;
}

async function batchArchiveSelected() {
  if (!selectedIds.value.length) return;

  try {
    await ElMessageBox.confirm(
      `确认归档选中的 ${selectedIds.value.length} 个项目？归档后全链路只读，C 端与 B 端写操作都会被拒绝。`,
      '批量归档',
      { type: 'warning', confirmButtonText: '确认归档', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { data, error } = await fetchBatchArchive(selectedIds.value);

  if (!error && data) {
    showBatchResult('批量归档结果', data);
    await load();
  }
}

const assignDialog = reactive({ visible: false, submitting: false, phone: '' });

function openBatchAssign() {
  if (!selectedIds.value.length) return;

  assignDialog.phone = '';
  assignDialog.visible = true;
}

async function submitBatchAssign() {
  if (!/^1[3-9]\d{9}$/.test(assignDialog.phone.trim())) {
    ElMessage.warning('请输入正确的手机号');
    return;
  }

  assignDialog.submitting = true;

  try {
    const { data, error } = await fetchBatchAssign(selectedIds.value, assignDialog.phone.trim());

    if (error || !data) return;

    assignDialog.visible = false;
    showBatchResult('批量分配工长结果', data);
    await load();
  } finally {
    assignDialog.submitting = false;
  }
}

// ── 导出 ──

async function exportExcel() {
  const { data, error, response } = await fetchExportProjects({
    name: query.name.trim() || undefined,
    address: query.address.trim() || undefined,
    status: query.status || undefined
  });

  if (error || !data) return;

  if (!(data instanceof Blob)) {
    ElMessage.success('导出任务已提交');
    return;
  }

  // 大数据量时服务端返回 202 + JSON（被 axios 包成 application/json 的 Blob），
  // 此时不是文件，而是一张「已转异步」的回执
  if (data.type && data.type.includes('json')) {
    try {
      const payload = JSON.parse(await data.text());
      ElMessage.success(payload.message || '数据量较大，已转后台生成，可到「我的导出」查看');
    } catch {
      ElMessage.success('导出任务已提交');
    }
    return;
  }

  const disposition =
    response?.headers?.['content-disposition'] ||
    (response?.headers as any)?.get?.('content-disposition') ||
    '';
  const match = String(disposition).match(/filename\*=UTF-8''([^;]+)/);
  const filename = match ? decodeURIComponent(match[1]) : '项目列表.xlsx';

  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  ElMessage.success('导出完成');
}

onMounted(async () => {
  await load();

  if (route.query.create === '1') {
    openCreate();
  }

  // 从详情页点「编辑」跳回来时，列表项可能不在当前页 —— 只需要 id，
  // openEdit 会自己再取一次详情
  if (route.query.edit) {
    openEdit({ id: Number(route.query.edit) } as ProjectListItem);
  }
});
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-col gap-10px">
          <div class="flex flex-wrap items-center justify-between gap-12px">
            <span class="font-600">项目列表</span>
            <div class="flex flex-wrap items-center gap-8px">
              <ElInput v-model="query.name" class="w-170px" clearable placeholder="项目名称" @keyup.enter="search" />
              <ElInput v-model="query.address" class="w-190px" clearable placeholder="项目地址" @keyup.enter="search" />
              <ElSelect v-model="query.status" class="w-120px" clearable placeholder="项目状态">
                <ElOption label="待开工" value="pending" />
                <ElOption label="施工中" value="building" />
                <ElOption label="已完工" value="finished" />
                <ElOption label="已归档" value="archived" />
              </ElSelect>
              <ElButton type="primary" @click="search">查询</ElButton>
              <ElButton @click="resetQuery">重置</ElButton>
              <ElButton v-if="!readOnly" type="primary" plain @click="openCreate">新建项目</ElButton>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-8px border-t border-#f2f3f5 pt-10px">
            <span class="text-12px" :class="readOnly ? 'text-#e6a23c' : 'text-#86909c'">
              {{
                readOnly
                  ? '只读排障模式：可查看项目详情，不能新建、修改或批量操作'
                  : selectedIds.length
                    ? `已选 ${selectedIds.length} 个项目`
                    : '勾选项目后可批量归档或分配工长'
              }}
            </span>
            <div class="flex flex-wrap gap-8px">
              <template v-if="!readOnly">
                <ElButton size="small" :disabled="!selectedIds.length" @click="batchArchiveSelected">
                  批量归档
                </ElButton>
                <ElButton size="small" :disabled="!selectedIds.length" @click="openBatchAssign">
                  批量分配工长
                </ElButton>
              </template>
              <ElButton size="small" @click="exportExcel">导出 Excel</ElButton>
              <ElButton size="small" @click="router.push('/export-task')">我的导出</ElButton>
            </div>
          </div>
        </div>
      </template>

      <ElTable v-loading="loading" :data="list" row-key="id" stripe @selection-change="onSelectionChange">
        <ElTableColumn v-if="!readOnly" type="selection" width="42" />
        <ElTableColumn prop="name" label="项目名称" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <ElButton link type="primary" @click="openDetail(row)">{{ row.name }}</ElButton>
            <ElTag v-if="row.isOverdue" class="ml-6px" type="danger" size="small">延期</ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn prop="address" label="地址" min-width="180" show-overflow-tooltip />

        <ElTableColumn prop="status" label="状态" width="86">
          <template #default="{ row }">
            <ElTag :type="PROJECT_STATUS_META[row.status]?.type || 'info'" size="small">
              {{ PROJECT_STATUS_META[row.status]?.label || row.statusLabel }}
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="工长" width="90">
          <template #default="{ row }">
            <span v-if="row.foreman">{{ row.foreman.nickname || `用户 #${row.foreman.userId}` }}</span>
            <span v-else class="text-#c0c4cc">未分配</span>
          </template>
        </ElTableColumn>

        <ElTableColumn label="总进度" width="130">
          <template #default="{ row }">
            <ElProgress :percentage="Number(row.progress) || 0" :stroke-width="8" />
          </template>
        </ElTableColumn>

        <ElTableColumn prop="contractAmount" label="合同金额" width="120" align="right">
          <template #default="{ row }">¥ {{ formatMoney(row.contractAmount) }}</template>
        </ElTableColumn>

        <ElTableColumn label="开工 / 计划竣工" width="160">
          <template #default="{ row }">
            <div class="text-13px">{{ formatDate(row.startDate) }}</div>
            <div class="text-12px text-#86909c">{{ formatDate(row.planEndDate) }}</div>
          </template>
        </ElTableColumn>

        <ElTableColumn label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <div class="action-cell">
              <ElButton link type="primary" @click="openDetail(row)">详情</ElButton>
              <ElButton v-if="!readOnly" link type="primary" @click="openEdit(row)">编辑</ElButton>

              <ElDropdown v-if="!readOnly" trigger="click" @command="command => command(row)">
                <ElButton link type="primary">更多</ElButton>
                <template #dropdown>
                  <ElDropdownMenu>
                    <ElDropdownItem
                      v-for="item in availableStatuses(row)"
                      :key="item.value"
                      :command="() => changeStatus(row, item.value, item.reverse)"
                    >
                      流转到{{ item.label }}{{ item.reverse ? '（退回）' : '' }}
                    </ElDropdownItem>

                    <ElDropdownItem v-if="row.status !== 'archived'" :command="() => archive(row)">
                      归档
                    </ElDropdownItem>

                    <ElDropdownItem
                      v-if="row.status === 'archived' && isOwner"
                      :command="() => restoreArchived(row)"
                    >
                      解除归档
                    </ElDropdownItem>

                    <ElDropdownItem v-if="isOwner" divided :command="() => remove(row)">
                      删除项目
                    </ElDropdownItem>
                  </ElDropdownMenu>
                </template>
              </ElDropdown>
            </div>
          </template>
        </ElTableColumn>

        <template #empty>
          <ElEmpty description="暂无项目" />
        </template>
      </ElTable>

      <div class="mt-16px flex justify-end">
        <ElPagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </ElCard>

    <!-- 新建 / 编辑 -->
    <ElDialog
      v-model="dialog.visible"
      :title="dialog.mode === 'create' ? '新建项目' : '编辑项目'"
      width="680px"
      destroy-on-close
    >
      <ElForm ref="formRef" :model="form" :rules="rules" label-width="104px">
        <ElFormItem label="项目名称" prop="name">
          <ElInput v-model="form.name" maxlength="50" show-word-limit placeholder="请输入项目名称" />
        </ElFormItem>

        <ElFormItem label="项目地址" prop="address">
          <ElInput v-model="form.address" maxlength="200" placeholder="保存后自动解析坐标，失败可在详情页手工拾取" />
        </ElFormItem>

        <ElFormItem label="户型面积">
          <ElInput v-model="form.area" placeholder="㎡，最多两位小数（可不填）">
            <template #append>㎡</template>
          </ElInput>
        </ElFormItem>

        <ElFormItem label="合同金额" prop="contractAmount">
          <ElInput v-model="form.contractAmount" placeholder="例如 128000.00">
            <template #prepend>¥</template>
          </ElInput>
        </ElFormItem>

        <ElFormItem label="开工日期" prop="startDate">
          <ElDatePicker
            v-model="form.startDate"
            class="w-full"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择开工日期"
          />
        </ElFormItem>

        <ElFormItem label="计划竣工" prop="planEndDate">
          <ElDatePicker
            v-model="form.planEndDate"
            class="w-full"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择计划竣工日期"
          />
        </ElFormItem>

        <ElFormItem v-if="dialog.mode === 'create'" label="阶段模板">
          <ElSelect v-model="form.templateId" class="w-full" placeholder="默认使用租户的默认模板">
            <ElOption
              v-for="item in templates"
              :key="item.id"
              :label="`${item.name}（${item.stageCount} 阶段 / ${item.itemCount} 工序）${item.isDefault ? ' · 默认' : ''}`"
              :value="item.id"
            />
          </ElSelect>
          <div class="pt-4px text-12px text-#86909c">
            保存时会把模板的阶段与工序整套拷贝到项目，之后修改模板不影响已生成的项目。
          </div>
        </ElFormItem>

        <ElFormItem label="备注">
          <ElInput v-model="form.remark" type="textarea" :rows="3" maxlength="500" show-word-limit />
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="dialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="dialog.submitting" @click="submitForm">保存</ElButton>
      </template>
    </ElDialog>

    <!-- 批量分配工长 -->
    <ElDialog v-model="assignDialog.visible" title="批量分配工长" width="480px">
      <ElAlert
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        :title="`将 ${selectedIds.length} 个项目的工长替换为同一人`"
        description="按手机号邀请；对方在小程序确认前为 pending，不计入权限。已有工长的项目会在本次操作中替换。"
      />
      <ElForm label-width="80px">
        <ElFormItem label="手机号" required>
          <ElInput v-model="assignDialog.phone" maxlength="11" placeholder="请输入工长手机号" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="assignDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="assignDialog.submitting" @click="submitBatchAssign">
          确认分配
        </ElButton>
      </template>
    </ElDialog>

    <!-- 批量结果：逐条列出失败项与原因（AC-AD60） -->
    <ElDialog v-model="batchResult.visible" :title="batchResult.title" width="560px">
      <template v-if="batchResult.result">
        <ElResult
          :icon="batchResult.result.failureCount ? 'warning' : 'success'"
          :title="`成功 ${batchResult.result.successCount} 个，失败 ${batchResult.result.failureCount} 个`"
          :sub-title="`共处理 ${batchResult.result.total} 个项目`"
        />
        <ElTable
          v-if="batchResult.result.failures.length"
          :data="batchResult.result.failures"
          size="small"
          border
        >
          <ElTableColumn prop="projectId" label="项目 ID" width="110" />
          <ElTableColumn prop="reason" label="失败原因" />
        </ElTable>
      </template>
      <template #footer>
        <ElButton type="primary" @click="batchResult.visible = false">知道了</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
/*
 * Element Plus 的 ElDropdown 会给触发元素包一层 inline-flex 且
 * vertical-align: top，而普通 ElButton 是 vertical-align: middle ——
 * 同一个单元格里“更多”就会比“详情 / 编辑”高 3px 左右。
 * 用 flex 容器统一基线，并去掉相邻按钮的 margin，间距交给 gap。
 */
.action-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.action-cell :deep(.el-button + .el-button) {
  margin-left: 0;
}

.action-cell :deep(.el-dropdown) {
  display: flex;
  align-items: center;
}

.action-cell :deep(.el-dropdown .el-button) {
  margin-left: 0;
}
</style>
