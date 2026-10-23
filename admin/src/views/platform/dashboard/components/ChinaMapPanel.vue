<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { registerMap } from 'echarts/core';
import { useEcharts, type ECOption } from '@/hooks/common/echarts';
import { useThemeStore } from '@/store/modules/theme';
import chinaGeo from '@/assets/geo/china.json';
import regionData from '@/assets/geo/china-cities.json';
import type { DashboardCity, DashboardOverview, DashboardProvince, DashboardRegion } from '@/service/api/platformDashboard';

defineOptions({ name: 'ChinaMapPanel' });

const props = defineProps<{
  overview: DashboardOverview | null;
  region: DashboardRegion | null;
  selectedProvinceCode: string;
  selectedCityCode: string;
}>();

const emit = defineEmits<{
  (event: 'select-province', payload: { code: string; name: string }): void;
  (event: 'select-city', payload: { code: string; name: string }): void;
}>();

interface GeoFeature {
  properties: {
    adcode: string | number;
    name?: string;
    level?: string;
  };
  geometry?: {
    type: string;
    coordinates: any;
  };
}

interface GeoData {
  features: GeoFeature[];
}

const themeStore = useThemeStore();
const darkMode = computed(() => themeStore.darkMode);

const directProvinceCodes = new Set(
  (regionData as { code: string; directCity?: boolean }[])
    .filter(row => row.directCity)
    .map(row => row.code)
);

const allFeatures = (chinaGeo as GeoData).features;

/**
 * 海南省的 GeoJSON 把三沙市的南海岛礁也放在同一个 MultiPolygon 里，
 * 最南到北纬 3.8°。和大陆放在一张图上会把整体 bounding box 拉高：
 * 大陆被迫缩在上半部分、顶部贴边，下面留一大片空海（用户看到的「被边框裁掉」）。
 *
 * 标准做法是主图只画到海南本岛，南海诸岛用右下角插图表示。
 * ECharts 对名为 `china` 的地图会自动补一个「南海诸岛」插图区域，
 * 因此这里只裁掉海南岛以南的岛礁，插图仍然保留。
 */
function trimHainanSouthSea(feature: GeoFeature): GeoFeature {
  if (String(feature.properties?.adcode ?? '') !== '460000') return feature;
  if (feature.geometry?.type !== 'MultiPolygon') return feature;

  const polygons = feature.geometry.coordinates as number[][][][];
  const kept = polygons.filter(polygon => {
    let minLat = Infinity;
    const walk = (node: any) => {
      if (typeof node?.[0] === 'number') {
        minLat = Math.min(minLat, node[1]);
        return;
      }
      if (Array.isArray(node)) node.forEach(walk);
    };
    walk(polygon);
    // 海南本岛与周边小岛都在北纬 18° 以北；三沙岛礁在更南边
    return minLat >= 17.5;
  });

  if (kept.length === polygons.length) return feature;

  return { ...feature, geometry: { ...feature.geometry, coordinates: kept } };
}

const provinceFeatures = allFeatures
  .filter(feature => {
    const code = String(feature.properties?.adcode ?? '');
    return /^\d{6}$/.test(code) && Boolean(feature.properties?.name);
  })
  .map(trimHainanSouthSea);

const provinceGeoCache = new Map<string, GeoData>();
const currentProvinceGeo = shallowRef<GeoData | null>(null);
const provinceLoading = ref(false);
const provinceError = ref('');

registerMap('china', { type: 'FeatureCollection', features: provinceFeatures } as any);

function provinceStat(code: string): DashboardProvince | undefined {
  return props.overview?.provinces.find(row => row.provinceCode === code);
}

function cityStat(code: string): DashboardCity | undefined {
  return props.region?.cities.find(row => row.cityCode === code);
}

function mapDataForProvince() {
  const rows = props.overview?.provinces ?? [];
  const statByCode = new Map(rows.map(row => [row.provinceCode, row]));

  return provinceFeatures.map(feature => {
    const code = String(feature.properties.adcode);
    const stat = statByCode.get(code);
    const selected = props.selectedProvinceCode === code;
    const name = feature.properties.name || '';
    // 直辖市与港澳的面太小，国家尺度下文字必然压到邻省（北京压河北、香港压广东）。
    // 与其把文字挪到别人家的地盘上，不如不显示；右侧排行与 tooltip 仍可进入。
    const hideLabel = TINY_REGION_NAMES.has(name);
    return {
      name,
      code,
      value: stat?.tenantCount ?? 0,
      tenantCount: stat?.tenantCount ?? 0,
      activeCount: stat?.activeCount ?? 0,
      projectCount: stat?.projectCount ?? 0,
      adminCount: stat?.adminCount ?? 0,
      label: hideLabel ? { show: false } : undefined,
      itemStyle: selected ? { areaColor: '#f2a27e', borderColor: '#eb5c20', borderWidth: 1.5 } : undefined
    };
  });
}

