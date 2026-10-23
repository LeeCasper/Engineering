import { request } from './request'

/**
 * 门锁密码（§4.8 / AC-K01 ~ AC-K16）。
 *
 * 这是全项目敏感级别最高的数据：响应里是明文密码。
 * 前端不做任何本地缓存，也不把返回值写进 storage / 日志。
 */

export function fetchDoorCodes(projectId) {
  return request({ url: `/projects/${projectId}/door-codes` })
}

export function createDoorCode(projectId, data) {
  return request({
    url: `/projects/${projectId}/door-codes`,
    method: 'POST',
    data,
  })
}

export function updateDoorCode(doorCodeId, data) {
  return request({
    url: `/door-codes/${doorCodeId}`,
    method: 'PUT',
    data,
  })
}

export function revokeDoorCode(doorCodeId) {
  return request({
    url: `/door-codes/${doorCodeId}/revoke`,
    method: 'POST',
  })
}

export function fetchDoorCodeAccessLog(projectId, { page = 1, pageSize = 20 } = {}) {
  return request({
    url: `/projects/${projectId}/door-codes/access-log?page=${page}&pageSize=${pageSize}`,
  })
}
