<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  fetchPaymentNodes,
  fetchReplacePaymentNodes,
  fetchUnlockPaymentNode,
  type PaymentNode,
  type PaymentNodeInput,
  type ProjectDetail
} from '@/service/api/project';
import { useTenantReadOnly } from '@/hooks/common/tenant';
import { formatDate, formatMoney, PAYMENT_STATUS_META } from '@/utils/format';

defineOptions({ name: 'PaymentNodesTab' });

const props = defineProps<{ projectId: number; detail: ProjectDetail }>();
const emit = defineEmits<{ refresh: [] }>();

const readOnly = useTenantReadOnly();
const loading = ref(false);
const nodes = ref<PaymentNode[]>([]);
const contractAmount = ref('0.00');
const nodesTotal = ref('0.00');
const difference = ref('0.00');
const mismatched = ref(false);

const stageNameMap = computed(() => {
  const map = new Map<number, string>();
  props.detail.stages.forEach(stage => map.set(stage.id, stage.name));
  return map;
});

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchPaymentNodes(props.projectId);

    if (!error && data) {
      nodes.value = data.nodes;
      contractAmount.value = data.contractAmount;
      nodesTotal.value = data.nodesTotal;
      difference.value = data.difference;
      mismatched.value = data.mismatched;
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// ── 编辑（整体替换） ──

const editDialog = reactive({ visible: false, submitting: false });
const editNodes = ref<PaymentNodeInput[]>([]);

function openEdit() {
  editNodes.value = nodes.value.length
    ? nodes.value.map(node => ({
        name: node.name,
        amount: node.amount,
        triggerType: node.triggerType,
        triggerStageId: node.triggerStageId ?? undefined
      }))
    : [{ name: '', amount: '', triggerType: 'manual' }];

  editDialog.visible = true;
}

function addNode() {
  editNodes.value.push({ name: '', amount: '', triggerType: 'manual' });
}

function removeNode(index: number) {
  editNodes.value.splice(index, 1);
}

async function submitEdit() {
  for (let index = 0; index < editNodes.value.length; index += 1) {
    const node = editNodes.value[index];

    if (!node.name.trim()) {
      ElMessage.warning(`第 ${index + 1} 个节点缺少名称`);
      return;
    }

    if (!/^\d+(\.\d{1,2})?$/.test(node.amount) || Number(node.amount) < 0) {
      ElMessage.warning(`第 ${index + 1} 个节点金额格式不正确`);
      return;
    }

    if (node.triggerType === 'stage_acceptance' && !node.triggerStageId) {
      ElMessage.warning(`第 ${index + 1} 个节点选择了阶段验收触发，但没有选择阶段`);
      return;
    }
  }

  editDialog.submitting = true;

  try {
    const payload = editNodes.value.map(node => ({
      name: node.name.trim(),
      amount: node.amount,
      triggerType: node.triggerType,
      triggerStageId: node.triggerType === 'stage_acceptance' ? node.triggerStageId : undefined
    }));

    const { error } = await fetchReplacePaymentNodes(props.projectId, payload);

    if (error) return;

    ElMessage.success('付款节点已保存');
    editDialog.visible = false;
    await load();
    emit('refresh');
  } finally {
    editDialog.submitting = false;
  }
}

async function unlock(node: PaymentNode) {
  try {
    await ElMessageBox.confirm(
      `手工解锁付款节点「${node.name}」？该操作会写入操作日志。仅手工触发型节点可以解锁。`,
      '解锁付款节点',
      { type: 'warning', confirmButtonText: '确认解锁', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchUnlockPaymentNode(props.projectId, node.id);

  if (!error) {
    ElMessage.success('节点已解锁');
    await load();
    emit('refresh');
  }
}
</script>

<template>
  <div>
    <ElAlert
      v-if="mismatched"
      class="mb-14px"
      type="warning"
      :closable="false"
      show-icon
      title="各节点金额之和与合同总额不一致"
      :description="`合同金额 ¥${formatMoney(contractAmount)}，节点合计 ¥${formatMoney(nodesTotal)}，差额 ¥${formatMoney(difference)}。允许保存，但请确认这不是漏配。`"
    />

    <div class="mb-12px flex flex-wrap items-center justify-between gap-8px">
      <span class="text-13px text-#86909c">
        付款节点是整体配置：保存会按当前顺序重写全部节点。已产生收入流水的项目不允许替换。
      </span>
      <ElButton v-if="!readOnly" type="primary" plain @click="openEdit">编辑节点配置</ElButton>
    </div>

    <ElTable v-loading="loading" :data="nodes" row-key="id" border>
      <ElTableColumn prop="seq" label="#" width="56" align="center" />
      <ElTableColumn prop="name" label="节点名称" min-width="150" />
      <ElTableColumn label="金额" width="150" align="right">
        <template #default="{ row }">¥ {{ formatMoney(row.amount) }}</template>
      </ElTableColumn>
      <ElTableColumn label="触发方式" width="140">
        <template #default="{ row }">
          <span v-if="row.triggerType === 'stage_acceptance'">
            阶段验收：{{ stageNameMap.get(row.triggerStageId) || `#${row.triggerStageId}` }}
          </span>
          <span v-else>手工解锁</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="100">
        <template #default="{ row }">
          <ElTag :type="PAYMENT_STATUS_META[row.status]?.type || 'info'" size="small">
            {{ PAYMENT_STATUS_META[row.status]?.label || row.statusLabel }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn label="解锁时间" width="130">
        <template #default="{ row }">{{ formatDate(row.unlockedAt) }}</template>
      </ElTableColumn>
      <ElTableColumn v-if="!readOnly" label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <ElButton
            v-if="row.triggerType === 'manual' && row.status === 'not_started'"
            link
            type="primary"
            @click="unlock(row)"
          >
            手工解锁
          </ElButton>
        </template>
      </ElTableColumn>
      <template #empty>
        <ElEmpty description="尚未配置付款节点" :image-size="60" />
      </template>
    </ElTable>
  </div>

  <ElDialog v-model="editDialog.visible" title="付款节点配置" width="860px">
    <ElAlert
      class="mb-14px"
      type="info"
      :closable="false"
      show-icon
      title="保存即整体替换"
      description="顺序按下列行从上到下；已登记收入流水的项目替换会被拒绝，避免已付款流水指向被删除的节点。"
    />

    <div class="flex flex-col gap-10px">
      <div
        v-for="(node, index) in editNodes"
        :key="index"
        class="grid grid-cols-12 items-center gap-8px"
      >
        <span class="col-span-1 text-center text-13px text-#86909c">{{ index + 1 }}</span>
        <ElInput v-model="node.name" class="col-span-3" maxlength="50" placeholder="节点名称" />
        <ElInput v-model="node.amount" class="col-span-2" placeholder="金额">
          <template #prepend>¥</template>
        </ElInput>
        <ElSelect v-model="node.triggerType" class="col-span-3">
          <ElOption label="手工解锁" value="manual" />
          <ElOption label="阶段验收触发" value="stage_acceptance" />
        </ElSelect>
        <ElSelect
          v-model="node.triggerStageId"
          class="col-span-2"
          clearable
          :disabled="node.triggerType !== 'stage_acceptance'"
          placeholder="关联阶段"
        >
          <ElOption v-for="stage in detail.stages" :key="stage.id" :label="stage.name" :value="stage.id" />
        </ElSelect>
        <ElButton class="col-span-1" link type="danger" @click="removeNode(index)">删除</ElButton>
      </div>
    </div>

    <ElButton class="mt-12px" plain @click="addNode">添加节点</ElButton>

    <template #footer>
      <ElButton @click="editDialog.visible = false">取消</ElButton>
      <ElButton type="primary" :loading="editDialog.submitting" @click="submitEdit">保存</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped></style>
