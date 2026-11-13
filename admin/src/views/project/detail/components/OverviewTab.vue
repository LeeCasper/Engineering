<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  fetchGenerateProjectCompletionReport,
  fetchProjectCompletionReport,
  type ProjectCompletionReport,
  type ProjectDetail
} from '@/service/api/project';
import {
  fetchProjectVisitThreshold,
  fetchResetProjectVisitThreshold,
  fetchUpdateProjectVisitThreshold,
  type VisitThresholdConfig
} from '@/service/api/visitStats';
import { useAuthStore } from '@/store/modules/auth';
import { useTenantReadOnly } from '@/hooks/common/tenant';
import { openSignedApiPath } from '@/utils/signed-url';
import { formatDate, formatMoney, GATE_STATUS_META, PAYMENT_STATUS_META } from '@/utils/format';

defineOptions({ name: 'ProjectOverviewTab' });

const props = defineProps<{ detail: ProjectDetail }>();
const readOnly = useTenantReadOnly();
const authStore = useAuthStore();

const completionReport = ref<ProjectCompletionReport | null>(null);
const completionLoading = ref(false);

// 总报告包含账务汇总，只在项目完工/归档后提供
const reportable = computed(() => ['finished', 'archived'].includes(props.detail.status));
const reportStatus = computed(() => completionReport.value?.status || 'none');
const reportButtonText = computed(() => {
  if (completionLoading.value || reportStatus.value === 'pending') return '生成中…';
  if (reportStatus.value === 'success') return '查看总报告';
  if (reportStatus.value === 'failed') return '重新生成';
  return '生成总报告';
});

async function loadCompletionReport() {
  if (!reportable.value) return;
  const { data } = await fetchProjectCompletionReport(props.detail.id);
  if (data) completionReport.value = data;
}

// ── 签到偏差阈值（B-5.1）──
//
// 项目级覆盖优先于租户 / 平台配置。界面必须同时展示「生效值来自哪一层」，
// 否则管理员看到 500 会以为是自己设的，实际可能只是继承了租户默认值。
const SOURCE_LABELS: Record<string, string> = {
  project: '本项目单独设置',
  tenant: '租户配置',
  platform: '平台基础配置',
  default: '系统默认值'
};

const threshold = ref<VisitThresholdConfig | null>(null);
const thresholdDraft = ref('');
const thresholdSaving = ref(false);
// 写权限：租户 owner（§5.5 要求项目管理员只能查看），且不在只读排障窗口内
const canEditThreshold = computed(() => authStore.isTenantOwner && !readOnly.value);

async function loadThreshold() {
  const { data } = await fetchProjectVisitThreshold(props.detail.id);

  if (data) {
    threshold.value = data;
    thresholdDraft.value = data.value;
  }
}

async function saveThreshold() {
  if (!threshold.value) return;

  const value = String(thresholdDraft.value).trim();
  if (!/^\d+$/.test(value)) {
    ElMessage.warning('阈值必须是正整数（米）');
    return;
  }

  thresholdSaving.value = true;

  try {
    const { data, error } = await fetchUpdateProjectVisitThreshold(props.detail.id, value);

    if (error || !data) return;

    threshold.value = data;
    thresholdDraft.value = data.value;
    ElMessage.success(
      data.changed ? '已保存，仅影响之后的新签到' : '与当前值一致，未做修改'
    );
  } finally {
    thresholdSaving.value = false;
  }
}

