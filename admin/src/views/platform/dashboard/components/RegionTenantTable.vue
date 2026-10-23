<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { fetchDashboardTenants } from '@/service/api/platformDashboard';
import { fetchTenantDetail, type TenantItem, type TenantStatus } from '@/service/api/platform';
import { formatDate } from '@/utils/format';

defineOptions({ name: 'RegionTenantTable' });

const props = defineProps<{
  title: string;
  provinceCode?: string;
  cityCode?: string;
  unassigned?: boolean;
  enabled?: boolean;
}>();

const STATUS_META: Record<string, { label: string; type: 'success' | 'warning' | 'info' }> = {
  active: { label: '正常', type: 'success' },
  suspended: { label: '已停用', type: 'warning' },
  archived: { label: '已退租', type: 'info' }
};

const loading = ref(false);
const list = ref<TenantItem[]>([]);
const total = ref(0);

const query = reactive({
  page: 1,
  pageSize: 10,
  keyword: '',
  status: '' as TenantStatus | ''
});

const detailDrawer = reactive({ visible: false, loading: false });
const detail = ref<TenantItem | null>(null);

function scopeParams() {
  return {
    provinceCode: props.provinceCode || undefined,
    cityCode: props.cityCode || undefined,
    unassigned: props.unassigned ? true : undefined,
    status: query.status || undefined,
    keyword: query.keyword.trim() || undefined,
    page: query.page,
    pageSize: query.pageSize
  };
}

async function load() {
  if (props.enabled === false) {
    list.value = [];
    total.value = 0;
    return;
  }

  loading.value = true;
  try {
    const { data, error } = await fetchDashboardTenants(scopeParams());
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

function search() {
  query.page = 1;
  load();
}

function resetQuery() {
  query.keyword = '';
  query.status = '';
  query.page = 1;
  load();
}

async function openDetail(row: TenantItem) {
  detailDrawer.visible = true;
  detailDrawer.loading = true;
  detail.value = null;

  try {
    const { data } = await fetchTenantDetail(row.id);
    if (data) detail.value = data;
  } finally {
    detailDrawer.loading = false;
  }
}

watch(
  () => [props.provinceCode, props.cityCode, props.unassigned, props.enabled],
  () => {
    query.page = 1;
    load();
  }
);

onMounted(load);

// 看板顶部的「刷新数据」要一并刷新明细表；父组件通过 ref 调用
defineExpose({ reload: load });
</script>

<template>
  <ElCard shadow="never">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-10px">
        <div>
          <span class="font-600 text-#1d2129">{{ title }}</span>
          <span class="ml-8px text-12px text-#86909c">共 {{ total }} 家</span>
        </div>
        <div class="flex flex-wrap items-center gap-8px">
          <ElInput
            v-model="query.keyword"
            class="w-200px"
            clearable
            placeholder="公司名称 / 租户标识"
            @keyup.enter="search"
          />
          <ElSelect v-model="query.status" class="w-120px" clearable placeholder="状态">
            <ElOption label="正常" value="active" />
            <ElOption label="已停用" value="suspended" />
            <ElOption label="已退租" value="archived" />
          </ElSelect>
          <ElButton type="primary" @click="search">查询</ElButton>
          <ElButton @click="resetQuery">重置</ElButton>
        </div>
      </div>
    </template>

    <ElTable v-loading="loading" :data="list" row-key="id" stripe>
      <ElTableColumn prop="name" label="公司名称" min-width="150" show-overflow-tooltip />
      <ElTableColumn prop="code" label="租户标识" width="120">
        <template #default="{ row }">
          <span class="font-mono text-13px">{{ row.code }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="状态" width="100">
        <template #default="{ row }">
          <ElTag :type="STATUS_META[row.status]?.type || 'info'" size="small">
            {{ STATUS_META[row.status]?.label || row.statusLabel }}
          </ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="plan" label="套餐" width="90">
        <template #default="{ row }">{{ row.plan || '-' }}</template>
      </ElTableColumn>
      <ElTableColumn label="所在地区" width="150">
        <template #default="{ row }">
          <span v-if="row.regionLabel">{{ row.regionLabel }}</span>
          <span v-else class="text-#c0c4cc">未设置</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="项目 / 账号" width="110" align="center">
        <template #default="{ row }">{{ row.usage.projectCount }} / {{ row.usage.adminCount }}</template>
      </ElTableColumn>
      <ElTableColumn label="开通时间" width="120">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn label="到期时间" width="120">
        <template #default="{ row }">
          {{ row.expiresAt ? formatDate(row.expiresAt) : '长期有效' }}
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <ElButton link type="primary" @click="openDetail(row)">详情</ElButton>
        </template>
      </ElTableColumn>
      <template #empty>
        <ElEmpty :description="enabled === false ? '请选择省份或城市' : '该区域暂无租户'" />
      </template>
    </ElTable>

    <div class="mt-14px flex justify-end">
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

    <ElDrawer v-model="detailDrawer.visible" title="租户详情" size="480px">
      <div v-loading="detailDrawer.loading">
        <ElDescriptions v-if="detail" :column="1" border>
          <ElDescriptionsItem label="公司名称">{{ detail.name }}</ElDescriptionsItem>
          <ElDescriptionsItem label="租户标识">{{ detail.code }}</ElDescriptionsItem>
          <ElDescriptionsItem label="状态">
            {{ STATUS_META[detail.status]?.label || detail.statusLabel }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="套餐">{{ detail.plan || '-' }}</ElDescriptionsItem>
          <ElDescriptionsItem label="所在地区">
            {{ detail.regionLabel || '未设置' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="项目 / 账号">
            {{ detail.usage.projectCount }} / {{ detail.usage.adminCount }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="联系人">
            {{ detail.contactName || '-' }} {{ detail.contactPhone || '' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="开通时间">{{ formatDate(detail.createdAt) }}</ElDescriptionsItem>
          <ElDescriptionsItem label="到期时间">
            {{ detail.expiresAt ? formatDate(detail.expiresAt) : '长期有效' }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="备注">{{ detail.remark || '-' }}</ElDescriptionsItem>
        </ElDescriptions>
      </div>
    </ElDrawer>
  </ElCard>
</template>
