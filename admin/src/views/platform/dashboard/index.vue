<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { fetchDashboardOverview, fetchDashboardRegion, type DashboardOverview, type DashboardRegion } from '@/service/api/platformDashboard';
import { REGION_PROVINCES } from '@/utils/region';
import DashboardKpiCards from './components/DashboardKpiCards.vue';
import ChinaMapPanel from './components/ChinaMapPanel.vue';
import RegionSidePanel from './components/RegionSidePanel.vue';
import RegionTenantTable from './components/RegionTenantTable.vue';

defineOptions({ name: 'PlatformDashboardPage' });

const directProvinceCodes = new Set(
  REGION_PROVINCES.filter(province => province.directCity).map(province => province.code)
);

const loadingOverview = ref(false);
const loadingRegion = ref(false);
const overview = ref<DashboardOverview | null>(null);
const regionDetail = ref<DashboardRegion | null>(null);

const selectedProvinceCode = ref('');
const selectedProvinceName = ref('');
const selectedCityCode = ref('');
const selectedCityName = ref('');
const unassignedSelected = ref(false);
const tenantTableRef = ref<InstanceType<typeof RegionTenantTable> | null>(null);

let requestSeq = 0;

const level = computed<'national' | 'province' | 'city' | 'unassigned'>(() => {
  if (unassignedSelected.value) return 'unassigned';
  if (selectedCityCode.value) return 'city';
  if (selectedProvinceCode.value) return 'province';
  return 'national';
});

const showCityCrumb = computed(
  () => Boolean(selectedCityCode.value) && selectedCityCode.value !== selectedProvinceCode.value
);

const tenantTableTitle = computed(() => {
  if (unassignedSelected.value) return '未分配地区租户';
  if (selectedCityCode.value) return `${selectedCityName.value || '所选城市'}租户`;
  if (selectedProvinceCode.value) return `${selectedProvinceName.value || '所选省份'}租户`;
  return '地区租户';
});

const tenantTableEnabled = computed(() => level.value !== 'national');

async function loadOverview() {
  loadingOverview.value = true;
  try {
    const { data, error } = await fetchDashboardOverview();
    if (!error && data) overview.value = data;
  } finally {
    loadingOverview.value = false;
  }
}

async function loadRegion() {
  if (level.value === 'national') {
    regionDetail.value = null;
    return;
  }

  const seq = ++requestSeq;
  loadingRegion.value = true;
  try {
    const { data, error } = await fetchDashboardRegion({
      provinceCode: selectedProvinceCode.value || undefined,
      cityCode: selectedCityCode.value || undefined,
      unassigned: unassignedSelected.value || undefined
    });
    if (seq === requestSeq && !error && data) regionDetail.value = data;
  } finally {
    if (seq === requestSeq) loadingRegion.value = false;
  }
}

function resetToNational() {
  selectedProvinceCode.value = '';
  selectedProvinceName.value = '';
  selectedCityCode.value = '';
  selectedCityName.value = '';
  unassignedSelected.value = false;
  regionDetail.value = null;
  requestSeq += 1;
}

function selectProvince(payload: { code: string; name: string }) {
  unassignedSelected.value = false;
  selectedProvinceCode.value = payload.code;
  selectedProvinceName.value = payload.name;

  if (directProvinceCodes.has(payload.code)) {
    // 直辖市/港澳台：省即城市，不再展示一级空的城市地图
    selectedCityCode.value = payload.code;
    selectedCityName.value = payload.name;
    loadRegion();
    return;
  }

  selectedCityCode.value = '';
  selectedCityName.value = '';
  loadRegion();
}

/** 包屑回到「省」层级：保留省份、清掉城市，重新拉省级汇总 */
function backToProvince() {
  if (!selectedProvinceCode.value) return;
  selectedCityCode.value = '';
  selectedCityName.value = '';
  loadRegion();
}

function selectCity(payload: { code: string; name: string }) {
  if (!payload.code) return;
  unassignedSelected.value = false;
  selectedCityCode.value = payload.code;
  selectedCityName.value = payload.name;
  loadRegion();
}

function selectUnassigned() {
  selectedProvinceCode.value = '';
  selectedProvinceName.value = '';
  selectedCityCode.value = '';
  selectedCityName.value = '';
  unassignedSelected.value = true;
  loadRegion();
}

async function refresh() {
  await loadOverview();
  if (level.value !== 'national') await loadRegion();
  tenantTableRef.value?.reload();
}

onMounted(loadOverview);
</script>

<template>
  <div class="p-16px">
    <div class="mb-14px flex flex-wrap items-end justify-between gap-10px">
      <div>
        <div class="text-20px font-700 text-#1d2129">数据看板</div>
        <div class="mt-4px text-12px text-#86909c">
          全国租户开通情况；点击省份下钻城市，点击城市查看租户明细
        </div>
      </div>
      <ElButton :loading="loadingOverview" @click="refresh">刷新数据</ElButton>
    </div>

    <template v-if="overview">
      <DashboardKpiCards :summary="overview.summary" @select-unassigned="selectUnassigned" />

      <div class="mt-14px grid grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)] gap-14px lt-lg:grid-cols-1">
        <ElCard v-loading="loadingRegion" shadow="never">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-10px">
              <div class="flex flex-wrap items-center gap-5px text-13px">
                <ElButton link type="primary" @click="resetToNational">全国</ElButton>
                <template v-if="selectedProvinceCode">
                  <span class="text-#c0c4cc">/</span>
                  <ElButton v-if="showCityCrumb" link type="primary" @click="backToProvince">
                    {{ selectedProvinceName }}
                  </ElButton>
                  <span v-else class="font-600 text-#1d2129">{{ selectedProvinceName }}</span>
                </template>
                <template v-if="showCityCrumb">
                  <span class="text-#c0c4cc">/</span>
                  <span class="font-600 text-#eb5c20">{{ selectedCityName }}</span>
                </template>
                <template v-if="unassignedSelected">
                  <span class="text-#c0c4cc">/</span>
                  <span class="font-600 text-#a85400">未分配地区</span>
                </template>
              </div>
              <span v-if="overview.month" class="text-11px text-#86909c">
                统计月份 {{ overview.month }}
              </span>
            </div>
          </template>

          <ChinaMapPanel
            :overview="overview"
            :region="regionDetail"
            :selected-province-code="selectedProvinceCode"
            :selected-city-code="selectedCityCode"
            @select-province="selectProvince"
            @select-city="selectCity"
          />
        </ElCard>

        <RegionSidePanel
          v-loading="loadingRegion"
          :level="level"
          :overview="overview"
          :region="regionDetail"
          :selected-province-name="selectedProvinceName"
          :selected-city-name="selectedCityName"
          @select-province="selectProvince"
          @select-city="selectCity"
          @select-unassigned="selectUnassigned"
        />
      </div>

      <div class="mt-14px">
        <RegionTenantTable
          ref="tenantTableRef"
          :title="tenantTableTitle"
          :province-code="selectedProvinceCode || undefined"
          :city-code="selectedCityCode || undefined"
          :unassigned="unassignedSelected"
          :enabled="tenantTableEnabled"
        />
      </div>
    </template>

    <ElEmpty v-else-if="!loadingOverview" description="暂无看板数据" />
  </div>
</template>
