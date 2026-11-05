-- =====================================================================
-- 029 已移除的主工长不再占用主工长唯一位
--
-- ── 问题 ──
-- 008 的主工长生成列条件只有 `deleted_at IS NULL`，没有判断 status：
--
--   IF(is_primary = 1 AND role = 'foreman' AND deleted_at IS NULL, project_id, NULL)
--
-- 于是「已移除（status='removed'）但仍 is_primary=1」的历史行继续占着
-- `uk_pm_primary_foreman`。服务层判断当前主工长时排除了 removed，
-- 因此会认为本项目没有主工长，邀请新工长时自动设 is_primary=1；
-- 插入撞上唯一键后，`ON DUPLICATE KEY UPDATE` 会更新那条已移除的旧行
-- （user_id 不同），新成员实际上没有插入，随后读成员关系得到 null，
-- 接口返回 500「Cannot read properties of null (reading 'id')」。
--
-- ── 修正 ──
-- 与 025 的主业主生成列保持一致：只有 pending / active 才占用唯一位。
-- 先删索引，再改生成列，最后重建索引。
-- =====================================================================

ALTER TABLE `project_member`
  DROP INDEX `uk_pm_primary_foreman`;

ALTER TABLE `project_member`
  MODIFY COLUMN `primary_foreman_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      IF(`is_primary` = 1
         AND `role` = 'foreman'
         AND `status` IN ('pending', 'active')
         AND `deleted_at` IS NULL,
         `project_id`, NULL)
    ) STORED
    COMMENT '仅用于唯一索引，实现「一个项目最多 1 名主工长」的条件唯一';

ALTER TABLE `project_member`
  ADD UNIQUE KEY `uk_pm_primary_foreman` (`primary_foreman_key`);
