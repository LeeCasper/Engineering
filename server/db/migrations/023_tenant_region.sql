-- =====================================================================
-- 023_tenant_region.sql —— 租户所在地区（平台运营统计）
-- =====================================================================
--
-- 平台需要按地区查看租户开通情况。地区是运营统计维度，不参与计费身份；
-- 已有租户允许暂时为 NULL，看板会把它们归入「未分配地区」，而不是静默丢弃。
--
-- 代码是事实来源：province_code / city_code 来自 DataV GeoAtlas 的行政区划
-- 代码（GB/T 2260 六位），名称由服务端从内置 regions.json 派生后写入，
-- 避免前端提交代码与名称不一致。
--
-- 直辖市、香港、澳门、台湾：city_code = province_code，城市名称等于省级名称。

ALTER TABLE `tenant`
  ADD COLUMN `province_code` CHAR(6) NULL
    COMMENT '省级行政区划代码；NULL=未分配地区' AFTER `remark`,
  ADD COLUMN `province_name` VARCHAR(50) NULL
    COMMENT '省级名称，由服务端按代码派生' AFTER `province_code`,
  ADD COLUMN `city_code` CHAR(6) NULL
    COMMENT '地级行政区划代码；直辖市/港澳台等于省级代码' AFTER `province_name`,
  ADD COLUMN `city_name` VARCHAR(50) NULL
    COMMENT '地级名称，由服务端按代码派生' AFTER `city_code`,
  ADD KEY `idx_tenant_region` (`province_code`, `city_code`);
