<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, type UploadRequestOptions } from 'element-plus';
import { Loading, Plus } from '@element-plus/icons-vue';
import { fetchConfigs, fetchUpdateConfig } from '@/service/api/config';
import { uploadAdminFavicon, uploadAdminLogo, uploadBrandingLogo } from '@/service/api/branding';
import { useBrandingStore } from '@/store/modules/branding';
import { applyDocumentTitle } from '@/utils/document-title';

defineOptions({ name: 'PlatformBrandingPage' });

const route = useRoute();
const brandingStore = useBrandingStore();

const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);

// ── 后台管理端品牌 ──
const adminSaving = ref(false);
const adminUploadingLogo = ref(false);
const adminUploadingFavicon = ref(false);
const adminName = ref('');
const adminLogoUrl = ref('');
const adminFaviconUrl = ref('');
const savedAdminName = ref('');
const savedAdminLogoUrl = ref('');
const savedAdminFaviconUrl = ref('');

const name = ref('');
const logoUrl = ref('');
const savedName = ref('');
const savedLogoUrl = ref('');

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const dirty = computed(
  () => name.value.trim() !== savedName.value || logoUrl.value !== savedLogoUrl.value
);

const previewName = computed(() => name.value.trim() || '未命名小程序');

const adminDirty = computed(
  () =>
    adminName.value.trim() !== savedAdminName.value ||
    adminLogoUrl.value !== savedAdminLogoUrl.value ||
    adminFaviconUrl.value !== savedAdminFaviconUrl.value
);

async function load() {
  loading.value = true;
  try {
    const { data, error } = await fetchConfigs('platform');
    if (error || !data) return;

    const items = new Map(data.list.map(item => [item.key, item]));
    const nameItem = items.get('miniapp_name');
    const logoItem = items.get('miniapp_logo');

    name.value = nameItem?.value || '柏总管';
    logoUrl.value = logoItem?.value || '';
    savedName.value = name.value;
    savedLogoUrl.value = logoUrl.value;

    adminName.value = items.get('admin_name')?.value || '工程宝管理后台';
    adminLogoUrl.value = items.get('admin_logo')?.value || '';
    adminFaviconUrl.value = items.get('admin_favicon')?.value || '';
    savedAdminName.value = adminName.value;
    savedAdminLogoUrl.value = adminLogoUrl.value;
    savedAdminFaviconUrl.value = adminFaviconUrl.value;
  } finally {
    loading.value = false;
  }
}

async function handleUpload(options: UploadRequestOptions) {
  const file = options.file as File;

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    ElMessage.error('Logo 只支持 PNG / JPG / WebP 图片');
    return;
  }
  if (file.size > MAX_LOGO_BYTES) {
    ElMessage.error('Logo 不得超过 2MB');
    return;
  }

  uploading.value = true;
  try {
    const { data, error } = await uploadBrandingLogo(file);
    if (error || !data) return;

    logoUrl.value = data.url;
    options.onSuccess?.(data);
    ElMessage.success('Logo 已上传，点击「保存」后生效');
  } finally {
    uploading.value = false;
  }
}

const FAVICON_TYPES = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/ico'];
const MAX_FAVICON_BYTES = 1024 * 1024;

async function handleAdminLogoUpload(options: UploadRequestOptions) {
  const file = options.file as File;

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    ElMessage.error('后台 Logo 只支持 PNG / JPG / WebP 图片');
    return;
  }
  if (file.size > MAX_LOGO_BYTES) {
    ElMessage.error('后台 Logo 不得超过 2MB');
    return;
  }

  adminUploadingLogo.value = true;
  try {
    const { data, error } = await uploadAdminLogo(file);
    if (error || !data) return;

    adminLogoUrl.value = data.url;
    options.onSuccess?.(data);
    ElMessage.success('后台 Logo 已上传，点击「保存」后生效');
  } finally {
    adminUploadingLogo.value = false;
  }
}

async function handleAdminFaviconUpload(options: UploadRequestOptions) {
  const original = options.file as File;

  // 部分系统对 .ico 返回空 MIME；按扩展名补成 image/x-icon 再上传
  const file =
    !original.type && /\.ico$/i.test(original.name)
      ? new File([original], original.name, { type: 'image/x-icon' })
      : original;

  if (!FAVICON_TYPES.includes(file.type)) {
    ElMessage.error('浏览器图标只支持 ICO / PNG 图片');
    return;
  }
  if (file.size > MAX_FAVICON_BYTES) {
    ElMessage.error('浏览器图标不得超过 1MB');
    return;
  }

  adminUploadingFavicon.value = true;
  try {
    const { data, error } = await uploadAdminFavicon(file);
    if (error || !data) return;

    adminFaviconUrl.value = data.url;
    options.onSuccess?.(data);
    ElMessage.success('浏览器图标已上传，点击「保存」后生效');
  } finally {
    adminUploadingFavicon.value = false;
  }
}

