import { request } from '../request';
import type { PageResult } from './project';

export interface TemplateListItem {
  id: number;
  name: string;
  isDefault: boolean;
  stageCount: number;
  itemCount: number;
  referencingProjectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateItem {
  id?: number;
  name: string;
  weight?: string | number | null;
  /** 默认验收项清单，生成项目验收单时带入 */
  checklist: string[];
}

export interface TemplateStage {
  id?: number;
  name: string;
  planDays: number;
  weight?: string | number | null;
  items: TemplateItem[];
}

export interface TemplateDetail {
  id: number;
  name: string;
  isDefault: boolean;
  referencingProjectCount: number;
  affectsExistingProjects: boolean;
  stages: TemplateStage[];
}

export interface TemplateInput {
  name: string;
  isDefault: boolean;
  stages: Array<{
    name: string;
    planDays: number;
    weight?: string | number | null;
    items: Array<{
      name: string;
      weight?: string | number | null;
      checklist: string[];
    }>;
  }>;
}

export function fetchTemplateList(
  params: { page?: number; pageSize?: number; keyword?: string; onlyDefault?: boolean } = {}
) {
  return request<PageResult<TemplateListItem>>({
    url: '/admin/stage-templates',
    method: 'get',
    params
  });
}

export function fetchTemplateDetail(id: number) {
  return request<TemplateDetail>({ url: `/admin/stage-templates/${id}` });
}

export function fetchCreateTemplate(data: TemplateInput) {
  return request<{ id: number }>({
    url: '/admin/stage-templates',
    method: 'post',
    data
  });
}

export function fetchUpdateTemplate(id: number, data: TemplateInput) {
  return request<{ id: number; referencingProjectCount: number }>({
    url: `/admin/stage-templates/${id}`,
    method: 'put',
    data
  });
}

export function fetchDuplicateTemplate(id: number, name: string) {
  return request<{ id: number; name: string }>({
    url: `/admin/stage-templates/${id}/duplicate`,
    method: 'post',
    data: { name }
  });
}

export function fetchDeleteTemplate(id: number) {
  return request<null>({ url: `/admin/stage-templates/${id}`, method: 'delete' });
}

export function fetchSetDefaultTemplate(id: number) {
  return request<{ id: number }>({
    url: `/admin/stage-templates/${id}/default`,
    method: 'put'
  });
}
