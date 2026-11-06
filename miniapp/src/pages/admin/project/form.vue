<template>
  <view class="admin-page">
    <AdminNav :title="isEdit ? '编辑项目' : '新建项目'" fallback="/pages/admin/home/index?tab=projects" />

    <view class="admin-content">
      <view v-if="loading" class="admin-card">
        <gc-loading text="正在加载…" />
      </view>

      <view v-else-if="loadError" class="admin-card">
        <text class="admin-muted">{{ loadError }}</text>
        <button class="admin-btn admin-btn--ghost admin-btn--block retry-btn" @tap="loadProject">重新加载</button>
      </view>

      <template v-else>
        <view class="admin-card">
          <view class="admin-section-head">
            <view>
              <text class="admin-section-title">基础信息</text>
              <text class="admin-section-sub">项目名、地址与合同金额会同步到网页后台</text>
            </view>
          </view>

          <view class="admin-form-group">
            <text class="admin-form-label">项目名称</text>
            <input
              v-model="form.name"
              class="admin-input"
              maxlength="50"
              placeholder="例如：阳光花园 3 栋 1201"
              placeholder-class="admin-placeholder"
            />
          </view>

          <view class="admin-form-group">
            <text class="admin-form-label">项目地址</text>
            <input
              v-model="form.address"
              class="admin-input"
              maxlength="200"
              placeholder="请输入详细地址，失焦后自动定位"
              placeholder-class="admin-placeholder"
              @blur="onAddressBlur"
            />
            <text class="admin-form-hint">也可以在地图上选点；地图解析失败时仍可保存，并手工填写坐标。</text>
          </view>

          <view class="admin-form-group">
            <text class="admin-form-label">项目封面</text>
            <view class="cover-field">
              <view
                class="cover-preview"
                :class="{ 'cover-preview--empty': !form.coverUrl }"
                @tap="chooseCover"
              >
                <image v-if="form.coverUrl" class="cover-img" :src="form.coverUrl" mode="aspectFill" />
                <view v-else class="cover-empty">
                  <image
                    class="cover-empty-icon"
                    src="/static/images/icon-camera-gray.png"
                    mode="aspectFit"
                  />
                  <text>上传封面</text>
                </view>
                <view v-if="coverUploading" class="cover-mask">上传中…</view>
              </view>
              <view class="cover-actions">
                <view class="cover-buttons">
                  <button
                    class="admin-btn admin-btn--ghost admin-btn--small"
                    :disabled="coverUploading"
                    @tap="chooseCover"
                  >
                    {{ form.coverUrl ? '更换封面' : '上传封面' }}
                  </button>
                  <button
                    v-if="form.coverUrl"
                    class="admin-btn admin-btn--ghost admin-btn--small cover-remove"
                    :disabled="coverUploading"
                    @tap="removeCover"
                  >
                    移除
                  </button>
                </view>
                <text class="admin-form-hint">建议 1:1 正方形图片，不超过 5MB，支持 JPG / PNG / WebP；各端按正方形居中裁切。</text>
              </view>
            </view>
          </view>

          <view class="admin-form-group">
            <text class="admin-form-label">地图定位</text>

            <view
              v-if="hasCoordinates"
              class="location-map"
              @touchstart="onMapTouchStart"
              @touchmove.stop.prevent="onMapTouchMove"
              @touchend="onMapTouchEnd"
              @touchcancel="onMapTouchCancel"
            >
              <image
                v-if="mapPreview && !mapImageError"
                class="location-map-image"
                :src="mapPreview"
                mode="aspectFill"
                :style="mapImageStyle"
                @error="onMapImageError"
              />
              <view v-else class="location-map-placeholder">
                <text>{{ mapError || '地图预览不可用，可直接保存坐标' }}</text>
              </view>
              <view v-if="!mapError && !mapImageError" class="location-pin" />
              <view v-if="mapLoading" class="location-map-loading">
                <text>地图加载中…</text>
              </view>
            </view>

            <view v-else class="location-empty">
              <text class="location-empty-title">还没有设置项目位置</text>
              <text class="location-empty-sub">输入地址后按「按地址定位」，或使用地图选点 / 手工坐标。</text>
            </view>

            <view class="location-actions">
              <button class="admin-btn admin-btn--ghost location-btn" :disabled="locating" @tap="locateByAddress">
                {{ locating ? '定位中…' : '按地址定位' }}
              </button>
              <button class="admin-btn admin-btn--ghost location-btn" @tap="chooseOnMap">地图选点</button>
              <button class="admin-btn admin-btn--ghost location-btn" @tap="toggleManual">
                {{ manualOpen ? '收起坐标' : '手工坐标' }}
              </button>
            </view>

            <view v-if="hasCoordinates" class="location-meta">
              <text>经度 {{ form.longitude }} · 纬度 {{ form.latitude }}</text>
              <text class="location-zoom">缩放 {{ mapZoom }}</text>
            </view>

            <view v-if="hasCoordinates" class="location-actions">
              <button class="admin-btn admin-btn--ghost location-btn" @tap="zoomOut">－ 缩小</button>
              <button class="admin-btn admin-btn--ghost location-btn" @tap="zoomIn">＋ 放大</button>
            </view>

            <text v-if="pickedAddress" class="admin-form-hint">
              地图位置：{{ pickedAddress }}
              <text class="location-link" @tap="usePickedAddress">填入项目地址</text>
            </text>
            <text v-if="addressStale" class="admin-form-hint location-warn">
              地址已修改，建议重新定位或确认地图位置。
            </text>

            <view v-if="manualOpen" class="manual-coords">
              <input
                v-model="manualLng"
                class="admin-input"
                type="digit"
                maxlength="20"
                placeholder="经度，如 121.4737010"
                placeholder-class="admin-placeholder"
              />
              <input
                v-model="manualLat"
                class="admin-input"
                type="digit"
                maxlength="20"
                placeholder="纬度，如 31.2304160"
                placeholder-class="admin-placeholder"
              />
              <view class="location-actions">
                <button class="admin-btn admin-btn--ghost location-btn" @tap="applyManual">应用坐标</button>
                <button class="admin-btn admin-btn--ghost location-btn" @tap="toggleManual">取消</button>
              </view>
              <text v-if="manualError" class="location-error">{{ manualError }}</text>
            </view>
          </view>

          <view class="form-grid">
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">合同金额</text>
              <input
                v-model="form.contractAmount"
                class="admin-input"
                type="digit"
                maxlength="20"
                placeholder="例如 200000"
                placeholder-class="admin-placeholder"
              />
            </view>
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">面积（可选）</text>
              <input
                v-model="form.area"
                class="admin-input"
                type="digit"
                maxlength="20"
                placeholder="例如 120.5"
                placeholder-class="admin-placeholder"
              />
            </view>
          </view>

          <view class="form-grid">
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">开工日期</text>
              <picker mode="date" :value="form.startDate" @change="onStartDate">
                <view class="admin-picker-row">
                  <text :class="form.startDate ? 'admin-picker-value' : 'admin-placeholder'">
                    {{ form.startDate || '选择日期' }}
                  </text>
                </view>
              </picker>
            </view>
            <view class="admin-form-group form-grid-item">
              <text class="admin-form-label">计划竣工</text>
              <picker mode="date" :value="form.planEndDate" @change="onPlanEndDate">
                <view class="admin-picker-row">
                  <text :class="form.planEndDate ? 'admin-picker-value' : 'admin-placeholder'">
                    {{ form.planEndDate || '选择日期' }}
                  </text>
                </view>
              </picker>
            </view>
          </view>

          <view v-if="!isEdit" class="admin-form-group">
            <text class="admin-form-label">阶段模板</text>
            <view class="admin-picker-row" @tap="openTemplateSheet">
              <text :class="selectedTemplateName ? 'admin-picker-value' : 'admin-placeholder'">
                {{ selectedTemplateName || (templatesLoading ? '加载中…' : '使用默认模板') }}
              </text>
              <image class="picker-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
            </view>
            <text class="admin-form-hint">模板决定项目生成哪些阶段与工序；模板编辑仍在网页后台。</text>
          </view>

          <view class="admin-form-group">
            <text class="admin-form-label">备注（可选）</text>
            <textarea
              v-model="form.remark"
              class="admin-textarea"
              maxlength="500"
              placeholder="补充说明"
              placeholder-class="admin-placeholder"
            />
          </view>
        </view>

        <text v-if="error" class="form-error">{{ error }}</text>

        <button
          class="admin-btn admin-btn--block save-btn"
          :class="{ 'admin-btn--disabled': saving }"
          :disabled="saving"
          @tap="submit"
        >
          {{ saving ? '保存中…' : isEdit ? '保存修改' : '创建项目' }}
        </button>
      </template>
    </view>

    <view v-if="templateSheetOpen" class="admin-sheet-mask" @tap="templateSheetOpen = false">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">选择阶段模板</text>
            <text class="admin-sheet-sub">创建后项目结构是模板的副本，修改模板不影响已建项目</text>
          </view>
          <view class="admin-sheet-close" @tap="templateSheetOpen = false">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="!templates.length" class="admin-empty-inline">暂无可用模板</view>
        <view v-else class="template-list">
          <view
            v-for="template in templates"
            :key="template.id"
            class="template-row"
            :class="{ 'template-row--active': Number(form.templateId) === Number(template.id) }"
            @tap="chooseTemplate(template)"
          >
            <view class="template-main">
              <view class="template-title-row">
                <text class="template-name">{{ template.name }}</text>
                <text v-if="template.isDefault" class="admin-badge admin-badge--accent">默认</text>
              </view>
              <text class="template-meta">{{ template.stageCount }} 个阶段 · {{ template.itemCount }} 个工序</text>
            </view>
            <text v-if="Number(form.templateId) === Number(template.id)" class="template-check">已选择</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import {
  createAdminProject,
  updateAdminProject,
  fetchAdminProject,
  geocodeAdminMap,
  fetchAdminMapPreview,
  uploadAdminProjectCover,
} from '../../../api/admin/project'
import { fetchAdminTemplates } from '../../../api/admin/template'
import {
  requireAdminSession,
  formatDate,
  showAdminError,
  MAX_MERCATOR_LAT,
  isValidCoordinate,
  moveCenterByPixels,
  toCoordinateString,
} from '../../../utils/admin'