async function saveAdmin() {
  const trimmedName = adminName.value.trim();

  if (!trimmedName) {
    ElMessage.warning('请填写管理后台名称');
    return;
  }
  if (trimmedName.length > 30) {
    ElMessage.warning('管理后台名称不能超过 30 个字符');
    return;
  }
  if (!adminDirty.value) return;

  adminSaving.value = true;
  const failed: string[] = [];

  try {
    if (trimmedName !== savedAdminName.value) {
      const { error } = await fetchUpdateConfig('admin_name', trimmedName, 'platform');
      if (error) failed.push('后台名称');
    }

    if (adminLogoUrl.value !== savedAdminLogoUrl.value) {
      const { error } = await fetchUpdateConfig('admin_logo', adminLogoUrl.value, 'platform');
      if (error) failed.push('后台 Logo');
    }

    if (adminFaviconUrl.value !== savedAdminFaviconUrl.value) {
      const { error } = await fetchUpdateConfig('admin_favicon', adminFaviconUrl.value, 'platform');
      if (error) failed.push('浏览器图标');
    }
  } finally {
    adminSaving.value = false;
  }

  if (failed.length) {
    ElMessage.warning(`保存失败：${failed.join('、')}`);
    return;
  }

  savedAdminName.value = trimmedName;
  savedAdminLogoUrl.value = adminLogoUrl.value;
  savedAdminFaviconUrl.value = adminFaviconUrl.value;

  // 立即刷新侧边栏、页签与当前页面标题
  await brandingStore.load(true);
  applyDocumentTitle(route.meta);

  ElMessage.success('后台品牌已保存并生效');
}

function discardAdmin() {
  adminName.value = savedAdminName.value;
  adminLogoUrl.value = savedAdminLogoUrl.value;
  adminFaviconUrl.value = savedAdminFaviconUrl.value;
}

function clearAdminLogo() {
  adminLogoUrl.value = '';
}

function clearAdminFavicon() {
  adminFaviconUrl.value = '';
}

async function save() {
  const trimmedName = name.value.trim();

  if (!trimmedName) {
    ElMessage.warning('请填写小程序名称');
    return;
  }
  if (trimmedName.length > 30) {
    ElMessage.warning('小程序名称不能超过 30 个字符');
    return;
  }
  if (!dirty.value) return;

  saving.value = true;
  const failed: string[] = [];

  try {
    if (trimmedName !== savedName.value) {
      const { error } = await fetchUpdateConfig('miniapp_name', trimmedName, 'platform');
      if (error) failed.push('小程序名称');
    }

    if (logoUrl.value !== savedLogoUrl.value) {
      const { error } = await fetchUpdateConfig('miniapp_logo', logoUrl.value, 'platform');
      if (error) failed.push('小程序 Logo');
    }
  } finally {
    saving.value = false;
  }

  if (failed.length) {
    ElMessage.warning(`保存失败：${failed.join('、')}`);
    return;
  }

  savedName.value = trimmedName;
  savedLogoUrl.value = logoUrl.value;
  ElMessage.success('小程序品牌已保存，重新进入小程序后生效');
}

function discard() {
  name.value = savedName.value;
  logoUrl.value = savedLogoUrl.value;
}

