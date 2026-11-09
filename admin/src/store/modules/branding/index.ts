import { defineStore } from 'pinia';
import { SetupStoreId } from '@/enum';
import { fetchAdminBranding } from '@/service/api/branding';
import { brandingState } from '@/utils/branding-state';

const DEFAULT_NAME = import.meta.env.VITE_APP_TITLE || '工程宝管理后台';

/**
 * 管理后台品牌（名称 / Logo / 浏览器图标）。
 *
 * 服务端 `/branding/admin` 是公开接口；登录页在拿到 token 之前就要显示品牌，
 * 因此不能依赖 auth store。加载失败时保持内置默认值，不影响登录。
 */
export const useBrandingStore = defineStore(SetupStoreId.Branding, () => {
  // 与标题工具 / 展示组件共用同一组 ref，避免在 router 守卫里 import 本 store
  const { name, logoUrl, faviconUrl } = brandingState;

  let loaded = false;
  let loading: Promise<void> | null = null;

  /**
   * 更新页签图标。
   * 优先用单独的 favicon，未配置时退回上传的后台 Logo；
   * 两者都没有则保留 index.html 里的内置 /favicon.svg。
   */
  function applyFavicon(url: string) {
    if (!url) return;

    let link =
      document.querySelector<HTMLLinkElement>('#app-favicon') ??
      document.querySelector<HTMLLinkElement>('link[rel~="icon"]');

    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }

    const path = url.split('?')[0].toLowerCase();
    link.href = url;
    link.type = path.endsWith('.ico')
      ? 'image/x-icon'
      : path.endsWith('.svg')
        ? 'image/svg+xml'
        : 'image/png';
  }

  async function load(force = false) {
    if (loaded && !force) return;
    if (loading) return loading;

    loading = (async () => {
      try {
        const { data, error } = await fetchAdminBranding();
        if (error || !data) return;

        name.value = data.name || DEFAULT_NAME;
        logoUrl.value = data.logoUrl || '';
        faviconUrl.value = data.faviconUrl || '';
        // 只跟随后台上传的 favicon；没配就回到内置 /favicon.svg，
        // 不拿 Logo 顶替，避免宽版 Logo 被裁成奇怪的页签图标。
        // 传默认值也覆盖了「清空图标后当前会话仍显示旧图标」的情况。
        applyFavicon(faviconUrl.value || '/favicon.svg');
      } catch {
        // 品牌是增强信息；加载失败时保持默认，不阻断应用启动
      } finally {
        loaded = true;
        loading = null;
      }
    })();

    return loading;
  }

  return {
    name,
    logoUrl,
    faviconUrl,
    load
  };
});