function mapDataForCities() {
  const features = currentProvinceGeo.value?.features ?? [];
  const rows = props.region?.cities ?? [];
  const statByCode = new Map(rows.map(row => [row.cityCode, row]));

  return features
    .filter(feature => /^\d{6}$/.test(String(feature.properties?.adcode ?? '')) && feature.properties?.name)
    .map(feature => {
      const code = String(feature.properties.adcode);
      const stat = statByCode.get(code);
      const selected = props.selectedCityCode === code;
      return {
        name: feature.properties.name,
        code,
        value: stat?.tenantCount ?? 0,
        tenantCount: stat?.tenantCount ?? 0,
        activeCount: stat?.activeCount ?? 0,
        projectCount: stat?.projectCount ?? 0,
        adminCount: stat?.adminCount ?? 0,
        itemStyle: selected ? { areaColor: '#f2a27e', borderColor: '#eb5c20', borderWidth: 1.5 } : undefined
      };
    });
}

/**
 * 地图标签只用于定位，不参与数据匹配（数据匹配始终用 GeoJSON 全名）。
 * 去掉行政后缀能显著减少东部省份的标签重叠。
 */
function shortLabel(name: string) {
  return name
    .replace(/特别行政区$/, '')
    .replace(/维吾尔自治区$/, '')
    .replace(/壮族自治区$/, '')
    .replace(/回族自治区$/, '')
    .replace(/自治区$/, '')
    .replace(/省$/, '')
    .replace(/市$/, '');
}

/**
 * 直辖市与港澳在地图上只有几十像素宽。横排两字会压到相邻省份，
 * 改成竖排并缩小字号，标签才能落在自己的行政区里。
 */
const TINY_REGION_NAMES = new Set([
  '北京市',
  '天津市',
  '上海市',
  '香港特别行政区',
  '澳门特别行政区'
]);

function buildOption(): ECOption {
  const isProvinceView = Boolean(props.selectedProvinceCode && currentProvinceGeo.value);
  const data = isProvinceView ? mapDataForCities() : mapDataForProvince();
  const maxValue = Math.max(1, ...data.map(item => Number(item.value) || 0));
  const labelColor = darkMode.value ? '#c9d1d9' : '#4e5969';
  const areaColor = darkMode.value ? '#2b3038' : '#f7f1eb';
  const borderColor = darkMode.value ? '#1b1f26' : '#ffffff';

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: darkMode.value ? 'rgba(30, 34, 40, 0.96)' : 'rgba(255, 255, 255, 0.98)',
      borderColor: darkMode.value ? '#39414b' : '#f0eae4',
      textStyle: { color: darkMode.value ? '#e6edf3' : '#241c17', fontSize: 12 },
      formatter: (params: any) => {
        const row = params.data || {};
        const name = row.name || params.name || '未知地区';
        if (!row.code) return name;
        return [
          `<div style="font-weight:600;margin-bottom:4px">${name}</div>`,
          `<div>租户：${row.tenantCount ?? 0} 家</div>`,
          `<div>正常：${row.activeCount ?? 0} 家</div>`,
          `<div>项目：${row.projectCount ?? 0} 个</div>`,
          `<div>后台账号：${row.adminCount ?? 0} 个</div>`
        ].join('');
      }
    },
    visualMap: {
      min: 0,
      max: maxValue,
      seriesIndex: 0,
      calculable: false,
      left: 10,
      bottom: 10,
      itemWidth: 10,
      itemHeight: 84,
      text: ['高', '低'],
      textStyle: { color: labelColor, fontSize: 10 },
      inRange: {
        color: darkMode.value
          ? ['#2b3038', '#5a4033', '#9a4f2e', '#eb5c20']
          : ['#f7f1eb', '#f8d9c9', '#f2a27e', '#eb5c20']
      }
    },
    series: [
      {
        type: 'map',
        map: isProvinceView ? `province-${props.selectedProvinceCode}` : 'china',
        roam: false,
        selectedMode: false,
        layoutCenter: ['50%', '50%'],
        layoutSize: '100%',
        zoom: isProvinceView ? 1.02 : 1,
        label: {
          show: true,
          color: labelColor,
          fontSize: isProvinceView ? 11 : 12,
          // 深色字压在橙色热区上会糊成一团，加一圈描边保证可读
          textBorderColor: darkMode.value ? '#1b1f26' : '#ffffff',
          textBorderWidth: 2,
          formatter: (params: any) => shortLabel(params.name || '')
        },
        // 中国东部省份密集，必须自动避让；有租户的地区优先保留标签
        // （hideOverlap: false = 参与避让时不被隐藏）。
        // labelLayout 回调只给 dataIndex，没给 data，必须从闭包里的 data 取
        labelLayout: (params: any) => ({
          hideOverlap: !Number(data[params.dataIndex]?.tenantCount)
        }),
        itemStyle: {
          areaColor,
          borderColor,
          borderWidth: 1
        },
        emphasis: {
          label: { show: true, color: darkMode.value ? '#ffffff' : '#241c17' },
          itemStyle: { areaColor: darkMode.value ? '#6b4a37' : '#f8d9c9' }
        },
        data
      },
    ],
  };
}

