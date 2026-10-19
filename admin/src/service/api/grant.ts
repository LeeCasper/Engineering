import { request } from '../request';
import type { PageResult } from './project';

export interface PlatformGrant {
  id: number;
  tenantId: number;
  adminUserId: number;
  adminUsername: string | null;
  grantedBy: number;
  reason: string | null;
  expiresAt: string;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
  statusLabel: string;
  isActive: boolean;
  createdAt: string;
}

export interface GrantCreateInput {
  adminUsername: string;
  reason?: string;
  expiresAt: string;
}

export function fetchGrants(params: { page?: number; pageSize?: number } = {}) {
  return request<PageResult<PlatformGrant>>({
    url: '/admin/platform-grants',
    method: 'get',
    params
  });
}

export function fetchCreateGrant(data: GrantCreateInput) {
  return request<PlatformGrant>({
    url: '/admin/platform-grants',
    method: 'post',
    data
  });
}

export function fetchRevokeGrant(id: number) {
  return request<null>({
    url: `/admin/platform-grants/${id}`,
    method: 'delete'
  });
}
