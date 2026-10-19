<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  fetchFeedbackList,
  fetchHandleFeedback,
  type FeedbackItem,
  type FeedbackStatus
} from '@/service/api/feedback';
import { useTenantReadOnly } from '@/hooks/common/tenant';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'FeedbackPage' });

const STATUS_META: Record<string, { label: string; type: 'warning' | 'primary' | 'success' }> = {
  new: { label: '待处理', type: 'warning' },
  processing: { label: '处理中', type: 'primary' },
  resolved: { label: '已处理', type: 'success' }
};

const readOnly = useTenantReadOnly();
const loading = ref(false);
const list = ref<FeedbackItem[]>([]);
const total = ref(0);

const query = reactive({
  page: 1,
  pageSize: 20,
  status: 'new' as FeedbackStatus | ''
});

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchFeedbackList({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status || undefined
    });

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
  query.status = 'new';
  query.page = 1;
  load();
}

// ── 处理 ──

const handleDialog = reactive({
  visible: false,
  submitting: false,
  item: null as FeedbackItem | null
});

const handleForm = reactive({
  status: 'processing' as 'processing' | 'resolved',
  reply: ''
});

function openHandle(row: FeedbackItem) {
  handleDialog.item = row;
  handleForm.status = row.status === 'processing' ? 'resolved' : 'processing';
  handleForm.reply = row.reply || '';
  handleDialog.visible = true;
}

async function submitHandle() {
  if (!handleDialog.item) return;

  handleDialog.submitting = true;

  try {
    const { error } = await fetchHandleFeedback(handleDialog.item.id, {
      status: handleForm.status,
      reply: handleForm.reply.trim() || undefined
    });

    if (error) return;

    ElMessage.success('反馈已处理');
    handleDialog.visible = false;
    await load();
  } finally {
    handleDialog.submitting = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <span class="font-600">意见反馈</span>
          <div class="flex items-center gap-8px">
            <ElSelect v-model="query.status" class="w-140px" clearable placeholder="状态">
              <ElOption label="待处理" value="new" />
              <ElOption label="处理中" value="processing" />
              <ElOption label="已处理" value="resolved" />
            </ElSelect>
            <ElButton type="primary" @click="search">查询</ElButton>
            <ElButton @click="resetQuery">重置</ElButton>
          </div>
        </div>
      </template>

      <ElTable v-loading="loading" :data="list" row-key="id" stripe>
        <ElTableColumn label="提交时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </ElTableColumn>

        <ElTableColumn label="反馈内容" min-width="300">
          <template #default="{ row }">
            <div class="line-clamp-2 whitespace-pre-wrap text-13px">{{ row.content }}</div>
            <div class="pt-4px flex gap-4px" v-if="row.images?.length">
              <ElImage
                v-for="(image, index) in row.images"
                :key="index"
                :src="image"
                :preview-src-list="row.images"
                :initial-index="Number(index)"
                fit="cover"
                class="size-44px rd-4px"
                preview-teleported
              />
            </div>
          </template>
        </ElTableColumn>

        <ElTableColumn label="联系方式" width="140">
          <template #default="{ row }">{{ row.contact || '—' }}</template>
        </ElTableColumn>

        <ElTableColumn label="项目 / 用户" width="130">
          <template #default="{ row }">
            <div class="text-12px text-#4e5969">
              {{ row.projectId ? `项目 #${row.projectId}` : '未关联项目' }}
            </div>
            <div class="text-12px text-#86909c">用户 #{{ row.userId }}</div>
          </template>
        </ElTableColumn>

        <ElTableColumn label="状态" width="100">
          <template #default="{ row }">
            <ElTag :type="STATUS_META[row.status]?.type || 'info'" size="small">
              {{ STATUS_META[row.status]?.label || row.statusLabel }}
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="处理时间" width="150">
          <template #default="{ row }">{{ formatDateTime(row.handledAt) }}</template>
        </ElTableColumn>

        <ElTableColumn label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <ElButton
              v-if="row.status !== 'resolved' && !readOnly"
              link
              type="primary"
              @click="openHandle(row)"
            >
              处理
            </ElButton>
            <span v-else class="text-12px text-#c0c4cc">—</span>
          </template>
        </ElTableColumn>

        <template #empty>
          <ElEmpty description="没有反馈" />
        </template>
      </ElTable>

      <div class="mt-16px flex justify-end">
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
    </ElCard>

    <ElDialog v-model="handleDialog.visible" title="处理反馈" width="620px">
      <template v-if="handleDialog.item">
        <div class="mb-14px rounded-6px bg-#f7f8fa p-14px">
          <div class="whitespace-pre-wrap text-14px leading-22px">{{ handleDialog.item.content }}</div>
          <div class="pt-10px flex gap-8px" v-if="handleDialog.item.images?.length">
            <ElImage
              v-for="(image, index) in handleDialog.item.images"
              :key="index"
              :src="image"
              :preview-src-list="handleDialog.item.images"
              :initial-index="index"
              fit="cover"
              class="size-72px rd-4px"
              preview-teleported
            />
          </div>
          <div class="pt-10px text-12px text-#86909c">
            联系方式：{{ handleDialog.item.contact || '未填写' }} · 提交于
            {{ formatDateTime(handleDialog.item.createdAt) }}
          </div>
        </div>

        <ElForm label-width="80px">
          <ElFormItem label="状态">
            <ElSelect v-model="handleForm.status" class="w-full">
              <ElOption
                label="处理中"
                value="processing"
                :disabled="handleDialog.item.status !== 'new'"
              />
              <ElOption label="已处理" value="resolved" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="回执">
            <ElInput
              v-model="handleForm.reply"
              type="textarea"
              :rows="4"
              maxlength="1000"
              show-word-limit
              placeholder="可选。回执会记录处理结论；口头已沟通时可以不填"
            />
          </ElFormItem>
        </ElForm>

        <ElAlert
          type="info"
          :closable="false"
          show-icon
          title="状态只能向前"
          description="已处理不能退回处理中；如需补充说明，请在回执里修正，或让用户重新提交。"
        />
      </template>

      <template #footer>
        <ElButton @click="handleDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="handleDialog.submitting" @click="submitHandle">提交</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped></style>
