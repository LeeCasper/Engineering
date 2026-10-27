<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  fetchAdminMapGeocode,
  fetchAdminMapReverseGeocode,
  fetchAdminMapStatic,
  type MapStaticResult
} from '@/service/api/map';
import { moveCenterByPixels, toCoordinateString } from '@/utils/map-projection';

type CoordinateSource = 'none' | 'hydrate' | 'geocode' | 'manual';

interface Props {
  address: string;
  disabled?: boolean;
  height?: number;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  height: 300
});

const longitude = defineModel<string>('longitude', { default: '' });
const latitude = defineModel<string>('latitude', { default: '' });

const emit = defineEmits<{
  (e: 'source-change', payload: { source: CoordinateSource; address: string }): void;
  (e: 'address-suggestion', value: string): void;
}>();

// 必须在下面的 source / locatedAddress 初始化之前声明：
// 那两行会调用 hasCoords()，而 hasCoords → isValidCoordinate 会读取这个常量。
// const 在声明前处于 TDZ，会直接抛 "Cannot access before initialization"。
const COORDINATE_PATTERN = /^-?\d{1,3}(\.\d{1,7})?$/;

const viewportRef = ref<HTMLElement | null>(null);
const preview = ref<MapStaticResult | null>(null);
const previewError = ref('');
const imageFailed = ref(false);
const loading = ref(false);
const locating = ref(false);
const fillingAddress = ref(false);
const zoom = ref(16);
const source = ref<CoordinateSource>(hasCoords() ? 'hydrate' : 'none');
const locatedAddress = ref(hasCoords() ? props.address.trim() : '');

const manualOpen = ref(false);
const manualLng = ref('');
const manualLat = ref('');
const manualError = ref('');

const drag = reactive({
  active: false,
  startX: 0,
  startY: 0,
  dx: 0,
  dy: 0
});

let previewSeq = 0;
let resizeObserver: ResizeObserver | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let observedWidth = 0;

function isValidCoordinate(value: string, min: number, max: number) {
  const text = String(value || '').trim();
  if (!COORDINATE_PATTERN.test(text)) return false;
  const number = Number(text);
  return Number.isFinite(number) && number >= min && number <= max;
}

function hasCoords() {
  return isValidCoordinate(longitude.value, -180, 180) && isValidCoordinate(latitude.value, -85.0511288, 85.0511288);
}

const hasValidCoords = computed(() => hasCoords());
const displayError = computed(() => {
  if (previewError.value) return previewError.value;
  if (imageFailed.value) return '地图图片加载失败，可手工填写坐标';
  return '';
});

const addressStale = computed(() => {
  const current = props.address.trim();
  return Boolean(hasValidCoords.value && locatedAddress.value && current && current !== locatedAddress.value);
});

const imageStyle = computed(() => ({
  transform: `translate3d(${drag.dx}px, ${drag.dy}px, 0)`,
  transition: drag.active ? 'none' : 'transform 0.18s ease'
}));

const viewportStyle = computed(() => ({ height: `${props.height}px` }));

function resetPreview() {
  previewSeq += 1;
  preview.value = null;
  previewError.value = '';
  imageFailed.value = false;
  loading.value = false;
}

function emitSource(nextSource: CoordinateSource, address: string) {
  source.value = nextSource;
  locatedAddress.value = address;
  emit('source-change', { source: nextSource, address });
}

function applyCoords(lng: string, lat: string, nextSource: CoordinateSource, address: string) {
  longitude.value = toCoordinateString(Number(lng));
  latitude.value = toCoordinateString(Number(lat));
  emitSource(nextSource, String(address || '').trim());
}

function clearCoords() {
  resetPreview();
  longitude.value = '';
  latitude.value = '';
  drag.dx = 0;
  drag.dy = 0;
  emitSource('none', '');
}

async function mapSize() {
  await nextTick();
  const width = viewportRef.value?.clientWidth || 520;
  return {
    width: Math.max(280, Math.min(1024, Math.round(width))),
    height: Math.max(160, Math.min(480, Math.round(props.height)))
  };
}