async function resetThreshold() {
  if (!threshold.value) return;

  try {
    await ElMessageBox.confirm(
      `清除后本项目将跟随「${SOURCE_LABELS[threshold.value.tenantSource] || '租户配置'}」（${threshold.value.tenantValue} 米）。历史签到的判定结果不受影响。`,
      '清除项目覆盖',
      { type: 'warning', confirmButtonText: '清除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { data, error } = await fetchResetProjectVisitThreshold(props.detail.id);

  if (error || !data) return;

  threshold.value = data;
  thresholdDraft.value = data.value;
  ElMessage.success('已恢复为跟随全局配置');
}

onMounted(() => {
  loadCompletionReport();
  loadThreshold();
});

async function openCompletionReport(refresh = false) {
  if (completionLoading.value || reportStatus.value === 'pending') return;

  if (!refresh && completionReport.value?.status === 'success' && completionReport.value.signedPath) {
    openSignedApiPath(completionReport.value.signedPath);
    return;
  }

  if (readOnly.value) {
    ElMessage.warning('当前为只读排障窗口，不能生成报告');
    return;
  }

  completionLoading.value = true;
  try {
    const { data, error } = await fetchGenerateProjectCompletionReport(props.detail.id, { refresh });
    if (data) {
      completionReport.value = data;
      if (data.status === 'success' && data.signedPath) {
        openSignedApiPath(data.signedPath);
      } else if (data.status === 'failed') {
        ElMessage.error(data.error || '总报告生成失败');
      }
    } else if (error) {
      ElMessage.error(error.message || '总报告生成失败');
    }
  } finally {
    completionLoading.value = false;
  }
}


const itemCount = computed(() => props.detail.stages.reduce((sum, stage) => sum + stage.items.length, 0));

/** 仅用于展示的节点合计。真正的金额运算全部在后端 decimal.js 里完成 */
const paymentTotal = computed(() => {
  const cents = props.detail.paymentNodes.reduce(
    (sum, node) => sum + Math.round(Number(node.amount) * 100),
    0
  );

  return (cents / 100).toFixed(2);
});

const compositionMissing = computed(() => {
  const c = props.detail.memberComposition;
  const missing: string[] = [];

  if (!c.foremanCount) missing.push('至少 1 名已确认的工长');
  if (c.foremanCount && !c.primaryForemanUserId) missing.push('指定 1 名主工长');
  if (!c.ownerCount) missing.push('至少 1 名已确认的业主');
  if (c.ownerCount && !c.primaryOwnerUserId) missing.push('指定 1 名主业主');
  if (c.primaryOwnerUserId && !c.primaryOwnerActive) missing.push('主业主确认邀请');

  return missing;
});
</script>

<template>
  <div>
    <ElAlert
      v-if="!detail.memberComposition.meetsRequirement"
      class="mb-16px"
      type="warning"
      :closable="false"
      show-icon
      title="人员尚未配齐，不能流转到「施工中」"
      :description="`缺少：${compositionMissing.join('、')}。pending（待确认）成员不计入任何权限判定。`"
    />

    <div
      v-if="reportable"
      class="mb-16px flex items-center justify-between rounded-8px border border-solid border-#ebeef5 bg-white p-16px"
    >
      <div>
        <div class="font-600">项目竣工总报告</div>
        <div class="mt-4px text-12px text-#86909c">
          <template v-if="reportStatus === 'success'">
            已生成{{ completionReport?.generatedAt ? ` · ${formatDate(completionReport.generatedAt)}` : '' }}
          </template>
          <template v-else-if="reportStatus === 'pending'">正在生成，请稍候…</template>
          <template v-else-if="reportStatus === 'failed'">
            {{ completionReport?.error || '生成失败，可重试' }}
          </template>
          <template v-else>汇总各阶段验收、签名与账务，生成后可下载 PDF 归档</template>
        </div>
      </div>
      <div class="flex items-center gap-12px">
        <ElButton
          v-if="reportStatus === 'success' && !readOnly"
          link
          type="primary"
          :loading="completionLoading"
          @click="openCompletionReport(true)"
        >
          重新生成
        </ElButton>
        <ElButton
          type="primary"
          :loading="completionLoading || reportStatus === 'pending'"
          :disabled="readOnly && reportStatus !== 'success'"
          @click="openCompletionReport(false)"
        >
          {{ reportButtonText }}
        </ElButton>
      </div>
    </div>

    <ElDescriptions :column="3" border>
      <ElDescriptionsItem label="项目地址" :span="3">{{ detail.address }}</ElDescriptionsItem>
      <ElDescriptionsItem label="户型面积">{{ detail.area ? `${detail.area} ㎡` : '-' }}</ElDescriptionsItem>
      <ElDescriptionsItem label="合同金额">¥ {{ formatMoney(detail.contractAmount) }}</ElDescriptionsItem>
      <ElDescriptionsItem label="阶段 / 工序">
        {{ detail.stages.length }} 个阶段 / {{ itemCount }} 个工序
      </ElDescriptionsItem>
      <ElDescriptionsItem label="开工日期">{{ formatDate(detail.startDate) }}</ElDescriptionsItem>
      <ElDescriptionsItem label="计划竣工">{{ formatDate(detail.planEndDate) }}</ElDescriptionsItem>
      <ElDescriptionsItem label="实际竣工">{{ formatDate(detail.actualEndDate) }}</ElDescriptionsItem>
      <ElDescriptionsItem label="模板编号">#{{ detail.templateId }}</ElDescriptionsItem>
      <ElDescriptionsItem label="坐标">
        <span v-if="detail.needsCoordinates" class="text-#e6a23c">未拾取，可在编辑中手工填写</span>
        <span v-else>{{ detail.longitude }}, {{ detail.latitude }}</span>
      </ElDescriptionsItem>
      <ElDescriptionsItem label="归档时间">{{ formatDate(detail.archivedAt) }}</ElDescriptionsItem>
      <ElDescriptionsItem label="备注" :span="3">{{ detail.remark || '-' }}</ElDescriptionsItem>
    </ElDescriptions>

    <!-- 签到偏差阈值（B-5.1） -->
    <div class="mt-20px">
      <div class="mb-10px flex flex-wrap items-center justify-between gap-8px">
        <span class="font-600">签到偏差阈值</span>
        <div v-if="threshold" class="flex items-center gap-8px">
          <ElButton
            v-if="threshold.hasOverride"
            :disabled="!canEditThreshold"
            @click="resetThreshold"
          >
            清除覆盖
          </ElButton>
          <ElButton type="primary" :disabled="!canEditThreshold" :loading="thresholdSaving" @click="saveThreshold">
            保存
          </ElButton>
        </div>
      </div>

      <div v-if="threshold" class="flex flex-wrap items-center gap-12px">
        <ElInput
          v-model="thresholdDraft"
          class="w-200px"
          :disabled="!canEditThreshold"
          placeholder="例如 500"
        >
          <template #append>米</template>
        </ElInput>
        <ElTag :type="threshold.hasOverride ? 'success' : 'info'" size="small">
          生效：{{ threshold.value }} 米（{{ SOURCE_LABELS[threshold.source] || threshold.source }}）
        </ElTag>
        <span class="text-12px text-#86909c">
          清除覆盖后跟随 {{ SOURCE_LABELS[threshold.tenantSource] || threshold.tenantSource }}（{{ threshold.tenantValue }} 米）
        </span>
      </div>

      <div class="mt-6px text-12px text-#86909c">
        偏差未超过阈值判为正常，超过则必须填写异常说明才能提交；修改只影响之后的新签到，历史记录保留当时的阈值快照。
        <span v-if="!canEditThreshold">仅租户管理员可修改，当前账号为只读查看。</span>
      </div>
    </div>

    <!-- 阶段概况 -->
    <div class="mt-20px">
      <div class="mb-10px font-600">阶段概况</div>
      <ElTable :data="detail.stages" row-key="id" size="small" border>
        <ElTableColumn prop="seq" label="#" width="56" align="center" />
        <ElTableColumn prop="name" label="阶段" min-width="160" />
        <ElTableColumn label="门禁状态" width="110">
          <template #default="{ row }">
            <ElTag :type="GATE_STATUS_META[row.gateStatus]?.type || 'info'" size="small">
              {{ GATE_STATUS_META[row.gateStatus]?.label || row.gateStatus }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="完成度" width="160">
          <template #default="{ row }">
            <ElProgress :percentage="Number(row.progress) || 0" :stroke-width="7" />
          </template>
        </ElTableColumn>
        <ElTableColumn label="工序数" width="86" align="center">
          <template #default="{ row }">{{ row.items.length }}</template>
        </ElTableColumn>
        <ElTableColumn label="计划起止" width="190">
          <template #default="{ row }">
            {{ formatDate(row.planStart) }} ~ {{ formatDate(row.planEnd) }}
          </template>
        </ElTableColumn>
      </ElTable>
    </div>

    <!-- 付款节点概况 -->
    <div class="mt-20px">
      <div class="mb-10px flex items-center justify-between">
        <span class="font-600">付款节点</span>
        <span class="text-13px text-#86909c">
          共 {{ detail.paymentNodes.length }} 个节点，合计 ¥ {{ formatMoney(paymentTotal) }}
        </span>
      </div>
      <ElTable :data="detail.paymentNodes" row-key="id" size="small" border>
        <ElTableColumn prop="seq" label="#" width="56" align="center" />
        <ElTableColumn prop="name" label="节点" min-width="140" />
        <ElTableColumn label="金额" width="140" align="right">
          <template #default="{ row }">¥ {{ formatMoney(row.amount) }}</template>
        </ElTableColumn>
        <ElTableColumn label="触发方式" width="120">
          <template #default="{ row }">
            {{ row.triggerType === 'stage_acceptance' ? '阶段验收' : '手工' }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="100">
          <template #default="{ row }">
            <ElTag :type="PAYMENT_STATUS_META[row.status]?.type || 'info'" size="small">
              {{ PAYMENT_STATUS_META[row.status]?.label || row.status }}
            </ElTag>
          </template>
        </ElTableColumn>
        <template #empty>
          <ElEmpty description="尚未配置付款节点" :image-size="60" />
        </template>
      </ElTable>
    </div>
  </div>
</template>

<style scoped></style>
