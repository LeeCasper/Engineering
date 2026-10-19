<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/store/modules/auth';
import { clearTenantContext, getTenantContextId, getTenantContextName } from '@/utils/tenant';

defineOptions({ name: 'TenantContextBanner' });

const authStore = useAuthStore();

const tenantId = computed(() => getTenantContextId());
const tenantName = computed(() => getTenantContextName());
const visible = computed(() => authStore.isPlatform && Boolean(tenantId.value));

function exit() {
  clearTenantContext();
  // 菜单是启动时按角色与上下文过滤的，必须整页重载才能回到平台视图
  window.location.href = '/home';
}
</script>

<template>
  <div v-if="visible" class="tenant-banner">
    <ElTag type="warning" effect="dark" size="small">只读排障模式</ElTag>
    <span class="ml-8px">租户：{{ tenantName || `#${tenantId}` }}</span>
    <span class="ml-10px text-12px text-#86909c">所有访问已记入该租户的操作日志</span>
    <ElButton class="ml-12px" link type="primary" @click="exit">退出排障</ElButton>
  </div>
</template>

<style scoped>
.tenant-banner {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 3000;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid #ffd591;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}
</style>
