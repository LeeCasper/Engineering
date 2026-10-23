-- =====================================================================
-- 020 考察计划：起点到第一站的里程与耗时
--
-- `route_plan_point.leg_distance` 的语义是「从上一站到本站」，首站没有上一站，
-- 因此首站为 NULL（007 的注释）。但「起点 → 第一站」是真实发生的一段路：
--   - 路线页要逐段显示里程与耗时（C-6.6）；
--   - AC-N05 要求总里程等于各分段之和 —— 少了首段，用户按列表相加会对不上。
--
-- 因此把首段单独快照到 route_plan 上，而不是改写 route_plan_point 的 NULL 语义。
-- =====================================================================

ALTER TABLE `route_plan`
  ADD COLUMN `origin_leg_distance` DECIMAL(10,2) NULL
    COMMENT '起点到第一站的里程（米）；地图服务降级时为 NULL'
    AFTER `total_duration`,
  ADD COLUMN `origin_leg_duration` INT UNSIGNED NULL
    COMMENT '起点到第一站的耗时（秒）；地图服务降级时为 NULL'
    AFTER `origin_leg_distance`;
