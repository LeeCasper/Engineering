-- =====================================================================
-- 021 C 端固定角色
--
-- ── 业务规则变更（v2.5）──
-- 原设计把角色放在 project_member 上，允许同一个人在 A 项目当工长、
-- 在 B 项目当监理（AC-U05 原语义）。现改为：
--
--   - 业主可以参与多个项目；
--   - 工长在所有项目里都是工长；
--   - 监理在所有项目里都是监理；
--   - 角色一旦由邀请确定，不能自行或由管理员改成别的角色。
--
-- 因此 user 表增加一个权威的固定角色。project_member.role 仍然保留，
-- 用于「这个人是否在这个项目里」以及项目内权限判定；但它必须与 user.role
-- 一致，由 projectMember.service 在邀请 / 确认时校验。
--
-- ── 回填策略 ──
-- 只回填「历史成员关系里只有一个角色」的账号。历史上已经跨角色的人
-- （例如开发库里同时是业主和工长的测试账号）保持 NULL，交给数据清理流程；
-- 迁移不擅自删成员关系或改角色 —— 那会让线上用户静默失去项目访问权。
-- =====================================================================

ALTER TABLE `user`
  ADD COLUMN `role` ENUM('owner', 'foreman', 'supervisor') NULL
  COMMENT 'C 端固定角色；由首次邀请确定，跨项目不可更改。NULL=尚未被邀请或历史多角色待清理'
  AFTER `status`;

UPDATE `user` u
JOIN (
  SELECT user_id, MIN(role) AS sole_role, COUNT(DISTINCT role) AS role_count
    FROM project_member
   WHERE deleted_at IS NULL AND status IN ('pending', 'active')
   GROUP BY user_id
) m ON m.user_id = u.id
SET u.role = m.sole_role
WHERE u.role IS NULL AND m.role_count = 1;
