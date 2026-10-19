/** 金额展示：后端以 DECIMAL 字符串返回，前端不做浮点运算，只做千分位展示 */
export function formatMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '-';

  const raw = String(value);
  const [integer, decimal] = raw.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${sign}${grouped}${decimal === undefined ? '' : `.${decimal}`}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '-';

  // 后端 dateStrings=true，DATETIME 以字符串返回；只展示日期部分
  return String(value).slice(0, 10);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';

  return String(value).slice(0, 19);
}

export const PROJECT_STATUS_META: Record<string, { label: string; type: 'info' | 'primary' | 'success' | 'warning' | 'danger' }> = {
  pending: { label: '待开工', type: 'info' },
  building: { label: '施工中', type: 'primary' },
  finished: { label: '已完工', type: 'success' },
  archived: { label: '已归档', type: 'warning' }
};

export const GATE_STATUS_META: Record<string, { label: string; type: 'info' | 'primary' | 'success' | 'warning' | 'danger' }> = {
  locked: { label: '未解锁', type: 'info' },
  active: { label: '进行中', type: 'primary' },
  pending_acceptance: { label: '待验收', type: 'warning' },
  accepted: { label: '已验收', type: 'success' },
  disputed: { label: '有异议', type: 'danger' },
  settled: { label: '已结清', type: 'success' }
};

export const ROLE_LABELS: Record<string, string> = {
  platform: '平台运营',
  owner: '租户管理员',
  admin: '项目管理员',
  foreman: '工长',
  supervisor: '监理'
};

export const MEMBER_STATUS_META: Record<string, { label: string; type: 'info' | 'success' | 'danger' | 'warning' }> = {
  pending: { label: '待确认', type: 'warning' },
  active: { label: '已加入', type: 'success' },
  removed: { label: '已移除', type: 'danger' }
};

export const PAYMENT_STATUS_META: Record<string, { label: string; type: 'info' | 'success' | 'warning' | 'primary' }> = {
  not_started: { label: '未开始', type: 'info' },
  unlocked: { label: '已解锁', type: 'warning' },
  paid: { label: '已付款', type: 'primary' },
  confirmed: { label: '已确认', type: 'success' }
};
