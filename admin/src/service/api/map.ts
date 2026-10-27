import { request } from '../request';

/**
 * 管理端地图接口。
 *
 * 所有地图能力都由后端代理（静态地图也只返回 base64 data URL），
 * 前端不接触 AMap Key，也不加载任何地图 JS SDK。
 */

export interface MapCoordinate {
  longitude: string;
  latitude: string;
}

export interface MapGeocodeResult {
  found: boolean;
  reason?: 'not_found' | 'unavailable';
  address: string;
  longitude: string | null;
  latitude: string | null;
  cached: boolean;
}

export interface MapReverseResult {
  found: boolean;
  address: string | null;
  longitude: string;
  latitude: string;
}

export interface MapStaticBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface MapStaticResult {
  available: boolean;
  message?: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  zoom?: number;
  scale?: 1 | 2;
  center?: MapCoordinate;
  bounds?: MapStaticBounds;
  cached?: boolean;
}

export interface MapStaticParams extends MapCoordinate {
  zoom: number;
  width: number;
  height: number;
  scale?: 1 | 2;
}

/** 地址 → GCJ-02 坐标；未命中 / 未配置 Key 时返回 found:false，而不是 HTTP 错误 */
export function fetchAdminMapGeocode(address: string) {
  return request<MapGeocodeResult>({
    url: '/admin/maps/geocode',
    method: 'get',
    params: { address }
  });
}

/** 坐标 → 文字地址（地图选点后「填入地址」） */
export function fetchAdminMapReverseGeocode(params: MapCoordinate) {
  return request<MapReverseResult>({
    url: '/admin/maps/reverse-geocode',
    method: 'get',
    params
  });
}

/** 静态地图预览；失败时 available:false，由表单降级为手工坐标 */
export function fetchAdminMapStatic(params: MapStaticParams) {
  return request<MapStaticResult>({
    url: '/admin/maps/static',
    method: 'get',
    params
  });
}
