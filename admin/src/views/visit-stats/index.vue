<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  fetchExportVisitStats,
  fetchVisitStats,
  type VisitFilterOption,
  type VisitPersonStat,
  type VisitStatItem,
  type VisitStatsResult,
  type VisitSummary
} from '@/service/api/visitStats';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'VisitStatsPage' });

/**
 * 后台考察统计（B-4.6 / §5.4）。
 *
 * 「统计口径必须在页面上可查」是需求原文要求，因此口径说明常驻在页面上，
 * 而不是塞进一个没人点的问号里 —— 业务方与看板对不上数时，第一件事就是找分母。
 */

const loading = ref(false);
const exporting = ref(false);
const result = ref<VisitStatsResult | null>(null);

const summary = computed<VisitSummary>(
  () => result.value?.summary ?? { visitCount: 0, abnormalCount: 0, projectCount: 0, abnormalRate: 0 }
);
const byPerson = computed<VisitPersonStat[]>(() => result.value?.byPerson ?? []);
const list = ref<VisitStatItem[]>([]);
const total = ref(0);
const foremen = ref<VisitFilterOption[]>([]);
const projects = ref<Array<{ projectId: number; name: string }>>([]);
const caliber = ref('');

/** 默认近 30 天，与 §5.4「时间范围（默认近 30 天）」一致 */
function defaultRange(): [string, string] {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);

  return [toDateString(start), toDateString(end)];
}

function toDateString(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
}

const query = reactive({
  page: 1,
  pageSize: 20,
  range: defaultRange() as [string, string] | null,
  foremanId: null as number | null,
  projectId: null as number | null
});

function params() {
  const [startDate, endDate] = query.range ?? [undefined, undefined];

  return {
    startDate,
    endDate,
    foremanId: query.foremanId ?? undefined,
    projectId: query.projectId ?? undefined
  };
}

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchVisitStats({
      ...params(),
      page: query.page,
      pageSize: query.pageSize
    });

    if (error || !data) return;

    result.value = data;
    list.value = data.list;
    total.value = data.total;
    foremen.value = data.foremen;
    projects.value = data.projects;
    caliber.value = data.caliber;
  } finally {
    loading.value = false;
  }
}

function search() {
  query.page = 1;
  load();
}

function resetQuery() {
  query.range = defaultRange();
  query.foremanId = null;
  query.projectId = null;
  query.page = 1;
  load();
}

