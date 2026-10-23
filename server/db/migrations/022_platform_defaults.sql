-- =====================================================================
-- 022_platform_defaults.sql —— 平台基础配置与基础内容页
-- =====================================================================
--
-- 背景（多租户 SaaS）：
--   同一个微信小程序服务多个租户。品牌、用户协议、隐私政策、默认阈值
--   必须先有一套「平台基础版本」，否则登录前（还没有租户上下文）读不到内容，
--   新租户没有配置时也没有可继承的默认值。
--
-- 语义：
--   tenant_id IS NULL  = 平台基础版本（由平台运营维护）
--   tenant_id = N      = 租户 N 的覆盖版本
--
-- 读取优先级（服务层实现）：
--   租户配置/内容 → 平台基础版本 → 代码内置默认值
--
-- ── 为什么加 tenant_key 生成列 ──
-- MySQL 的唯一索引不约束 NULL（CLAUDE.md 第 2 条）。直接对 tenant_id 建
-- 唯一索引时，平台行可以无限重复插入，读取命中哪条取决于物理顺序。
-- 用 IFNULL(tenant_id, 0) 折叠成 0 后，平台行也受唯一约束保护。
-- 这与 admin_user.tenant_key、sys_config.project_id_key 的做法一致。

-- ── 1. sys_config ──
ALTER TABLE `sys_config` DROP INDEX `uk_sys_config_key_scope_project`;

ALTER TABLE `sys_config`
  MODIFY COLUMN `tenant_id` BIGINT UNSIGNED NULL
    COMMENT 'NULL=平台基础配置；非 NULL=该租户的覆盖配置',
  ADD COLUMN `tenant_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (IFNULL(`tenant_id`, 0)) STORED
    COMMENT '仅用于唯一索引：MySQL 唯一索引不约束 NULL，平台行折叠为 0';

ALTER TABLE `sys_config`
  ADD UNIQUE KEY `uk_sys_config_key_scope_project`
    (`tenant_key`, `config_key`, `scope`, `project_id_key`);


-- ── 2. content_page ──
ALTER TABLE `content_page` DROP INDEX `uk_content_page_key`;

ALTER TABLE `content_page`
  MODIFY COLUMN `tenant_id` BIGINT UNSIGNED NULL
    COMMENT 'NULL=平台基础内容页；非 NULL=该租户的覆盖版本',
  ADD COLUMN `tenant_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (IFNULL(`tenant_id`, 0)) STORED
    COMMENT '仅用于唯一索引：MySQL 唯一索引不约束 NULL，平台行折叠为 0';

ALTER TABLE `content_page`
  ADD UNIQUE KEY `uk_content_page_key` (`tenant_key`, `page_key`);
