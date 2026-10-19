-- =====================================================================
-- 001 核心：用户、后台账号、数据权限、系统配置、操作日志
--
-- 对应需求文档 §6.1 的 user / admin_user / admin_login_log /
-- project_admin_scope / sys_config / operation_log 六张表。
--
-- 全局约定（§6.2）：
--   - 字符集 utf8mb4，引擎 InnoDB；
--   - 金额 DECIMAL(12,2)，完成度/权重 DECIMAL(5,2)，经纬度 DECIMAL(10,7)；
--   - 时间统一 DATETIME，时区由应用层钉死 Asia/Shanghai；
--   - 所有表带 created_at / updated_at / deleted_at（软删除）。
-- =====================================================================


-- ── user：C 端用户（工长 / 监理 / 业主三种角色都落在这张表，角色按项目判定） ──
CREATE TABLE `user` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `openid`        VARCHAR(64)     NULL COMMENT '微信 openid，同一用户在不同小程序不同',
  `unionid`       VARCHAR(64)     NULL COMMENT '微信 unionid，接入开放平台后可用于跨应用识别同一人',
  `phone`         VARCHAR(20)     NULL COMMENT '手机号。注销时置 NULL 以释放唯一索引（AC-U20）',
  `nickname`      VARCHAR(64)     NULL,
  `avatar`        VARCHAR(512)    NULL,
  `status`        ENUM('active','deleted') NOT NULL DEFAULT 'active',
  `anonymized_at` DATETIME        NULL COMMENT '注销匿名化时间（AC-U19）。非 NULL 表示该账号已注销',
  `last_login_at` DATETIME        NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- phone 允许 NULL：MySQL 唯一索引不约束多个 NULL，
  -- 这正是 AC-U20「注销后手机号可重新注册」所依赖的行为 ——
  -- 若用空串代替 NULL，第二个注销用户就会撞唯一键。
  UNIQUE KEY `uk_user_phone` (`phone`),
  UNIQUE KEY `uk_user_openid` (`openid`),
  KEY `idx_user_unionid` (`unionid`),
  KEY `idx_user_status` (`status`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='C 端用户';


-- ── admin_user：B 端后台账号（超级管理员 / 项目管理员） ──
CREATE TABLE `admin_user` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`             VARCHAR(50)     NOT NULL,
  `password_hash`        VARCHAR(100)    NOT NULL COMMENT 'bcrypt 加盐哈希，禁止明文（AC-AD04）',
  `role`                 ENUM('super','admin') NOT NULL DEFAULT 'admin',
  `status`               ENUM('active','disabled') NOT NULL DEFAULT 'active',
  -- 登录安全字段（G-07）
  `failed_count`         INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '连续登录失败次数，成功登录后清零（AC-AD03）',
  `locked_until`         DATETIME        NULL COMMENT '锁定截止时间，为 NULL 表示未锁定',
  `must_change_password` TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '首次登录或重置密码后强制改密（AC-AD06）',
  `password_changed_at`  DATETIME        NULL,
  `token_version`        INT UNSIGNED    NOT NULL DEFAULT 1 COMMENT '改密/禁用时自增，使已签发 token 立即失效（AC-AD07/08）',
  `created_by`           BIGINT UNSIGNED NULL COMMENT '创建者。项目管理员只能管理自己创建的下属（AC-AD50）',
  `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`           DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_user_username` (`username`),
  KEY `idx_admin_user_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='后台账号';


-- admin_login_log：后台登录日志
--
-- 与 operation_log 分表（§6.2）：登录是高频且绝大多数为成功事件，
-- 与业务变更记录混放会把真正的增删改记录淹没。
CREATE TABLE `admin_login_log` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_user_id` BIGINT UNSIGNED NULL COMMENT '账号不存在时（用户名猜错）为 NULL，此时仍要留痕',
  `username`      VARCHAR(50)     NOT NULL COMMENT '登录时输入的用户名，便于排查「谁在猜账号」',
  `login_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip`            VARCHAR(45)     NOT NULL DEFAULT '' COMMENT 'IPv6 最长 45 字符',
  `result`        ENUM('success','failed') NOT NULL,
  `fail_reason`   VARCHAR(100)    NULL COMMENT '失败原因，如「密码错误」「账号已锁定」',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_login_log_user_time` (`admin_user_id`, `login_at`),
  KEY `idx_login_log_time` (`login_at`),
  KEY `idx_login_log_ip` (`ip`, `login_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='后台登录日志';


-- project_admin_scope：项目管理员的数据权限范围
--
-- 需求文档 §5.1 数据权限模型（Q10 已定：按项目隔离）：
--   项目管理员可见 = 自己创建的项目 ∪ 本表授权的项目。
-- 这张表存在的唯一理由是「超级管理员把某个项目一键授权给某管理员」。
CREATE TABLE `project_admin_scope` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_user_id` BIGINT UNSIGNED NOT NULL,
  `project_id`    BIGINT UNSIGNED NOT NULL,
  `granted_by`    BIGINT UNSIGNED NOT NULL COMMENT '授权人，通常为超级管理员',
  `granted_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pas_admin_project` (`admin_user_id`, `project_id`),
  KEY `idx_pas_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目数据授权范围';


-- sys_config：系统配置（B-5.1 ~ B-5.9）
--
-- ── 一份 DDL 上的必要偏离 ──
-- 需求文档 §6.2 写的是「对 (config_key, scope, project_id) 建唯一索引，
-- scope='global' 时 project_id 为 NULL」。但 MySQL 的唯一索引**不约束 NULL**，
-- 多个 NULL 被视为互不相同，照原文建索引等于没有约束 ——
-- 全局配置能被重复插入两条，读取时命中哪一条取决于物理顺序。
--
-- 处理方式：加一个生成列把 NULL 折叠成 0，再对生成列建唯一索引。
-- 语义完全保持（NULL 仍表示全局），约束真实生效。
CREATE TABLE `sys_config` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_key`   VARCHAR(64)     NOT NULL COMMENT '如 sign_in_distance_threshold、gate_strength',
  `config_value` VARCHAR(500)    NOT NULL COMMENT '统一以字符串存储，由应用层按配置项定义解析类型（§6.2）',
  `scope`        ENUM('global','project') NOT NULL DEFAULT 'global',
  `project_id`   BIGINT UNSIGNED NULL COMMENT 'scope=global 时为 NULL',
  `project_id_key` BIGINT UNSIGNED GENERATED ALWAYS AS (IFNULL(`project_id`, 0)) STORED
                 COMMENT '仅用于唯一索引：MySQL 唯一索引不约束 NULL，需折叠为 0',
  `description`  VARCHAR(200)    NULL COMMENT '配置项说明，供后台展示',
  `updated_by`   BIGINT UNSIGNED NULL COMMENT '最后修改人，仅超级管理员可改（AC-AD67）',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`   DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_config_key_scope_project` (`config_key`, `scope`, `project_id_key`),
  KEY `idx_sys_config_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统配置';


-- operation_log：业务操作日志
--
-- §6.2 要求 detail 统一为 {"before": {...}, "after": {...}}。
-- 金额变更必须记录变更前后值（AC-L28、AC-AD09）。
--
-- operator_type + operator_id 是多态关联：操作人可能是后台账号或 C 端用户，
-- 因此**不建外键** —— 加了就只能指向其中一张表。
CREATE TABLE `operation_log` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `operator_type` ENUM('admin','user','system') NOT NULL,
  `operator_id`   BIGINT UNSIGNED NULL COMMENT 'system 产生的日志（如定时任务）为 NULL',
  `action`        VARCHAR(64)     NOT NULL COMMENT '如 project.create、ledger.update、sys_config.update',
  `target_type`   VARCHAR(64)     NULL COMMENT '目标对象类型，如 project、ledger',
  `target_id`     BIGINT UNSIGNED NULL,
  `project_id`    BIGINT UNSIGNED NULL COMMENT '冗余项目归属，便于按项目查日志',
  `detail`        JSON            NULL COMMENT '{"before": {...}, "after": {...}}',
  `ip`            VARCHAR(45)     NULL,
  `request_id`    VARCHAR(64)     NULL COMMENT '与访问日志的 X-Request-Id 对应，便于串联排查',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_oplog_target` (`target_type`, `target_id`, `created_at`),
  KEY `idx_oplog_operator` (`operator_type`, `operator_id`, `created_at`),
  KEY `idx_oplog_project` (`project_id`, `created_at`),
  KEY `idx_oplog_action` (`action`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='业务操作日志';
