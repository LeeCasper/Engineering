import regionData from '@/assets/geo/china-cities.json';

export interface RegionCity {
  code: string;
  name: string;
  center?: number[];
}

export interface RegionProvince {
  code: string;
  name: string;
  center?: number[];
  directCity: boolean;
  cities: RegionCity[];
}

export interface RegionValue {
  provinceCode: string;
  provinceName: string;
  cityCode: string | null;
  cityName: string | null;
}

export interface RegionCascaderOption {
  value: string;
  label: string;
  children?: { value: string; label: string }[];
  [key: string]: unknown;
}

export const REGION_PROVINCES = regionData as RegionProvince[];

export const REGION_CASCADER_OPTIONS: RegionCascaderOption[] = REGION_PROVINCES.map(province => ({
  value: province.code,
  label: province.name,
  children: province.cities.map(city => ({ value: city.code, label: city.name }))
}));

export function findProvince(code?: string | null): RegionProvince | null {
  if (!code) return null;
  return REGION_PROVINCES.find(province => province.code === code) || null;
}

export function findCity(provinceCode?: string | null, cityCode?: string | null): RegionCity | null {
  const province = findProvince(provinceCode);
  if (!province || !cityCode) return null;
  return province.cities.find(city => city.code === cityCode) || null;
}

/**
 * 把 Cascader 的 [provinceCode, cityCode] 转成接口需要的一对代码。
 * 名称不在这里提交 —— 后端会按代码派生，避免代码与名称不一致。
 */
export function regionCodesFromValue(value?: string[] | null): {
  provinceCode?: string;
  cityCode?: string;
} {
  if (!value || value.length === 0) return {};
  return { provinceCode: value[0], cityCode: value[1] };
}

export function regionLabel(region?: RegionValue | null): string {
  if (!region) return '未设置';
  if (!region.cityCode || region.cityCode === region.provinceCode) return region.provinceName;
  return `${region.provinceName} / ${region.cityName}`;
}
