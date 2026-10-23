<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  fetchCreateTenant,
  fetchTenantDetail,
  fetchTenants,
  fetchUpdateTenant,
  fetchUpdateTenantStatus,
  type TenantCreateInput,
  type TenantItem,
  type TenantProvisionResult,
  type TenantStatus
} from '@/service/api/platform';
import { clearTenantContext, copyText, setTenantContext, tenantLoginUrl } from '@/utils/tenant';
import { fetchProjectList } from '@/service/api/project';
import { formatDate } from '@/utils/format';
import RegionCascader from './components/RegionCascader.vue';

defineOptions({ name: 'PlatformTenantPage' });

const route = useRoute();

const STATUS_META: Record<string, { label: string; type: 'success' | 'warning' | 'info' }> = {
  active: { label: '正常', type: 'success' },
  suspended: { label: '已停用', type: 'warning' },
  archived: { label: '已退租', type: 'info' }
};

const loading = ref(false);
const list = ref<TenantItem[]>([]);
const total = ref(0);

const query = reactive({
  page: 1,
  pageSize: 20,
  keyword: '',
  status: '' as TenantStatus | ''
});

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchTenants({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
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
  query.keyword = '';
  query.status = '';
  query.page = 1;
  load();
}

// ── 开通租户 ──

function generateCode() {
  // 2-32 位小写字母、数字或 -，以字母/数字开头
  createForm.code = `t${Math.random().toString(36).slice(2, 8)}`;
}

const createDialog = reactive({ visible: false, submitting: false });

const createForm = reactive({
  name: '',
  code: '',
  regionCodes: [] as string[],
  plan: 'basic',
  maxProjects: 20,
  maxAdminUsers: 5,
  expiresAt: '',
  contactName: '',
  contactPhone: '',
  remark: '',
  ownerUsername: 'admin',
  ownerPassword: ''
});

const createLoginUrl = computed(() =>
  createForm.code ? tenantLoginUrl(createForm.code) : '填写租户标识后自动生成'
);

function openCreate() {
  createForm.name = '';
  createForm.code = '';
  createForm.regionCodes = [];
  generateCode();
  createForm.plan = 'basic';
  createForm.maxProjects = 20;
  createForm.maxAdminUsers = 5;
  createForm.expiresAt = '';
  createForm.contactName = '';
  createForm.contactPhone = '';
  createForm.remark = '';
  createForm.ownerUsername = 'admin';
  createForm.ownerPassword = '';
  createDialog.visible = true;
}

const resultDialog = reactive({ visible: false });
const provisionResult = ref<TenantProvisionResult | null>(null);

const provisionTenantCode = computed(() => provisionResult.value?.tenantCode || '');
const provisionUrl = computed(() =>
  provisionResult.value ? tenantLoginUrl(provisionResult.value.tenantCode) : ''
);

async function submitCreate() {
  if (!createForm.name.trim()) {
    ElMessage.warning('请输入公司名称');
    return;
  }

  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(createForm.code)) {
    ElMessage.warning('租户标识需为 2-32 位小写字母、数字或 -，且以字母或数字开头');
    return;
  }

  if (createForm.regionCodes.length !== 2) {
    ElMessage.warning('请选择租户所在省 / 市');
    return;
  }

  if (!createForm.ownerUsername.trim()) {
    ElMessage.warning('请输入租户 owner 用户名');
    return;
  }

  if (
    createForm.ownerPassword.length < 8 ||
    !/[A-Za-z]/.test(createForm.ownerPassword) ||
    !/\d/.test(createForm.ownerPassword)
  ) {
    ElMessage.warning('初始密码至少 8 位，且须同时包含字母与数字');
    return;
  }

  createDialog.submitting = true;

  try {
    const payload: TenantCreateInput = {
      name: createForm.name.trim(),
      code: createForm.code,
      plan: createForm.plan.trim() || undefined,
      maxProjects: Number(createForm.maxProjects ?? 0),
      maxAdminUsers: Number(createForm.maxAdminUsers ?? 0),
      expiresAt: createForm.expiresAt || undefined,
      contactName: createForm.contactName.trim() || undefined,
      contactPhone: createForm.contactPhone.trim() || undefined,
      remark: createForm.remark.trim() || undefined,
      provinceCode: createForm.regionCodes[0],
      cityCode: createForm.regionCodes[1],
      owner: {
        username: createForm.ownerUsername.trim(),
        password: createForm.ownerPassword
      }
    };

    const { data, error } = await fetchCreateTenant(payload);

    if (error || !data) return;

    provisionResult.value = data;
    createDialog.visible = false;
    resultDialog.visible = true;
    await load();
  } finally {
    createDialog.submitting = false;
  }
}

