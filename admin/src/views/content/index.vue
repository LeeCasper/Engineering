<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  fetchContentPage,
  fetchContentPages,
  fetchSaveContentPage,
  type ContentPageSummary
} from '@/service/api/content';
import { useTenantReadOnly } from '@/hooks/common/tenant';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'ContentPage' });

const readOnly = useTenantReadOnly();
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
    const { data, error } = await fetchContentPages();

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
    const { data, error } = await fetchContentPage(row.pageKey);

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
    });

    if (error || !data) return;

    editor.publishedAt = data.publishedAt;
    ElMessage.success(publish ? '已保存并发布' : '已保存');
    await load();
  } finally {
    editor.submitting = false;
  }
}

function statusText(row: ContentPageSummary) {
  if (!row.exists) return '未创建';
  return row.publishedAt ? '已发布' : '未发布（草稿）';
}

function statusType(row: ContentPageSummary) {
  if (!row.exists) return 'info';
  return row.publishedAt ? 'success' : 'warning';
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <span class="font-600">内容页</span>
          <span class="text-12px text-#86909c">
            用户协议与隐私政策在登录前即可阅读；未发布时 C 端返回 404，而不是空白页
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

        <ElTableColumn label="状态" width="130">
          <template #default="{ row }">
            <ElTag :type="statusType(row)" size="small">{{ statusText(row) }}</ElTag>
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
        description="种子数据里的页面只是未发布的骨架。直接发布占位内容，比不发布更危险 —— 它会让「我们已经有隐私政策了」变成一句看起来成立的话。"
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