function clearLogo() {
  logoUrl.value = '';
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard v-loading="loading" class="mx-auto max-w-1200px" shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <div>
            <div class="text-16px font-600 text-#1d2129">小程序品牌</div>
            <div class="pt-2px text-12px text-#86909c">
              设置小程序登录页、首页展示的名称与 Logo；平台统一维护，租户不可修改
            </div>
          </div>
          <div class="flex items-center gap-8px">
            <ElTag v-if="dirty" type="warning">有未保存的修改</ElTag>
            <ElButton v-if="dirty" :disabled="saving" @click="discard">放弃修改</ElButton>
            <ElButton type="primary" :disabled="!dirty" :loading="saving" @click="save">
              保存
            </ElButton>
          </div>
        </div>
      </template>

      <div class="branding-grid">
        <div class="branding-form">
          <div class="field">
            <div class="field-label">小程序名称</div>
            <ElInput
              v-model="name"
              maxlength="30"
              show-word-limit
              placeholder="例如：柏总管"
            />
            <div class="field-hint">显示在小程序登录页与首页的品牌名称，最多 30 个字符。</div>
          </div>

          <div class="field">
            <div class="field-label">小程序 Logo</div>
            <div class="logo-row">
              <ElUpload
                name="logo"
                :show-file-list="false"
                :http-request="handleUpload"
                accept="image/png,image/jpeg,image/webp"
                :disabled="uploading"
              >
                <div class="logo-upload-box" :class="{ 'is-uploading': uploading }">
                  <ElIcon v-if="uploading" class="is-loading"><Loading /></ElIcon>
                  <template v-else>
                    <ElIcon><Plus /></ElIcon>
                    <span>{{ logoUrl ? '更换 Logo' : '上传 Logo' }}</span>
                  </template>
                </div>
              </ElUpload>
              <div class="logo-meta">
                <div class="text-13px text-#4e5969">建议使用正方形 PNG / JPG，小于 2MB。</div>
                <div class="mt-4px text-12px text-#86909c">
                  留空时使用小程序内置 Logo。上传后需点击「保存」才会生效。
                </div>
                <ElButton v-if="logoUrl" class="mt-8px" link type="danger" @click="clearLogo">
                  清除 Logo
                </ElButton>
              </div>
            </div>
          </div>
        </div>

        <div class="branding-preview">
          <div class="preview-title">效果预览</div>
          <div class="preview-card">
            <div class="preview-logo">
              <ElImage v-if="logoUrl" :src="logoUrl" fit="contain" class="h-full w-full" />
              <div v-else class="preview-logo-placeholder">内置 Logo</div>
            </div>
            <div class="preview-name">{{ previewName }}</div>
            <div class="preview-slogan">让装修工程更透明、更可控</div>
          </div>
          <div class="preview-note">实际展示以小程序内的布局为准</div>
        </div>
      </div>
    </ElCard>

    <ElCard class="mx-auto mt-16px max-w-1200px" shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <div>
            <div class="text-16px font-600 text-#1d2129">后台管理端品牌</div>
            <div class="pt-2px text-12px text-#86909c">
              设置管理后台登录页、侧边栏与浏览器页签的名称、Logo 和图标；平台统一维护，租户不可修改
            </div>
          </div>
          <div class="flex items-center gap-8px">
            <ElTag v-if="adminDirty" type="warning">有未保存的修改</ElTag>
            <ElButton v-if="adminDirty" :disabled="adminSaving" @click="discardAdmin">
              放弃修改
            </ElButton>
            <ElButton type="primary" :disabled="!adminDirty" :loading="adminSaving" @click="saveAdmin">
              保存
            </ElButton>
          </div>
        </div>
      </template>

      <div class="branding-grid">
        <div class="branding-form">
          <div class="field">
            <div class="field-label">后台名称</div>
            <ElInput
              v-model="adminName"
              maxlength="30"
              show-word-limit
              placeholder="例如：工程宝管理后台"
            />
            <div class="field-hint">
              显示在后台登录页、侧边栏与浏览器页签标题，最多 30 个字符。
            </div>
          </div>

          <div class="field">
            <div class="field-label">后台 Logo</div>
            <div class="logo-row">
              <ElUpload
                name="logo"
                :show-file-list="false"
                :http-request="handleAdminLogoUpload"
                accept="image/png,image/jpeg,image/webp"
                :disabled="adminUploadingLogo"
              >
                <div class="logo-upload-box" :class="{ 'is-uploading': adminUploadingLogo }">
                  <ElIcon v-if="adminUploadingLogo" class="is-loading"><Loading /></ElIcon>
                  <template v-else>
                    <ElIcon><Plus /></ElIcon>
                    <span>{{ adminLogoUrl ? '更换 Logo' : '上传 Logo' }}</span>
                  </template>
                </div>
              </ElUpload>
              <div class="logo-meta">
                <div class="text-13px text-#4e5969">建议使用正方形 PNG / JPG，小于 2MB。</div>
                <div class="mt-4px text-12px text-#86909c">
                  留空时使用内置蓝色 Logo。上传后需点击「保存」才会生效。
                </div>
                <ElButton
                  v-if="adminLogoUrl"
                  class="mt-8px"
                  link
                  type="danger"
                  @click="clearAdminLogo"
                >
                  清除 Logo
                </ElButton>
              </div>
            </div>
          </div>

          <div class="field">
            <div class="field-label">浏览器图标（Favicon）</div>
            <div class="logo-row">
              <ElUpload
                name="favicon"
                :show-file-list="false"
                :http-request="handleAdminFaviconUpload"
                accept=".ico,.png,image/x-icon,image/png"
                :disabled="adminUploadingFavicon"
              >
                <div
                  class="logo-upload-box favicon-upload-box"
                  :class="{ 'is-uploading': adminUploadingFavicon }"
                >
                  <ElIcon v-if="adminUploadingFavicon" class="is-loading"><Loading /></ElIcon>
                  <template v-else>
                    <ElIcon><Plus /></ElIcon>
                    <span>{{ adminFaviconUrl ? '更换图标' : '上传图标' }}</span>
                  </template>
                </div>
              </ElUpload>
              <div class="logo-meta">
                <div class="text-13px text-#4e5969">
                  支持 ICO / PNG，建议 32×32 或 48×48，小于 1MB。
                </div>
                <div class="mt-4px text-12px text-#86909c">
                  留空时使用内置 favicon.svg；修改后可能需要刷新页面才能看到新图标。
                </div>
                <ElButton
                  v-if="adminFaviconUrl"
                  class="mt-8px"
                  link
                  type="danger"
                  @click="clearAdminFavicon"
                >
                  清除图标
                </ElButton>
              </div>
            </div>
          </div>
        </div>

        <div class="branding-preview">
          <div class="preview-title">效果预览</div>
          <div class="preview-card">
            <div class="preview-browser">
              <span class="preview-favicon-dot">
                <ElImage
                  v-if="adminFaviconUrl"
                  :src="adminFaviconUrl"
                  fit="contain"
                  class="h-full w-full"
                />
                <span v-else>fav</span>
              </span>
              <span class="preview-tab-title">{{ adminName || '工程宝管理后台' }}</span>
            </div>
            <div class="preview-sidebar">
              <div class="preview-logo admin-preview-logo">
                <ElImage
                  v-if="adminLogoUrl"
                  :src="adminLogoUrl"
                  fit="contain"
                  class="h-full w-full"
                />
                <div v-else class="preview-logo-placeholder">内置 Logo</div>
              </div>
              <div class="preview-name admin-preview-name">{{ adminName || '工程宝管理后台' }}</div>
            </div>
          </div>
          <div class="preview-note">实际展示以管理后台布局为准</div>
        </div>
      </div>
    </ElCard>
  </div>
</template>

<style scoped>
.branding-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 24px;
}

