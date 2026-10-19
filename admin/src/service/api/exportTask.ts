import { request } from '../request';
import type { PageResult } from './project';

export type ExportStatus = 'pending' | 'running' | 'success' | 'failed';

export interface ExportTask {
  id: number;
  status: ExportStatus;
  statusLabel: string;
  rowCount: number | null;
  downloadPath: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function fetchExports(params: { page?: number; pageSize?: number } = {}) {
  return request<PageResult<ExportTask>>({
    url: '/admin/exports',
    method: 'get',
    params
  });
}

export function fetchDownloadExport(id: number) {
  return request<Blob, 'blob'>({
    url: `/admin/exports/${id}/download`,
    method: 'get',
    responseType: 'blob'
  });
}
