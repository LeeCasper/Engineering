import { request } from '../request';

/**
 * 考察统计（B-4.6）与项目级签到阈值（B-5.1）。
 *
 * 时间字段全部用 `YYYY-MM-DD` 传：后端按「开始 00:00 至结束次日 00:00」的开区间
 * 统计，前端不要自己拼带时分秒的字符串 —— 两边的边界算法一旦分叉，
 * 结束当天的记录会整片漏掉。
 */

export interface VisitStatsParams {
  startDate?: string;
  endDate?: string;
  /** 签到人 id（后端字段名沿用需求里的「工长」，统计里也包含监理） */
  foremanId?: number;
  projectId?: number;
  page?: number;
  pageSize?: number;
}

export interface VisitSummary {
  visitCount: number;
  abnormalCount: number;
  projectCount: number;
  /** 百分比数值，例如 33.3 表示 33.3% */
  abnormalRate: number;
}

export interface VisitPersonStat extends VisitSummary {
  userId: number;
  name: string;
  role: string | null;
  roleLabel: string;
}

export interface VisitStatItem {
  id: number;
  projectId: number;
  projectName: string;
  userId: number;
  userName: string;
  role: string | null;
  roleLabel: string;
  checkinAt: string;
  latitude: number | null;
  longitude: number | null;
  distanceM: number;
  /** 判定时的阈值快照，改配置不会改写历史记录 */
  thresholdM: number;
  isAbnormal: boolean;
  abnormalReason: string | null;
  remark: string | null;
}

export interface VisitFilterOption {
  userId: number;
  name: string;
  role: string | null;
  roleLabel: string;
}

export interface VisitStatsResult {
  range: { startDate: string; endDate: string };
  summary: VisitSummary;
  byPerson: VisitPersonStat[];
  list: VisitStatItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  foremen: VisitFilterOption[];
  projects: Array<{ projectId: number; name: string }>;
  /** 统计口径说明，页面必须展示（§5.4） */
  caliber: string;
}

export function fetchVisitStats(params: VisitStatsParams) {
  return request<VisitStatsResult>({ url: '/admin/visit-stats', params });
}

export function fetchExportVisitStats(params: VisitStatsParams) {
  return request<Blob, 'blob'>({
    url: '/admin/visit-stats/export',
    method: 'get',
    params: {
      startDate: params.startDate,
      endDate: params.endDate,
      foremanId: params.foremanId,
      projectId: params.projectId
    },
    responseType: 'blob'
  });
}

/** 项目阈值配置：生效值 + 四层来源 + 清除覆盖后的回退目标 */
export interface VisitThresholdConfig {
  projectId: number;
  projectName: string;
  key: string;
  label: string;
  unit: string | null;
  note: string | null;
  min: number | null;
  max: number | null;
  /** 生效值 */
  value: string;
  /** project / tenant / platform / default */
  source: 'project' | 'tenant' | 'platform' | 'default';
  hasOverride: boolean;
  /** 项目自己配的值；未覆盖为 null */
  projectValue: string | null;
  /** 清除覆盖后会回到的值 */
  tenantValue: string;
  tenantSource: 'tenant' | 'platform' | 'default';
  platformValue: string | null;
  updatedAt: string | null;
  updatedBy: number | null;
  effective: boolean;
}

export function fetchProjectVisitThreshold(projectId: number) {
  return request<VisitThresholdConfig>({ url: `/admin/projects/${projectId}/visit-threshold` });
}

export function fetchUpdateProjectVisitThreshold(projectId: number, value: string) {
  return request<VisitThresholdConfig & { changed: boolean }>({
    url: `/admin/projects/${projectId}/visit-threshold`,
    method: 'put',
    data: { value }
  });
}

/** 清除项目覆盖，回到租户 / 平台配置 */
export function fetchResetProjectVisitThreshold(projectId: number) {
  return request<VisitThresholdConfig & { changed: boolean }>({
    url: `/admin/projects/${projectId}/visit-threshold`,
    method: 'delete'
  });
}