.branding-form {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.field-label {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #1d2129;
}

.field-hint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 18px;
  color: #86909c;
}

.logo-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.logo-upload-box {
  display: flex;
  width: 118px;
  height: 118px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed #c9cdd4;
  border-radius: 10px;
  color: #86909c;
  font-size: 12px;
  transition: border-color 0.16s ease, color 0.16s ease;
}

.logo-upload-box:hover {
  border-color: #eb5c20;
  color: #eb5c20;
}

.logo-upload-box.is-uploading {
  cursor: wait;
}

.logo-meta {
  flex: 1;
  padding-top: 4px;
}

.branding-preview {
  padding: 16px;
  border: 1px solid #e5e6eb;
  border-radius: 12px;
  background: #faf7f4;
}

.preview-title {
  margin-bottom: 12px;
  font-size: 12px;
  color: #86909c;
}

.preview-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 16px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 4px 16px rgb(29 33 41 / 6%);
}

.preview-logo {
  display: flex;
  width: 72px;
  height: 72px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 16px;
  background: #fdebe4;
}

.preview-logo-placeholder {
  color: #eb5c20;
  font-size: 12px;
}

.preview-name {
  margin-top: 14px;
  font-size: 18px;
  font-weight: 700;
  color: #1d2129;
}

.preview-slogan {
  margin-top: 4px;
  font-size: 12px;
  color: #86909c;
}

.preview-note {
  margin-top: 10px;
  font-size: 11px;
  color: #a7a09a;
  text-align: center;
}

.favicon-upload-box {
  width: 96px;
  height: 96px;
}

.preview-browser {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  background: #f9fafb;
}

.preview-favicon-dot {
  display: flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 3px;
  background: #e5e6eb;
  color: #86909c;
  font-size: 9px;
}

.preview-tab-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #4e5969;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-sidebar {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed #e5e6eb;
}

.admin-preview-logo {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 10px;
}

.admin-preview-name {
  margin-top: 0;
  overflow: hidden;
  font-size: 14px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .branding-grid {
    grid-template-columns: 1fr;
  }
}
</style>
