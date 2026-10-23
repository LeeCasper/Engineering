<script setup lang="ts">
import type { DashboardSummary } from '@/service/api/platformDashboard';

defineOptions({ name: 'DashboardKpiCards' });

defineProps<{
  summary: DashboardSummary;
}>();

const emit = defineEmits<{
  (event: 'select-unassigned'): void;
}>();
</script>

<template>
  <div class="grid grid-cols-4 gap-14px lt-lg:grid-cols-2 lt-sm:grid-cols-1">
    <ElCard shadow="never" :body-style="{ padding: '16px' }">
      <div class="text-12px text-#86909c">租户总数</div>
      <div class="mt-6px text-28px font-700 text-#1d2129">{{ summary.tenantCount }}</div>
      <div class="mt-4px text-11px text-#86909c">含停用与已退租</div>
    </ElCard>

    <ElCard shadow="never" :body-style="{ padding: '16px' }">
      <div class="text-12px text-#86909c">正常</div>
      <div class="mt-6px text-28px font-700 text-#00b42a">{{ summary.activeCount }}</div>
      <div class="mt-4px text-11px text-#86909c">当前可登录</div>
    </ElCard>

    <ElCard shadow="never" :body-style="{ padding: '16px' }">
      <div class="text-12px text-#86909c">停用 / 退租</div>
      <div class="mt-6px text-28px font-700 text-#ff7d00">
        {{ summary.suspendedCount }} / {{ summary.archivedCount }}
      </div>
      <div class="mt-4px text-11px text-#86909c">停用 / 已退租</div>
    </ElCard>

    <ElCard shadow="never" :body-style="{ padding: '16px' }">
      <div class="text-12px text-#86909c">本月新增</div>
      <div class="mt-6px text-28px font-700 text-#eb5c20">{{ summary.newThisMonthCount }}</div>
      <div class="mt-4px text-11px text-#86909c">按开通时间统计</div>
    </ElCard>

    <ElCard shadow="never" :body-style="{ padding: '16px' }">
      <div class="text-12px text-#86909c">项目总数</div>
      <div class="mt-6px text-28px font-700 text-#1d2129">{{ summary.projectCount }}</div>
      <div class="mt-4px text-11px text-#86909c">平台内项目数</div>
    </ElCard>

    <ElCard shadow="never" :body-style="{ padding: '16px' }">
      <div class="text-12px text-#86909c">后台账号</div>
      <div class="mt-6px text-28px font-700 text-#1d2129">{{ summary.adminCount }}</div>
      <div class="mt-4px text-11px text-#86909c">租户 owner / admin</div>
    </ElCard>

    <ElCard shadow="never" :body-style="{ padding: '16px' }">
      <div class="text-12px text-#86909c">已配置地区</div>
      <div class="mt-6px text-28px font-700 text-#1d2129">
        {{ Math.max(0, summary.tenantCount - summary.regionUnsetCount) }}
      </div>
      <div class="mt-4px text-11px text-#86909c">可用于地图统计</div>
    </ElCard>

    <ElCard
      class="cursor-pointer transition-border hover:border-#f2a27e"
      shadow="never"
      :body-style="{ padding: '16px' }"
      @click="emit('select-unassigned')"
    >
      <div class="text-12px text-#86909c">未分配地区</div>
      <div class="mt-6px text-28px font-700 text-#c9a227">{{ summary.regionUnsetCount }}</div>
      <div class="mt-4px text-11px text-#86909c">点击查看并补录</div>
    </ElCard>
  </div>
</template>