async function loadPreview() {
  if (!hasCoords()) {
    resetPreview();
    return;
  }

  const seq = ++previewSeq;
  const size = await mapSize();
  if (seq !== previewSeq || !hasCoords()) return;
  loading.value = true;

  try {
    const { data, error } = await fetchAdminMapStatic({
      longitude: longitude.value,
      latitude: latitude.value,
      zoom: zoom.value,
      width: size.width,
      height: size.height,
      scale: 2
    });

    if (seq !== previewSeq) return;

    if (error) {
      preview.value = null;
      previewError.value = '地图预览加载失败，可手工填写坐标';
      return;
    }

    if (!data?.available || !data.dataUrl) {
      preview.value = null;
      previewError.value = data?.message || '地图预览不可用，可手工填写坐标';
      return;
    }

    imageFailed.value = false;
    previewError.value = '';
    preview.value = data;
  } finally {
    if (seq === previewSeq) loading.value = false;
  }
}

async function locateByAddress(address = props.address, force = false) {
  const text = String(address || '').trim();
  if (!text) {
    ElMessage.warning('请先输入项目地址');
    return false;
  }
  // 地址失焦时不要覆盖管理员刚刚在地图上手动选择的位置，也不要对已经
  // 按同一地址解析过的坐标重复请求；只有明确点「按地址定位 / 重新定位」
  // 才强制用地址重新解析。
  if (!force) {
    if (source.value === 'manual') return false;
    if (
      (source.value === 'geocode' || source.value === 'hydrate') &&
      text === locatedAddress.value
    ) {
      return false;
    }
  }
  if (locating.value) return false;

  locating.value = true;
  try {
    const { data, error } = await fetchAdminMapGeocode(text);
    if (error) {
      ElMessage.warning('地址定位失败，请稍后重试或手工填写坐标');
      return false;
    }

    if (!data?.found || !data.longitude || !data.latitude) {
      // 新地址解析失败时，如果现有坐标来自地址解析 / 回填，就不要继续保留旧坐标
      if (source.value !== 'manual') clearCoords();
      ElMessage.warning(
        data?.reason === 'unavailable'
          ? '地图服务暂时不可用，请手工填写坐标'
          : '没有找到该地址对应的坐标，请拖动地图选点或手工填写'
      );
      return false;
    }

    applyCoords(data.longitude, data.latitude, 'geocode', text);
    return true;
  } finally {
    locating.value = false;
  }
}

async function fillAddress() {
  if (!hasCoords() || fillingAddress.value) return;

  fillingAddress.value = true;
  try {
    const { data, error } = await fetchAdminMapReverseGeocode({
      longitude: longitude.value,
      latitude: latitude.value
    });

    if (error || !data?.found || !data.address) {
      ElMessage.warning('没有反查到可读地址，请手工填写');
      return;
    }

    const address = data.address.trim();
    emitSource(source.value, address);
    emit('address-suggestion', address);
    ElMessage.success('已填入地图位置对应的地址');
  } finally {
    fillingAddress.value = false;
  }
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled || loading.value || displayError.value || !preview.value) return;
  if (event.button !== undefined && event.button !== 0) return;

  viewportRef.value?.setPointerCapture?.(event.pointerId);
  drag.active = true;
  drag.startX = event.clientX;
  drag.startY = event.clientY;
  drag.dx = 0;
  drag.dy = 0;
}

function onPointerMove(event: PointerEvent) {
  if (!drag.active) return;
  drag.dx = event.clientX - drag.startX;
  drag.dy = event.clientY - drag.startY;
}

function onPointerUp(event: PointerEvent) {
  if (!drag.active) return;

  drag.active = false;
  try {
    viewportRef.value?.releasePointerCapture?.(event.pointerId);
  } catch {
    // 指针捕获可能已由浏览器释放，忽略即可
  }

  const { dx, dy } = drag;
  drag.dx = 0;
  drag.dy = 0;

  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

  const center = moveCenterByPixels(
    { longitude: Number(longitude.value), latitude: Number(latitude.value) },
    dx,
    dy,
    zoom.value
  );
  applyCoords(
    toCoordinateString(center.longitude),
    toCoordinateString(center.latitude),
    'manual',
    props.address
  );
}

