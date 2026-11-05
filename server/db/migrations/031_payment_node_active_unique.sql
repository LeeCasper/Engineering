-- =====================================================================
-- 031 付款节点整体替换不再撞软删行
--
-- ── 问题 ──
-- `payment_node` 的唯一键是 `(project_id, seq)`，不包含 `deleted_at`。
-- 管理端保存付款节点走「整体替换」：先把旧节点软删，再按 1..N 重新插入。
-- 第二次保存时，软删的旧行仍然占着 `(project_id, seq)`，新插入会撞唯一键，
-- 接口返回 409「数据已存在，请勿重复提交」，节点配置永远无法再次保存。
--
-- ── 修正 ──
-- 与项目里其他条件唯一索引同一做法：用生成列把软删行折叠成 NULL，
-- 只让未删除的节点参与 `(project_id, seq)` 唯一约束。
-- 历史软删行会保留，但不再阻塞新的配置。
-- =====================================================================

ALTER TABLE `payment_node`
  DROP INDEX `uk_pn_project_seq`;

ALTER TABLE `payment_node`
  ADD COLUMN `active_project_id` BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      IF(`deleted_at` IS NULL, `project_id`, NULL)
    ) STORED
    COMMENT '仅用于唯一索引，实现「未删除节点在同项目内 seq 唯一」的条件唯一';

ALTER TABLE `payment_node`
  ADD UNIQUE KEY `uk_pn_active_project_seq` (`active_project_id`, `seq`);
