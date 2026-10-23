import { request } from '../request';
import type { PageResult } from './project';

export type TenantStatus = 'active' | 'suspended' | 'archived';

export interface TenantUsage {
  projectCount: number;
  adminCount: number;
}

export interface TenantRegion {
  provinceCode: string;
  provinceName: string;
  cityCode: string | null;
  cityName: string | null;
}

export interface TenantItem {
  id: number;
  name: string;
  code: string;
  status: TenantStatus;
  statusLabel: string;
  plan: string | null;
  maxProjects: number;
  maxAdminUsers: number;
  trialEndsAt: string | null;
  expiresAt: string | null;
  /** 已过到期时间但还没被改成 suspended */
  expired: boolean;
  contactName: string | null;
  contactPhone: string | null;
  remark: string | null;
  /** 平台运营统计用的省 / 市；历史租户可能为 null */
  region: TenantRegion | null;
  regionLabel: string | null;
  usage: TenantUsage;
  createdAt: string;
  updatedAt: string;
}

export interface TenantListParams {
  page?: number;
  pageSize?: number;
  status?: TenantStatus;
  keyword?: string;
}

export interface TenantCreateInput {
  name: string;
  code: string;
  plan?: string;
  maxProjects?: number;
  maxAdminUsers?: number;
  trialEndsAt?: string;
  /** 纯日期按当天结束理解（后端会补 23:59:59） */
  expiresAt?: string;
  contactName?: string;
  contactPhone?: string;
  remark?: string;
  /** 新建租户必填；名称由后端按代码派生 */
  provinceCode: string;
  cityCode: string;
  owner: {
    username: string;
    password: string;
  };
}

export interface TenantUpdateInput {
  plan?: string;
  maxProjects?: number;
  maxAdminUsers?: number;
  /** 显式传 null 表示清空（取消到期时间 = 长期有效） */
  trialEndsAt?: string | null;
  expiresAt?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  remark?: string | null;
  /** 省、市必须成对传；都传 null 表示清空 */
  provinceCode?: string | null;
  cityCode?: string | null;
}

export interface TenantProvisionResult {
  tenant: TenantItem;
  owner: {
    id: number;
    username: string;
    mustChangePassword: boolean;
  };
  defaultTemplateId: number;
  tenantCode: string;
}

export function fetchTenants(params: TenantListParams) {
  return request<PageResult<TenantItem>>({
    url: '/admin/platform/tenants',
    method: 'get',
    params
  });
}

export function fetchTenantDetail(id: number) {
  return request<TenantItem>({ url: `/admin/platform/tenants/${id}` });
}

export function fetchCreateTenant(data: TenantCreateInput) {
  return request<TenantProvisionResult>({
    url: '/admin/platform/tenants',
    method: 'post',
    data
  });
}

export function fetchUpdateTenant(id: number, data: TenantUpdateInput) {
  return request<TenantItem>({
    url: `/admin/platform/tenants/${id}`,
    method: 'put',
    data
  });
}

export function fetchUpdateTenantStatus(
  id: number,
  data: { status: TenantStatus; reason?: string }
) {
  return request<TenantItem>({
    url: `/admin/platform/tenants/${id}/status`,
    method: 'put',
    data
  });
}
