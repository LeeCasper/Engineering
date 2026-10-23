import { request } from '../request';

export type ConfigType = 'int' | 'ratio' | 'enum' | 'string';

/** tenant=租户覆盖；platform=平台基础配置 */
export type ConfigScope = 'tenant' | 'platform';

export type ConfigSource = 'tenant' | 'platform' | 'default';

export interface SysConfigItem {
  key: string;
  label: string;
  requirement: string;
  type: ConfigType;
  unit: string | null;
  note: string | null;
  isDefault: boolean;
  /** 当前生效值的来源 */
  source: ConfigSource;
  /** 租户视角下：当前值是否继承自平台/出厂值 */
  inherited: boolean;
  /** 平台专属项（如微信订阅消息模板 ID），租户后台只读 */
  platformOnly: boolean;
  value: string;
  /** 平台基础值；平台视角为 null */
  platformValue: string | null;
  updatedAt: string | null;
  updatedBy: number | null;
  /** false 表示对应功能尚未交付，改完不会立即生效 */
  effective: boolean;
  min: number | null;
  max: number | null;
  allowed: string[] | null;
  maxLength: number | null;
}

function configBase(scope: ConfigScope) {
  return scope === 'platform' ? '/admin/platform/sys-configs' : '/admin/sys-configs';
}

export function fetchConfigs(scope: ConfigScope = 'tenant') {
  return request<{ list: SysConfigItem[] }>({ url: configBase(scope) });
}

export function fetchUpdateConfig(key: string, value: string, scope: ConfigScope = 'tenant') {
  return request<{ key: string; value: string; changed: boolean; source: ConfigSource }>({
    url: `${configBase(scope)}/${encodeURIComponent(key)}`,
    method: 'put',
    data: { value }
  });
}

/** 删除租户覆盖值，重新继承平台基础配置 */
export function fetchResetConfig(key: string) {
  return request<{ key: string; value: string; changed: boolean; source: ConfigSource }>({
    url: `/admin/sys-configs/${encodeURIComponent(key)}`,
    method: 'delete'
  });
}