async function exportExcel() {
  exporting.value = true;

  try {
    const { data, error, response } = await fetchExportVisitStats(params());

    if (error || !data) return;

    // 筛选结果为空时后端返回 409 + JSON，axios 会把它包成 Blob。
    // 不判断就会把一段错误 JSON 存成 .xlsx，用户打开才发现打不开
    if (data.type && data.type.includes('json')) {
      try {
        const payload = JSON.parse(await data.text());
        ElMessage.warning(payload.message || '当前筛选条件下没有可导出的记录');
      } catch {
        ElMessage.warning('当前筛选条件下没有可导出的记录');
      }
      return;
    }

    const disposition =
      response?.headers?.['content-disposition'] ||
      (response?.headers as any)?.get?.('content-disposition') ||
      '';
    const match = String(disposition).match(/filename\*=UTF-8''([^;]+)/);
    const filename = match ? decodeURIComponent(match[1]) : '考察统计.xlsx';

    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } finally {
    exporting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never" class="mb-16px">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <span class="font-600">考察统计</span>
          <ElButton :loading="exporting" @click="exportExcel">导出明细</ElButton>
        </div>
      </template>

      <div class="flex flex-wrap items-center gap-8px">
        <ElDatePicker
          v-model="query.range"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="w-260px"
        />
        <ElSelect v-model="query.foremanId" class="w-180px" clearable placeholder="全部签到人">
          <ElOption
            v-for="item in foremen"
            :key="item.userId"
            :label="`${item.name}（${item.roleLabel}）`"
            :value="item.userId"
          />
        </ElSelect>
        <ElSelect v-model="query.projectId" class="w-200px" clearable placeholder="全部项目">
          <ElOption v-for="item in projects" :key="item.projectId" :label="item.name" :value="item.projectId" />
        </ElSelect>
        <ElButton type="primary" @click="search">查询</ElButton>
        <ElButton @click="resetQuery">重置</ElButton>
      </div>

      <ElAlert class="mt-16px" type="info" :closable="false" show-icon title="统计口径">
        {{ caliber || '考察次数按签到记录条数统计；异常签到率 = 异常签到数 ÷ 签到总数。' }}
      </ElAlert>
    </ElCard>

    <div class="mb-16px grid grid-cols-4 gap-16px lt-md:grid-cols-2">
      <ElCard shadow="never">
        <div class="text-12px text-#86909c">考察次数</div>
        <div class="pt-6px text-26px font-600">{{ summary.visitCount }}</div>
      </ElCard>
      <ElCard shadow="never">
        <div class="text-12px text-#86909c">异常签到数</div>
        <div class="pt-6px text-26px font-600" :class="summary.abnormalCount ? 'text-#d54941' : ''">
          {{ summary.abnormalCount }}
        </div>
      </ElCard>
      <ElCard shadow="never">
        <div class="text-12px text-#86909c">异常签到率</div>
        <div class="pt-6px text-26px font-600">
          {{ summary.abnormalRate }}%
        </div>
      </ElCard>
      <ElCard shadow="never">
        <div class="text-12px text-#86909c">覆盖项目数</div>
        <div class="pt-6px text-26px font-600">{{ summary.projectCount }}</div>
      </ElCard>
    </div>

    <ElCard shadow="never" class="mb-16px">
      <template #header>
        <span class="font-600">按签到人</span>
      </template>
      <ElTable :data="byPerson" size="small" empty-text="该时间段内没有签到记录">
        <ElTableColumn label="签到人" min-width="140">
          <template #default="{ row }">{{ row.name }}</template>
        </ElTableColumn>
        <ElTableColumn label="角色" width="90">
          <template #default="{ row }">{{ row.roleLabel }}</template>
        </ElTableColumn>
        <ElTableColumn prop="visitCount" label="考察次数" width="100" />
        <ElTableColumn prop="abnormalCount" label="异常签到数" width="110" />
        <ElTableColumn label="异常签到率" width="110">
          <template #default="{ row }">{{ row.abnormalRate }}%</template>
        </ElTableColumn>
        <ElTableColumn prop="projectCount" label="覆盖项目数" width="110" />
      </ElTable>
    </ElCard>

    <ElCard shadow="never">
      <template #header>
        <span class="font-600">考察明细</span>
      </template>

      <ElTable v-loading="loading" :data="list" size="small" empty-text="该时间段内没有签到记录">
        <ElTableColumn label="签到时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.checkinAt) }}</template>
        </ElTableColumn>
        <ElTableColumn prop="projectName" label="项目" min-width="160" show-overflow-tooltip />
        <ElTableColumn label="签到人" width="130">
          <template #default="{ row }">{{ row.userName }}</template>
        </ElTableColumn>
        <ElTableColumn prop="roleLabel" label="角色" width="80" />
        <ElTableColumn label="偏差 / 阈值" width="130">
          <template #default="{ row }">{{ row.distanceM }} / {{ row.thresholdM }} 米</template>
        </ElTableColumn>
        <ElTableColumn label="判定" width="90">
          <template #default="{ row }">
            <ElTag :type="row.isAbnormal ? 'danger' : 'success'" size="small">
              {{ row.isAbnormal ? '异常' : '正常' }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="异常说明" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.abnormalReason || '—' }}</template>
        </ElTableColumn>
        <ElTableColumn label="备注" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '—' }}</template>
        </ElTableColumn>
      </ElTable>

      <div class="mt-16px flex justify-end">
        <ElPagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </ElCard>
  </div>
</template>

<style scoped></style>