const { domRef, updateOptions } = useEcharts(buildOption, {
  onRender: chart => {
    chart.hideLoading();
    chart.off('click');
    chart.on('click', (params: any) => {
      if (params?.seriesType !== 'map') return;
      const code = String(params.data?.code ?? '');
      if (!code) return;
      const name = params.data?.name || params.name || '';

      if (props.selectedProvinceCode && currentProvinceGeo.value) {
        emit('select-city', { code, name });
        return;
      }

      emit('select-province', { code, name });
    });
  }
});

async function loadProvinceGeo(code: string) {
  if (directProvinceCodes.has(code)) {
    currentProvinceGeo.value = null;
    provinceError.value = '';
    await updateOptions(() => buildOption());
    return;
  }

  const cached = provinceGeoCache.get(code);
  if (cached) {
    currentProvinceGeo.value = cached;
    provinceError.value = '';
    await updateOptions(() => buildOption());
    return;
  }

  provinceLoading.value = true;
  provinceError.value = '';
  try {
    const base = import.meta.env.BASE_URL || '/';
    const url = `${base}geo/provinces/${code}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`地图加载失败（${res.status}）`);
    const geo = (await res.json()) as GeoData;
    provinceGeoCache.set(code, geo);
    registerMap(`province-${code}`, geo as any);
    currentProvinceGeo.value = geo;
    await updateOptions(() => buildOption());
  } catch (err) {
    provinceError.value = err instanceof Error ? err.message : '省份地图加载失败';
    currentProvinceGeo.value = null;
    await updateOptions(() => buildOption());
  } finally {
    provinceLoading.value = false;
  }
}

watch(
  () => props.selectedProvinceCode,
  code => {
    if (!code) {
      currentProvinceGeo.value = null;
      provinceError.value = '';
      updateOptions(() => buildOption());
      return;
    }
    loadProvinceGeo(code);
  },
  { immediate: true }
);

watch(
  () => [props.overview, props.region, props.selectedCityCode, darkMode.value],
  () => {
    updateOptions(() => buildOption());
  },
  { deep: false }
);

defineExpose({ retry: () => loadProvinceGeo(props.selectedProvinceCode) });
</script>

<template>
  <div class="relative h-700px w-full lt-sm:h-380px">
    <div ref="domRef" class="h-full w-full" />

    <div
      v-if="provinceLoading"
      class="absolute inset-0 flex items-center justify-center bg-white/60 text-13px text-#4e5969 dark:bg-#1b1f26/70 dark:text-#c9d1d9"
    >
      加载省级地图…
    </div>

    <div
      v-else-if="provinceError"
      class="absolute inset-0 flex flex-col items-center justify-center gap-8px bg-white/70 text-13px text-#4e5969 dark:bg-#1b1f26/80 dark:text-#c9d1d9"
    >
      <span>{{ provinceError }}</span>
      <ElButton size="small" @click="loadProvinceGeo(selectedProvinceCode)">重试</ElButton>
    </div>
  </div>
</template>
