import { localStg } from '@/utils/storage';
import { getTenantContextId } from '@/utils/tenant';
import type { RequestInstanceState } from './type';

export { getTenantContextId };

/** 请求头里的租户上下文，与后端 adminAuth 中间件保持一致 */
export const TENANT_CONTEXT_HEADER = 'X-Tenant-Id';

export function getAuthorization() {
  const token = localStg.get('token');
  const Authorization = token ? `Bearer ${token}` : null;

  return Authorization;
}

/** 平台排障时携带的目标租户；租户账号没有这个上下文 */
export function getTenantContext() {
  return getTenantContextId();
}

export function showErrorMsg(state: RequestInstanceState, message: string) {
  if (!state.errMsgStack?.length) {
    state.errMsgStack = [];
  }

  const isExist = state.errMsgStack.includes(message);

  if (!isExist) {
    state.errMsgStack.push(message);

    window.$message?.error({
      message,
      onClose: () => {
        state.errMsgStack = state.errMsgStack.filter(msg => msg !== message);

        setTimeout(() => {
          state.errMsgStack = [];
        }, 5000);
      }
    });
  }
}