defineOptions({ name: 'AdminProjectFormPage' })

const projectId = ref(null)
const isEdit = computed(() => Boolean(projectId.value))
const form = reactive({
  name: '',
  address: '',
  coverUrl: '',
  area: '',
  contractAmount: '',
  startDate: '',
  planEndDate: '',
  templateId: '',
  remark: '',
  longitude: '',
  latitude: '',
})

const mapPreview = ref('')
const mapLoading = ref(false)
const mapError = ref('')
const mapImageError = ref(false)
const locating = ref(false)
const mapZoom = ref(16)
const coordinateSource = ref('none')
const locatedAddress = ref('')
const pickedAddress = ref('')
const manualOpen = ref(false)
const manualLng = ref('')
const manualLat = ref('')
const manualError = ref('')
const dragState = reactive({ active: false, startX: 0, startY: 0, dx: 0, dy: 0 })
const mapWidth = ref(0)
const mapHeight = ref(0)

let previewSeq = 0
let locateSeq = 0

const hasCoordinates = computed(
  () =>
    isValidCoordinate(form.longitude, -180, 180) &&
    isValidCoordinate(form.latitude, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)
)

const addressStale = computed(() => {
  const address = form.address.trim()
  return Boolean(hasCoordinates.value && locatedAddress.value && address && address !== locatedAddress.value)
})

