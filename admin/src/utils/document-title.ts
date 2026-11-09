import type { RouteMeta } from 'vue-router';
import { useTitle } from '@vueuse/core';
import { $t } from '@/locales';
import { brandingState } from '@/utils/branding-state';

/**
 * 页面标题统一在这里拼：`页面标题 - 后台品牌名称`。
 *
 * ── 为什么要集中 ──
 * 路由守卫每次导航都会写 `document.title`，语言切换时也会写；
 * 如果只在启动时拼一次品牌名称，第一次路由跳转就会把它覆盖掉。
 */
export function resolvePageTitle(meta?: RouteMeta) {
  if (!meta) return '';

  return meta.i18nKey ? $t(meta.i18nKey) : meta.title || '';
}

export function applyDocumentTitle(meta?: RouteMeta) {
  const pageTitle = resolvePageTitle(meta);
  const appName = brandingState.name.value || '工程宝管理后台';

  useTitle(pageTitle ? `${pageTitle} - ${appName}` : appName);
}