// ── 详情 / 条款 ──

const detailDrawer = reactive({ visible: false, loading: false });
const detail = ref<TenantItem | null>(null);

async function openDetail(row: TenantItem) {
  detailDrawer.visible = true;
  detailDrawer.loading = true;

  try {
    const { data } = await fetchTenantDetail(row.id);

    if (data) detail.value = data;
  } finally {
    detailDrawer.loading = false;
  }
}

const termsDialog = reactive({ visible: false, submitting: false, id: 0 });

const termsForm = reactive({
  name: '',
  regionCodes: [] as string[],
  plan: 'basic',
  maxProjects: 20,
  maxAdminUsers: 5,
  expiresAt: '',
  contactName: '',
  contactPhone: '',
  remark: ''
});

function openTerms(row: TenantItem) {
  termsDialog.id = row.id;
  termsForm.name = row.name;
  termsForm.regionCodes = row.region
    ? [row.region.provinceCode, row.region.cityCode].filter(Boolean) as string[]
    : [];
  termsForm.plan = row.plan ?? 'basic';
  termsForm.maxProjects = row.maxProjects;
  termsForm.maxAdminUsers = row.maxAdminUsers;
  termsForm.expiresAt = row.expiresAt ? String(row.expiresAt).slice(0, 10) : '';
  termsForm.contactName = row.contactName ?? '';
  termsForm.contactPhone = row.contactPhone ?? '';
  termsForm.remark = row.remark ?? '';
  termsDialog.visible = true;
}

async function submitTerms() {
  if (termsForm.regionCodes.length === 1) {
    ElMessage.warning('请选择完整的省 / 市，或清空地区');
    return;
  }

  termsDialog.submitting = true;

  try {
    const { error } = await fetchUpdateTenant(termsDialog.id, {
      plan: termsForm.plan.trim() || undefined,
      maxProjects: Number(termsForm.maxProjects ?? 0),
      maxAdminUsers: Number(termsForm.maxAdminUsers ?? 0),
      // 空字符串表示清空到期时间（长期有效），必须显式传 null
      expiresAt: termsForm.expiresAt || null,
      contactName: termsForm.contactName.trim() || null,
      contactPhone: termsForm.contactPhone.trim() || null,
      remark: termsForm.remark.trim() || null,
      provinceCode: termsForm.regionCodes[0] ?? null,
      cityCode: termsForm.regionCodes[1] ?? null
    });

    if (error) return;

    ElMessage.success('租户条款已更新');
    termsDialog.visible = false;
    await load();

    if (detail.value?.id === termsDialog.id) {
      const { data } = await fetchTenantDetail(termsDialog.id);
      if (data) detail.value = data;
    }
  } finally {
    termsDialog.submitting = false;
  }
}

// ── 状态流转 ──

async function suspend(row: TenantItem) {
  let reason = '';

  try {
    const result = await ElMessageBox.prompt(
      `停用后「${row.name}」的后台账号将无法登录，C 端进入只读。可随时恢复。`,
      '停用租户',
      {
        type: 'warning',
        confirmButtonText: '确认停用',
        cancelButtonText: '取消',
        inputPlaceholder: '停用原因（可选，会写入审计日志）',
        inputValidator: () => true
      }
    );

    reason = result.value || '';
  } catch {
    return;
  }

  const { error } = await fetchUpdateTenantStatus(row.id, { status: 'suspended', reason });

  if (!error) {
    ElMessage.success('租户已停用');
    await load();
  }
}

