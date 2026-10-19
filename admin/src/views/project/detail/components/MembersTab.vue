<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  fetchInviteMember,
  fetchRemoveMember,
  fetchSetPrimaryForeman,
  type MemberRole,
  type ProjectDetail,
  type ProjectMember
} from '@/service/api/project';
import { useTenantReadOnly } from '@/hooks/common/tenant';
import { formatDate, MEMBER_STATUS_META } from '@/utils/format';

defineOptions({ name: 'ProjectMembersTab' });

const props = defineProps<{ projectId: number; detail: ProjectDetail }>();
const emit = defineEmits<{ refresh: [] }>();

const readOnly = useTenantReadOnly();
const composition = computed(() => props.detail.memberComposition);
const members = computed(() => props.detail.members);

const inviteDialog = reactive({
  visible: false,
  submitting: false
});

const inviteForm = reactive({
  phone: '',
  role: 'foreman' as MemberRole,
  confirmReplace: false
});

function openInvite() {
  inviteForm.phone = '';
  inviteForm.role = 'foreman';
  inviteForm.confirmReplace = false;
  inviteDialog.visible = true;
}

async function submitInvite() {
  if (!inviteForm.phone.trim()) {
    ElMessage.warning('请输入手机号');
    return;
  }

  inviteDialog.submitting = true;

  try {
    const { error } = await fetchInviteMember(props.projectId, {
      phone: inviteForm.phone.trim(),
      role: inviteForm.role,
      confirmReplace: inviteForm.confirmReplace
    });

    if (error) return;

    ElMessage.success('邀请已发出，等待对方在小程序确认');
    inviteDialog.visible = false;
    emit('refresh');
  } finally {
    inviteDialog.submitting = false;
  }
}

async function setPrimary(member: ProjectMember) {
  try {
    await ElMessageBox.confirm(
      `将「${member.nickname || `用户 #${member.userId}`}」指定为主工长？改指立即生效，原主工长降为普通工长。`,
      '指定主工长',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchSetPrimaryForeman(props.projectId, member.id);

  if (!error) {
    ElMessage.success('主工长已改指');
    emit('refresh');
  }
}

async function remove(member: ProjectMember) {
  try {
    await ElMessageBox.confirm(
      `确认解除「${member.nickname || `用户 #${member.userId}`}」与本项目的成员关系？历史汇报与操作记录会保留。`,
      '解除成员',
      { type: 'warning', confirmButtonText: '确认解除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  const { error } = await fetchRemoveMember(props.projectId, member.id);

  if (!error) {
    ElMessage.success('成员已解除');
    emit('refresh');
  }
}

const roleTagType: Record<string, 'primary' | 'success' | 'warning'> = {
  foreman: 'primary',
  supervisor: 'success',
  owner: 'warning'
};
</script>

<template>
  <div>
    <ElAlert
      :type="composition.meetsRequirement ? 'success' : 'warning'"
      :closable="false"
      show-icon
      :title="
        composition.meetsRequirement
          ? '人员已配齐，可流转到「施工中」'
          : '人员尚未配齐，不能流转到「施工中」'
      "
      :description="`已确认工长 ${composition.foremanCount} 名${composition.primaryForemanName ? `（主工长：${composition.primaryForemanName}）` : '（未指定主工长）'}，已确认业主 ${composition.ownerCount} 名。待确认（pending）成员不计入权限判定。`"
    />

    <div v-if="!readOnly" class="my-14px flex justify-end">
      <ElButton type="primary" plain @click="openInvite">邀请成员</ElButton>
    </div>

    <ElTable :data="members" row-key="id" border>
      <ElTableColumn label="成员" min-width="150">
        <template #default="{ row }">
          <span>{{ row.nickname || `用户 #${row.userId}` }}</span>
          <ElTag
            v-if="row.isPrimaryForeman && row.status === 'active'"
            class="ml-6px"
            type="danger"
            size="small"
          >
            主工长
          </ElTag>
          <!-- 后端允许首个被邀请的工长在 pending 时就带上 is_primary，
               但 pending 不参与任何权限判定。这里如实说明「确认后才生效」，
               否则会和上方「已确认工长 0 名（未指定主工长）」自相矛盾 -->
          <ElTag
            v-else-if="row.isPrimaryForeman && row.status === 'pending'"
            class="ml-6px"
            type="info"
            size="small"
          >
            确认后成为主工长
          </ElTag>
        </template>
      </ElTableColumn>

      <ElTableColumn label="角色" width="100">
        <template #default="{ row }">
          <ElTag :type="roleTagType[row.role] || 'info'" size="small">{{ row.roleLabel }}</ElTag>
        </template>
      </ElTableColumn>

      <ElTableColumn label="状态" width="100">
        <template #default="{ row }">
          <ElTag :type="MEMBER_STATUS_META[row.status]?.type || 'info'" size="small">
            {{ MEMBER_STATUS_META[row.status]?.label || row.statusLabel }}
          </ElTag>
        </template>
      </ElTableColumn>

      <ElTableColumn prop="phoneMasked" label="手机号" width="140">
        <template #default="{ row }">{{ row.phoneMasked || '-' }}</template>
      </ElTableColumn>

      <ElTableColumn label="邀请 / 确认" width="200">
        <template #default="{ row }">
          <div class="text-12px text-#86909c">邀请：{{ formatDate(row.invitedAt) }}</div>
          <div class="text-12px text-#86909c">确认：{{ formatDate(row.confirmedAt) }}</div>
        </template>
      </ElTableColumn>

      <ElTableColumn v-if="!readOnly" label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <ElButton
            v-if="row.role === 'foreman' && row.status === 'active' && !row.isPrimaryForeman"
            link
            type="primary"
            @click="setPrimary(row)"
          >
            设为主工长
          </ElButton>
          <ElButton v-if="row.status !== 'removed'" link type="danger" @click="remove(row)">
            移除
          </ElButton>
        </template>
      </ElTableColumn>

      <template #empty>
        <ElEmpty description="还没有成员" :image-size="60" />
      </template>
    </ElTable>

    <ElDialog v-model="inviteDialog.visible" title="邀请成员" width="480px">
      <ElAlert
        class="mb-14px"
        type="info"
        :closable="false"
        show-icon
        title="邀请按手机号发起"
        description="对方在小程序确认前状态为「待确认」，不计入任何权限，也不会在 C 端项目列表里出现。"
      />

      <ElForm label-width="84px">
        <ElFormItem label="手机号" required>
          <ElInput v-model="inviteForm.phone" maxlength="20" placeholder="请输入被邀请人的手机号" />
        </ElFormItem>

        <ElFormItem label="角色" required>
          <ElSelect v-model="inviteForm.role" class="w-full">
            <ElOption label="工长（可多名，首个自动成为主工长）" value="foreman" />
            <ElOption label="监理（0 名时验收自动跳过监理环节）" value="supervisor" />
            <ElOption label="业主（至少 1 名）" value="owner" />
          </ElSelect>
        </ElFormItem>

        <ElFormItem label="重复邀请">
          <ElCheckbox v-model="inviteForm.confirmReplace">
            该手机号已是本项目成员且角色不同时，确认替换角色
          </ElCheckbox>
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="inviteDialog.visible = false">取消</ElButton>
        <ElButton type="primary" :loading="inviteDialog.submitting" @click="submitInvite">发出邀请</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped></style>
