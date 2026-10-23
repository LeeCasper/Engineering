import { request } from '../request';

export type ContentScope = 'tenant' | 'platform';

export interface ContentPageSummary {
  pageKey: string;
  label: string;
  required: boolean;
  title: string;
  version: string | null;
  publishedAt: string | null;
  contentLength: number;
  exists: boolean;
  /** 本租户未发布，但平台已有可继承的已发布版本 */
  inheritsPlatform: boolean;
  platformPublishedAt: string | null;
  /** C 端实际会读到的版本来源 */
  effectiveSource: 'tenant' | 'platform' | 'none';
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

function contentBase(scope: ContentScope) {
  return scope === 'platform' ? '/admin/platform/contents' : '/admin/contents';
}

export function fetchContentPages(scope: ContentScope = 'tenant') {
  return request<{ list: ContentPageSummary[] }>({ url: contentBase(scope) });
}

export function fetchContentPage(pageKey: string, scope: ContentScope = 'tenant') {
  return request<ContentPageDetail>({ url: `${contentBase(scope)}/${pageKey}` });
}

export function fetchSaveContentPage(
  pageKey: string,
  data: ContentPageInput,
  scope: ContentScope = 'tenant'
) {
  return request<ContentPageDetail>({
    url: `${contentBase(scope)}/${pageKey}`,
    method: 'put',
    data
  });
}