async function resume(row: TenantItem) {
  try {
    await ElMessageBox.confirm(`确认恢复「${row.name}」？恢复后后台账号可以重新登录。`, '恢复租户', {
      type: 'warning',
      confirmButtonText: '确认恢复',
      cancelButtonText: '取消'
    });
  } catch {
    return;
  }

  const { error } = await fetchUpdateTenantStatus(row.id, { status: 'active' });

  if (!error) {
    ElMessage.success('租户已恢复');
    await load();
  }
}

async function archive(row: TenantItem) {
  try {
    await ElMessageBox.confirm(
      `确认让「${row.name}」退租？**退租是终态，不能恢复**。数据进入留存期，要重新合作只能新开租户。`,
      '退租确认',
      { type: 'error', confirmButtonText: '确认退租', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchUpdateTenantStatus(row.id, { status: 'archived' });

  if (!error) {
    ElMessage.success('租户已退租');
    await load();
  }
}

// ── 复制管理地址 ──

async function copyLoginUrl(code: string) {
  if (!code) return;

  const ok = await copyText(tenantLoginUrl(code));

  if (ok) {
    ElMessage.success('管理地址已复制');
  } else {
    ElMessage.error('复制失败，请手动选择地址');
  }
}

function openLoginPage(code: string) {
  if (!code) return;

  window.open(tenantLoginUrl(code), '_blank');
}

function usageText(used: number, max: number) {
  return `${used} / ${max === 0 ? '不限' : max}`;
}

/**
 * 进入租户的只读排障视图。
 *
 * 平台默认看不到租户业务数据；只有租户管理员在「排障授权」里给当前平台账号
 * 开过窗口，业务接口才会放行。这里先设上下文并做一次探测请求：
 * 没有授权就立刻清掉上下文，不要让用户进入一个到处 403 的空页面。
 */
async function enterTenant(row: TenantItem) {
  if (row.status !== 'active' || row.expired) {
    ElMessage.warning('租户已停用或已到期，不能进入排障视图');
    return;
  }

  setTenantContext(row.id, row.name);

  const { error } = await fetchProjectList({ page: 1, pageSize: 1 });

  if (error) {
    clearTenantContext();
    ElMessage.warning('该租户尚未授予当前平台账号访问窗口，请让租户管理员在「排障授权」中授予');
    return;
  }

  // 菜单是按「启动时有没有租户上下文」过滤的，必须整页重载
  window.location.href = '/project/list';
}

onMounted(async () => {
  await load();

  // 从工作台的「开通租户」直接进来时打开弹窗
  if (route.query.create === '1') {
    openCreate();
  }
});
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <div>
            <span class="font-600">租户管理</span>
            <div class="pt-2px text-12px text-#86909c">
              平台默认看不到租户数据；租户授予排障窗口后，可从「更多 → 只读进入」查看项目（只读）
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-8px">
            <ElInput
              v-model="query.keyword"
              class="w-200px"
              clearable
              placeholder="公司名称 / 租户标识"
              @keyup.enter="search"
            />
            <ElSelect v-model="query.status" class="w-130px" clearable placeholder="状态">
              <ElOption label="正常" value="active" />
              <ElOption label="已停用" value="suspended" />
              <ElOption label="已退租" value="archived" />
            </ElSelect>
            <ElButton type="primary" @click="search">查询</ElButton>
            <ElButton @click="resetQuery">重置</ElButton>
            <ElButton type="primary" plain @click="openCreate">开通租户</ElButton>
          </div>
        </div>
      </template>

      <ElTable v-loading="loading" :data="list" row-key="id" stripe>
        <ElTableColumn prop="name" label="公司名称" min-width="130" show-overflow-tooltip />

        <ElTableColumn prop="code" label="租户标识" width="100">
          <template #default="{ row }">
            <span class="font-mono text-13px">{{ row.code }}</span>
          </template>
        </ElTableColumn>

        <ElTableColumn label="状态" width="90">
          <template #default="{ row }">
            <ElTag :type="STATUS_META[row.status]?.type || 'info'" size="small">
              {{ STATUS_META[row.status]?.label || row.statusLabel }}
            </ElTag>
            <ElTag v-if="row.expired && row.status === 'active'" class="ml-4px" type="danger" size="small">
              已过期
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn prop="plan" label="套餐" width="70">
          <template #default="{ row }">{{ row.plan || '-' }}</template>
        </ElTableColumn>

        <ElTableColumn label="所在地区" width="130">
          <template #default="{ row }">
            <span v-if="row.regionLabel">{{ row.regionLabel }}</span>
            <span v-else class="text-#c0c4cc">未设置</span>
          </template>
        </ElTableColumn>

        <ElTableColumn label="用量（项目 / 账号）" width="130" align="center">
          <template #default="{ row }">
            <div class="text-12px text-#4e5969">
              项目 {{ usageText(row.usage.projectCount, row.maxProjects) }}
            </div>
            <div class="text-12px text-#4e5969">
              账号 {{ usageText(row.usage.adminCount, row.maxAdminUsers) }}
            </div>
          </template>
        </ElTableColumn>

        <ElTableColumn label="到期时间" width="110">
          <template #default="{ row }">
            {{ row.expiresAt ? formatDate(row.expiresAt) : '长期有效' }}
          </template>
        </ElTableColumn>

        <ElTableColumn label="管理地址" width="90" align="center">
          <template #default="{ row }">
            <!-- 完整 URL 太长，放进表格会把操作列挤出可视区；这里只保留复制入口 -->
            <ElTooltip :content="tenantLoginUrl(row.code)" placement="top">
              <ElButton link type="primary" @click="copyLoginUrl(row.code)">复制地址</ElButton>
            </ElTooltip>
          </template>
        </ElTableColumn>

        <ElTableColumn label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center gap-2px whitespace-nowrap">
              <ElButton link type="primary" @click="openDetail(row)">详情</ElButton>
              <ElButton link type="primary" @click="openTerms(row)">调整</ElButton>

              <ElDropdown trigger="click" @command="command => command(row)">
                <ElButton link type="primary">更多</ElButton>
                <template #dropdown>
                  <ElDropdownMenu>
                    <ElDropdownItem
                      :command="() => enterTenant(row)"
                      :disabled="row.status !== 'active' || row.expired"
                    >
                      只读进入（排障）
                    </ElDropdownItem>
                    <ElDropdownItem :command="() => openLoginPage(row.code)">打开登录页</ElDropdownItem>
                    <ElDropdownItem :command="() => copyLoginUrl(row.code)">复制管理地址</ElDropdownItem>
                    <ElDropdownItem
                      v-if="row.status === 'active'"
                      divided
                      :command="() => suspend(row)"
                    >
                      停用
                    </ElDropdownItem>
                    <ElDropdownItem v-if="row.status === 'suspended'" :command="() => resume(row)">
                      恢复
                    </ElDropdownItem>
                    <ElDropdownItem
                      v-if="row.status !== 'archived'"
                      divided
                      :command="() => archive(row)"
                    >
                      退租（终态）
                    </ElDropdownItem>
                  </ElDropdownMenu>
                </template>
              </ElDropdown>
            </div>
          </template>
        </ElTableColumn>

        <template #empty>
          <ElEmpty description="还没有租户" />
        </template>
      </ElTable>

      <div class="mt-16px flex justify-end">
        <ElPagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </ElCard>

    <!-- 开通租户 -->
    <ElDialog v-model="createDialog.visible" title="开通租户" width="720px" destroy-on-close>
      <ElAlert
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        title="一个事务建齐"
        description="租户行、owner 账号、默认阶段模板与内容页骨架会一起创建。owner 首次登录强制改密。"
      />

      <ElForm label-width="110px">
        <ElFormItem label="公司名称" required>
          <ElInput v-model="createForm.name" maxlength="100" placeholder="例如：阳光装饰工程有限公司" />
        </ElFormItem>

        <ElFormItem label="所在地区" required>
          <RegionCascader v-model="createForm.regionCodes" placeholder="省 / 市（用于运营看板统计）" />
        </ElFormItem>

        <ElFormItem label="租户标识" required>
          <div class="w-full flex gap-8px">
            <ElInput v-model="createForm.code" maxlength="32" placeholder="小写字母 / 数字 / -" />
            <ElButton @click="generateCode">随机生成</ElButton>
          </div>
          <div class="w-full pt-4px text-12px text-#86909c">
            租户专属管理地址：<span class="text-primary">{{ createLoginUrl }}</span>
          </div>
        </ElFormItem>

        <ElFormItem label="套餐">
          <ElInput v-model="createForm.plan" maxlength="32" placeholder="basic / pro / enterprise" />
        </ElFormItem>

        <ElFormItem label="项目配额">
          <ElInputNumber v-model="createForm.maxProjects" :min="0" :max="1000000" />
          <span class="ml-8px text-12px text-#86909c">0 表示不限</span>
        </ElFormItem>

        <ElFormItem label="账号配额">
          <ElInputNumber v-model="createForm.maxAdminUsers" :min="0" :max="100000" />
          <span class="ml-8px text-12px text-#86909c">0 表示不限</span>
        </ElFormItem>

        <ElFormItem label="到期时间">
          <ElDatePicker
            v-model="createForm.expiresAt"
            class="w-full"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="留空表示长期有效；纯日期按当天结束理解"
          />
        </ElFormItem>

        <ElFormItem label="联系人">
          <div class="w-full flex gap-8px">
            <ElInput v-model="createForm.contactName" maxlength="50" placeholder="姓名" />
            <ElInput v-model="createForm.contactPhone" maxlength="20" placeholder="电话" />
          </div>
        </ElFormItem>

        <ElFormItem label="备注">
          <ElInput v-model="createForm.remark" type="textarea" :rows="2" maxlength="200" show-word-limit />
        </ElFormItem>

        <ElDivider content-position="left">租户 owner 账号</ElDivider>

        <ElFormItem label="用户名" required>
          <ElInput v-model="createForm.ownerUsername" maxlength="50" placeholder="租户管理员的登录名" />
        </ElFormItem>

        <ElFormItem label="初始密码" required>
          <ElInput
            v-model="createForm.ownerPassword"
            type="password"
            show-password
            placeholder="至少 8 位，须同时包含字母与数字"
          />
          <div class="w-full pt-4px text-12px text-#86909c">首次登录会强制修改，之后该密码立即失效。</div>
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="createDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="createDialog.submitting" @click="submitCreate">
          开通并生成地址
        </ElButton>
      </template>
    </ElDialog>

    <!-- 开通成功：地址一定要让人看得见、复制得走 -->
    <ElDialog v-model="resultDialog.visible" title="租户已开通" width="600px">
      <ElResult
        icon="success"
        :title="`${provisionResult?.tenant.name || ''} 已开通`"
        :sub-title="`owner 账号：${provisionResult?.owner.username || ''}（首次登录强制改密）`"
      >
        <template #extra>
          <div class="w-full text-left">
            <div class="mb-6px text-13px text-#4e5969">租户专属管理地址</div>
            <ElInput :model-value="provisionUrl" readonly>
              <template #append>
                <ElButton @click="copyLoginUrl(provisionTenantCode)">复制</ElButton>
              </template>
            </ElInput>
            <div class="pt-6px text-12px text-#86909c">
              把这条地址交给租户管理员。平台入口 /login 不会接受租户账号。
            </div>

            <div class="mt-18px flex gap-8px">
              <ElButton type="primary" @click="openLoginPage(provisionTenantCode)">
                打开登录页
              </ElButton>
              <ElButton @click="resultDialog.visible = false">完成</ElButton>
            </div>
          </div>
        </template>
      </ElResult>
    </ElDialog>

    <!-- 详情 -->
    <ElDrawer v-model="detailDrawer.visible" title="租户详情" size="520px">
      <div v-loading="detailDrawer.loading">
        <template v-if="detail">
          <ElDescriptions :column="1" border>
            <ElDescriptionsItem label="公司名称">{{ detail.name }}</ElDescriptionsItem>
            <ElDescriptionsItem label="租户标识">
              <span class="font-mono">{{ detail.code }}</span>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="状态">
              <ElTag :type="STATUS_META[detail.status]?.type || 'info'" size="small">
                {{ STATUS_META[detail.status]?.label || detail.statusLabel }}
              </ElTag>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="套餐">{{ detail.plan || '-' }}</ElDescriptionsItem>
            <ElDescriptionsItem label="所在地区">
              {{ detail.regionLabel || '未设置' }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="项目用量">
              {{ usageText(detail.usage.projectCount, detail.maxProjects) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="账号用量">
              {{ usageText(detail.usage.adminCount, detail.maxAdminUsers) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="到期时间">
              {{ detail.expiresAt ? formatDate(detail.expiresAt) : '长期有效' }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="联系人">
              {{ detail.contactName || '-' }}
              <span v-if="detail.contactPhone"> · {{ detail.contactPhone }}</span>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="备注">{{ detail.remark || '-' }}</ElDescriptionsItem>
            <ElDescriptionsItem label="创建时间">{{ formatDate(detail.createdAt) }}</ElDescriptionsItem>
          </ElDescriptions>

          <div class="mt-18px">
            <div class="mb-6px text-13px font-600">租户专属管理地址</div>
            <ElInput :model-value="tenantLoginUrl(detail.code)" readonly>
              <template #append>
                <ElButton @click="copyLoginUrl(detail.code)">复制</ElButton>
              </template>
            </ElInput>
          </div>

          <div class="mt-18px flex gap-8px">
            <ElButton type="primary" @click="openLoginPage(detail.code)">打开登录页</ElButton>
            <ElButton
              type="warning"
              :disabled="detail.status !== 'active' || detail.expired"
              @click="enterTenant(detail)"
            >
              只读进入（排障）
            </ElButton>
            <ElButton @click="openTerms(detail)">调整条款</ElButton>
          </div>
        </template>
      </div>
    </ElDrawer>

    <!-- 调整条款 -->
    <ElDialog v-model="termsDialog.visible" title="调整租户条款" width="560px">
      <ElForm label-width="110px">
        <ElFormItem label="所在地区">
          <RegionCascader
            v-model="termsForm.regionCodes"
            clearable
            placeholder="省 / 市（清空后不计入地图统计）"
          />
        </ElFormItem>
        <ElFormItem label="套餐">
          <ElInput v-model="termsForm.plan" maxlength="32" />
        </ElFormItem>
        <ElFormItem label="项目配额">
          <ElInputNumber v-model="termsForm.maxProjects" :min="0" :max="1000000" />
          <span class="ml-8px text-12px text-#86909c">0 表示不限</span>
        </ElFormItem>
        <ElFormItem label="账号配额">
          <ElInputNumber v-model="termsForm.maxAdminUsers" :min="0" :max="100000" />
          <span class="ml-8px text-12px text-#86909c">0 表示不限</span>
        </ElFormItem>
        <ElFormItem label="到期时间">
          <ElDatePicker
            v-model="termsForm.expiresAt"
            class="w-full"
            type="date"
            value-format="YYYY-MM-DD"
            clearable
            placeholder="清空表示长期有效"
          />
        </ElFormItem>
        <ElFormItem label="联系人">
          <div class="w-full flex gap-8px">
            <ElInput v-model="termsForm.contactName" maxlength="50" placeholder="姓名" />
            <ElInput v-model="termsForm.contactPhone" maxlength="20" placeholder="电话" />
          </div>
        </ElFormItem>
        <ElFormItem label="备注">
          <ElInput v-model="termsForm.remark" type="textarea" :rows="2" maxlength="200" show-word-limit />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="termsDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="termsDialog.submitting" @click="submitTerms">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped></style>
