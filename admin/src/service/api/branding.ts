import { request } from '../request';

export interface BrandingLogoResult {
  url: string;
  key: string;
  sizeBytes: number;
}

/** 平台运营上传小程序 Logo（multipart，字段名 logo） */
export function uploadBrandingLogo(file: File) {
  const form = new FormData();
  form.append('logo', file);

  return request<BrandingLogoResult>({
    url: '/admin/platform/branding/logo',
    method: 'post',
    data: form,
    // 请求实例默认是 application/json；multipart 必须显式覆盖，
    // 否则 FormData 会被当成 JSON 序列化，后端拿不到文件字段。
    headers: { 'Content-Type': 'multipart/form-data' }
  });
}

export interface AdminBrandingResult {
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
}

/** 管理后台品牌：登录前公开读取（/branding/admin） */
export function fetchAdminBranding() {
  return request<AdminBrandingResult>({
    url: '/branding/admin',
    method: 'get',
    // 品牌是启动增强项：接口慢/挂了不能把登录页拖住
    timeout: 2500
  });
}

/** 平台运营上传管理后台 Logo（multipart，字段名 logo） */
export function uploadAdminLogo(file: File) {
  const form = new FormData();
  form.append('logo', file);

  return request<BrandingLogoResult>({
    url: '/admin/platform/branding/admin-logo',
    method: 'post',
    data: form,
    headers: { 'Content-Type': 'multipart/form-data' }
  });
}

/** 平台运营上传浏览器图标（multipart，字段名 favicon，ICO / PNG） */
export function uploadAdminFavicon(file: File) {
  const form = new FormData();
  form.append('favicon', file);

  return request<BrandingLogoResult>({
    url: '/admin/platform/branding/favicon',
    method: 'post',
    data: form,
    headers: { 'Content-Type': 'multipart/form-data' }
  });
}
