import { request } from '../request';
import type { PageResult } from './project';
import type { TenantItem, TenantStatus } from './platform';

export interface DashboardPlanCount {
  plan: string;
  count: number;
}

export interface DashboardSummary {
  tenantCount: number;
  activeCount: number;
  suspendedCount: number;
  archivedCount: number;
  newThisMonthCount: number;
  projectCount: number;
  adminCount: number;
  regionUnsetCount: number;
  planCounts: DashboardPlanCount[];
}

export interface DashboardRegionSummary {
  tenantCount: number;
  activeCount: number;
  suspendedCount: number;
  archivedCount: number;
  newThisMonthCount: number;
  projectCount: number;
  adminCount: number;
  planCounts: DashboardPlanCount[];
}

export interface DashboardUnassigned extends DashboardRegionSummary {}

export interface DashboardProvince extends DashboardRegionSummary {
  provinceCode: string;
  provinceName: string;
}

export interface DashboardCity extends DashboardRegionSummary {
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
}

export interface DashboardOverview {
  month: string;
  summary: DashboardSummary;
  provinces: DashboardProvince[];
  unassigned: DashboardUnassigned;
}

export interface DashboardScope {
  level: 'province' | 'city' | 'unassigned';
  provinceCode: string | null;
  provinceName: string | null;
  cityCode: string | null;
  cityName: string | null;
}

export interface DashboardRegion {
  month: string;
  scope: DashboardScope;
  summary: DashboardRegionSummary;
  cities: DashboardCity[];
  unassignedCity: DashboardRegionSummary | null;
}

export interface DashboardTenantParams {
  provinceCode?: string;
  cityCode?: string;
  unassigned?: boolean;
  status?: TenantStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export function fetchDashboardOverview() {
  return request<DashboardOverview>({ url: '/admin/platform/dashboard/overview' });
}

export function fetchDashboardRegion(params: {
  provinceCode?: string;
  cityCode?: string;
  unassigned?: boolean;
}) {
  return request<DashboardRegion>({
    url: '/admin/platform/dashboard/region',
    method: 'get',
    params: {
      ...params,
      // 后端 query 用 0/1；直接传 boolean 会被序列化成 "true"
      unassigned: params.unassigned ? '1' : undefined
    }
  });
}

export function fetchDashboardTenants(params: DashboardTenantParams) {
  return request<PageResult<TenantItem>>({
    url: '/admin/platform/dashboard/tenants',
    method: 'get',
    params: {
      ...params,
      unassigned: params.unassigned ? '1' : undefined
    }
  });
}
