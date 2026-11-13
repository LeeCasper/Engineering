import { request } from '../request';
import type { PageResult } from './project';

export type AdminRole = 'owner' | 'admin';
export type AdminStatus = 'active' | 'disabled';

export interface AdminAccount {
  id: number;
  username: string;
  role: AdminRole;
  status: AdminStatus;
  mustChangePassword: boolean;
  createdBy: number | null;
  createdAt: string;
}

export interface AccountListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  role?: AdminRole;
  status?: AdminStatus;
}

export function fetchAccounts(params: AccountListParams) {
  return request<PageResult<AdminAccount>>({
    url: '/admin/admin-users',
    method: 'get',
    params
  });
}

export function fetchCreateAccount(data: { username: string; password: string; role: AdminRole }) {
  return request<AdminAccount>({
    url: '/admin/admin-users',
    method: 'post',
    data
  });
}

/** 编辑基本信息。admin_user 只有用户名这一项可改 */
export function fetchUpdateAccount(id: number, username: string) {
  return request<AdminAccount>({
    url: `/admin/admin-users/${id}`,
    method: 'put',
    data: { username }
  });
}

export function fetchUpdateAccountRole(id: number, role: AdminRole) {
  return request<{ id: number; role: AdminRole }>({
    url: `/admin/admin-users/${id}/role`,
    method: 'put',
    data: { role }
  });
}

/** 软删除：账号不可登录，审计链保留，用户名可重新使用 */
export function fetchDeleteAccount(id: number) {
  return request<{ id: number }>({
    url: `/admin/admin-users/${id}`,
    method: 'delete'
  });
}

export function fetchUpdateAccountStatus(id: number, status: AdminStatus) {
  return request<{ id: number; status: AdminStatus }>({
    url: `/admin/admin-users/${id}/status`,
    method: 'put',
    data: { status }
  });
}

export function fetchResetAccountPassword(id: number, newPassword: string) {
  return request<{ id: number }>({
    url: `/admin/admin-users/${id}/password`,
    method: 'put',
    data: { newPassword }
  });
}

export function fetchGrantedProjects(id: number) {
  return request<{ projectIds: number[] }>({
    url: `/admin/admin-users/${id}/projects`
  });
}

export function fetchGrantProjects(id: number, projectIds: number[]) {
  return request<{ id: number }>({
    url: `/admin/admin-users/${id}/projects`,
    method: 'post',
    data: { projectIds }
  });
}
