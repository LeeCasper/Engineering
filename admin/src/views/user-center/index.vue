<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/store/modules/auth';
import { localStg } from '@/utils/storage';
import { copyText, tenantLoginUrl } from '@/utils/tenant';
import { ROLE_LABELS } from '@/utils/format';

defineOptions({ name: 'UserCenterPage' });

const authStore = useAuthStore();
const router = useRouter();

const roleLabel = computed(() => ROLE_LABELS[authStore.userInfo.role] || '后台账号');

const tenantCode = computed(() => (authStore.isPlatform ? '' : localStg.get('loginTenantCode') || ''));
const loginUrl = computed(() => (tenantCode.value ? tenantLoginUrl(tenantCode.value) : ''));

async function copyAddress() {
  if (!loginUrl.value) return;

  const ok = await copyText(loginUrl.value);

  if (ok) {
    ElMessage.success('管理地址已复制');
  } else {
    ElMessage.error('复制失败，请手动选择地址');
  }
}

const scopeText = computed(() => {
  if (authStore.isPlatform) return '平台运营：管理租户，不参与租户业务数据';
  if (authStore.isTenantOwner) return '本租户全部项目与账号';
  return '本租户内被授权的项目';
});
</script>

<template>
  <div class="p-16px">
    <ElCard class="max-w-640px" shadow="never">
      <template #header>
        <span class="font-600">个人中心</span>
      </template>

      <ElDescriptions :column="1" border>
        <ElDescriptionsItem label="用户名">{{ authStore.userInfo.userName }}</ElDescriptionsItem>
        <ElDescriptionsItem label="角色">{{ roleLabel }}</ElDescriptionsItem>
        <ElDescriptionsItem label="租户">
          {{ authStore.userInfo.tenantId ?? '平台（不属于任何租户）' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="数据范围">{{ scopeText }}</ElDescriptionsItem>
        <ElDescriptionsItem v-if="tenantCode" label="租户管理地址">
          <div class="flex flex-wrap items-center gap-8px">
            <span class="break-all text-13px">{{ loginUrl }}</span>
            <ElButton link type="primary" @click="copyAddress">复制</ElButton>
          </div>
        </ElDescriptionsItem>
      </ElDescriptions>

      <div class="mt-20px flex gap-10px">
        <ElButton type="primary" @click="router.push('/change-password')">修改密码</ElButton>
        <ElButton @click="authStore.logout()">退出登录</ElButton>
      </div>
    </ElCard>
  </div>
</template>

<style scoped></style>
