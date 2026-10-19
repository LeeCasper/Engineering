<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  fetchAccounts,
  fetchCreateAccount,
  fetchGrantedProjects,
  fetchGrantProjects,
  fetchResetAccountPassword,
  fetchUpdateAccountStatus,
  type AdminAccount,
  type AdminRole,
  type AdminStatus
} from '@/service/api/account';
import { fetchProjectList, type ProjectListItem } from '@/service/api/project';
import { useAuthStore } from '@/store/modules/auth';
import { formatDate, PROJECT_STATUS_META } from '@/utils/format';

defineOptions({ name: 'AccountPage' });

const authStore = useAuthStore();
const isOwner = computed(() => authStore.isTenantOwner);

const loading = ref(false);
const list = ref<AdminAccount[]>([]);
const total = ref(0);

const query = reactive({
  page: 1,
  pageSize: 20,
  keyword: '',
  role: '' as AdminRole | '',
  status: '' as AdminStatus | ''
});

const roleLabels: Record<string, string> = {
  owner: '租户管理员',
  admin: '项目管理员'
};

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchAccounts({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      role: query.role || undefined,
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
  query.role = '';
  query.status = '';
  query.page = 1;
  load();
}

/**
 * 后端仍会独立校验。这里隐藏入口只是避免用户点到一个必然 403 的按钮，
 * 不是权限边界。
 */
function canManage(row: AdminAccount) {
  if (row.id === Number(authStore.userInfo.userId)) return false;

  if (isOwner.value) return true;

  return row.role !== 'owner' && Number(row.createdBy) === Number(authStore.userInfo.userId);
}

// ── 新建账号 ──

const createDialog = reactive({ visible: false, submitting: false });
const createForm = reactive({ username: '', password: '', role: 'admin' as AdminRole });

function openCreate() {
  createForm.username = '';
  createForm.password = '';
  createForm.role = 'admin';
  createDialog.visible = true;
}

async function submitCreate() {
  if (!/^[A-Za-z0-9_.@-]+$/.test(createForm.username.trim())) {
    ElMessage.warning('用户名只能包含字母、数字与 _ . @ -');
    return;
  }

  if (
    createForm.password.length < 8 ||
    !/[A-Za-z]/.test(createForm.password) ||
    !/\d/.test(createForm.password)
  ) {
    ElMessage.warning('初始密码至少 8 位，且须同时包含字母与数字');
    return;
  }

  createDialog.submitting = true;

  try {
    const { error } = await fetchCreateAccount({
      username: createForm.username.trim(),
      password: createForm.password,
      // 账号管理页只创建项目管理员；再建一个 owner 会把「谁能管谁」变得模糊
      role: 'admin'
    });

    if (error) return;

    ElMessage.success('账号已创建，首次登录会强制修改初始密码');
    createDialog.visible = false;
    await load();
  } finally {
    createDialog.submitting = false;
  }
}

// ── 启用 / 禁用 ──

async function toggleStatus(row: AdminAccount) {
  const target: AdminStatus = row.status === 'active' ? 'disabled' : 'active';
  const actionText = target === 'active' ? '启用' : '禁用';

  try {
    await ElMessageBox.confirm(
      target === 'disabled'
        ? `确认禁用「${row.username}」？已签发的 token 在下一次请求时立即失效。`
        : `确认启用「${row.username}」？`,
      `${actionText}账号`,
      { type: 'warning', confirmButtonText: `确认${actionText}`, cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchUpdateAccountStatus(row.id, target);

  if (!error) {
    ElMessage.success(`账号已${actionText}`);
    await load();
  }
}

// ── 重置密码 ──

const resetDialog = reactive({ visible: false, submitting: false, id: 0, username: '' });
const resetForm = reactive({ newPassword: '', confirmPassword: '' });

function openReset(row: AdminAccount) {
  resetDialog.id = row.id;
  resetDialog.username = row.username;
  resetForm.newPassword = '';
  resetForm.confirmPassword = '';
  resetDialog.visible = true;
}

async function submitReset() {
  if (
    resetForm.newPassword.length < 8 ||
    !/[A-Za-z]/.test(resetForm.newPassword) ||
    !/\d/.test(resetForm.newPassword)
  ) {
    ElMessage.warning('新密码至少 8 位，且须同时包含字母与数字');
    return;
  }

  if (resetForm.newPassword !== resetForm.confirmPassword) {
    ElMessage.warning('两次输入的密码不一致');
    return;
  }

  resetDialog.submitting = true;

  try {
    const { error } = await fetchResetAccountPassword(resetDialog.id, resetForm.newPassword);

    if (error) return;

    ElMessage.success('密码已重置，对方下次登录会强制修改，原 token 立即失效');
    resetDialog.visible = false;
    await load();
  } finally {
    resetDialog.submitting = false;
  }
}

// ── 项目权限 ──

const grantDialog = reactive({ visible: false, submitting: false, id: 0, username: '', loading: false });
const grantForm = reactive({ projectIds: [] as number[] });
const projectOptions = ref<ProjectListItem[]>([]);
const projectLoading = ref(false);

async function loadProjectOptions(keyword = '') {
  projectLoading.value = true;

  try {
    const { data } = await fetchProjectList({
      page: 1,
      pageSize: 50,
      name: keyword.trim() || undefined
    });

    if (data) projectOptions.value = data.list;
  } finally {
    projectLoading.value = false;
  }
}

async function openGrant(row: AdminAccount) {
  grantDialog.id = row.id;
  grantDialog.username = row.username;
  grantForm.projectIds = [];
  grantDialog.visible = true;
  grantDialog.loading = true;

  try {
    await loadProjectOptions();
    const { data } = await fetchGrantedProjects(row.id);

    if (data) grantForm.projectIds = data.projectIds;
  } finally {
    grantDialog.loading = false;
  }
}

async function submitGrant() {
  grantDialog.submitting = true;

  try {
    const { error } = await fetchGrantProjects(grantDialog.id, grantForm.projectIds);

    if (error) return;

    ElMessage.success('项目权限已更新');
    grantDialog.visible = false;
  } finally {
    grantDialog.submitting = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="p-16px">
    <ElCard shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-12px">
          <span class="font-600">账号管理</span>
          <div class="flex flex-wrap items-center gap-8px">
            <ElInput
              v-model="query.keyword"
              class="w-180px"
              clearable
              placeholder="用户名"
              @keyup.enter="search"
            />
            <ElSelect v-model="query.role" class="w-130px" clearable placeholder="角色">
              <ElOption label="租户管理员" value="owner" />
              <ElOption label="项目管理员" value="admin" />
            </ElSelect>
            <ElSelect v-model="query.status" class="w-120px" clearable placeholder="状态">
              <ElOption label="启用" value="active" />
              <ElOption label="禁用" value="disabled" />
            </ElSelect>
            <ElButton type="primary" @click="search">查询</ElButton>
            <ElButton @click="resetQuery">重置</ElButton>
            <ElButton v-if="isOwner" type="primary" plain @click="openCreate">新建账号</ElButton>
          </div>
        </div>
      </template>

      <ElAlert
        v-if="!isOwner"
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        :title="
          authStore.isPlatform
            ? '平台账号在排障窗口内只能查看账号列表'
            : '项目管理员只能看到并管理自己创建的下属账号'
        "
        :description="
          authStore.isPlatform
            ? '创建、禁用、重置密码都会被后端只读窗口拒绝。'
            : '创建账号是租户管理员的能力；项目管理员不能操作租户管理员账号。'
        "
      />

      <ElTable v-loading="loading" :data="list" row-key="id" stripe>
        <ElTableColumn prop="username" label="用户名" min-width="150" />

        <ElTableColumn label="角色" width="120">
          <template #default="{ row }">
            <ElTag :type="row.role === 'owner' ? 'danger' : 'primary'" size="small">
              {{ roleLabels[row.role] || row.role }}
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="状态" width="100">
          <template #default="{ row }">
            <ElTag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '启用' : '禁用' }}
            </ElTag>
            <ElTag v-if="row.mustChangePassword" class="ml-4px" type="warning" size="small">待改密</ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="创建人" width="100">
          <template #default="{ row }">
            {{ row.createdBy ? `#${row.createdBy}` : '系统' }}
          </template>
        </ElTableColumn>

        <ElTableColumn label="创建时间" width="140">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </ElTableColumn>

        <ElTableColumn label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <template v-if="canManage(row)">
              <ElButton link type="primary" @click="toggleStatus(row)">
                {{ row.status === 'active' ? '禁用' : '启用' }}
              </ElButton>
              <ElButton link type="primary" @click="openReset(row)">重置密码</ElButton>
              <ElButton
                v-if="isOwner && row.role === 'admin'"
                link
                type="primary"
                @click="openGrant(row)"
              >
                项目权限
              </ElButton>
            </template>
            <span v-else class="text-12px text-#c0c4cc">—</span>
          </template>
        </ElTableColumn>

        <template #empty>
          <ElEmpty description="还没有后台账号" />
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

    <!-- 新建账号 -->
    <ElDialog v-model="createDialog.visible" title="新建账号" width="480px">
      <ElAlert
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        title="首次登录强制改密"
        description="新账号首次登录时必须先修改初始密码，完成后旧 token 立即失效。"
      />
      <ElForm label-width="90px">
        <ElFormItem label="用户名" required>
          <ElInput v-model="createForm.username" maxlength="50" placeholder="字母、数字与 _ . @ -" />
        </ElFormItem>
        <ElFormItem label="初始密码" required>
          <ElInput
            v-model="createForm.password"
            type="password"
            show-password
            placeholder="至少 8 位，须同时包含字母与数字"
          />
        </ElFormItem>
        <ElFormItem label="角色">
          <ElTag type="primary">项目管理员</ElTag>
          <span class="ml-8px text-12px text-#86909c">账号管理页只创建项目管理员</span>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="createDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="createDialog.submitting" @click="submitCreate">创建</ElButton>
      </template>
    </ElDialog>

    <!-- 重置密码 -->
    <ElDialog v-model="resetDialog.visible" :title="`重置密码 · ${resetDialog.username}`" width="480px">
      <ElForm label-width="90px">
        <ElFormItem label="新密码" required>
          <ElInput
            v-model="resetForm.newPassword"
            type="password"
            show-password
            placeholder="至少 8 位，须同时包含字母与数字"
          />
        </ElFormItem>
        <ElFormItem label="确认密码" required>
          <ElInput v-model="resetForm.confirmPassword" type="password" show-password />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="resetDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="resetDialog.submitting" @click="submitReset">重置</ElButton>
      </template>
    </ElDialog>

    <!-- 项目权限 -->
    <ElDialog v-model="grantDialog.visible" :title="`项目权限 · ${grantDialog.username}`" width="640px">
      <div v-loading="grantDialog.loading">
        <ElAlert
          class="mb-14px"
          type="info"
          :closable="false"
          show-icon
          title="授予后该管理员能看到这些项目"
          description="项目管理员默认只能看到自己创建的项目；这里额外授予的项目与「自己创建」取并集。"
        />
        <ElSelect
          v-model="grantForm.projectIds"
          class="w-full"
          multiple
          filterable
          remote
          reserve-keyword
          :remote-method="loadProjectOptions"
          :loading="projectLoading"
          placeholder="搜索并选择项目（可多选）"
        >
          <ElOption
            v-for="project in projectOptions"
            :key="project.id"
            :label="`${project.name}（${PROJECT_STATUS_META[project.status]?.label || project.statusLabel}）`"
            :value="project.id"
          />
        </ElSelect>
        <div class="pt-6px text-12px text-#86909c">
          已选 {{ grantForm.projectIds.length }} 个项目。搜索只加载前 50 个匹配项，已选中的项不会因为搜索而丢失。
        </div>
      </div>
      <template #footer>
        <ElButton @click="grantDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="grantDialog.submitting" @click="submitGrant">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped></style>
