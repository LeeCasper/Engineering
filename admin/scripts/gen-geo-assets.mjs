/**
 * 生成平台数据看板使用的地区数据。
 *
 * 数据来源：阿里云 DataV GeoAtlas（https://geo.datav.aliyun.com/areas_v3/bound/）。
 * 内部管理后台使用；若将来公开展示，需要另行确认标准地图/审图号合规要求。
 *
 * 用法：node scripts/gen-geo-assets.mjs
 *
 * 产物：
 *   src/assets/geo/china.json            全国省界
 *   src/assets/geo/china-cities.json     省 / 市树 + 中心点（表单、看板回退列表）
 *   public/geo/provinces/{adcode}.json   非直辖省级城市边界（按需加载）
 *   ../server/src/data/regions.json      后端校验使用的省 / 市代码与名称
 *
 * 生成文件不要手改；数据源更新后重新执行本脚本。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(here, '..');
const repoRoot = join(adminRoot, '..');

const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';
const CHINA_URL = `${BASE}/100000_full.json`;
const SOURCE_DATE = new Date().toISOString().slice(0, 10);

/** 直辖市、港澳台：没有“地级市”层级，城市即省级本身 */
const DIRECT_CITY_PROVINCES = new Set(['110000', '120000', '310000', '500000', '710000', '810000', '820000']);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function centerOf(feature) {
  const props = feature.properties || {};
  return props.center || props.centroid || [];
}

function isSixDigitCode(value) {
  return /^\d{6}$/.test(String(value || ''));
}

async function main() {
  const china = await fetchJson(CHINA_URL);
  const provinces = china.features
    .filter(feature => isSixDigitCode(feature.properties?.adcode) && feature.properties?.name)
    .map(feature => ({
      code: String(feature.properties.adcode),
      name: String(feature.properties.name),
      center: centerOf(feature),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  if (!provinces.length) throw new Error('全国地图没有解析出任何省级行政区');

  const provinceDir = join(adminRoot, 'public/geo/provinces');
  await mkdir(provinceDir, { recursive: true });
  await mkdir(join(adminRoot, 'src/assets/geo'), { recursive: true });
  await mkdir(join(repoRoot, 'server/src/data'), { recursive: true });

  const citiesByProvince = [];
  let provinceMapCount = 0;
  let cityCount = 0;

  for (const province of provinces) {
    let cities = [];

    if (!DIRECT_CITY_PROVINCES.has(province.code)) {
      try {
        const geo = await fetchJson(`${BASE}/${province.code}_full.json`);
        cities = geo.features
          .filter(feature => feature.properties?.level === 'city' && isSixDigitCode(feature.properties?.adcode))
          .map(feature => ({
            code: String(feature.properties.adcode),
            name: String(feature.properties.name),
            center: centerOf(feature),
          }))
          .sort((a, b) => a.code.localeCompare(b.code));

        if (cities.length) {
          await writeFile(
            join(provinceDir, `${province.code}.json`),
            JSON.stringify(geo),
            'utf8'
          );
          provinceMapCount += 1;
        }
      } catch (err) {
        console.warn(`[geo] ${province.name} ${province.code} 城市边界获取失败，按直辖市处理：${err.message}`);
        cities = [];
      }
    }

    // 直辖市、港澳台、或省级地图不可用时：省即城市
    if (!cities.length) {
      cities = [{ code: province.code, name: province.name, center: province.center }];
    }

    for (const city of cities) {
      if (!city.code.startsWith(province.code.slice(0, 2))) {
        throw new Error(`城市代码不属于省份：${province.code} / ${city.code}`);
      }
    }

    citiesByProvince.push({ ...province, cities });
    cityCount += cities.length;
  }

  const adminRegions = citiesByProvince.map(province => ({
    code: province.code,
    name: province.name,
    center: province.center,
    directCity: DIRECT_CITY_PROVINCES.has(province.code),
    cities: province.cities,
  }));

  const serverRegions = citiesByProvince.map(province => ({
    code: province.code,
    name: province.name,
    cities: province.cities.map(city => ({ code: city.code, name: city.name })),
  }));

  await writeFile(join(adminRoot, 'src/assets/geo/china.json'), JSON.stringify(china), 'utf8');
  await writeFile(
    join(adminRoot, 'src/assets/geo/china-cities.json'),
    JSON.stringify(adminRegions),
    'utf8'
  );
  await writeFile(
    join(repoRoot, 'server/src/data/regions.json'),
    JSON.stringify(serverRegions),
    'utf8'
  );

  const readme = `# 地图与地区数据

本目录 / \`public/geo/\` 下的地图数据由 \`scripts/gen-geo-assets.mjs\` 生成，**不要手改**。

- 数据来源：阿里云 DataV GeoAtlas
  - 全国：\`${CHINA_URL}\`
  - 省级：\`${BASE}/{adcode}_full.json\`
- 生成日期：${SOURCE_DATE}
- 生成命令：\`node scripts/gen-geo-assets.mjs\`
- 产物：
  - \`src/assets/geo/china.json\`：全国省界
  - \`src/assets/geo/china-cities.json\`：省 / 市树 + 中心点
  - \`public/geo/provinces/*.json\`：非直辖省级城市边界
  - \`../server/src/data/regions.json\`：后端地区校验数据

直辖市、香港、澳门、台湾按“省即城市”处理；其余省份从省级边界中提取地级行政区。

> 注意：DataV GeoAtlas 适合内部管理后台使用，不等同于经过审图的标准地图。
> 若该看板将来公开展示，请先确认标准地图/审图号合规要求，并保留数据来源说明。
`;

  await writeFile(join(adminRoot, 'src/assets/geo/README.md'), readme, 'utf8');

  console.log(
    JSON.stringify(
      {
        provinces: provinces.length,
        cities: cityCount,
        provinceMaps: provinceMapCount,
        sourceDate: SOURCE_DATE,
      },
      null,
      2
    )
  );
}

main().catch(err => {
  console.error('[geo] 生成失败：', err);
  process.exitCode = 1;
});
