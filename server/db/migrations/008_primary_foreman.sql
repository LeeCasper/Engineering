-- =====================================================================
-- 008 主工长（需求文档 §9 Q11 的决策落地）
--
-- ── 背景 ──
-- §5.2 与 AC-AD58 原本写的是「工长必须且仅 1 人」，同时在 §9 Q11 留了一个
-- 未决口子：「是否允许配置多名工长」。现在 Q11 已拍板：
--
--   允许配置多名工长；其中有且仅有 1 名「主工长」。
--   所有工长可汇报进度与登记支出（各自留痕），
--   仅主工长可发起验收与提交阶段结算单。
--
-- 核心理由（Q11 原文）：多人项目若共用一个账号，审计链就失效了 ——
-- 看不出是哪个工长做的。允许各自登录各自留痕，但把「代表项目对外确认」的
-- 权限收敛到一个人，避免两个工长同时发起验收、口径打架。
--
-- ── 为什么是新增迁移而不是改 002 ──
-- 002 早已在开发库与测试库执行过，改它会被 scripts/migrate.js 的校验和检查拦下
-- （这是刻意的，见 CLAUDE.md 第 5 条）。结构变更一律新增迁移文件。
-- =====================================================================


-- is_primary：是否为主工长。对非工长角色恒为 0（由服务层保证）
ALTER TABLE `project_member`
  ADD COLUMN `is_primary` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '是否为主工长（Q11）。仅 role=foreman 时可能为 1，其余角色恒为 0'
    AFTER `role`;

-- ── 「一个项目最多 1 名主工长」怎么落到数据库层 ──
-- 又是一个条件唯一索引，MySQL 8 没有 partial index，仍用生成列实现：
-- 不满足条件的行折叠为 NULL，而唯一索引不约束 NULL。
--
-- 只有「主工长 + 未删除」的行才参与约束。软删除一名主工长后，
-- 项目即可指定新的主工长而不会撞键 —— 这正是期望行为。
--
-- 注意生成列必须 STORED：VIRTUAL 生成列不能建唯一索引。
ALTER TABLE `project_member`
  ADD COLUMN `primary_foreman_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      IF(`is_primary` = 1 AND `role` = 'foreman' AND `deleted_at` IS NULL, `project_id`, NULL)
    ) STORED
    COMMENT '仅用于唯一索引，实现「一个项目最多 1 名主工长」的条件唯一',
  ADD UNIQUE KEY `uk_pm_primary_foreman` (`primary_foreman_key`);

-- ── 存量数据回填 ──
-- 已有项目若存在工长，把其中最早加入的那一位设为主工长。
-- 用 MIN(id) 而不是随机挑一个：id 递增，最早的那条就是最早被邀请的，
-- 语义上最接近「原本就在负责这个项目的人」。
--
-- 子查询按 project_id 分组保证每个项目只挑出一条 —— 否则一个项目设两名主工长
-- 会直接撞刚建好的唯一索引，整个迁移失败。
UPDATE `project_member` pm
  JOIN (
    SELECT `project_id`, MIN(`id`) AS `id`
      FROM `project_member`
     WHERE `role` = 'foreman'
       AND `status` IN ('pending', 'active')
       AND `deleted_at` IS NULL
     GROUP BY `project_id`
  ) pick ON pick.`id` = pm.`id`
   SET pm.`is_primary` = 1;