const mapImageStyle = computed(
  () =>
    `transform: translate3d(${dragState.dx}px, ${dragState.dy}px, 0); transition: ${
      dragState.active ? 'none' : 'transform .15s ease'
    };`
)

const coverUploading = ref(false)
const templates = ref([])
const templatesLoading = ref(false)
const templateSheetOpen = ref(false)
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const error = ref('')

const selectedTemplateName = computed(() => {
  const item = templates.value.find((template) => Number(template.id) === Number(form.templateId))
  return item ? item.name : ''
})

onLoad(async (options) => {
  const id = options && options.id ? Number(options.id) : null
  projectId.value = Number.isInteger(id) && id > 0 ? id : null

  try {
    await requireAdminSession()
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
    return
  }

  if (isEdit.value) {
    await loadProject()
  } else {
    const today = new Date()
    const plan = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
    form.startDate = formatDate(today)
    form.planEndDate = formatDate(plan)
    await loadTemplates()
  }
})

async function loadTemplates() {
  templatesLoading.value = true
  try {
    const data = await fetchAdminTemplates()
    templates.value = (data && data.list) || []
    if (!form.templateId && templates.value.length) {
      const defaultTemplate = templates.value.find((item) => item.isDefault) || templates.value[0]
      form.templateId = defaultTemplate.id
    }
  } catch (err) {
    showAdminError(err, '模板加载失败')
  } finally {
    templatesLoading.value = false
  }
}

