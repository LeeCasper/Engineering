-- =====================================================================
-- 025 主业主与临时业主（需求文档 v2.12）
--
-- project_member.role 仍为 'owner'，两种业主共享全部普通能力；
-- owner_type 只在 role='owner' 时有值：
--   primary   = 主业主，唯一，不可改指/移除（账号注销除外）
--   temporary = 临时业主，可随时移除
--
-- 条件唯一索引：一个项目最多 1 名 pending/active 的主业主。
-- 与 008 的主工长键不同，这里的键必须包含 status —— 被拒绝/撤销的
-- pending 邀请要能释放主业主名额，否则项目会永久卡住。
-- =====================================================================

ALTER TABLE `project_member`
  ADD COLUMN `owner_type` ENUM('primary','temporary') NULL
    COMMENT '业主类型：primary=主业主（唯一），temporary=临时业主；非业主/已移除为 NULL'
    AFTER `is_primary`;

-- BACKFILL:BEGIN
-- 1) 存量 pending/active 业主先全部标为临时
UPDATE `project_member`
   SET `owner_type` = 'temporary'
 WHERE `role` = 'owner'
   AND `status` IN ('pending', 'active')
   AND `deleted_at` IS NULL;

-- 2) 每个项目最早加入（active）的业主成为主业主。
--    优先 active：一个陈旧的 pending 邀请不应抢走已确认业主的主业主身份。
UPDATE `project_member` pm
  JOIN (
    SELECT `project_id`, MIN(`id`) AS `id`
      FROM `project_member`
     WHERE `role` = 'owner'
       AND `status` = 'active'
       AND `deleted_at` IS NULL
     GROUP BY `project_id`
  ) pick ON pick.`id` = pm.`id`
   SET pm.`owner_type` = 'primary';

-- 3) 没有 active 业主的项目，取最早的 pending 邀请
UPDATE `project_member` pm
  JOIN (
    SELECT `project_id`, MIN(`id`) AS `id`
      FROM `project_member`
     WHERE `role` = 'owner'
       AND `status` = 'pending'
       AND `deleted_at` IS NULL
     GROUP BY `project_id`
  ) pick ON pick.`id` = pm.`id`
  LEFT JOIN (
    SELECT DISTINCT `project_id`
      FROM `project_member`
     WHERE `role` = 'owner'
       AND `status` = 'active'
       AND `deleted_at` IS NULL
  ) act ON act.`project_id` = pm.`project_id`
   SET pm.`owner_type` = 'primary'
 WHERE act.`project_id` IS NULL;
-- BACKFILL:END

ALTER TABLE `project_member`
  ADD COLUMN `primary_owner_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      IF(`owner_type` = 'primary'
         AND `role` = 'owner'
         AND `status` IN ('pending', 'active')
         AND `deleted_at` IS NULL,
         `project_id`, NULL)
    ) STORED
    COMMENT '仅用于唯一索引，实现「一个项目最多 1 名主业主」',
  ADD UNIQUE KEY `uk_pm_primary_owner` (`primary_owner_key`);
