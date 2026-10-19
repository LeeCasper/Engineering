-- =====================================================================
-- 009 模板默认标记的唯一性
--
-- §5.3 默认模板约束：「系统始终保留至少一个默认模板（is_default = 1），
-- 默认模板不可删除」。
--
-- 「至少一个」数据库管不了，只能由服务层保证（删除默认模板时拒绝）。
-- 但「**至多**一个」可以，而且必须管住 —— 否则会出现两个 is_default = 1 的模板：
--   - stageTemplate.findDefault() 用 ORDER BY id ASC LIMIT 1 挑一个，
--     于是「哪个是默认」变成了取决于 id 的隐式行为；
--   - 新建项目不选模板时会用其中较早的那个，而管理员界面上高亮的可能是另一个；
--   - 删除保护还会误判（删掉「非默认」的那个其实也是默认）。
--
-- 仍是条件唯一索引，仍是 MySQL 没有 partial index 的那个解法：
-- 生成列把非默认行折叠为 NULL，唯一索引不约束 NULL。
-- 这里不需要 IF 判断，直接 IF(is_default = 1 AND deleted_at IS NULL, 1, NULL)
-- 即可 —— 参与约束的行给出同一个常量值，效果就是「这种行只能有一行」。
-- =====================================================================

ALTER TABLE `stage_template`
  ADD COLUMN `default_key` TINYINT
    GENERATED ALWAYS AS (IF(`is_default` = 1 AND `deleted_at` IS NULL, 1, NULL)) STORED
    COMMENT '仅用于唯一索引，保证全系统至多一个默认模板（§5.3）',
  ADD UNIQUE KEY `uk_template_single_default` (`default_key`);
