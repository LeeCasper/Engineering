<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  fetchOperationLogFilters,
  fetchOperationLogs,
  type OperationLog,
  type OperationLogFilterModule
} from '@/service/api/log';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'OperationLogPage' });

const loading = ref(false);
const list = ref<OperationLog[]>([]);
const total = ref(0);

const modules = ref<OperationLogFilterModule[]>([]);
const dateRange = ref<string[]>([]);

const query = reactive({
  page: 1,
  pageSize: 20,
  module: '',
  action: '',
  operatorType: '' as '' | 'admin' | 'user' | 'system'
});

const actionOptions = computed(() => {
  if (!query.module) return [];
  return modules.value.find(item => item.module === query.module)?.actions || [];
});

const moduleLabels = computed(() => {
  const map = new Map<string, string>();
  modules.value.forEach(item => map.set(item.module, item.label));
  return map;
});

async function loadFilterOptions() {
  const { data } = await fetchOperationLogFilters();

  if (data) modules.value = data.modules;
}

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchOperationLogs({
      page: query.page,
      pageSize: query.pageSize,
      module: query.module || undefined,
      action: query.action || undefined,
      operatorType: query.operatorType || undefined,
      from: dateRange.value?.[0] || undefined,
      to: dateRange.value?.[1] || undefined
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

function onModuleChange() {
  query.action = '';
}

function search() {
  query.page = 1;
  load();
}

function resetQuery() {
  query.module = '';
  query.action = '';
  query.operatorType = '';
  dateRange.value = [];
  query.page = 1;
  load();
}

function operatorLabel(row: OperationLog) {
  if (row.operatorType === 'system') return '系统';
  if (row.operatorName) return row.operatorName;
  return row.operatorType === 'user' ? `C 端用户 #${row.operatorId}` : `账号 #${row.operatorId}`;
}

function pretty(value: unknown) {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

onMounted(async () => {
  await loadFilterOptions();
  await load();
});
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <span class="font-600">操作日志</span>
          <div class="flex flex-wrap items-center gap-8px">
            <ElSelect
              v-model="query.module"
              class="w-140px"
              clearable
              placeholder="模块"
              @change="onModuleChange"
            >
              <ElOption
                v-for="item in modules"
                :key="item.module"
                :label="item.label"
                :value="item.module"
              />
            </ElSelect>

            <ElSelect v-model="query.action" class="w-210px" clearable placeholder="动作">
              <ElOption v-for="action in actionOptions" :key="action" :label="action" :value="action" />
            </ElSelect>

            <ElSelect v-model="query.operatorType" class="w-130px" clearable placeholder="操作人类型">
              <ElOption label="后台账号" value="admin" />
              <ElOption label="C 端用户" value="user" />
              <ElOption label="系统" value="system" />
            </ElSelect>

            <ElDatePicker
              v-model="dateRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              class="!w-240px"
            />

            <ElButton type="primary" @click="search">查询</ElButton>
            <ElButton @click="resetQuery">重置</ElButton>
          </div>
        </div>
      </template>

      <ElTable v-loading="loading" :data="list" row-key="id" stripe>
        <ElTableColumn type="expand" width="40">
          <template #default="{ row }">
            <div class="grid grid-cols-2 gap-16px bg-#f7f8fa p-14px">
              <div>
                <div class="mb-6px text-13px font-600">变更前</div>
                <pre class="m-0 whitespace-pre-wrap break-all text-12px">{{ pretty(row.detail?.before) }}</pre>
              </div>
              <div>
                <div class="mb-6px text-13px font-600">变更后</div>
                <pre class="m-0 whitespace-pre-wrap break-all text-12px">{{ pretty(row.detail?.after) }}</pre>
              </div>
            </div>
          </template>
        </ElTableColumn>

        <ElTableColumn label="时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </ElTableColumn>

        <ElTableColumn label="操作人" width="150">
          <template #default="{ row }">
            <div>{{ operatorLabel(row) }}</div>
            <ElTag
              size="small"
              :type="row.operatorType === 'system' ? 'info' : row.operatorType === 'user' ? 'warning' : 'primary'"
            >
              {{ row.operatorType === 'system' ? '系统' : row.operatorType === 'user' ? 'C 端' : '后台' }}
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="模块 / 动作" min-width="190">
          <template #default="{ row }">
            <div>{{ moduleLabels.get(row.module) || row.module }}</div>
            <div class="font-mono text-11px text-#86909c">{{ row.action }}</div>
          </template>
        </ElTableColumn>

        <ElTableColumn label="目标" width="160">
          <template #default="{ row }">
            <span v-if="row.targetType" class="font-mono text-12px">
              {{ row.targetType }}<template v-if="row.targetId"> #{{ row.targetId }}</template>
            </span>
            <span v-else class="text-#c0c4cc">—</span>
          </template>
        </ElTableColumn>

        <ElTableColumn label="项目" min-width="150">
          <template #default="{ row }">
            {{ row.projectName || (row.projectId ? `#${row.projectId}` : '—') }}
          </template>
        </ElTableColumn>

        <ElTableColumn prop="ip" label="IP" width="140">
          <template #default="{ row }">{{ row.ip || '—' }}</template>
        </ElTableColumn>

        <template #empty>
          <ElEmpty description="没有匹配的日志" />
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
  </div>
</template>

<style scoped></style>
