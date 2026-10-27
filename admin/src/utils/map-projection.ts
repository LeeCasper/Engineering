/**
 * 静态地图的 Web Mercator 换算。
 *
 * 后端用同一套公式返回 bounds；前端拖拽时用 moveCenterByPixels 计算新中心。
 * 这里**只处理 CSS 像素**：scale=2 只影响图片像素密度，不影响地理覆盖范围。
 */

const WORLD_AT_ZOOM1 = 256;
// 与服务端一致：高德静态地图 zoom=16 的覆盖范围等同标准 Web Mercator 17
const STATIC_MAP_ZOOM_OFFSET = 1;
export const MAX_MERCATOR_LAT = 85.0511287798066;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lngLatToMercator(longitude: number, latitude: number, zoom: number) {
  const worldSize = WORLD_AT_ZOOM1 * 2 ** (zoom + STATIC_MAP_ZOOM_OFFSET);
  const x = ((longitude + 180) / 360) * worldSize;
  const rad = (clamp(latitude, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) * Math.PI) / 180;
  const y = (0.5 - Math.log((1 + Math.sin(rad)) / (1 - Math.sin(rad))) / (4 * Math.PI)) * worldSize;
  return { x, y, worldSize };
}

function mercatorToLngLat(x: number, y: number, zoom: number) {
  const worldSize = WORLD_AT_ZOOM1 * 2 ** (zoom + STATIC_MAP_ZOOM_OFFSET);
  const longitude = (x / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / worldSize;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

  return {
    longitude: clamp(longitude, -180, 180),
    latitude: clamp(latitude, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)
  };
}

/** 把拖拽的 CSS 像素位移换算成新的地图中心 */
export function moveCenterByPixels(
  center: { longitude: number; latitude: number },
  dxCss: number,
  dyCss: number,
  zoom: number
) {
  const { x, y } = lngLatToMercator(center.longitude, center.latitude, zoom);
  // 向右拖地图 → 中心往西；向下拖 → 中心往北
  return mercatorToLngLat(x - dxCss, y - dyCss, zoom);
}

/** 与后端一致的静态地图可视范围；主要给调试 / 测试使用 */
export function staticMapBounds(
  center: { longitude: number; latitude: number },
  zoom: number,
  width: number,
  height: number
) {
  const { x, y } = lngLatToMercator(center.longitude, center.latitude, zoom);
  return {
    west: mercatorToLngLat(x - width / 2, y, zoom).longitude,
    east: mercatorToLngLat(x + width / 2, y, zoom).longitude,
    north: mercatorToLngLat(x, y - height / 2, zoom).latitude,
    south: mercatorToLngLat(x, y + height / 2, zoom).latitude
  };
}

/** 坐标落库 / 提交统一 7 位小数字符串，禁止把 Number 写回业务对象 */
export function toCoordinateString(value: number) {
  return Number(value).toFixed(7);
}
