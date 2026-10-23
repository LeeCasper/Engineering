<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, type UploadRequestOptions } from 'element-plus';
import { Loading, Plus } from '@element-plus/icons-vue';
import { fetchConfigs, fetchUpdateConfig } from '@/service/api/config';
import { uploadBrandingLogo } from '@/service/api/branding';

defineOptions({ name: 'PlatformBrandingPage' });

const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);

const name = ref('');
const logoUrl = ref('');
const savedName = ref('');
const savedLogoUrl = ref('');

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const dirty = computed(
  () => name.value.trim() !== savedName.value || logoUrl.value !== savedLogoUrl.value
);

const previewName = computed(() => name.value.trim() || '未命名小程序');

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

@media (max-width: 900px) {
  .branding-grid {
    grid-template-columns: 1fr;
  }
}
</style>
