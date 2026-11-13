-- =====================================================================
-- 039 后台账号软删除后释放用户名
--
-- ── 问题 ──
-- `admin_user` 的唯一键是 `(tenant_key, username)`，不包含 `deleted_at`。
-- 补上「删除账号」能力后，删除走软删（AC-AD50 要求能删除，且审计需要保留行），
-- 软删的旧行仍然占着用户名：service 层的查重按 `deleted_at IS NULL` 过滤，
-- 预检通过，插库时却撞唯一键，接口返回 409，同名的账号永远建不回来。
--
-- ── 修正 ──
-- 与 031 的 `payment_node` 同一做法：用生成列把软删行折叠成 NULL，
-- 只让未删除的账号参与 `(tenant_key, username)` 唯一约束。
-- `tenant_key` 本身也是生成列（016），MySQL 8 允许生成列引用先定义的生成列。
-- 历史软删行（此前没有删除入口，理论上为空）不会阻塞新建。
-- =====================================================================

ALTER TABLE `admin_user`
  DROP INDEX `uk_admin_user_username`;

ALTER TABLE `admin_user`
  ADD COLUMN `active_tenant_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      IF(`deleted_at` IS NULL, `tenant_key`, NULL)
    ) STORED
    COMMENT '仅用于唯一索引，实现「未删除账号在同一租户内 username 唯一」的条件唯一';

ALTER TABLE `admin_user`
  ADD UNIQUE KEY `uk_admin_user_username` (`active_tenant_key`, `username`);