async function loadProject() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await fetchAdminProject(projectId.value)
    if (!data) throw new Error('项目不存在')
    if (data.status === 'archived') throw new Error('已归档项目只读，无法编辑')

    form.name = data.name || ''
    form.address = data.address || ''
    form.coverUrl = data.coverUrl || ''
    form.area = data.area || ''
    form.contractAmount = data.contractAmount || ''
    form.startDate = formatDate(data.startDate)
    form.planEndDate = formatDate(data.planEndDate)
    form.remark = data.remark || ''
    form.templateId = data.templateId || ''
    form.longitude = data.longitude || ''
    form.latitude = data.latitude || ''

    const hasCoords = Boolean(form.longitude && form.latitude)
    coordinateSource.value = hasCoords ? 'hydrate' : 'none'
    locatedAddress.value = hasCoords ? form.address.trim() : ''
  } catch (err) {
    loadError.value = err.message || '项目加载失败'
    showAdminError(err, '项目加载失败')
  } finally {
    loading.value = false
  }
}

// ── 地图定位 ─────────────────────────────────────────────
//
// 静态图由服务端生成，地图 Key 不在小程序里出现。拖动、缩放只改
// 中心坐标；松手后重新拉一张图。微信端额外提供原生 chooseLocation 快捷选点。

function setCoordinates(lng, lat, source, address) {
  const lngNumber = Number(lng)
  const latNumber = Number(lat)
  if (!Number.isFinite(lngNumber) || !Number.isFinite(latNumber)) return false

  // 必须先格式化成 7 位小数字符串再校验：拖拽得到的原始 Number 通常有
  // 十几位小数，直接传给 isValidCoordinate 会被「最多 7 位小数」规则拒绝。
  const lngText = toCoordinateString(lngNumber)
  const latText = toCoordinateString(latNumber)
  if (!isValidCoordinate(lngText, -180, 180)) return false
  if (!isValidCoordinate(latText, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)) return false

  form.longitude = lngText
  form.latitude = latText
  coordinateSource.value = source
  locatedAddress.value = String(address || '').trim()
  mapImageError.value = false
  return true
}

function resetMapPreview() {
  previewSeq += 1
  mapPreview.value = ''
  mapLoading.value = false
  mapError.value = ''
  mapImageError.value = false
}

function clearCoordinates() {
  resetMapPreview()
  form.longitude = ''
  form.latitude = ''
  coordinateSource.value = 'none'
  locatedAddress.value = ''
  pickedAddress.value = ''
  dragState.active = false
  dragState.dx = 0
  dragState.dy = 0
}

function measureMap() {
  return new Promise((resolve) => {
    uni
      .createSelectorQuery()
      .select('.location-map')
      .boundingClientRect((rect) => {
        resolve(
          rect && rect.width
            ? { width: Math.round(rect.width), height: Math.round(rect.height) }
            : null
        )
      })
      .exec()
  })
}

