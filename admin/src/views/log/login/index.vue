<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { fetchLoginLogs, type LoginLog, type LogScope } from '@/service/api/log';
import { useAuthStore } from '@/store/modules/auth';
import { formatDateTime } from '@/utils/format';

defineOptions({ name: 'LoginLogPage' });

const props = withDefaults(
  defineProps<{
    /** tenant=租户账号登录；platform=平台账号登录 */
    scope?: LogScope;
  }>(),
  { scope: 'tenant' }
);

const authStore = useAuthStore();
const isPlatformScope = computed(() => props.scope === 'platform');
const isOwner = computed(() => authStore.isTenantOwner);

const loading = ref(false);
const list = ref<LoginLog[]>([]);
const total = ref(0);

const query = reactive({
  page: 1,
  pageSize: 20,
  username: '',
  result: '' as '' | 'success' | 'failed'
});

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchLoginLogs({
      page: query.page,
      pageSize: query.pageSize,
      username: query.username.trim() || undefined,
      result: query.result || undefined
    }, props.scope);

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
  query.username = '';
  query.result = '';
  query.page = 1;
  load();
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <span class="font-600">{{ isPlatformScope ? '平台登录日志' : '登录日志' }}</span>
          <div class="flex flex-wrap items-center gap-8px">
            <ElInput
              v-model="query.username"
              class="w-180px"
              clearable
              placeholder="用户名"
              @keyup.enter="search"
            />
            <ElSelect v-model="query.result" class="w-120px" clearable placeholder="结果">
              <ElOption label="成功" value="success" />
              <ElOption label="失败" value="failed" />
            </ElSelect>
            <ElButton type="primary" @click="search">查询</ElButton>
            <ElButton @click="resetQuery">重置</ElButton>
          </div>
        </div>
      </template>

      <ElAlert
        v-if="isPlatformScope"
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        title="平台账号登录记录"
        description="包含平台运营账号的登录，以及无法判定租户的失败尝试（例如用户名猜错）。租户账号登录日志留在租户后台。"
      />

      <ElAlert
        v-else-if="!isOwner"
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        title="项目管理员只能看到自己的登录记录"
        description="租户管理员可以查看本租户全部账号的登录记录。"
      />

      <ElTable v-loading="loading" :data="list" row-key="id" stripe>
        <ElTableColumn label="登录时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.loginAt) }}</template>
        </ElTableColumn>

        <ElTableColumn prop="username" label="用户名" min-width="150" />

        <ElTableColumn label="账号 ID" width="100">
          <template #default="{ row }">
            {{ row.adminUserId ? `#${row.adminUserId}` : '—' }}
          </template>
        </ElTableColumn>

        <ElTableColumn label="结果" width="100">
          <template #default="{ row }">
            <ElTag :type="row.result === 'success' ? 'success' : 'danger'" size="small">
              {{ row.result === 'success' ? '成功' : '失败' }}
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="登录方式" width="100">
          <template #default="{ row }">
            {{ row.authMethod === 'wechat' ? '微信免密' : '密码' }}
          </template>
        </ElTableColumn>

        <ElTableColumn label="失败原因" min-width="220">
          <template #default="{ row }">{{ row.failReason || '—' }}</template>
        </ElTableColumn>

        <ElTableColumn prop="ip" label="IP" width="160">
          <template #default="{ row }">{{ row.ip || '—' }}</template>
        </ElTableColumn>

        <template #empty>
          <ElEmpty description="没有登录记录" />
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
  </div>
</template>

<style scoped></style>
