<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  fetchProjectAcceptanceReports,
  type AdminAcceptanceReport,
  type AdminAcceptanceReportList
} from '@/service/api/project';
import { openSignedApiPath } from '@/utils/signed-url';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'ProjectAcceptanceReportTab' });

const props = defineProps<{ projectId: number }>();

const STATUS_META: Record<
  AdminAcceptanceReport['status'],
  { label: string; type: 'info' | 'primary' | 'success' | 'warning' | 'danger' }
> = {
  draft: { label: '草稿', type: 'info' },
  pending_supervisor: { label: '待监理审核', type: 'warning' },
  pending_owner: { label: '待业主确认', type: 'warning' },
  pending_rectify: { label: '待整改', type: 'danger' },
  passed: { label: '已通过', type: 'success' }
};

const loading = ref(false);
const items = ref<AdminAcceptanceReport[]>([]);
const summary = ref<AdminAcceptanceReportList['summary']>({
  total: 0,
  passed: 0,
  inProgress: 0,
  reportReady: 0
});

const statusFilter = ref<'all' | 'passed' | 'pending' | 'rectify'>('all');
const typeFilter = ref<'all' | 'stage' | 'item'>('all');
const keyword = ref('');

const filteredItems = computed(() => {
  const term = keyword.value.trim().toLowerCase();

  return items.value.filter((item) => {
    if (typeFilter.value !== 'all' && item.type !== typeFilter.value) return false;

    if (statusFilter.value === 'passed' && item.status !== 'passed') return false;
    if (statusFilter.value === 'rectify' && item.status !== 'pending_rectify') return false;
    if (
      statusFilter.value === 'pending' &&
      (item.status === 'passed' || item.status === 'pending_rectify')
    ) {
      return false;
    }

    if (!term) return true;
    const haystack = [item.stageName, item.itemName, item.submitter, String(item.id)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  });
});

async function load() {
  loading.value = true;
  try {
    const { data, error } = await fetchProjectAcceptanceReports(props.projectId);
    if (data) {
      items.value = data.items;
      summary.value = data.summary;
    } else if (error) {
      ElMessage.error(error.message || '验收报告加载失败');
    }
  } finally {
    loading.value = false;
  }
}

watch(() => props.projectId, load, { immediate: true });

function resetFilters() {
  statusFilter.value = 'all';
  typeFilter.value = 'all';
  keyword.value = '';
}

function objectLabel(item: AdminAcceptanceReport) {
  if (item.type === 'item') return item.itemName || '工序验收';
  return item.stageName || '阶段验收';
}

function objectSub(item: AdminAcceptanceReport) {
  if (item.type !== 'item') return '';
  return item.stageName || '';
}

function statusMeta(status: string) {
  return (
    STATUS_META[status as keyof typeof STATUS_META] || {
      label: status,
      type: 'info' as const
    }
  );
}

function signatureLabel(item: AdminAcceptanceReport) {
  if (item.esignStatus === 'signed' || item.signatureMode === 'provider') return '可靠电子签';
  if (item.hasSignature) return '手写签名';
  return '未签名';
}

function reportMeta(item: AdminAcceptanceReport) {
  if (item.status !== 'passed') return { label: '—', type: 'info' as const };
  if (item.reportPdf.status === 'success') return { label: '已生成', type: 'success' as const };
  if (item.reportPdf.status === 'failed') return { label: '生成失败', type: 'danger' as const };
  return { label: '生成中', type: 'warning' as const };
}

function openReport(item: AdminAcceptanceReport) {
  if (!item.reportPdf.signedPath) return;
  openSignedApiPath(item.reportPdf.signedPath);
}
</script>

<template>
  <div v-loading="loading">
    <div class="mb-16px grid grid-cols-4 gap-12px max-md:grid-cols-2">
      <div class="rounded-8px border border-solid border-#ebeef5 bg-white p-14px">
        <div class="text-12px text-#86909c">验收单总数</div>
        <div class="mt-6px text-24px font-700 text-#1d2129">{{ summary.total }}</div>
      </div>
      <div class="rounded-8px border border-solid border-#ebeef5 bg-white p-14px">
        <div class="text-12px text-#86909c">已通过</div>
        <div class="mt-6px text-24px font-700 text-#00b42a">{{ summary.passed }}</div>
      </div>
      <div class="rounded-8px border border-solid border-#ebeef5 bg-white p-14px">
        <div class="text-12px text-#86909c">进行中</div>
        <div class="mt-6px text-24px font-700 text-#ff7d00">{{ summary.inProgress }}</div>
      </div>
      <div class="rounded-8px border border-solid border-#ebeef5 bg-white p-14px">
        <div class="text-12px text-#86909c">报告已生成</div>
        <div class="mt-6px text-24px font-700 text-#165dff">{{ summary.reportReady }}</div>
      </div>
    </div>

    <div class="mb-12px flex flex-wrap items-center gap-10px">
      <ElSelect v-model="statusFilter" class="w-130px" placeholder="状态">
        <ElOption label="全部状态" value="all" />
        <ElOption label="已通过" value="passed" />
        <ElOption label="进行中" value="pending" />
        <ElOption label="待整改" value="rectify" />
      </ElSelect>
      <ElSelect v-model="typeFilter" class="w-130px" placeholder="类型">
        <ElOption label="全部类型" value="all" />
        <ElOption label="阶段验收" value="stage" />
        <ElOption label="工序验收" value="item" />
      </ElSelect>
      <ElInput
        v-model="keyword"
        class="w-240px"
        clearable
        placeholder="搜索阶段 / 工序 / 提交人 / 编号"
      />
      <ElButton link type="primary" @click="resetFilters">重置</ElButton>
      <span class="ml-auto text-12px text-#86909c">
        共 {{ filteredItems.length }} 条
      </span>
    </div>

    <ElTable :data="filteredItems" row-key="id" border>
      <ElTableColumn label="编号" width="80">
        <template #default="{ row }">#{{ row.id }}</template>
      </ElTableColumn>

      <ElTableColumn label="类型" width="88">
        <template #default="{ row }">
          <ElTag :type="row.type === 'item' ? 'info' : 'primary'" size="small">
            {{ row.typeLabel }}
          </ElTag>
        </template>
      </ElTableColumn>

      <ElTableColumn label="验收对象" min-width="160">
        <template #default="{ row }">
          <div class="font-500">{{ objectLabel(row) }}</div>
          <div v-if="objectSub(row)" class="text-12px text-#86909c">{{ objectSub(row) }}</div>
        </template>
      </ElTableColumn>

      <ElTableColumn label="轮次" width="70" align="center">
        <template #default="{ row }">第 {{ row.round }} 轮</template>
      </ElTableColumn>

      <ElTableColumn label="状态" width="108">
        <template #default="{ row }">
          <ElTag :type="statusMeta(row.status).type" size="small">
            {{ statusMeta(row.status).label }}
          </ElTag>
        </template>
      </ElTableColumn>

      <ElTableColumn label="提交人" width="90">
        <template #default="{ row }">{{ row.submitter || '-' }}</template>
      </ElTableColumn>

      <ElTableColumn label="时间" width="184">
        <template #default="{ row }">
          <div class="text-12px text-#4e5969">提交 {{ formatDateTime(row.submittedAt) }}</div>
          <div class="text-12px text-#86909c">通过 {{ formatDateTime(row.finishedAt) }}</div>
        </template>
      </ElTableColumn>

      <ElTableColumn label="签名" width="94">
        <template #default="{ row }">
          <span :class="row.hasSignature ? 'text-#00b42a' : 'text-#c9cdd4'">
            {{ signatureLabel(row) }}
          </span>
        </template>
      </ElTableColumn>

      <ElTableColumn label="验收报告" min-width="150">
        <template #default="{ row }">
          <div class="flex items-center gap-6px">
            <ElTag :type="reportMeta(row).type" size="small">{{ reportMeta(row).label }}</ElTag>
            <ElButton
              v-if="row.reportPdf.signedPath"
              link
              type="primary"
              size="small"
              @click="openReport(row)"
            >
              下载
            </ElButton>
          </div>
        </template>
      </ElTableColumn>

      <template #empty>
        <ElEmpty description="当前筛选下没有验收记录" :image-size="72" />
      </template>
    </ElTable>
  </div>
</template>

<style scoped></style>
