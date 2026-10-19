import { computed } from 'vue';
import { useAuthStore } from '@/store/modules/auth';
import { getTenantContextId } from '@/utils/tenant';

/**
 * 是否处于「平台只读排障」视图。
 *
 * 平台账号只有在租户授予窗口后才会进入租户菜单；窗口内后端拒绝一切写操作
 * （`requireTenant`），因此界面上也不该再展示新建/编辑/删除入口 ——
 * 让用户点一个必然 403 的按钮不是「权限控制」，只是坏体验。
 */
export function useTenantReadOnly() {
  const authStore = useAuthStore();

  return computed(() => authStore.isPlatform && Boolean(getTenantContextId()));
}