function onPointerCancel(event: PointerEvent) {
  if (!drag.active) return;
  drag.active = false;
  drag.dx = 0;
  drag.dy = 0;
  try {
    viewportRef.value?.releasePointerCapture?.(event.pointerId);
  } catch {
    // ignore
  }
}

function zoomIn() {
  if (loading.value || zoom.value >= 17) return;
  zoom.value += 1;
}

function zoomOut() {
  if (loading.value || zoom.value <= 10) return;
  zoom.value -= 1;
}

function openManual() {
  manualLng.value = longitude.value || '';
  manualLat.value = latitude.value || '';
  manualError.value = '';
  manualOpen.value = true;
}

function toggleManual() {
  if (manualOpen.value) {
    manualOpen.value = false;
    manualError.value = '';
    return;
  }
  openManual();
}

function applyManual() {
  const lng = manualLng.value.trim();
  const lat = manualLat.value.trim();

  if (!lng || !lat) {
    manualError.value = '经度和纬度必须同时填写';
    return;
  }
  if (!isValidCoordinate(lng, -180, 180)) {
    manualError.value = '经度格式不正确（-180 ~ 180，最多 7 位小数）';
    return;
  }
  if (!isValidCoordinate(lat, -85.0511288, 85.0511288)) {
    manualError.value = '纬度格式不正确（-85.0511288 ~ 85.0511288，最多 7 位小数）';
    return;
  }

  manualError.value = '';
  manualOpen.value = false;
  applyCoords(lng, lat, 'manual', props.address);
}

function onImageError() {
  imageFailed.value = true;
}

function observeViewport() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  observedWidth = 0;

  const element = viewportRef.value;
  if (!element || typeof ResizeObserver === 'undefined') return;

  observedWidth = Math.round(element.clientWidth || 0);
  resizeObserver = new ResizeObserver(entries => {
    const width = Math.round(entries[0]?.contentRect.width || 0);
    if (!width || Math.abs(width - observedWidth) <= 2) return;
    observedWidth = width;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      void loadPreview();
    }, 250);
  });
  resizeObserver.observe(element);
}

watch(
  [longitude, latitude, zoom],
  () => {
    if (!hasCoords()) {
      resetPreview();
      return;
    }
    void loadPreview();
  },
  { immediate: true }
);

watch(hasValidCoords, async value => {
  if (!value) {
    resizeObserver?.disconnect();
    resizeObserver = null;
    return;
  }
  await nextTick();
  observeViewport();
});

watch([manualLng, manualLat], () => {
  manualError.value = '';
});