async function refreshMapPreview() {
  if (!hasCoordinates.value) {
    resetMapPreview()
    return
  }

  const seq = ++previewSeq
  mapLoading.value = true
  mapError.value = ''

  try {
    await nextTick()
    const measured = await measureMap()
    if (seq !== previewSeq || !hasCoordinates.value) return

    const info = uni.getSystemInfoSync()
    const width = Math.max(
      240,
      Math.min(640, (measured && measured.width) || Math.round((info.windowWidth || 375) - 64))
    )
    const height = Math.max(
      120,
      Math.min(480, (measured && measured.height) || Math.round((width * 200) / 360))
    )
    mapWidth.value = width
    mapHeight.value = height

    const data = await fetchAdminMapPreview({
      longitude: form.longitude,
      latitude: form.latitude,
      zoom: mapZoom.value,
      width,
      height,
      scale: 2,
    })

    if (seq !== previewSeq) return

    if (data && data.available && data.dataUrl) {
      mapPreview.value = data.dataUrl
      mapImageError.value = false
      mapWidth.value = data.width || width
      mapHeight.value = data.height || height
    } else {
      mapPreview.value = ''
      mapError.value = (data && data.message) || '地图预览不可用，可直接保存坐标'
    }
  } catch (err) {
    if (seq === previewSeq) {
      mapPreview.value = ''
      mapError.value = '地图预览加载失败，可直接保存坐标'
    }
  } finally {
    if (seq === previewSeq) mapLoading.value = false
  }
}

async function locateByAddress() {
  const address = form.address.trim()
  if (!address) {
    uni.showToast({ title: '请先输入项目地址', icon: 'none' })
    return
  }
  if (locating.value) return

  const seq = ++locateSeq
  locating.value = true

  try {
    const result = await geocodeAdminMap(address)
    if (seq !== locateSeq) return

    if (result && result.found && result.longitude && result.latitude) {
      setCoordinates(result.longitude, result.latitude, 'geocode', address)
      pickedAddress.value = ''
      return
    }

    // 地址改坏时不要继续保留旧的地理编码坐标；手动选点则尊重管理员的选择
    if (coordinateSource.value !== 'manual' && coordinateSource.value !== 'choose') {
      clearCoordinates()
    }
    uni.showToast({
      title:
        result && result.reason === 'unavailable'
          ? '地图服务不可用，请手工填坐标'
          : '没有找到地址坐标，可地图选点',
      icon: 'none',
    })
  } catch (err) {
    if (seq === locateSeq) showAdminError(err, '地址定位失败')
  } finally {
    if (seq === locateSeq) locating.value = false
  }
}

function onAddressBlur() {
  const address = form.address.trim()
  if (!address) return
  // 手动选点后失焦不覆盖，只有明确点「按地址定位」才重新解析
  if (coordinateSource.value === 'manual' || coordinateSource.value === 'choose') return
  // 已经按同一地址解析过，不必重复请求
  if (hasCoordinates.value && locatedAddress.value === address) return
  locateByAddress()
}

function chooseOnMap() {
  if (typeof uni.chooseLocation !== 'function') {
    uni.showToast({ title: '当前环境不支持地图选点，请用地址定位', icon: 'none' })
    return
  }

  const options = {}
  if (hasCoordinates.value) {
    options.latitude = Number(form.latitude)
    options.longitude = Number(form.longitude)
  }

  uni.chooseLocation({
    ...options,
    success(res) {
      const lat = Number(res.latitude)
      const lng = Number(res.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        uni.showToast({ title: '没有取到有效坐标，请重试', icon: 'none' })
        return
      }

      const picked = String(res.address || res.name || '').trim()
      setCoordinates(lng, lat, 'choose', form.address.trim())
      pickedAddress.value = picked
      if (!form.address.trim() && picked) {
        form.address = picked
        locatedAddress.value = picked
      }
    },
    fail(err) {
      const detail = String((err && err.errMsg) || '')
      if (detail.includes('cancel')) return
      uni.showModal({
        title: '无法选择位置',
        content: '请允许小程序使用位置信息，或使用「按地址定位」。',
        showCancel: false,
      })
    },
  })
}

function usePickedAddress() {
  if (!pickedAddress.value) return
  form.address = pickedAddress.value
  locatedAddress.value = pickedAddress.value
  pickedAddress.value = ''
}

