-- =====================================================================
-- 015 多租户 · 结构（M13 / P0）
--
-- 本文件**只建结构**：新表、新列、把 role 枚举扩成超集。
-- 不动任何数据、不删任何索引 —— 回填与索引重建在 016 里。
--
-- 为什么拆成两个文件：
--   migrate.js 是整个文件执行完才写 ledger，而 MySQL 的 DDL 隐式提交、无法回滚。
--   若「建列 + 回填 + 重建索引」混在一个文件里，第 5 步失败时前 4 步已经生效
--   却不在 ledger 里，重跑会把 ADD COLUMN 再执行一次而直接报错，现场只能手工收拾。
--   拆开之后，失败点永远停在一个可以重跑的位置。
--
-- 隔离模型（三层）：
--   平台（admin_user.tenant_id IS NULL, role='platform'）
--     └─ 租户 tenant
--          ├─ 租户管理员 role='owner'
--          └─ 项目管理员 role='admin'
--               └─ 项目 project（tenant_id）
--                    └─ C 端成员 project_member（可跨租户）
-- =====================================================================


-- ── tenant：租户（一家装修公司） ──
--
-- `code` 是对外的短标识：租户二维码 / 登录链接带上它，用来在同名账号之间区分
-- （两家公司都可以有一个叫 admin 的账号）。因此它必须全局唯一且**不可变**。
--
-- 配额本期只落两项：项目数与后台账号数。存储配额等有真实计费再说 ——
-- 一个算了但没人执行的配额，比没有更糟（客户以为有限制，实际没有）。
CREATE TABLE `tenant` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`            VARCHAR(100)    NOT NULL COMMENT '公司名称，展示用',
  `code`            VARCHAR(32)     NOT NULL COMMENT '对外短标识，登录与邀请链接携带，全局唯一且不可变',
  `status`          ENUM('active','suspended','archived') NOT NULL DEFAULT 'active'
                    COMMENT 'active=正常；suspended=欠费/停用（后台拒绝登录）；archived=已退租',
  `plan`            VARCHAR(32)     NOT NULL DEFAULT 'basic' COMMENT '套餐标识，仅记录，不驱动逻辑',
  `max_projects`    INT UNSIGNED    NOT NULL DEFAULT 20 COMMENT '项目数配额（0 表示不限）',
  `max_admin_users` INT UNSIGNED    NOT NULL DEFAULT 5  COMMENT '后台账号数配额（0 表示不限）',
  `trial_ends_at`   DATETIME        NULL COMMENT '试用截止时间',
  `expires_at`      DATETIME        NULL COMMENT '正式到期时间。到期后后台拒绝登录，C 端只读',
  `contact_name`    VARCHAR(50)     NULL COMMENT '租户联系人',
  `contact_phone`   VARCHAR(20)     NULL,
  `remark`          VARCHAR(200)    NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`code`),
  KEY `idx_tenant_status` (`status`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='租户（装修公司）';


-- ── platform_access_grant：平台排障的临时授权 ──
--
-- 平台运营**默认看不到**租户业务数据。需要排障时，由租户管理员显式授权一个
-- 时间窗，平台在这个窗口内可读，且每次访问都写 operation_log。
--
-- 为什么不给平台一个「永久只读」的角色：
--   那等于把「随时可以看客户合同金额和业主手机号」写进系统设计里，
--   而 SaaS 客户签约时几乎一定会问这一条。默认拒绝 + 显式授权 + 全程留痕，
--   是唯一能在合同里写清楚的方案。
--
-- `granted_by` 是租户 owner 的 admin_user.id —— 授权这件事必须由被看的那一方发起。
CREATE TABLE `platform_access_grant` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `admin_user_id` BIGINT UNSIGNED NOT NULL COMMENT '被授权的平台账号（tenant_id 为 NULL 的 admin_user）',
  `granted_by`    BIGINT UNSIGNED NOT NULL COMMENT '发起授权的租户管理员',
  `reason`        VARCHAR(200)    NULL COMMENT '排障事由，写进审计日志',
  `expires_at`    DATETIME        NOT NULL COMMENT '授权截止时间，必须显式给出',
  `revoked_at`    DATETIME        NULL COMMENT '租户主动撤销的时间',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- 校验授权时的唯一查询形状：某平台账号 + 某租户 + 未撤销 + 未过期
  KEY `idx_grant_lookup` (`admin_user_id`, `tenant_id`, `revoked_at`, `expires_at`),
  KEY `idx_grant_tenant` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台访问租户数据的临时授权';


-- ── admin_user：租户归属 + 角色扩展 ──
--
-- tenant_id 为 NULL = 平台账号（我们自己的运营）。
--
-- role 枚举**先扩成超集**，把旧值 super 与新值 platform/owner 都放进去。
-- 直接收窄成最终枚举会让残留的 'super' 被 MySQL **静默截断成空串**
-- （只报 WARN_DATA_TRUNCATED），表现为「登录成功但什么权限都没有」。
-- 数据迁移与收窄都在 016，且收窄前必须先确认 super 已清零。
ALTER TABLE `admin_user`
  ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL COMMENT '租户；NULL 表示平台账号';

ALTER TABLE `admin_user`
  MODIFY COLUMN `role` ENUM('super','admin','platform','owner') NOT NULL DEFAULT 'admin'
  COMMENT 'platform=平台运营（tenant_id 为 NULL）；owner=租户管理员；admin=项目管理员';


-- ── 12 张「根」表：显式带 tenant_id ──
--
-- 只有这些表需要列：它们会被**跨项目查询**（列表、导出、日志、配置、消息、模板），
-- 没有父级可以把租户派生出来。
--
-- 其余业务表（ledger、acceptance、progress_*、project_member、door_code、visit_* 等）
-- **不加列**，经 project 派生。前提是一条既有不变量：子表行只按 id 被读取，
-- 且读取之后必定经过一次项目级校验（projectAccess.load 或 findActiveRole）。
-- 这条不变量一旦被打破（新增「按 id 直接返回子表数据」的接口却不校验项目归属），
-- 租户隔离就会出现缺口 —— 写进 CLAUDE.md。
ALTER TABLE `project`            ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `stage_template`     ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `sys_config`         ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `content_page`       ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `feedback`           ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `operation_log`      ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `admin_notification` ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `export_task`        ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `admin_login_log`    ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `user_subscription`  ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `notification`       ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
ALTER TABLE `route_plan`         ADD COLUMN `tenant_id` BIGINT UNSIGNED NULL;
