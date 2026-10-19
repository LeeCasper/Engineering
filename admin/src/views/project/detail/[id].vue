<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  fetchArchiveProject,
  fetchChangeProjectStatus,
  fetchProjectDetail,
  fetchSetCoordinates,
  type ProjectDetail,
  type ProjectStatus
} from '@/service/api/project';
import { useAuthStore } from '@/store/modules/auth';
import { useTenantReadOnly } from '@/hooks/common/tenant';
import { formatDate, formatMoney, PROJECT_STATUS_META } from '@/utils/format';
import OverviewTab from './components/OverviewTab.vue';
import StructureTab from './components/StructureTab.vue';
import MembersTab from './components/MembersTab.vue';
import PaymentNodesTab from './components/PaymentNodesTab.vue';

defineOptions({ name: 'ProjectDetailPage' });

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const projectId = computed(() => Number(route.params.id));
const detail = ref<ProjectDetail | null>(null);
const loading = ref(false);
const activeTab = ref('overview');

const isOwner = computed(() => authStore.isTenantOwner);
const readOnly = useTenantReadOnly();

const statusOrder: ProjectStatus[] = ['pending', 'building', 'finished', 'archived'];

const statusOptions = computed(() => {
  if (!detail.value) return [];

  const currentIndex = statusOrder.indexOf(detail.value.status);

  return statusOrder
    .filter(status => status !== detail.value!.status)
    .map(status => ({
      value: status,
      label: PROJECT_STATUS_META[status]?.label || status,
      reverse: statusOrder.indexOf(status) < currentIndex
    }));
});

async function load() {
  loading.value = true;

  try {
    const { data, error } = await fetchProjectDetail(projectId.value);

    if (!error && data) {
      detail.value = data;
    }
  } finally {
    loading.value = false;
  }
}