function toggleManual() {
  if (manualOpen.value) {
    manualOpen.value = false
    manualError.value = ''
    return
  }
  manualLng.value = form.longitude || ''
  manualLat.value = form.latitude || ''
  manualError.value = ''
  manualOpen.value = true
}

function applyManual() {
  const lng = manualLng.value.trim()
  const lat = manualLat.value.trim()

  if (!lng || !lat) {
    manualError.value = '经度和纬度必须同时填写'
    return
  }
  if (!isValidCoordinate(lng, -180, 180)) {
    manualError.value = '经度格式不正确（-180 ~ 180，最多 7 位小数）'
    return
  }
  if (!isValidCoordinate(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)) {
    manualError.value = '纬度格式不正确（最多 7 位小数）'
    return
  }

  if (!setCoordinates(lng, lat, 'manual', form.address)) return
  manualOpen.value = false
  manualError.value = ''
}

function zoomIn() {
  if (mapLoading.value || mapZoom.value >= 17) return
  mapZoom.value += 1
}

function zoomOut() {
  if (mapLoading.value || mapZoom.value <= 10) return
  mapZoom.value -= 1
}

function touchPoint(event) {
  const touch =
    (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0])
  if (!touch) return null
  return {
    x: touch.clientX !== undefined ? touch.clientX : touch.pageX,
    y: touch.clientY !== undefined ? touch.clientY : touch.pageY,
  }
}

function onMapTouchStart(event) {
  if (!hasCoordinates.value || mapLoading.value || mapError.value || mapImageError.value) return
  const point = touchPoint(event)
  if (!point) return

  dragState.active = true
  dragState.startX = point.x
  dragState.startY = point.y
  dragState.dx = 0
  dragState.dy = 0
}

function onMapTouchMove(event) {
  if (!dragState.active) return
  const point = touchPoint(event)
  if (!point) return
  dragState.dx = point.x - dragState.startX
  dragState.dy = point.y - dragState.startY
}

function onMapTouchEnd() {
  if (!dragState.active) return

  dragState.active = false
  const dx = dragState.dx
  const dy = dragState.dy
  dragState.dx = 0
  dragState.dy = 0

  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
  if (!mapWidth.value || !mapHeight.value) return

  const next = moveCenterByPixels(
    { longitude: Number(form.longitude), latitude: Number(form.latitude) },
    dx,
    dy,
    mapZoom.value
  )
  setCoordinates(next.longitude, next.latitude, 'manual', form.address)
}

function onMapTouchCancel() {
  dragState.active = false
  dragState.dx = 0
  dragState.dy = 0
}

function onMapImageError() {
  mapImageError.value = true
}

watch([() => form.longitude, () => form.latitude, mapZoom], () => {
  if (!hasCoordinates.value) {
    resetMapPreview()
    return
  }
  refreshMapPreview()
})

onBeforeUnmount(() => {
  previewSeq += 1
  locateSeq += 1
})

async function submit() {
  if (saving.value) return
  error.value = validate()
  if (error.value) return

  saving.value = true
  try {
    if (isEdit.value) {
      const updated = await updateAdminProject(projectId.value, buildPayload(false))
      if (updated && updated.needsCoordinates) {
        uni.showModal({
          title: '已保存',
          content: '地址未解析出坐标，可在编辑项目时用地图选点或手工填写坐标。',
          showCancel: false,
          success: () => uni.navigateBack(),
        })
        return
      }

      uni.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 350)
      return
    }

    const created = await createAdminProject(buildPayload(true))
    const messages = []
    if (created && created.duplicates) messages.push('存在同名项目，已按允许重复的规则创建')
    if (created && created.needsCoordinates) {
      messages.push('地址未解析出坐标，可在编辑项目时用地图选点或手工填写坐标')
    }

    if (messages.length) {
      uni.showModal({
        title: '项目已创建',
        content: messages.join('\n'),
        showCancel: false,
        success: () => {
          uni.redirectTo({ url: `/pages/admin/project/detail?id=${created.id}` })
        },
      })
    } else {
      uni.redirectTo({ url: `/pages/admin/project/detail?id=${created.id}` })
    }
  } catch (err) {
    error.value = err.message || '保存失败'
    showAdminError(err, '保存失败')
  } finally {
    saving.value = false
  }
}

