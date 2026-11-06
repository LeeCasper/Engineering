-- =====================================================================
-- 033 实名认证
--
-- 032 只增加了「真实姓名」文本，用户可以随手填一个网名；被邀请进入项目后
-- 该姓名会出现在验收记录、联系人与结算单据上，没有可信度。
--
-- 本迁移把「填写姓名」升级为「姓名 + 身份证号二要素校验」：
--   - 证件号只在校验时使用，**不落库**；库里只保留脱敏号与核验结果；
--   - 每次提交都写 identity_verification 审计行，便于追溯；
--   - 被邀请（pending / active 成员）但未认证的用户，确认邀请时会被拦下。
--
-- 说明：当前实现是**本地证件校验**（18 位校验位、出生日期、省级行政区），
-- 不接公安库 / 第三方二要素服务。接口返回 verificationLevel='basic'，
-- 前端不得把它描述成「公安库核验通过」。
-- =====================================================================

ALTER TABLE `user`
  ADD COLUMN `real_name_status` ENUM('none','pending','verified','failed')
    NOT NULL DEFAULT 'none'
    COMMENT '实名认证状态；pending 预留给第三方异步核验'
    AFTER `real_name`,
  ADD COLUMN `id_card_mask` VARCHAR(32) NULL
    COMMENT '脱敏身份证号，例如 310101********1234；不存明文'
    AFTER `real_name_status`,
  ADD COLUMN `real_name_verified_at` DATETIME NULL
    AFTER `id_card_mask`,
  ADD COLUMN `real_name_verify_method` ENUM('local','provider','manual') NULL
    COMMENT 'local=本地证件校验；provider=第三方核验；manual=人工审核'
    AFTER `real_name_verified_at`,
  ADD KEY `idx_user_real_name_status` (`real_name_status`);


-- ── identity_verification：实名认证尝试流水（只追加） ──
-- 不存身份证号明文，也不存完整姓名：姓名只保留首字，证件号只保留前 6 后 4。
-- 失败尝试同样留痕，用于排查「用户说自己提交了但没通过」以及限制撞库。
CREATE TABLE `identity_verification` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT UNSIGNED NOT NULL,
  `name_masked`   VARCHAR(64) NULL COMMENT '姓名脱敏快照，例如 张*',
  `id_card_mask`  VARCHAR(32) NULL COMMENT '证件号脱敏快照',
  `method`        ENUM('local','provider','manual') NOT NULL DEFAULT 'local',
  `provider`      VARCHAR(32) NULL,
  `status`        ENUM('passed','failed') NOT NULL,
  `failure_code`  VARCHAR(64) NULL,
  `failure_reason` VARCHAR(100) NULL,
  `ip`            VARCHAR(64) NULL,
  `user_agent`    VARCHAR(512) NULL,
  `request_id`    VARCHAR(64) NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_identity_verification_user` (`user_id`, `id`),
  KEY `idx_identity_verification_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='实名认证尝试流水（只追加，不存证件明文）';
