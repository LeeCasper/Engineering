import { request } from '../request';
import type { PageResult } from './project';

export interface OperationLogFilterModule {
  module: string;
  label: string;
  actions: string[];
}

export interface OperationLog {
  id: number;
  operatorType: 'admin' | 'user' | 'system';
  operatorId: number | null;
  operatorName: string | null;
  action: string;
  module: string;
  targetType: string | null;
  targetId: number | null;
  projectId: number | null;
  projectName: string | null;
  detail: { before?: unknown; after?: unknown } | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface OperationLogParams {
  page?: number;
  pageSize?: number;
  module?: string;
  action?: string;
  operatorType?: 'admin' | 'user' | 'system';
  operatorId?: number;
  projectId?: number;
  from?: string;
  to?: string;
}

export interface LoginLog {
  id: number;
  adminUserId: number | null;
  username: string;
  loginAt: string;
  ip: string;
  result: 'success' | 'failed';
  failReason: string | null;
  authMethod?: 'password' | 'wechat';
}

export interface LoginLogParams {
  page?: number;
  pageSize?: number;
  username?: string;
  result?: 'success' | 'failed';
  adminUserId?: number;
}

export type LogScope = 'tenant' | 'platform';

export function fetchOperationLogFilters(scope: LogScope = 'tenant') {
  return request<{ modules: OperationLogFilterModule[] }>({
    url: scope === 'platform' ? '/admin/platform/logs/operation/filters' : '/admin/operation-logs/filters'
  });
}

export function fetchOperationLogs(params: OperationLogParams, scope: LogScope = 'tenant') {
  return request<PageResult<OperationLog>>({
    url: scope === 'platform' ? '/admin/platform/logs/operation' : '/admin/operation-logs',
    method: 'get',
    params
  });
}

export function fetchLoginLogs(params: LoginLogParams, scope: LogScope = 'tenant') {
  return request<PageResult<LoginLog>>({
    url: scope === 'platform' ? '/admin/platform/logs/login' : '/admin/login-logs',
    method: 'get',
    params
  });
}
