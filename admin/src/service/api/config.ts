import { request } from '../request';

export type ConfigType = 'int' | 'ratio' | 'enum' | 'string';

export interface SysConfigItem {
  key: string;
  label: string;
  requirement: string;
  type: ConfigType;
  unit: string | null;
  note: string | null;
  isDefault: boolean;
  value: string;
  updatedAt: string | null;
  updatedBy: number | null;
  /** false 表示对应功能尚未交付，改完不会立即生效 */
  effective: boolean;
  min: number | null;
  max: number | null;
  allowed: string[] | null;
  maxLength: number | null;
}

export function fetchConfigs() {
  return request<{ list: SysConfigItem[] }>({ url: '/admin/sys-configs' });
}

export function fetchUpdateConfig(key: string, value: string) {
  return request<{ key: string; value: string; changed: boolean }>({
    url: `/admin/sys-configs/${encodeURIComponent(key)}`,
    method: 'put',
    data: { value }
  });
}
