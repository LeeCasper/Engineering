<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchProjectList, fetchProjectStats, type ProjectListItem } from '@/service/api/project';
import { fetchTenants } from '@/service/api/platform';
import { useAuthStore } from '@/store/modules/auth';
import { formatDate, formatMoney, PROJECT_STATUS_META, ROLE_LABELS } from '@/utils/format';

defineOptions({ name: 'HomePage' });

const authStore = useAuthStore();
const router = useRouter();

const loading = ref(false);
const recent = ref<ProjectListItem[]>([]);
const counts = reactive({
  total: 0,
  pending: 0,
  building: 0,
  finished: 0,
  newThisMonth: 0
});

const platformCounts = reactive({
  total: 0,
  active: 0,
  suspended: 0,
  archived: 0
});

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '上午好';
  if (hour < 18) return '下午好';
  return '晚上好';
});

const roleLabel = computed(() => ROLE_LABELS[authStore.userInfo.role] || '后台账号');

/**
 * 平台账号没有租户业务数据（后端默认 1 = 0），因此不请求项目接口。
 * 工作台对平台只展示身份与后续入口说明。
 */
async function loadPlatform() {
  loading.value = true;

  try {
    const [all, active, suspended, archived] = await Promise.all([
      fetchTenants({ page: 1, pageSize: 1 }),
      fetchTenants({ page: 1, pageSize: 1, status: 'active' }),
      fetchTenants({ page: 1, pageSize: 1, status: 'suspended' }),
      fetchTenants({ page: 1, pageSize: 1, status: 'archived' })
    ]);

    platformCounts.total = all.data?.total ?? 0;
    platformCounts.active = active.data?.total ?? 0;
    platformCounts.suspended = suspended.data?.total ?? 0;
    platformCounts.archived = archived.data?.total ?? 0;
  } finally {
    loading.value = false;
  }
}