async function changeStatus(target: ProjectStatus, reverse: boolean) {
  if (!detail.value) return;

  const label = PROJECT_STATUS_META[target]?.label || target;

  try {
    await ElMessageBox.confirm(
      reverse
        ? `将项目从「${detail.value.statusLabel}」退回「${label}」需要二次确认，并写入操作日志。`
        : `确认把项目流转到「${label}」？`,
      '状态流转',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  if (target === 'archived') {
    const { error } = await fetchArchiveProject(projectId.value, true);
    if (!error) {
      ElMessage.success('项目已归档');
      await load();
    }
    return;
  }

  const { error } = await fetchChangeProjectStatus(projectId.value, target, reverse);

  if (!error) {
    ElMessage.success('状态已更新');
    await load();
  }
}

// ── 手工拾取坐标（AC-AD54） ──
//
// 没有配置腾讯地图 Key 时，地址地理编码会降级；此时管理员需要能手工填入
// GCJ-02 坐标。坐标是 DECIMAL(10,7)，必须按**字符串**提交 ——
// 转成 Number 会把 7 位小数截成 2 位，误差可达一公里。

const coordDialog = reactive({ visible: false, submitting: false });
const coordForm = reactive({ longitude: '', latitude: '' });

function openCoordinates() {
  coordForm.longitude = detail.value?.longitude ?? '';
  coordForm.latitude = detail.value?.latitude ?? '';
  coordDialog.visible = true;
}

async function submitCoordinates() {
  const pattern = /^-?\d{1,3}(\.\d{1,7})?$/;

  if (!pattern.test(coordForm.longitude) || Number(coordForm.longitude) < -180 || Number(coordForm.longitude) > 180) {
    ElMessage.warning('经度格式不正确（-180 ~ 180，最多 7 位小数）');
    return;
  }

  if (!pattern.test(coordForm.latitude) || Number(coordForm.latitude) < -90 || Number(coordForm.latitude) > 90) {
    ElMessage.warning('纬度格式不正确（-90 ~ 90，最多 7 位小数）');
    return;
  }

  coordDialog.submitting = true;

  try {
    const { error } = await fetchSetCoordinates(projectId.value, {
      longitude: coordForm.longitude,
      latitude: coordForm.latitude
    });

    if (error) return;

    ElMessage.success('坐标已保存');
    coordDialog.visible = false;
    await load();
  } finally {
    coordDialog.submitting = false;
  }
}

async function unarchive() {
  try {
    await ElMessageBox.confirm('解除归档后项目回到「已完工」，仍为只读，需要再显式流转到「施工中」。', '解除归档', {
      type: 'warning',
      confirmButtonText: '解除归档',
      cancelButtonText: '取消'
    });
  } catch {
    return;
  }

  const { error } = await fetchChangeProjectStatus(projectId.value, 'finished', true);

  if (!error) {
    ElMessage.success('已解除归档');
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading" class="p-16px">
    <template v-if="detail">
      <ElCard shadow="never" class="mb-16px">
        <div class="flex flex-wrap items-start justify-between gap-12px">
          <div>
            <div class="flex flex-wrap items-center gap-10px">
              <ElButton text @click="router.push('/project/list')">← 项目列表</ElButton>
              <span class="text-22px font-600 text-#1d2129">{{ detail.name }}</span>
              <ElTag :type="PROJECT_STATUS_META[detail.status]?.type || 'info'">
                {{ PROJECT_STATUS_META[detail.status]?.label || detail.statusLabel }}
              </ElTag>
              <ElTag v-if="detail.isOverdue" type="danger">已延期</ElTag>
              <ElTag v-if="detail.needsCoordinates" type="warning">坐标未拾取</ElTag>
              <ElTag v-if="readOnly" type="warning" effect="dark">只读排障</ElTag>
            </div>
            <div class="pt-6px text-13px text-#86909c">{{ detail.address }}</div>
          </div>

          <div class="flex flex-wrap items-center gap-8px">
            <ElButton
              v-if="detail.needsCoordinates && !readOnly"
              type="warning"
              plain
              @click="openCoordinates"
            >
              拾取坐标
            </ElButton>
            <ElButton @click="load">刷新</ElButton>
            <ElButton
              v-if="!readOnly"
              @click="router.push({ path: '/project/list', query: { edit: String(detail.id) } })"
            >
              编辑
            </ElButton>

            <ElDropdown
              v-if="detail.status !== 'archived' && !readOnly"
              trigger="click"
              @command="command => command()"
            >
              <ElButton type="primary">状态流转</ElButton>
              <template #dropdown>
                <ElDropdownMenu>
                  <ElDropdownItem
                    v-for="item in statusOptions"
                    :key="item.value"
                    :command="() => changeStatus(item.value, item.reverse)"
                  >
                    流转到{{ item.label }}{{ item.reverse ? '（退回）' : '' }}
                  </ElDropdownItem>
                </ElDropdownMenu>
              </template>
            </ElDropdown>

            <ElButton
              v-if="detail.status === 'archived' && isOwner && !readOnly"
              type="primary"
              @click="unarchive"
            >
              解除归档
            </ElButton>
          </div>
        </div>

        <div class="mt-18px grid grid-cols-5 gap-16px lt-lg:grid-cols-3 lt-sm:grid-cols-2">
          <div>
            <div class="text-12px text-#86909c">总进度</div>
            <ElProgress class="pt-6px" :percentage="Number(detail.progress) || 0" :stroke-width="10" />
          </div>
          <div>
            <div class="text-12px text-#86909c">合同金额</div>
            <div class="pt-4px text-18px font-600">¥ {{ formatMoney(detail.contractAmount) }}</div>
          </div>
          <div>
            <div class="text-12px text-#86909c">开工日期</div>
            <div class="pt-4px text-15px">{{ formatDate(detail.startDate) }}</div>
          </div>
          <div>
            <div class="text-12px text-#86909c">计划竣工</div>
            <div class="pt-4px text-15px">{{ formatDate(detail.planEndDate) }}</div>
          </div>
          <div>
            <div class="text-12px text-#86909c">实际竣工</div>
            <div class="pt-4px text-15px">{{ formatDate(detail.actualEndDate) }}</div>
          </div>
        </div>

        <ElAlert
          v-if="detail.status === 'archived'"
          class="mt-16px"
          type="warning"
          :closable="false"
          show-icon
          title="项目已归档，全链路只读"
          description="C 端与 B 端的所有写操作都会被拒绝；解除归档后仍需显式流转回「施工中」才能继续施工。"
        />
      </ElCard>

      <ElCard shadow="never">
        <ElTabs v-model="activeTab">
          <ElTabPane label="概览" name="overview">
            <OverviewTab :detail="detail" />
          </ElTabPane>
          <ElTabPane label="阶段与工序" name="structure">
            <StructureTab :project-id="projectId" :detail="detail" @refresh="load" />
          </ElTabPane>
          <ElTabPane label="成员" name="members">
            <MembersTab :project-id="projectId" :detail="detail" @refresh="load" />
          </ElTabPane>
          <ElTabPane label="付款节点" name="payments">
            <PaymentNodesTab :project-id="projectId" :detail="detail" @refresh="load" />
          </ElTabPane>
        </ElTabs>
      </ElCard>
    </template>

    <ElEmpty v-else-if="!loading" description="项目不存在或无权访问" />

    <ElDialog v-model="coordDialog.visible" title="手工拾取坐标" width="480px">
      <ElAlert
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        title="GCJ-02 坐标，最多 7 位小数"
        description="地址自动解析失败时，可在地图上取点后手工填入。坐标以字符串保存，避免精度丢失。"
      />
      <ElForm label-width="70px">
        <ElFormItem label="经度" required>
          <ElInput v-model="coordForm.longitude" placeholder="例如 121.4737010" />
        </ElFormItem>
        <ElFormItem label="纬度" required>
          <ElInput v-model="coordForm.latitude" placeholder="例如 31.2304160" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="coordDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="coordDialog.submitting" @click="submitCoordinates">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped></style>