function buildPayload(includeTemplate) {
  const address = form.address.trim()
  const payload = {
    name: form.name.trim(),
    address,
    // 空字符串表示清除封面；后端把它落成 NULL
    coverUrl: form.coverUrl || '',
    contractAmount: String(form.contractAmount).trim(),
    startDate: form.startDate,
    planEndDate: form.planEndDate,
  }

  if (form.area && String(form.area).trim()) payload.area = String(form.area).trim()
  if (form.remark && form.remark.trim()) payload.remark = form.remark.trim()
  if (includeTemplate && form.templateId) payload.templateId = Number(form.templateId)

  // 地址改掉后，旧的地理编码 / 回填坐标不再可信，交给后端按新地址重新解析；
  // manual / choose 是管理员明确选的位置，地址文字变了也保留。
  const hasCoords = Boolean(form.longitude && form.latitude)
  const staleCoordinates =
    hasCoords &&
    (coordinateSource.value === 'geocode' || coordinateSource.value === 'hydrate') &&
    locatedAddress.value !== address
  if (hasCoords && !staleCoordinates) {
    payload.longitude = String(form.longitude)
    payload.latitude = String(form.latitude)
  }

  return payload
}

function validate() {
  if (!form.name.trim()) return '请输入项目名称'
  if (!form.address.trim()) return '请输入项目地址'
  if (!/^\d+(\.\d{1,2})?$/.test(String(form.contractAmount).trim()) || Number(form.contractAmount) <= 0) {
    return '合同金额必须大于 0，且最多两位小数'
  }
  if (form.area && !/^\d+(\.\d{1,2})?$/.test(String(form.area).trim())) {
    return '面积必须大于 0，且最多两位小数'
  }
  if (form.longitude || form.latitude) {
    if (!form.longitude || !form.latitude) return '经度和纬度必须同时填写'
    if (!isValidCoordinate(form.longitude, -180, 180)) {
      return '经度格式不正确（-180 ~ 180，最多 7 位小数）'
    }
    if (!isValidCoordinate(form.latitude, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)) {
      return '纬度格式不正确（最多 7 位小数）'
    }
  }
  if (!form.startDate) return '请选择开工日期'
  if (!form.planEndDate) return '请选择计划竣工日期'
  if (form.planEndDate < form.startDate) return '计划竣工日期不得早于开工日期'
  if (!isEdit.value && !form.templateId) return '请选择阶段模板'
  return ''
}

const COVER_MAX_BYTES = 5 * 1024 * 1024

/**
 * 选图后立即上传，拿到绝对 URL 再随表单提交。
 *
 * 不用 `uni.chooseImage` 的 success 里的临时路径直接提交：
 * 临时文件在页面关闭 / 重启后会失效，必须先落到服务端存储。
 */
function chooseCover() {
  if (coverUploading.value) return

  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      const file = res.tempFiles && res.tempFiles[0]
      const path = res.tempFilePaths && res.tempFilePaths[0]
      if (!path) return
      if (file && file.size > COVER_MAX_BYTES) {
        uni.showToast({ title: '封面不得超过 5MB', icon: 'none' })
        return
      }

      coverUploading.value = true
      try {
        const data = await uploadAdminProjectCover(path)
        if (!data || !data.url) throw new Error('上传失败')
        form.coverUrl = data.url
        uni.showToast({ title: '封面上传成功', icon: 'none' })
      } catch (err) {
        showAdminError(err, '封面上传失败')
      } finally {
        coverUploading.value = false
      }
    },
  })
}

function removeCover() {
  if (coverUploading.value) return
  form.coverUrl = ''
}

function onStartDate(event) {
  form.startDate = event.detail.value
}

function onPlanEndDate(event) {
  form.planEndDate = event.detail.value
}

function openTemplateSheet() {
  templateSheetOpen.value = true
  if (!templates.value.length) loadTemplates()
}

function chooseTemplate(template) {
  form.templateId = template.id
  templateSheetOpen.value = false
}
</script>

