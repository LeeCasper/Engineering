-- =====================================================================
-- 016 多租户 · 回填与索引重建（M13 / P0）
--
-- 在 015 建好的结构上：写入租户 #1、回填全部 tenant_id、收窄 role 枚举、
-- 重建唯一索引（把「全局唯一」改成「租户内唯一」）。
--
-- ⚠️ 与 015 拆开的理由见 015 文件头：DDL 隐式提交且不可回滚，
--    migrate.js 又是整文件执行完才写 ledger。混在一个文件里失败一次就要手工收拾。
-- =====================================================================


-- ── 1. 租户 #1：存量数据的归属 ──
--
-- 显式给 id = 1，后面所有回填都引用它。
-- code 用 'default'：升级上来的老部署只有一家公司，等它有自己的短标识时再改
-- （code 不可变是设计约束，但这里是一次性的初始化，不是运行期修改）。
INSERT INTO `tenant` (`id`, `name`, `code`, `status`, `plan`, `max_projects`, `max_admin_users`, `remark`)
VALUES (1, '默认租户', 'default', 'active', 'basic', 0, 0, '单租户部署升级时自动创建，配额不限');


-- ── 2. 回填 tenant_id ──
--
-- 存量数据全部归入租户 #1。新部署没有存量行，这些 UPDATE 影响 0 行，无副作用。
UPDATE `project`            SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `stage_template`     SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `sys_config`         SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `content_page`       SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `feedback`           SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `operation_log`      SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `admin_notification` SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `export_task`        SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `admin_login_log`    SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `user_subscription`  SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `notification`       SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;
UPDATE `route_plan`         SET `tenant_id` = 1 WHERE `tenant_id` IS NULL;


-- ── 3. 后台账号的角色迁移 ──
--
-- **存量 'super' 变成租户 1 的 owner，不是平台账号。**
-- 直觉上「超级管理员 → 平台运营」，但那是把客户公司的最高管理员
-- 升级成了能看所有客户数据的人 —— 权限不升反降的映射方向错了。
-- 正确映射：老部署里的 super 就是这家装修公司的老板，对应 owner；
-- 平台运营是**软件方**的账号，属于新增主体，由部署脚本另行创建，不从存量数据里来。
UPDATE `admin_user` SET `role` = 'owner', `tenant_id` = 1 WHERE `role` = 'super';
UPDATE `admin_user` SET `tenant_id` = 1 WHERE `role` = 'admin' AND `tenant_id` IS NULL;


-- ── 4. 收窄枚举 ──
--
-- 这一步之前 'super' 必须已经清零。残留的 'super' 会被 MySQL 静默截断成空串
-- （只报 WARN_DATA_TRUNCATED），表现为「登录成功但什么权限都没有」。
-- 迁移脚本无法断言，因此靠上一行的 UPDATE 保证，另外在集成测试里对着
-- 迁移后的库断言 role 的取值集合。
ALTER TABLE `admin_user`
  MODIFY COLUMN `role` ENUM('platform','owner','admin') NOT NULL DEFAULT 'admin'
  COMMENT 'platform=平台运营（tenant_id 为 NULL）；owner=租户管理员；admin=项目管理员';


-- ── 5. 哪些表的 tenant_id 是 NOT NULL，哪些必须可空 ──
--
-- 判据只有一句：**这条记录是否一定属于某一个租户**。
--
-- NOT NULL（业务数据，必然归属某租户）：
--   project / stage_template / sys_config / content_page /
--   admin_notification / export_task / user_subscription / notification / route_plan
--
-- 可空（不属于任何单一租户的事件）：
--   admin_user          —— NULL 就是平台账号
--   admin_login_log     —— 用户名猜错时压根不知道是哪个租户
--   operation_log       —— 跨租户事件（如一个账号同时属于 A、B 两个租户时注销）
--   feedback            —— 未指定项目 = 提给平台的反馈
--   notification        —— 不关联任何项目的系统消息（与租户无关，但用户要看得到）
--
-- 可空的这三张表在查询侧必须显式处理 NULL，不能靠 `tenant_id = ?` 蒙混过关 ——
-- 那会把「平台级事件」永久过滤掉，而它们恰好是最需要被看到的（登录爆破、跨租户操作）。
ALTER TABLE `project`            MODIFY COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `stage_template`     MODIFY COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `sys_config`         MODIFY COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `content_page`       MODIFY COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `admin_notification` MODIFY COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `export_task`        MODIFY COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `user_subscription`  MODIFY COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `route_plan`         MODIFY COLUMN `tenant_id` BIGINT UNSIGNED NOT NULL;


-- ── 6. 重建「全局唯一」为「租户内唯一」 ──
--
-- 顺序不能反：下面两个生成列都引用 tenant_id，
-- 必须等 tenant_id 回填完**且**置为 NOT NULL 之后再重建。
-- 否则回填前的行生成列全是 NULL，唯一索引形同虚设，而 STORED 列不会自动重算。

