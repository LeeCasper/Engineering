-- =====================================================================
-- 030 阶段结算（C-7.5 ~ C-7.9 / AC-S02 ~ AC-S08）
--
-- ── 为什么现在才补 ──
-- `reconciliation` 从一开始就同时承载「阶段结算单」与「周期对账单」
-- （scope_type = stage / period，迁移 005），但服务层只实现了周期对账。
-- 于是验收通过后阶段停在 `accepted`，永远走不到 `settled`，
-- 下一阶段也就永远是 `locked`。
--
-- ── 这次补的两件事 ──
-- 1. 一个阶段最多一张结算单。MySQL 的唯一索引不约束 NULL，
--    用生成列把 `period` 行折叠成 NULL，只让 `stage` 行参与唯一约束。
-- 2. 异议处理留痕。工长重新提交后，旧异议的说明必须保留（AC-S07），
--    但不能再阻塞确认（AC-S05 / AC-S06）。新增解决时间与解决人。
-- =====================================================================

ALTER TABLE `reconciliation`
  ADD COLUMN `stage_settlement_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      IF(`scope_type` = 'stage', `project_stage_id`, NULL)
    ) STORED
    COMMENT '仅用于唯一索引，实现「一个阶段最多一张结算单」的条件唯一';

ALTER TABLE `reconciliation`
  ADD UNIQUE KEY `uk_rec_stage_settlement` (`stage_settlement_key`);

ALTER TABLE `reconciliation_detail`
  ADD COLUMN `dispute_resolved_at` DATETIME NULL
    COMMENT '异议被工长重新提交处理的时间；dispute=1 表示仍未处理',
  ADD COLUMN `dispute_resolved_by` BIGINT UNSIGNED NULL
    COMMENT '处理异议的主工长';