async function load() {
  if (authStore.isPlatform) {
    await loadPlatform();
    return;
  }

  loading.value = true;

  try {
    // 统计数字统一来自 stats 接口，口径与项目列表、状态筛选一致；
    // 最近项目仍用列表接口取前 6 条
    const [stats, latest] = await Promise.all([
      fetchProjectStats(),
      fetchProjectList({ page: 1, pageSize: 6, sortField: 'created_at', sortDirection: 'desc' })
    ]);

    const data = stats.data;
    counts.total = data?.total ?? 0;
    counts.pending = data?.statusCounts.pending ?? 0;
    counts.building = data?.statusCounts.building ?? 0;
    counts.finished = data?.statusCounts.finished ?? 0;
    counts.newThisMonth = data?.newThisMonth ?? 0;
    recent.value = latest.data?.list ?? [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openProject(row: ProjectListItem) {
  router.push(`/project/detail/${row.id}`);
}
</script>

<template>
  <div class="p-16px">
    <!-- 问候 -->
    <ElCard class="mb-16px" shadow="never">
      <div class="flex-y-center justify-between">
        <div>
          <div class="text-22px font-600 text-#1d2129">
            {{ greeting }}，{{ authStore.userInfo.userName }}
          </div>
          <div class="pt-6px text-13px text-#86909c">
            当前身份：{{ roleLabel }}
            <span v-if="authStore.userInfo.tenantId"> · 租户 #{{ authStore.userInfo.tenantId }}</span>
          </div>
        </div>

        <div v-if="!authStore.isPlatform" class="flex gap-10px">
          <ElButton @click="router.push('/project/list')">项目列表</ElButton>
          <ElButton type="primary" @click="router.push('/project/list?create=1')">新建项目</ElButton>
        </div>
      </div>

      <ElAlert
        v-if="authStore.isPlatform"
        class="mt-16px"
        type="info"
        :closable="false"
        show-icon
        title="平台运营账号默认看不到任何租户业务数据"
        description="平台的职责是开通租户、调配额与停用/续期；排障访问必须由租户管理员先授予时间窗。"
      />
    </ElCard>

    <template v-if="authStore.isPlatform">
      <div class="mb-16px grid grid-cols-4 gap-16px lt-lg:grid-cols-2 lt-sm:grid-cols-1">
        <ElCard shadow="never" :body-style="{ padding: '18px' }">
          <div class="text-13px text-#86909c">租户总数</div>
          <div class="pt-8px text-30px font-700 text-#1d2129">{{ platformCounts.total }}</div>
        </ElCard>
        <ElCard shadow="never" :body-style="{ padding: '18px' }">
          <div class="text-13px text-#86909c">正常</div>
          <div class="pt-8px text-30px font-700 text-#00b42a">{{ platformCounts.active }}</div>
        </ElCard>
        <ElCard shadow="never" :body-style="{ padding: '18px' }">
          <div class="text-13px text-#86909c">已停用</div>
          <div class="pt-8px text-30px font-700 text-#e6a23c">{{ platformCounts.suspended }}</div>
        </ElCard>
        <ElCard shadow="never" :body-style="{ padding: '18px' }">
          <div class="text-13px text-#86909c">已退租</div>
          <div class="pt-8px text-30px font-700 text-#86909c">{{ platformCounts.archived }}</div>
        </ElCard>
      </div>

      <ElCard shadow="never">
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <div>
            <div class="font-600">租户运营</div>
            <div class="pt-4px text-13px text-#86909c">
              开通租户后会自动生成租户专属管理地址；租户管理员从该地址登录，平台入口不接受租户账号。
            </div>
          </div>
          <div class="flex gap-8px">
            <ElButton @click="router.push('/platform/tenant')">租户管理</ElButton>
            <ElButton type="primary" @click="router.push('/platform/tenant?create=1')">开通租户</ElButton>
          </div>
        </div>
      </ElCard>
    </template>

    <template v-if="!authStore.isPlatform">
      <!-- 统计卡片 -->
      <div class="mb-16px grid grid-cols-5 gap-16px lt-lg:grid-cols-3 lt-sm:grid-cols-2">
        <ElCard shadow="never" :body-style="{ padding: '18px' }">
          <div class="text-13px text-#86909c">项目总数</div>
          <div class="pt-8px text-30px font-700 text-#1d2129">{{ counts.total }}</div>
        </ElCard>
        <ElCard shadow="never" :body-style="{ padding: '18px' }">
          <div class="text-13px text-#86909c">施工中</div>
          <div class="pt-8px text-30px font-700 text-primary">{{ counts.building }}</div>
        </ElCard>
        <ElCard shadow="never" :body-style="{ padding: '18px' }">
          <div class="text-13px text-#86909c">待开工</div>
          <div class="pt-8px text-30px font-700 text-#86909c">{{ counts.pending }}</div>
        </ElCard>
        <ElCard shadow="never" :body-style="{ padding: '18px' }">
          <div class="text-13px text-#86909c">已完工</div>
          <div class="pt-8px text-30px font-700 text-#00b42a">{{ counts.finished }}</div>
        </ElCard>
        <ElCard shadow="never" :body-style="{ padding: '18px' }">
          <div class="text-13px text-#86909c">本月新增</div>
          <div class="pt-8px text-30px font-700 text-#722ed1">{{ counts.newThisMonth }}</div>
        </ElCard>
      </div>

      <!-- 最近项目 -->
      <ElCard shadow="never">
        <template #header>
          <div class="flex-y-center justify-between">
            <span class="font-600">最近项目</span>
            <ElButton text type="primary" @click="router.push('/project/list')">查看全部</ElButton>
          </div>
        </template>

        <ElTable v-loading="loading" :data="recent" row-key="id" @row-click="openProject">
          <ElTableColumn prop="name" label="项目名称" min-width="180" show-overflow-tooltip />
          <ElTableColumn prop="address" label="地址" min-width="220" show-overflow-tooltip />
          <ElTableColumn prop="status" label="状态" width="100">
            <template #default="{ row }">
              <ElTag :type="PROJECT_STATUS_META[row.status]?.type || 'info'" size="small">
                {{ PROJECT_STATUS_META[row.status]?.label || row.statusLabel }}
              </ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn prop="progress" label="总进度" width="160">
            <template #default="{ row }">
              <ElProgress :percentage="Number(row.progress) || 0" :stroke-width="8" />
            </template>
          </ElTableColumn>
          <ElTableColumn prop="contractAmount" label="合同金额" width="140" align="right">
            <template #default="{ row }">¥ {{ formatMoney(row.contractAmount) }}</template>
          </ElTableColumn>
          <ElTableColumn prop="startDate" label="开工日期" width="120">
            <template #default="{ row }">{{ formatDate(row.startDate) }}</template>
          </ElTableColumn>
        </ElTable>
      </ElCard>
    </template>
  </div>
</template>

<style scoped></style>
