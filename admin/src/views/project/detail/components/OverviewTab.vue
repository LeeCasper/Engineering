<script setup lang="ts">
import { computed } from 'vue';
import type { ProjectDetail } from '@/service/api/project';
import { formatDate, formatMoney, GATE_STATUS_META, PAYMENT_STATUS_META } from '@/utils/format';

defineOptions({ name: 'ProjectOverviewTab' });

const props = defineProps<{ detail: ProjectDetail }>();

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
