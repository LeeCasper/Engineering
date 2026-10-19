import { request } from '../request';

export interface ContentPageSummary {
  pageKey: string;
  label: string;
  required: boolean;
  title: string;
  version: string | null;
  publishedAt: string | null;
  contentLength: number;
  exists: boolean;
  updatedAt: string | null;
}

export interface ContentPageDetail {
  pageKey: string;
  label: string;
  required: boolean;
  title: string;
  content: string | null;
  version: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface ContentPageInput {
  title: string;
  content?: string;
  version?: string;
  publish: boolean;
}

export function fetchContentPages() {
  return request<{ list: ContentPageSummary[] }>({ url: '/admin/contents' });
}

export function fetchContentPage(pageKey: string) {
  return request<ContentPageDetail>({ url: `/admin/contents/${pageKey}` });
}

export function fetchSaveContentPage(pageKey: string, data: ContentPageInput) {
  return request<ContentPageDetail>({
    url: `/admin/contents/${pageKey}`,
    method: 'put',
    data
  });
}
