<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { fetchDownloadExport, fetchExports, type ExportTask } from '@/service/api/exportTask';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'ExportTaskPage' });

const STATUS_META: Record<string, { type: 'info' | 'primary' | 'success' | 'danger' }> = {
  pending: { type: 'info' },
  running: { type: 'primary' },
  success: { type: 'success' },
  failed: { type: 'danger' }
};

const loading = ref(false);
const list = ref<ExportTask[]>([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 20 });
const downloadingId = ref(0);

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchExports({ page: query.page, pageSize: query.pageSize });

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

async function download(row: ExportTask) {
  downloadingId.value = row.id;

  try {
    const { data, error, response } = await fetchDownloadExport(row.id);

    if (error || !data || !(data instanceof Blob)) return;

    const disposition =
      response?.headers?.['content-disposition'] ||
      (response?.headers as any)?.get?.('content-disposition') ||
      '';
    const match = String(disposition).match(/filename\*=UTF-8''([^;]+)/);
    const filename = match ? decodeURIComponent(match[1]) : `项目列表_${row.id}.xlsx`;

    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    ElMessage.success('下载已开始');
  } finally {
    downloadingId.value = 0;
  }
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <span class="font-600">我的导出</span>
          <div class="flex items-center gap-8px">
            <span class="text-12px text-#86909c">只能下载自己发起的导出任务</span>
            <ElButton @click="load">刷新</ElButton>
          </div>
        </div>
      </template>

      <ElAlert
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        title="数据量超过 2000 行时转为后台生成"
        description="同步导出会直接下载；异步任务完成后出现在这里，同时会收到一条后台消息。文件含合同金额，仅发起人可下载。"
      />

      <ElTable v-loading="loading" :data="list" row-key="id" stripe>
        <ElTableColumn prop="id" label="任务 ID" width="100">
          <template #default="{ row }">#{{ row.id }}</template>
        </ElTableColumn>

        <ElTableColumn label="状态" width="110">
          <template #default="{ row }">
            <ElTag :type="STATUS_META[row.status]?.type || 'info'" size="small">
              {{ row.statusLabel }}
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="行数" width="100" align="right">
          <template #default="{ row }">{{ row.rowCount ?? '—' }}</template>
        </ElTableColumn>

        <ElTableColumn label="创建时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </ElTableColumn>

        <ElTableColumn label="完成时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.finishedAt) }}</template>
        </ElTableColumn>

        <ElTableColumn label="失败原因" min-width="220">
          <template #default="{ row }">{{ row.error || '—' }}</template>
        </ElTableColumn>

        <ElTableColumn label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <ElButton
              v-if="row.status === 'success'"
              link
              type="primary"
              :loading="downloadingId === row.id"
              @click="download(row)"
            >
              下载
            </ElButton>
            <span v-else class="text-12px text-#c0c4cc">—</span>
          </template>
        </ElTableColumn>

        <template #empty>
          <ElEmpty description="还没有导出任务" />
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
          @size-change="load"
        />
      </div>
    </ElCard>
  </div>
</template>

<style scoped></style>
