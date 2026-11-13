import { request } from '../request';

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type ProjectStatus = 'pending' | 'building' | 'finished' | 'archived';
export type MemberRole = 'foreman' | 'supervisor' | 'owner';

export interface ProjectListParams {
  page?: number;
  pageSize?: number;
  name?: string;
  address?: string;
  status?: ProjectStatus;
  foremanId?: number;
  /** 勾选导出：只导出这些项目；为空时按筛选条件导出全部 */
  ids?: number[];
  templateId?: number;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface ProjectListItem {
  id: number;
  name: string;
  address: string;
  /** 项目封面绝对地址；为空时前端显示内置占位图 */
  coverUrl: string | null;
  status: ProjectStatus;
  statusLabel: string;
  area: string | null;
  contractAmount: string;
  startDate: string;
  planEndDate: string;
  actualEndDate: string | null;
  templateId: number;
  progress: number;
  currentStageName: string | null;
  foreman: { userId: number; nickname: string | null; realName?: string | null } | null;
  isOverdue: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface StageItem {
  id: number;
  name: string;
  seq: number;
  weight: string | null;
  progress: number;
  status: string;
  planStart: string | null;
  planEnd: string | null;
}

export interface ProjectStage {
  id: number;
  name: string;
  seq: number;
  weight: string | null;
  status: string;
  gateStatus: string;
  progress: number;
  planStart: string | null;
  planEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  unlockedAt: string | null;
  settledAt: string | null;
  items: StageItem[];
}

export interface ProjectMember {
  id: number;
  userId: number;
  role: MemberRole;
  roleLabel: string;
  ownerType: 'primary' | 'temporary' | null;
  ownerTypeLabel: string | null;
  isPrimaryOwner: boolean;
  isPrimaryForeman: boolean;
  status: 'pending' | 'active' | 'removed';
  statusLabel: string;
  nickname: string | null;
  realName?: string | null;
  realNameVerified?: boolean;
  realNameStatus?: 'none' | 'pending' | 'verified' | 'failed';
  avatar: string | null;
  phoneMasked: string | null;
  invitedAt: string;
  confirmedAt: string | null;
  leftAt: string | null;
}

export interface PaymentNode {
  id: number;
  seq: number;
  name: string;
  amount: string;
  triggerType: 'manual' | 'stage_acceptance';
  triggerStageId: number | null;
  status: 'not_started' | 'unlocked' | 'paid' | 'confirmed';
  statusLabel: string;
  unlockedAt: string | null;
}

export interface MemberComposition {
  foremanCount: number;
  ownerCount: number;
  primaryForemanUserId: number | null;
  primaryForemanName: string | null;
  primaryOwnerUserId: number | null;
  primaryOwnerName: string | null;
  primaryOwnerActive: boolean;
  temporaryOwnerCount: number;
  meetsRequirement: boolean;
}

export interface ProjectDetail {
  id: number;
  name: string;
  address: string;
  coverUrl: string | null;
  status: ProjectStatus;
  statusLabel: string;
  area: string | null;
  contractAmount: string;
  startDate: string;
  planEndDate: string;
  actualEndDate: string | null;
  remark: string | null;
  longitude: string | null;
  latitude: string | null;
  needsCoordinates: boolean;
  templateId: number;
  createdBy: number;
  archivedAt: string | null;
  progress: number;
  isOverdue: boolean;
  stages: ProjectStage[];
  members: ProjectMember[];
  paymentNodes: PaymentNode[];
  memberComposition: MemberComposition;
  stagesTotal: number;
  paymentNodesTotal: string;
  [key: string]: any;
}

export interface CreateProjectInput {
  name: string;
  address: string;
  area?: string;
  contractAmount: string;
  startDate: string;
  planEndDate: string;
  templateId?: number;
  remark?: string;
  /** 封面绝对地址；传空字符串表示清除（编辑时） */
  coverUrl?: string;
  /** 地图选点结果（GCJ-02，7 位小数字符串）；必须成对出现 */
  longitude?: string;
  latitude?: string;
}

export interface ProjectCoverResult {
  url: string;
  key: string;
  sizeBytes: number;
}

/** 上传项目封面（multipart，字段名 cover）。返回的 url 再随创建 / 编辑提交 */
export function fetchUploadProjectCover(file: File) {
  const form = new FormData();
  form.append('cover', file);

  return request<ProjectCoverResult>({
    url: '/admin/projects/cover',
    method: 'post',
    data: form,
    // 与小程序 Logo 上传同理：不覆盖 Content-Type 会被当成 JSON 序列化
    headers: { 'Content-Type': 'multipart/form-data' }
  });
}

export type CoordinateSource = 'manual' | 'geocode' | 'hydrate' | 'none' | 'unchanged';

export interface InviteMemberInput {
  phone: string;
  role: MemberRole;
}

export interface BatchResult {
  total: number;
  successCount: number;
  failureCount: number;
  succeeded: number[];
  failures: Array<{ projectId: number; reason: string }>;
}

export interface PaymentNodeInput {
  name: string;
  amount: string;
  triggerType: 'manual' | 'stage_acceptance';
  triggerStageId?: number;
}

export interface StageInput {
  name: string;
  weight?: string | number | null;
  planStart?: string | null;
  planEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
}

export interface ItemInput {
  name: string;
  weight?: string | number | null;
  planStart?: string | null;
  planEnd?: string | null;
  checklist?: string[];
}

/** 项目列表（按当前账号的数据权限过滤） */
export function fetchProjectList(params: ProjectListParams) {
  return request<PageResult<ProjectListItem>>({
    url: '/admin/projects',
    method: 'get',
    params
  });
}

/** 工作台统计：与项目列表同一套数据权限口径 */
export interface ProjectStats {
  total: number;
  statusCounts: {
    pending: number;
    building: number;
    finished: number;
    archived: number;
  };
  overdue: number;
  pendingAcceptance: number;
  pendingInvitations: number;
  /** 本月新增：按 Asia/Shanghai 月初起算，排除软删项目 */
  newThisMonth: number;
}

export function fetchProjectStats() {
  return request<ProjectStats>({ url: '/admin/projects/stats' });
}

/** 项目详情：概览 + 阶段工序 + 成员 + 付款节点 */
export function fetchProjectDetail(id: number) {
  return request<ProjectDetail>({ url: `/admin/projects/${id}` });
}

export interface ProjectCompletionReport {
  available: boolean;
  status: 'none' | 'pending' | 'success' | 'failed';
  generatedAt: string | null;
  error: string | null;
  signedPath: string | null;
}

export function fetchProjectCompletionReport(id: number) {
  return request<ProjectCompletionReport>({ url: `/admin/projects/${id}/completion-report` });
}

export function fetchGenerateProjectCompletionReport(id: number, { refresh = false } = {}) {
  return request<ProjectCompletionReport>({
    url: `/admin/projects/${id}/completion-report${refresh ? '?refresh=1' : ''}`,
    method: 'post'
  });
}

export interface AdminAcceptanceReport {
  id: number;
  type: 'stage' | 'item';
  typeLabel: string;
  stageId: number | null;
  stageName: string | null;
  itemId: number | null;
  itemName: string | null;
  status: 'draft' | 'pending_supervisor' | 'pending_owner' | 'pending_rectify' | 'passed';
  statusLabel: string;
  round: number;
  resubmitCount: number;
  rejectCount: number;
  submitter: string | null;
  submittedAt: string | null;
  finishedAt: string | null;
  hasSignature: boolean;
  signatureMode: 'legacy' | 'provider';
  esignStatus: string | null;
  /** 报告编号：旧报告为 AC-{id}，新报告为 AC-{通过日期}-{项目}-{id} */
  reportNo: string | null;
  reportPdf: {
    status: 'pending' | 'success' | 'failed';
    error: string | null;
    signedPath: string | null;
  };
}

/** 验收列表筛选：pending = 非 passed 且非 pending_rectify（与服务端口径一致） */
export type AdminAcceptanceStatusFilter = 'passed' | 'pending' | 'rectify';
export type AdminAcceptanceTypeFilter = 'stage' | 'item';

export interface AdminAcceptanceReportQuery {
  page?: number;
  pageSize?: number;
  status?: AdminAcceptanceStatusFilter;
  type?: AdminAcceptanceTypeFilter;
  /** 匹配报告编号 / 阶段名 / 工序名 / 验收单 id / 提交人 */
  keyword?: string;
}

/** summary 按项目全量统计，不随筛选变化 */
export interface AdminAcceptanceReportSummary {
  total: number;
  passed: number;
  inProgress: number;
  reportReady: number;
}

/** AC-AD45：强制分页，默认 20、上限 50 */
export interface AdminAcceptanceReportList extends PageResult<AdminAcceptanceReport> {
  summary: AdminAcceptanceReportSummary;
}

export function fetchProjectAcceptanceReports(id: number, params: AdminAcceptanceReportQuery = {}) {
  return request<AdminAcceptanceReportList>({
    url: `/admin/projects/${id}/acceptances`,
    params
  });
}

export function fetchCreateProject(data: CreateProjectInput) {
  return request<{ id: number; needsCoordinates: boolean; coordinateSource: CoordinateSource }>({
    url: '/admin/projects',
    method: 'post',
    data
  });
}

export function fetchUpdateProject(id: number, data: Partial<CreateProjectInput>) {
  return request<{ id: number; needsCoordinates: boolean; coordinateSource: CoordinateSource }>({
    url: `/admin/projects/${id}`,
    method: 'put',
    data
  });
}

export function fetchSetCoordinates(id: number, data: { longitude: string; latitude: string }) {
  return request<{ id: number; longitude: string; latitude: string }>({
    url: `/admin/projects/${id}/coordinates`,
    method: 'put',
    data
  });
}

/** 状态流转。反向流转（如已完工 → 施工中）必须带 confirmReverse: true */
export function fetchChangeProjectStatus(
  id: number,
  status: ProjectStatus,
  confirmReverse = false
) {
  return request<{ id: number; from: string; to: string }>({
    url: `/admin/projects/${id}/status`,
    method: 'put',
    data: { status, confirmReverse }
  });
}

/** 归档（二次确认） */
export function fetchArchiveProject(id: number, confirm = true) {
  return request<{ id: number; status: string }>({
    url: `/admin/projects/${id}/archive`,
    method: 'post',
    data: { confirm }
  });
}

/** 恢复软删除（仅租户管理员） */
export function fetchRestoreProject(id: number) {
  return request<{ id: number; deleted_at: null }>({
    url: `/admin/projects/${id}/restore`,
    method: 'post'
  });
}

/** 软删除（仅租户管理员，二次确认） */
export function fetchDeleteProject(id: number, confirm = true) {
  return request<{ id: number; deleted: boolean }>({
    url: `/admin/projects/${id}`,
    method: 'delete',
    data: { confirm }
  });
}

/** 批量归档（单次最多 100 个，逐条返回成败） */
export function fetchBatchArchive(projectIds: number[]) {
  return request<BatchResult>({
    url: '/admin/projects/batch/archive',
    method: 'post',
    data: { projectIds, confirm: true }
  });
}

/** 批量分配工长（手机号邀请；已有工长的项目会被替换） */
export function fetchBatchAssign(projectIds: number[], phone: string) {
  return request<BatchResult>({
    url: '/admin/projects/batch/assign',
    method: 'post',
    data: { projectIds, phone }
  });
}

/**
 * 导出当前筛选条件下的项目列表。
 *
 * 服务端按行数决定同步（直接返回 xlsx）或异步（202 + JSON）。
 * 用 responseType=blob 拿原始字节；异步时响应体也是一段 JSON 的 Blob。
 */
export function fetchExportProjects(params: ProjectListParams) {
  return request<Blob, 'blob'>({
    url: '/admin/projects/export',
    method: 'get',
    params: {
      name: params.name,
      address: params.address,
      status: params.status,
      foremanId: params.foremanId,
      ids: params.ids && params.ids.length ? params.ids.join(',') : undefined
    },
    responseType: 'blob'
  });
}

export function fetchProjectMembers(id: number) {
  return request<{ members: ProjectMember[]; composition: MemberComposition }>({
    url: `/admin/projects/${id}/members`
  });
}

export interface MemberDirectoryParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  role?: MemberRole;
  projectId?: number;
}

/** 跨项目成员目录的一项：成员关系 + 所属项目 */
export interface MemberDirectoryItem extends ProjectMember {
  projectId: number;
  projectName: string;
  projectStatus: ProjectStatus;
}

export interface MemberDirectoryResult extends PageResult<MemberDirectoryItem> {
  roleCounts: { all: number; foreman: number; supervisor: number; owner: number };
}

/**
 * 跨项目成员目录（只读）。
 * 工长筛选下拉用它做远程搜索，不要拉全量 —— 成员关系会随项目数线性增长。
 */
export function fetchMemberDirectory(params: MemberDirectoryParams = {}) {
  return request<MemberDirectoryResult>({
    url: '/admin/members',
    method: 'get',
    params
  });
}

export function fetchInviteMember(id: number, data: InviteMemberInput) {
  return request<ProjectMember>({
    url: `/admin/projects/${id}/members`,
    method: 'post',
    data
  });
}

export function fetchSetPrimaryForeman(id: number, memberId: number) {
  return request<ProjectMember>({
    url: `/admin/projects/${id}/members/${memberId}/primary`,
    method: 'put'
  });
}

export function fetchRemoveMember(id: number, memberId: number) {
  return request<null>({
    url: `/admin/projects/${id}/members/${memberId}`,
    method: 'delete'
  });
}

export function fetchPaymentNodes(id: number) {
  return request<{
    nodes: PaymentNode[];
    contractAmount: string;
    nodesTotal: string;
    difference: string;
    mismatched: boolean;
  }>({ url: `/admin/projects/${id}/payment-nodes` });
}

export function fetchReplacePaymentNodes(id: number, nodes: PaymentNodeInput[]) {
  return request<{ nodes: PaymentNode[]; mismatched: boolean }>({
    url: `/admin/projects/${id}/payment-nodes`,
    method: 'put',
    data: { nodes }
  });
}

export function fetchUnlockPaymentNode(id: number, nodeId: number) {
  return request<PaymentNode>({
    url: `/admin/projects/${id}/payment-nodes/${nodeId}/unlock`,
    method: 'post'
  });
}

export function fetchAddStage(id: number, data: StageInput) {
  return request<ProjectStage>({
    url: `/admin/projects/${id}/stages`,
    method: 'post',
    data
  });
}

export function fetchUpdateStage(id: number, stageId: number, data: StageInput) {
  return request<ProjectStage>({
    url: `/admin/projects/${id}/stages/${stageId}`,
    method: 'put',
    data
  });
}

export function fetchDeleteStage(id: number, stageId: number) {
  return request<null>({
    url: `/admin/projects/${id}/stages/${stageId}`,
    method: 'delete'
  });
}

export function fetchAddItem(id: number, stageId: number, data: ItemInput) {
  return request<StageItem>({
    url: `/admin/projects/${id}/stages/${stageId}/items`,
    method: 'post',
    data
  });
}

export function fetchUpdateItem(id: number, itemId: number, data: ItemInput) {
  return request<StageItem>({
    url: `/admin/projects/${id}/items/${itemId}`,
    method: 'put',
    data
  });
}

export function fetchDeleteItem(id: number, itemId: number) {
  return request<null>({
    url: `/admin/projects/${id}/items/${itemId}`,
    method: 'delete'
  });
}
