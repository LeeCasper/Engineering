-- =====================================================================
-- 018 小程序管理员：微信免密登录绑定
--
-- 小程序管理端复用后台 /admin/* 接口。管理员仍用 admin_user 登录，
-- 本表只解决「同一个微信账号下次如何免密进入」。
--
-- 关键点：
--   1. openid 是绑定匹配的权威键。手机号绑定会合并 C 端占位账号、改变
--      user.id，但 openid 不变；因此 user_id 只作审计与注销辅助。
--   2. admin_token_version 是改密/禁用后的兜底：即使撤销写入漏了，
--      token_version 变化也会让绑定立即失配。
--   3. 一个 admin_user 最多一条 active 绑定；同一个微信可以绑定多个
--      管理员账号（不同租户，或同租户的 owner/admin 两个账号）。
--   4. 生成列 + 唯一索引实现「条件唯一」：revoked 行不参与约束，
--      因此解除绑定后可以重新绑定。这是 CLAUDE.md 第 2 条的再一次应用。
-- =====================================================================


-- admin_login_log：记录登录方式。历史记录默认视为密码登录
ALTER TABLE `admin_login_log`
  ADD COLUMN `auth_method` ENUM('password','wechat') NOT NULL DEFAULT 'password'
    COMMENT '登录方式：password=密码登录；wechat=微信免密' AFTER `result`;


CREATE TABLE `admin_wechat_binding` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`             BIGINT UNSIGNED NOT NULL COMMENT '绑定时管理员所属租户',
  `admin_user_id`         BIGINT UNSIGNED NOT NULL,
  `user_id`               BIGINT UNSIGNED NOT NULL COMMENT 'C 端用户 id；手机号合并后由服务层修正',
  `openid`                VARCHAR(64)     NOT NULL COMMENT '绑定匹配的权威键；合并账号不改变它',
  `unionid`               VARCHAR(64)     NULL,
  `admin_token_version`   INT UNSIGNED    NOT NULL COMMENT '绑定时 admin_user.token_version；失配即失效',
  `status`                ENUM('active','revoked') NOT NULL DEFAULT 'active',
  `bound_at`              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at`          DATETIME        NULL,
  `revoked_at`            DATETIME        NULL,
  `revoked_reason`        VARCHAR(64)     NULL COMMENT 'password_changed / password_reset / admin_disabled / user_deactivated / rebind / manual',
  `active_admin_key`      BIGINT UNSIGNED GENERATED ALWAYS AS (
      IF(`status` = 'active' AND `deleted_at` IS NULL, `admin_user_id`, NULL)
    ) STORED COMMENT '仅用于唯一索引：一个管理员最多一条 active 绑定',
  `wechat_admin_active_key` VARCHAR(85) GENERATED ALWAYS AS (
      IF(`status` = 'active' AND `deleted_at` IS NULL,
         CONCAT(`openid`, ':', `admin_user_id`), NULL)
    ) STORED COMMENT '仅用于唯一索引：同一微信与同一管理员只绑定一次',
  `created_at`            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`            DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_awb_admin_active` (`active_admin_key`),
  UNIQUE KEY `uk_awb_wechat_admin_active` (`wechat_admin_active_key`),
  KEY `idx_awb_openid` (`openid`, `status`, `deleted_at`),
  KEY `idx_awb_user` (`user_id`, `status`, `deleted_at`),
  KEY `idx_awb_tenant` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员微信免密登录绑定';
