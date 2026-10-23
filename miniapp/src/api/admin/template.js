import { adminRequest } from './request'

/** 新建项目时选择阶段模板；模板编辑仍留在网页后台 */
export function fetchAdminTemplates({ keyword = '', page = 1, pageSize = 50 } = {}) {
  const params = [`page=${page}`, `pageSize=${pageSize}`]
  if (keyword) params.push(`keyword=${encodeURIComponent(keyword)}`)
  return adminRequest({ url: `/stage-templates?${params.join('&')}` })
}
