-- =====================================================================
-- 011 红冲后释放付款节点的收入位
--
-- ── 问题 ──
-- 005 建的条件唯一索引是：
--   payment_node_uniq = IF(type='income' AND deleted_at IS NULL, payment_node_id, NULL)
-- 语义是「一个付款节点只能有一条收入流水」（AC-L05）。
--
-- 但 AC-L23 规定更正只能走红冲：原记录**保留**（账目只增不减），
-- 新增一条冲销记录。于是原记录的 `deleted_at` 仍是 NULL，
-- 它继续占着那个唯一位 —— **红冲之后再也无法为这个节点登记正确的金额**。
--
-- 这是个真实的死角：业主转错了钱、工长登记错了金额，
-- 按流程红冲完之后发现「这个节点永远登记不了了」。
--
-- ── 修正 ──
-- 把「已被冲销」的行也排除出约束。语义变成
-- 「一个付款节点只能有一条**有效**收入流水」，与业务预期一致。
--
-- 注意 `reversed_by_id` 在 005 里的定义位置早于 `payment_node_uniq`，
-- 而 MySQL 要求生成列只能引用**定义在它之前**的列 —— 顺序刚好满足。
-- =====================================================================

-- 先删索引，否则无法修改它依赖的生成列
ALTER TABLE `ledger`
  DROP INDEX `uk_ledger_payment_node_income`;

ALTER TABLE `ledger`
  MODIFY COLUMN `payment_node_uniq` BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      IF(`type` = 'income' AND `deleted_at` IS NULL AND `reversed_by_id` IS NULL, `payment_node_id`, NULL)
    ) STORED
    COMMENT '仅用于唯一索引，实现条件唯一：非收入行、已删除行、已冲销行都折叠为 NULL 不参与约束';

ALTER TABLE `ledger`
  ADD UNIQUE KEY `uk_ledger_payment_node_income` (`payment_node_uniq`);