-- 6.1 默认模板：全系统至多 1 个 → 每个租户至多 1 个
ALTER TABLE `stage_template` DROP INDEX `uk_template_single_default`;
ALTER TABLE `stage_template` DROP COLUMN `default_key`;
ALTER TABLE `stage_template`
  ADD COLUMN `default_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(`is_default` = 1 AND `deleted_at` IS NULL, `tenant_id`, NULL)) STORED
    COMMENT '仅用于唯一索引，保证每个租户至多一个默认模板（§5.3）',
  ADD UNIQUE KEY `uk_template_single_default` (`default_key`);

-- 6.2 系统配置：每个租户一套
ALTER TABLE `sys_config` DROP INDEX `uk_sys_config_key_scope_project`;
ALTER TABLE `sys_config`
  ADD UNIQUE KEY `uk_sys_config_key_scope_project` (`tenant_id`, `config_key`, `scope`, `project_id_key`);

-- 6.3 内容页：每个租户各自维护协议文本
ALTER TABLE `content_page` DROP INDEX `uk_content_page_key`;
ALTER TABLE `content_page` ADD UNIQUE KEY `uk_content_page_key` (`tenant_id`, `page_key`);

-- 6.4 后台账号：两家公司都可以有叫 admin 的账号
--
-- tenant_id 为 NULL 的平台账号会被生成列折叠成 0，
-- 因此平台账号之间仍共用一套用户名的唯一性（不允许两个平台都叫 admin）。
ALTER TABLE `admin_user`
  ADD COLUMN `tenant_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (IFNULL(`tenant_id`, 0)) STORED
    COMMENT '仅用于唯一索引：MySQL 唯一索引不约束 NULL，平台账号折叠为 0';

ALTER TABLE `admin_user` DROP INDEX `uk_admin_user_username`;
ALTER TABLE `admin_user` ADD UNIQUE KEY `uk_admin_user_username` (`tenant_key`, `username`);

-- 6.5 订阅授权：**同一个微信模板 ID 会被多个租户使用**
--
-- 不加租户的话，同一个人在租户 A 与租户 B 授权同一个模板会互相覆盖 ——
-- 表现为「在 B 授权了，A 那边又变回未授权」，而两份记录其实是同一个 key。
ALTER TABLE `user_subscription` DROP INDEX `uk_us_user_template`;
ALTER TABLE `user_subscription`
  ADD UNIQUE KEY `uk_us_user_template` (`user_id`, `tenant_id`, `template_id`);


-- ── 6.6 两处「跨项目串号」的修复（与租户无关，但同一次改造必须一起做） ──
--
-- ① progress_report 的幂等键是 (user_id, client_request_id)，**不含 project**。
--    一个同时在多个项目的工长（现在还可能跨租户）若复用同一个 clientRequestId，
--    服务层预检会命中**另一个项目**的汇报并直接返回它 —— 跨项目/跨租户读到别人的数据，
--    而本次提交被静默丢弃。唯一键跟着补 project_id。
ALTER TABLE `progress_report` DROP INDEX `uk_report_idempotent`;
ALTER TABLE `progress_report`
  ADD UNIQUE KEY `uk_report_idempotent` (`project_id`, `user_id`, `client_request_id`);

-- ② reminder_log 的去重键不含 project。stale_report 提醒的 ref_id 是「上次汇报的时间戳」，
--    两个项目的锚点落在同一秒、且业主是同一个人时，会互相把对方的提醒判为「已发过」。
--    project_id 可空（跨项目的提醒），用生成列折叠成 0 后再进唯一键。
ALTER TABLE `reminder_log`
  ADD COLUMN `project_key` BIGINT UNSIGNED
    GENERATED ALWAYS AS (IFNULL(`project_id`, 0)) STORED
    COMMENT '仅用于唯一索引：MySQL 唯一索引不约束 NULL';
ALTER TABLE `reminder_log` DROP INDEX `uk_reminder_once`;
ALTER TABLE `reminder_log`
  ADD UNIQUE KEY `uk_reminder_once` (`project_key`, `type`, `ref_type`, `ref_id`, `target_user_id`);


-- ── 7. 租户维度的普通索引（列表查询都按租户过滤） ──
ALTER TABLE `project`            ADD KEY `idx_project_tenant` (`tenant_id`, `status`, `deleted_at`);
ALTER TABLE `stage_template`     ADD KEY `idx_template_tenant` (`tenant_id`, `deleted_at`);
ALTER TABLE `sys_config`         ADD KEY `idx_sys_config_tenant` (`tenant_id`, `config_key`);
ALTER TABLE `content_page`       ADD KEY `idx_content_tenant` (`tenant_id`, `published_at`);
ALTER TABLE `feedback`           ADD KEY `idx_feedback_tenant` (`tenant_id`, `status`, `created_at`);
ALTER TABLE `operation_log`      ADD KEY `idx_oplog_tenant` (`tenant_id`, `created_at`);
ALTER TABLE `admin_notification` ADD KEY `idx_admin_notif_tenant` (`tenant_id`, `admin_user_id`, `is_read`);
ALTER TABLE `export_task`        ADD KEY `idx_export_tenant` (`tenant_id`, `created_by`);
ALTER TABLE `admin_login_log`    ADD KEY `idx_login_log_tenant` (`tenant_id`, `login_at`);
ALTER TABLE `user_subscription`  ADD KEY `idx_us_tenant` (`tenant_id`, `user_id`);
ALTER TABLE `notification`       ADD KEY `idx_notif_tenant` (`tenant_id`, `user_id`, `is_read`);
ALTER TABLE `route_plan`         ADD KEY `idx_route_plan_tenant` (`tenant_id`, `owner_id`);
ALTER TABLE `admin_user`         ADD KEY `idx_admin_user_tenant` (`tenant_id`, `status`);
