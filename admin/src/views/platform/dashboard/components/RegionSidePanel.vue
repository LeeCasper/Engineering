<script setup lang="ts">
import { computed } from 'vue';
import type {
  DashboardOverview,
  DashboardRegion,
  DashboardRegionSummary
} from '@/service/api/platformDashboard';

defineOptions({ name: 'RegionSidePanel' });

const props = defineProps<{
  level: 'national' | 'province' | 'city' | 'unassigned';
  overview: DashboardOverview | null;
  region: DashboardRegion | null;
  selectedProvinceName: string;
  selectedCityName: string;
}>();

const emit = defineEmits<{
  (event: 'select-province', payload: { code: string; name: string }): void;
  (event: 'select-city', payload: { code: string; name: string }): void;
  (event: 'select-unassigned'): void;
}>();

const provinceRows = computed(() => props.overview?.provinces ?? []);

const currentSummary = computed<DashboardRegionSummary | null>(() => {
  if (props.level === 'unassigned') return props.overview?.unassigned ?? null;
  return props.region?.summary ?? null;
});

const cityRows = computed(() => props.region?.cities ?? []);

const title = computed(() => {
  if (props.level === 'national') return '省份开通排行';
  if (props.level === 'province') return `${props.selectedProvinceName} · 城市排行`;
  if (props.level === 'city') return `${props.selectedCityName} · 开通概况`;
  return '未分配地区';
});

function planSummary(summary: DashboardRegionSummary | null) {
  if (!summary?.planCounts?.length) return '—';
  return summary.planCounts
    .slice(0, 3)
    .map(item => `${item.plan} ${item.count}`)
    .join(' · ');
}
</script>

<template>
  <ElCard shadow="never" class="h-full">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-8px">
        <span class="font-600 text-#1d2129">{{ title }}</span>
        <ElTag v-if="level !== 'national'" size="small" type="info">
          {{ level === 'unassigned' ? '未分配' : level === 'city' ? '城市' : '省份' }}
        </ElTag>
      </div>
    </template>

    <template v-if="level === 'national'">
      <div class="max-h-430px overflow-y-auto pr-4px">
        <button
          v-for="row in provinceRows"
          :key="row.provinceCode"
          type="button"
          class="mb-8px w-full flex items-center justify-between gap-8px border-0 border-b border-#f3efea bg-transparent p-8px text-left last:border-b-0 hover:bg-#faf7f3"
          @click="emit('select-province', { code: row.provinceCode, name: row.provinceName })"
        >
          <span class="min-w-0 truncate text-13px text-#1d2129">{{ row.provinceName }}</span>
          <span class="flex shrink-0 items-center gap-8px text-12px text-#86909c">
            <span>项目 {{ row.projectCount }}</span>
            <span class="font-600 text-#eb5c20">{{ row.tenantCount }} 家</span>
          </span>
        </button>
        <div v-if="!provinceRows.length" class="py-20px text-center text-12px text-#86909c">
          暂无已配置地区的租户
        </div>
      </div>

      <div
        class="mt-12px cursor-pointer rounded-8px bg-#fff7e8 p-12px transition-colors hover:bg-#fff1d6"
        @click="emit('select-unassigned')"
      >
        <div class="flex items-center justify-between gap-8px">
          <span class="text-13px font-600 text-#a85400">未分配地区</span>
          <span class="text-18px font-700 text-#a85400">
            {{ overview?.summary.regionUnsetCount ?? 0 }}
          </span>
        </div>
        <div class="mt-4px text-11px text-#a85400/80">
          这些租户不进入地图统计，点击查看并补录地区
        </div>
      </div>

      <div class="mt-10px text-11px text-#86909c">
        北京、天津、上海、香港、澳门面积较小，地图上不显示名称，可从上表直接进入。
      </div>
    </template>

    <template v-else>
      <div v-if="currentSummary" class="grid grid-cols-2 gap-8px">
        <div class="rounded-8px bg-#faf7f3 p-10px">
          <div class="text-11px text-#86909c">租户</div>
          <div class="mt-3px text-20px font-700 text-#1d2129">{{ currentSummary.tenantCount }}</div>
        </div>
        <div class="rounded-8px bg-#f0fbf4 p-10px">
          <div class="text-11px text-#86909c">正常</div>
          <div class="mt-3px text-20px font-700 text-#00b42a">{{ currentSummary.activeCount }}</div>
        </div>
        <div class="rounded-8px bg-#fff7e8 p-10px">
          <div class="text-11px text-#86909c">本月新增</div>
          <div class="mt-3px text-20px font-700 text-#ff7d00">
            {{ currentSummary.newThisMonthCount }}
          </div>
        </div>
        <div class="rounded-8px bg-#f7f8fa p-10px">
          <div class="text-11px text-#86909c">项目 / 账号</div>
          <div class="mt-3px text-16px font-700 text-#1d2129">
            {{ currentSummary.projectCount }} / {{ currentSummary.adminCount }}
          </div>
        </div>
      </div>

      <div class="mt-10px text-11px text-#86909c">
        套餐：{{ planSummary(currentSummary) }}
      </div>

      <template v-if="level === 'province'">
        <ElDivider class="my-12px" />
        <div class="max-h-330px overflow-y-auto pr-4px">
          <button
            v-for="row in cityRows"
            :key="row.cityCode"
            type="button"
            class="mb-6px w-full flex items-center justify-between gap-8px border-0 border-b border-#f3efea bg-transparent p-8px text-left last:border-b-0 hover:bg-#faf7f3"
            @click="emit('select-city', { code: row.cityCode, name: row.cityName })"
          >
            <span class="min-w-0 truncate text-12px text-#1d2129">{{ row.cityName }}</span>
            <span class="shrink-0 text-12px font-600 text-#eb5c20">{{ row.tenantCount }} 家</span>
          </button>
          <div
            v-if="region?.unassignedCity"
            class="mt-4px w-full flex items-center justify-between gap-8px rounded-8px bg-#fff7e8 p-8px"
          >
            <span class="text-12px text-#a85400">未分配到城市</span>
            <span class="text-12px font-600 text-#a85400">
              {{ region.unassignedCity.tenantCount }} 家
            </span>
          </div>
          <div v-if="!cityRows.length" class="py-16px text-center text-12px text-#86909c">
            本省暂无城市数据
          </div>
        </div>
      </template>

      <div v-else-if="level === 'city'" class="mt-12px rounded-8px bg-#faf7f3 p-10px text-11px text-#86909c">
        下方租户列表已按该城市筛选；点击顶部「全国」可返回地图总览。
      </div>

      <div v-else class="mt-12px rounded-8px bg-#fff7e8 p-10px text-11px text-#a85400">
        未分配地区的租户没有省 / 市信息，不会出现在地图省级/城市统计中。请到「租户管理 → 调整」补录。
      </div>
    </template>
  </ElCard>
</template>
