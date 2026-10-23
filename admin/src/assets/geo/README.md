# 地图与地区数据

本目录 / `public/geo/` 下的地图数据由 `scripts/gen-geo-assets.mjs` 生成，**不要手改**。

- 数据来源：阿里云 DataV GeoAtlas
  - 全国：`https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json`
  - 省级：`https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json`
- 生成日期：2026-10-22
- 生成命令：`node scripts/gen-geo-assets.mjs`
- 产物：
  - `src/assets/geo/china.json`：全国省界
  - `src/assets/geo/china-cities.json`：省 / 市树 + 中心点
  - `public/geo/provinces/*.json`：非直辖省级城市边界
  - `../server/src/data/regions.json`：后端地区校验数据

直辖市、香港、澳门、台湾按“省即城市”处理；其余省份从省级边界中提取地级行政区。

> 注意：DataV GeoAtlas 适合内部管理后台使用，不等同于经过审图的标准地图。
> 若该看板将来公开展示，请先确认标准地图/审图号合规要求，并保留数据来源说明。
