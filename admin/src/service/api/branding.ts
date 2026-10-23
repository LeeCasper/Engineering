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
