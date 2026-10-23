<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  fetchContentPage,
  fetchContentPages,
  fetchSaveContentPage,
  type ContentPageSummary,
  type ContentScope
} from '@/service/api/content';
import { useTenantReadOnly } from '@/hooks/common/tenant';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'ContentPage' });

const props = withDefaults(
  defineProps<{
    /** tenant=租户覆盖版本；platform=平台基础版本 */
    scope?: ContentScope;
  }>(),
  { scope: 'tenant' }
);

const isPlatformScope = computed(() => props.scope === 'platform');
const tenantReadOnly = useTenantReadOnly();
const readOnly = computed(() => !isPlatformScope.value && tenantReadOnly.value);
const loading = ref(false);
const list = ref<ContentPageSummary[]>([]);

const editor = reactive({
  visible: false,
  loading: false,
  submitting: false,
  pageKey: '',
  label: '',
  required: false,
  publishedAt: null as string | null
});

const form = reactive({
  title: '',
  version: '',
  content: ''
});

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchContentPages(props.scope);

    if (!error && data) list.value = data.list;
  } finally {
    loading.value = false;
  }
}

async function openEditor(row: ContentPageSummary) {
  editor.pageKey = row.pageKey;
  editor.label = row.label;
  editor.required = row.required;
  editor.publishedAt = row.publishedAt;
  editor.visible = true;
  editor.loading = true;

  try {
    const { data, error } = await fetchContentPage(row.pageKey, props.scope);

    if (error || !data) return;

    form.title = data.title;
    form.version = data.version || '';
    form.content = data.content || '';
    editor.publishedAt = data.publishedAt;
  } finally {
    editor.loading = false;
  }
}

async function save(publish: boolean) {
  if (!form.title.trim()) {
    ElMessage.warning('请填写页面标题');
    return;
  }

  editor.submitting = true;

  try {
    const { data, error } = await fetchSaveContentPage(editor.pageKey, {
      title: form.title.trim(),
      content: form.content,
      version: form.version.trim() || undefined,
      publish
    }, props.scope);

    if (error || !data) return;

    editor.publishedAt = data.publishedAt;
    ElMessage.success(publish ? '已保存并发布' : '已保存');
    await load();
  } finally {
    editor.submitting = false;
  }
}

function statusText(row: ContentPageSummary) {
  if (isPlatformScope.value) {
    if (!row.exists) return '未创建';
    return row.publishedAt ? '已发布' : '未发布（草稿）';
  }

  if (!row.exists) return row.inheritsPlatform ? '继承平台版本' : '未创建';
  if (!row.publishedAt) {
    return row.inheritsPlatform ? '草稿 · 继承平台' : '未发布（草稿）';
  }
  return '已发布';
}

function statusType(row: ContentPageSummary) {
  if (isPlatformScope.value) {
    if (!row.exists) return 'info';
    return row.publishedAt ? 'success' : 'warning';
  }

  if (!row.exists) return row.inheritsPlatform ? 'success' : 'info';
  if (!row.publishedAt) return row.inheritsPlatform ? 'warning' : 'warning';
  return 'success';
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <span class="font-600">{{ isPlatformScope ? '平台基础内容页' : '内容页' }}</span>
          <span class="text-12px text-#86909c">
            {{
              isPlatformScope
                ? '登录前与租户未发布时的兜底版本；所有租户共享'
                : '本租户已发布时优先使用；未发布时 C 端继承平台基础版本'
            }}
          </span>
        </div>
      </template>

      <ElTable v-loading="loading" :data="list" row-key="pageKey" stripe>
        <ElTableColumn label="页面" min-width="200">
          <template #default="{ row }">
            <div class="font-500">{{ row.label }}</div>
            <div class="font-mono text-11px text-#86909c">{{ row.pageKey }}</div>
            <ElTag v-if="row.required" class="mt-4px" size="small" type="danger">必需</ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn prop="title" label="标题" min-width="180" show-overflow-tooltip />

        <ElTableColumn label="状态" width="150">
          <template #default="{ row }">
            <ElTag :type="statusType(row)" size="small">{{ statusText(row) }}</ElTag>
            <div
              v-if="!isPlatformScope && row.inheritsPlatform && row.platformPublishedAt"
              class="mt-4px text-11px text-#86909c"
            >
              平台发布于 {{ formatDateTime(row.platformPublishedAt) }}
            </div>
          </template>
        </ElTableColumn>

        <ElTableColumn label="版本" width="100">
          <template #default="{ row }">{{ row.version || '—' }}</template>
        </ElTableColumn>

        <ElTableColumn label="字数" width="90" align="right">
          <template #default="{ row }">{{ row.contentLength }}</template>
        </ElTableColumn>

        <ElTableColumn label="最后更新" width="160">
          <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
        </ElTableColumn>

        <ElTableColumn label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <ElButton v-if="!readOnly" link type="primary" @click="openEditor(row)">编辑</ElButton>
            <span v-else class="text-12px text-#c0c4cc">只读</span>
          </template>
        </ElTableColumn>

        <template #empty>
          <ElEmpty description="没有内容页" />
        </template>
      </ElTable>

      <ElAlert
        class="mt-16px"
        type="warning"
        :closable="false"
        show-icon
        title="发布前请确认内容是正式文本"
        :description="
          isPlatformScope
            ? '平台基础内容会作为所有租户未发布时的兜底。用户协议与隐私政策必须由法务确认后再发布；直接发布占位内容比不发布更危险。'
            : '种子数据里的页面只是未发布的骨架。直接发布占位内容，比不发布更危险 —— 它会让「我们已经有隐私政策了」变成一句看起来成立的话。'
        "
      />
    </ElCard>

    <ElDrawer v-model="editor.visible" :title="`编辑内容页 · ${editor.label}`" size="720px">
      <div v-loading="editor.loading">
        <ElAlert
          v-if="editor.publishedAt"
          class="mb-14px"
          type="info"
          :closable="false"
          show-icon
          title="该页面已发布"
          :description="`最近发布时间：${formatDateTime(editor.publishedAt)}。已发布页面再次编辑不会自动退回草稿。`"
        />

        <ElForm label-width="80px">
          <ElFormItem label="标题" required>
            <ElInput v-model="form.title" maxlength="100" placeholder="页面标题" />
          </ElFormItem>

          <ElFormItem label="版本">
            <ElInput v-model="form.version" maxlength="32" placeholder="例如：v1.0 / 2026-10" />
          </ElFormItem>

          <ElFormItem label="正文">
            <ElInput
              v-model="form.content"
              type="textarea"
              :rows="20"
              maxlength="100000"
              show-word-limit
              placeholder="填写正式文本。C 端按纯文本展示，请勿粘贴带脚本的富文本。"
            />
          </ElFormItem>
        </ElForm>

        <div class="flex gap-8px">
          <ElButton :loading="editor.submitting" @click="save(false)">保存</ElButton>
          <ElButton type="primary" :loading="editor.submitting" @click="save(true)">保存并发布</ElButton>
          <ElButton @click="editor.visible = false">关闭</ElButton>
        </div>
      </div>
    </ElDrawer>
  </div>
</template>

<style scoped></style>
