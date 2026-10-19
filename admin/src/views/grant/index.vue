<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  fetchCreateGrant,
  fetchGrants,
  fetchRevokeGrant,
  type PlatformGrant
} from '@/service/api/grant';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'GrantPage' });

const STATUS_META: Record<string, { label: string; type: 'success' | 'info' | 'danger' | 'warning' }> = {
  active: { label: '生效中', type: 'success' },
  expired: { label: '已过期', type: 'info' },
  revoked: { label: '已撤销', type: 'danger' }
};

const loading = ref(false);
const list = ref<PlatformGrant[]>([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 20 });

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchGrants({
      page: query.page,
      pageSize: query.pageSize
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

// ── 授予 ──

const createDialog = reactive({ visible: false, submitting: false });

const createForm = reactive({
  adminUsername: '',
  reason: '',
  expiresAt: dayjs().add(1, 'day').format('YYYY-MM-DD HH:mm:ss')
});

function disableDate(date: Date) {
  return dayjs(date).isBefore(dayjs(), 'day');
}

function openCreate() {
  createForm.adminUsername = '';
  createForm.reason = '';
  createForm.expiresAt = dayjs().add(1, 'day').format('YYYY-MM-DD HH:mm:ss');
  createDialog.visible = true;
}

async function submitCreate() {
  const username = createForm.adminUsername.trim();

  if (!username) {
    ElMessage.warning('请输入平台运营账号的用户名');
    return;
  }

  if (!createForm.expiresAt) {
    ElMessage.warning('请选择截止时间');
    return;
  }

  const expires = dayjs(createForm.expiresAt);

  if (!expires.isValid() || !expires.isAfter(dayjs())) {
    ElMessage.warning('截止时间必须晚于当前时间');
    return;
  }

  if (expires.diff(dayjs(), 'hour', true) > 24 * 7) {
    ElMessage.warning('授权窗口最长 7 天');
    return;
  }

  createDialog.submitting = true;

  try {
    const { error } = await fetchCreateGrant({
      adminUsername: username,
      reason: createForm.reason.trim() || undefined,
      expiresAt: createForm.expiresAt
    });

    if (error) return;

    ElMessage.success('排障窗口已授予');
    createDialog.visible = false;
    await load();
  } finally {
    createDialog.submitting = false;
  }
}

async function revoke(row: PlatformGrant) {
  try {
    await ElMessageBox.confirm(
      `立即撤销「${row.adminUsername || `平台账号 #${row.adminUserId}`}」的访问窗口？撤销后平台下一次请求即被拒绝。`,
      '撤销授权',
      { type: 'warning', confirmButtonText: '确认撤销', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchRevokeGrant(row.id);

  if (!error) {
    ElMessage.success('授权已撤销');
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <span class="font-600">排障授权</span>
          <ElButton type="primary" plain @click="openCreate">授予访问窗口</ElButton>
        </div>
      </template>

      <ElAlert
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        title="平台默认看不到本租户的任何业务数据"
        description="排障时由租户管理员授予一个临时只读窗口。窗口内平台的每一次请求都会写入本租户的操作日志；平台不能给自己开窗。"
      />

      <ElTable v-loading="loading" :data="list" row-key="id" stripe>
        <ElTableColumn label="平台账号" min-width="150">
          <template #default="{ row }">
            {{ row.adminUsername || `#${row.adminUserId}` }}
          </template>
        </ElTableColumn>

        <ElTableColumn label="状态" width="100">
          <template #default="{ row }">
            <ElTag :type="STATUS_META[row.status]?.type || 'info'" size="small">
              {{ STATUS_META[row.status]?.label || row.statusLabel }}
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="事由" min-width="200">
          <template #default="{ row }">{{ row.reason || '—' }}</template>
        </ElTableColumn>

        <ElTableColumn label="截止时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.expiresAt) }}</template>
        </ElTableColumn>

        <ElTableColumn label="授予时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </ElTableColumn>

        <ElTableColumn label="撤销时间" width="170">
          <template #default="{ row }">{{ row.revokedAt ? formatDateTime(row.revokedAt) : '—' }}</template>
        </ElTableColumn>

        <ElTableColumn label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <ElButton v-if="row.isActive" link type="danger" @click="revoke(row)">撤销</ElButton>
            <span v-else class="text-12px text-#c0c4cc">—</span>
          </template>
        </ElTableColumn>

        <template #empty>
          <ElEmpty description="还没有授权记录" />
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
          @size-change="load"
        />
      </div>
    </ElCard>

    <ElDialog v-model="createDialog.visible" title="授予平台排障窗口" width="520px">
      <ElAlert
        class="mb-14px"
        type="warning"
        :closable="false"
        show-icon
        title="只读、限时、逐次留痕"
        description="窗口内平台只能读，不能修改任何数据；同一平台账号对同一租户只允许一个有效窗口。"
      />

      <ElForm label-width="100px">
        <ElFormItem label="平台账号" required>
          <ElInput
            v-model="createForm.adminUsername"
            maxlength="50"
            placeholder="平台运营提供的用户名，例如 platform"
          />
        </ElFormItem>
        <ElFormItem label="截止时间" required>
          <ElDatePicker
            v-model="createForm.expiresAt"
            class="w-full"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            :disabled-date="disableDate"
          />
          <div class="w-full pt-4px text-12px text-#86909c">必须晚于当前时间，最长 7 天。</div>
        </ElFormItem>
        <ElFormItem label="事由">
          <ElInput
            v-model="createForm.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="例如：排查项目进度不更新问题"
          />
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="createDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="createDialog.submitting" @click="submitCreate">授予</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped></style>