onMounted(async () => {
  if (hasCoords()) {
    await nextTick();
    observeViewport();
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (resizeTimer) clearTimeout(resizeTimer);
});

defineExpose({ locateByAddress, clear: clearCoords });
</script>

<template>
  <div class="map-picker">
    <div v-if="!hasValidCoords && !preview" class="map-empty">
      <div class="map-empty-title">还没有设置项目位置</div>
      <div class="map-empty-desc">输入项目地址后点击「按地址定位」，或直接手工填写经纬度。</div>
      <div class="map-actions">
        <ElButton
          size="small"
          type="primary"
          :loading="locating"
          :disabled="disabled"
          @click="locateByAddress(address, true)"
        >
          按地址定位
        </ElButton>
        <ElButton size="small" text :disabled="disabled" @click="toggleManual">手工输入坐标</ElButton>
      </div>
    </div>

    <div v-else class="map-layout">
      <div
        ref="viewportRef"
        class="map-viewport"
        :class="{ 'is-dragging': drag.active, 'is-disabled': disabled }"
        :style="viewportStyle"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <img
          v-if="preview?.dataUrl && !imageFailed"
          class="map-image"
          :src="preview.dataUrl"
          :style="imageStyle"
          alt="项目位置地图"
          :draggable="false"
          @dragstart.prevent
          @error="onImageError"
        />
        <div v-if="!displayError" class="map-pin" aria-hidden="true" />
        <div v-if="loading" class="map-overlay">地图加载中…</div>
        <div v-else-if="displayError" class="map-overlay map-overlay--error">
          {{ displayError }}
        </div>
      </div>

      <div class="map-toolbar">
        <div class="map-coords">
          <span>经度 {{ longitude }}</span>
          <span>纬度 {{ latitude }}</span>
        </div>
        <div class="map-tools">
          <ElButton size="small" :disabled="disabled || loading || zoom <= 10" @click="zoomOut">−</ElButton>
          <span class="map-zoom">{{ zoom }}</span>
          <ElButton size="small" :disabled="disabled || loading || zoom >= 17" @click="zoomIn">+</ElButton>
          <ElButton
            size="small"
            :loading="locating"
            :disabled="disabled"
            @click="locateByAddress(address, true)"
          >
            重新定位
          </ElButton>
        </div>
      </div>

      <div class="map-tip">拖动地图，让中心图钉对准项目位置；松手后坐标会自动更新。</div>

      <div class="map-actions">
        <ElButton
          size="small"
          :loading="fillingAddress"
          :disabled="disabled || !hasValidCoords"
          @click="fillAddress"
        >
          用地图位置填入地址
        </ElButton>
        <ElButton size="small" text :disabled="disabled" @click="toggleManual">手工输入坐标</ElButton>
      </div>
    </div>

    <ElAlert
      v-if="addressStale"
      class="mt-8px"
      type="warning"
      :closable="false"
      show-icon
      title="地址已修改，建议重新按地址定位或确认地图位置"
    />

    <div v-if="manualOpen" class="manual-coords">
      <ElInput v-model="manualLng" placeholder="经度，例如 121.4737010" :disabled="disabled" />
      <ElInput v-model="manualLat" placeholder="纬度，例如 31.2304160" :disabled="disabled" />
      <div class="manual-hint">GCJ-02 坐标，最多 7 位小数</div>
      <div class="manual-actions">
        <ElButton size="small" type="primary" :disabled="disabled" @click="applyManual">应用坐标</ElButton>
        <ElButton size="small" text @click="toggleManual">取消</ElButton>
      </div>
    </div>

    <ElAlert
      v-if="manualError"
      class="mt-8px"
      type="error"
      :closable="false"
      show-icon
      :title="manualError"
    />
  </div>
</template>

<style scoped>
.map-picker {
  width: 100%;
}

.map-empty {
  padding: 22px 18px;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  background: #fafafa;
  text-align: center;
}

.map-empty-title {
  color: #1d2129;
  font-size: 14px;
  font-weight: 600;
}

.map-empty-desc {
  margin-top: 6px;
  color: #86909c;
  font-size: 12px;
  line-height: 1.6;
}

.map-layout {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.map-viewport {
  position: relative;
  width: 100%;
  max-width: 1024px;
  overflow: hidden;
  border-radius: 8px;
  background: #eef0f3;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.map-viewport.is-dragging {
  cursor: grabbing;
}

.map-viewport.is-disabled {
  cursor: not-allowed;
}

.map-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}

.map-pin {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #eb5c20;
  box-shadow:
    0 0 0 2px rgb(235 92 32 / 30%),
    0 2px 6px rgb(0 0 0 / 25%);
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.map-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgb(255 255 255 / 82%);
  color: #86909c;
  font-size: 12px;
  text-align: center;
}

.map-overlay--error {
  color: #f53f3f;
}

.map-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.map-coords {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: #4e5969;
  font-size: 12px;
}

.map-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

.map-zoom {
  min-width: 18px;
  color: #4e5969;
  font-size: 12px;
  text-align: center;
}

.map-tip {
  color: #86909c;
  font-size: 12px;
  line-height: 1.5;
}

.map-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.manual-coords {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
  padding: 12px;
  border: 1px solid #f0f1f3;
  border-radius: 8px;
  background: #fafafa;
}

.manual-hint {
  grid-column: 1 / -1;
  color: #86909c;
  font-size: 12px;
}

.manual-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 8px;
}

@media (max-width: 520px) {
  .manual-coords {
    grid-template-columns: 1fr;
  }
}
</style>