<style scoped lang="scss">
.location-empty {
  padding: dp(16);
  border: 1px dashed #e5e1dc;
  border-radius: dp(10);
  background: #fffaf6;
  text-align: center;
}

.location-empty-title {
  display: block;
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.location-empty-sub {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
  line-height: 1.6;
}

.location-map {
  position: relative;
  width: 100%;
  /* 服务端预览宽度上限 640；H5 宽屏下也按 640 渲染，保证拖拽像素换算一致 */
  max-width: 640px;
  margin: 0 auto;
  padding-top: 55.56%;
  overflow: hidden;
  border-radius: dp(10);
  background: #f0ede9;
  touch-action: none;
}

.location-map-image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  will-change: transform;
}

.location-map-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: dp(16);
  color: #8b8179;
  font-size: dp(11);
  text-align: center;
}

.location-pin {
  position: absolute;
  top: 50%;
  left: 50%;
  width: dp(14);
  height: dp(14);
  border: 2px solid #fff;
  border-radius: 50%;
  background: #eb5c20;
  box-shadow: 0 0 0 2px rgba(235, 92, 32, 0.28), 0 2px 6px rgba(0, 0, 0, 0.22);
  transform: translate(-50%, -50%);
}

.location-map-loading {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.78);
  color: #8b8179;
  font-size: dp(11);
}

.location-actions {
  display: flex;
  flex-wrap: wrap;
  gap: dp(8);
  margin-top: dp(8);
}

.location-btn {
  flex: 0 0 auto;
  width: auto;
  min-height: dp(32);
  margin: 0;
  padding: 0 dp(12);
  font-size: dp(11);
  line-height: 1;
}

.location-meta {
  display: flex;
  justify-content: space-between;
  gap: dp(8);
  margin-top: dp(6);
  color: #6b625b;
  font-size: dp(10);
}

.location-zoom {
  color: #a0968d;
}

.location-warn {
  color: #d97706;
}

.location-link {
  margin-left: dp(4);
  color: #eb5c20;
}

.manual-coords {
  display: flex;
  flex-direction: column;
  gap: dp(8);
  margin-top: dp(8);
}

.location-error {
  color: #f53f3f;
  font-size: dp(10);
}

/* ── 项目封面 ── */
.cover-field {
  display: flex;
  align-items: center;
  gap: dp(12);
  margin-top: dp(8);
}

.cover-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(88);
  height: dp(88);
  overflow: hidden;
  border: 1px solid #e8e1da;
  border-radius: dp(10);
  background: #faf7f3;
  flex-shrink: 0;
}

.cover-preview--empty {
  border-style: dashed;
}

.cover-img {
  width: 100%;
  height: 100%;
}

.cover-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: dp(4);
  color: #a79c92;
  font-size: dp(10);
}

.cover-empty-icon {
  width: dp(20);
  height: dp(20);
}

.cover-mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: dp(11);
}

.cover-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: dp(6);
  min-width: 0;
}

.cover-buttons {
  display: flex;
  align-items: center;
  gap: dp(8);
}

.cover-remove {
  color: #f53f3f;
  border-color: #ffd8d2;
}

.cover-actions .admin-form-hint {
  margin-top: 0;
}

.form-grid {
  display: flex;
  gap: dp(10);
}

.form-grid-item {
  flex: 1;
  min-width: 0;
}

.picker-chevron {
  width: dp(12);
  height: dp(12);
}

.form-error {
  display: block;
  margin: dp(2) 0 dp(10);
  color: #f53f3f;
  font-size: dp(11);
  line-height: 1.5;
}

.save-btn {
  margin-bottom: dp(10);
}

.retry-btn {
  margin-top: dp(10);
}

.template-list {
  padding-top: dp(8);
}

.template-row {
  display: flex;
  align-items: center;
  padding: dp(12) dp(2);
  border-bottom: 1px solid #f8f4ef;
}

.template-row:last-child {
  border-bottom: none;
}

.template-row--active {
  background: #fff8f4;
}

.template-main {
  flex: 1;
  min-width: 0;
}

.template-title-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.template-name {
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.template-meta {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}

.template-check {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(11);
  flex-shrink: 0;
}
</style>
