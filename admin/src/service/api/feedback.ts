import { request } from '../request';
import type { PageResult } from './project';

export type FeedbackStatus = 'new' | 'processing' | 'resolved';

export interface FeedbackItem {
  id: number;
  userId: number;
  projectId: number | null;
  content: string;
  images: string[];
  contact: string | null;
  status: FeedbackStatus;
  statusLabel: string;
  reply: string | null;
  handledBy: number | null;
  handledAt: string | null;
  createdAt: string;
}

export interface FeedbackListParams {
  page?: number;
  pageSize?: number;
  status?: FeedbackStatus;
  projectId?: number;
  userId?: number;
}

export function fetchFeedbackList(params: FeedbackListParams) {
  return request<PageResult<FeedbackItem>>({
    url: '/admin/feedback',
    method: 'get',
    params
  });
}

export function fetchHandleFeedback(
  id: number,
  data: { status: 'processing' | 'resolved'; reply?: string }
) {
  return request<FeedbackItem>({
    url: `/admin/feedback/${id}`,
    method: 'put',
    data
  });
}
