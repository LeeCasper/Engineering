import { localStg } from '@/utils/storage';

/**
 * 租户专属管理地址。
 *
 * 平台开通租户后，租户管理员使用 `/t/<tenantCode>/login` 登录；
 * 根地址 `/login` 只服务平台运营。地址由租户标识确定性生成，
 * 不需要在数据库里额外存一份 URL —— 换域名时也不会留下一批失效链接。
 */
export function tenantLoginUrl(code: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  return `${window.location.origin}${base}/t/${encodeURIComponent(code)}/login`;
}

/**
 * 平台排障访问的租户上下文。
 *
 * 只有平台账号会写入它；请求层据此附加 `X-Tenant-Id`。进入/退出时做一次
 * 整页跳转，让路由表按「有 / 无上下文」重新初始化 —— 菜单是启动时按角色
 * 过滤的，不重载就会出现「路由变了但菜单没变」。
 */
export function getTenantContextId(): number | null {
  const value = localStg.get('tenantContext');

  if (!value) return null;

  const tenantId = Number(value);

  return Number.isInteger(tenantId) && tenantId > 0 ? tenantId : null;
}

export function getTenantContextName(): string {
  return localStg.get('tenantContextName') || '';
}

export function setTenantContext(tenantId: number, tenantName = '') {
  localStg.set('tenantContext', String(tenantId));
  localStg.set('tenantContextName', tenantName);
}

export function clearTenantContext() {
  localStg.remove('tenantContext');
  localStg.remove('tenantContextName');
}

/** 复制文本。clipboard API 不可用（非 HTTPS / 旧浏览器）时退回 execCommand */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}
