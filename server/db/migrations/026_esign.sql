-- =====================================================================
-- 026 可靠电子签名（验收单）
--
-- 现有 acceptance.signature_url 是手写签名图片，不满足《电子签名法》
-- 第 13 条的可靠电子签名条件。本迁移新增第三方电子签任务、实名主体绑定
-- 与回调收件箱；存量已通过的单子统一标记为 legacy，不追溯重签。
--
-- 设计约束：
--   1. acceptance.status 仍是 pending_owner，服务商签署完成且本地验签归档后
--      才进入 passed；
--   2. 同一验收单最多一个 creating/pending/archiving 任务，用生成列 + 唯一索引兜底；
--   3. 签名 PDF、证据报告走私有存储，不写 report_pdf_url（那是历史公开文件）；
--   4. 不存身份证号、身份证照片、人脸图或生物特征模板。
-- =====================================================================

ALTER TABLE `acceptance`
  ADD COLUMN `signature_mode` ENUM('legacy','provider') NOT NULL DEFAULT 'legacy'
    COMMENT 'legacy=存量手写签名图；provider=可靠电子签名'
    AFTER `signature_url`,
  ADD COLUMN `esign_status` ENUM('none','creating','pending','archiving','signed','failed','expired','cancelled','legacy')
    NOT NULL DEFAULT 'none'
    COMMENT '电子签状态；archiving=服务商已签、本地验签/归档中；legacy=历史手写签名'
    AFTER `signature_mode`,
  ADD COLUMN `esign_task_id` BIGINT UNSIGNED NULL
    COMMENT '当前/最后一次电子签任务'
    AFTER `esign_status`,
  ADD COLUMN `esign_completed_at` DATETIME NULL
    AFTER `esign_task_id`,
  ADD COLUMN `report_pdf_key` VARCHAR(512) NULL
    COMMENT '私有存储 key；与 report_pdf_url 二选一'
    AFTER `report_pdf_url`,
  ADD COLUMN `report_pdf_private` TINYINT(1) NOT NULL DEFAULT 0
    AFTER `report_pdf_key`,
  ADD COLUMN `report_pdf_sha256` CHAR(64) NULL
    AFTER `report_pdf_private`,
  ADD COLUMN `report_pdf_source` ENUM('generated','signed') NOT NULL DEFAULT 'generated'
    AFTER `report_pdf_sha256`,
  ADD COLUMN `post_pass_status` ENUM('pending','done','failed') NOT NULL DEFAULT 'pending'
    COMMENT '通过后的付款解锁/通知补偿状态'
    AFTER `report_pdf_source`,
  ADD COLUMN `post_pass_error` VARCHAR(500) NULL
    AFTER `post_pass_status`,
  ADD COLUMN `post_pass_done_at` DATETIME NULL
    AFTER `post_pass_error`,
  ADD KEY `idx_acc_esign_status` (`esign_status`),
  ADD KEY `idx_acc_esign_task` (`esign_task_id`);

-- 存量：所有已通过的单子都是电子签上线前的历史单。
-- 即使个别历史单没有签名图片，也不能让「passed 但非 signed/legacy」的检查误报。
UPDATE `acceptance`
   SET `signature_mode` = 'legacy',
       `esign_status` = 'legacy',
       `esign_completed_at` = `finished_at`,
       `post_pass_status` = 'done',
       `post_pass_done_at` = COALESCE(`finished_at`, `updated_at`)
 WHERE `status` = 'passed';


-- ── esign_task：第三方可靠电子签名任务 ──
CREATE TABLE `esign_task` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `acceptance_id`         BIGINT UNSIGNED NOT NULL,
  `project_id`            BIGINT UNSIGNED NOT NULL,
  `tenant_id`             BIGINT UNSIGNED NULL,
  `provider`              VARCHAR(32) NOT NULL COMMENT 'tencent / esign / fadada / mock',
  `idempotency_key`       VARCHAR(64) NOT NULL,
  `provider_task_id`      VARCHAR(128) NULL,
  `provider_flow_id`      VARCHAR(128) NULL,
  `status`                ENUM('creating','pending','archiving','signed','failed','expired','cancelled','superseded')
                          NOT NULL DEFAULT 'creating',
  `signer_user_id`        BIGINT UNSIGNED NOT NULL,
  `signer_identity_id`    BIGINT UNSIGNED NULL COMMENT 'esign_identity.id',
  `signer_name`           VARCHAR(100) NULL COMMENT '服务商实名结果；不存身份证号',
  `signer_subject_masked` VARCHAR(128) NULL COMMENT '证书主体脱敏展示',
  `signer_mobile_masked`  VARCHAR(20) NULL,
  `signer_id_masked`      VARCHAR(32) NULL,
  `verify_method`         ENUM('none','phone','id','face') NOT NULL DEFAULT 'none',
  `realname_status`       ENUM('none','pending','passed','failed') NOT NULL DEFAULT 'none',
  `realname_method`       ENUM('face','idcard','phone','bankcard','other') NULL,
  `realname_ref`          VARCHAR(128) NULL COMMENT '服务商核身流水号；不存身份证号',
  `realname_verified_at`  DATETIME NULL,
  `consent_at`            DATETIME NULL,
  `consent_version`       VARCHAR(32) NULL,
  `consent_text`          MEDIUMTEXT NULL COMMENT '服务端标准同意书正文快照',
  `consent_text_hash`     CHAR(64) NULL,
  `consent_ip`            VARCHAR(64) NULL,
  `consent_user_agent`    VARCHAR(512) NULL,
  `consent_request_id`    VARCHAR(64) NULL,
  `document_key`          VARCHAR(512) NULL COMMENT '签署前 PDF，私有存储',
  `document_hash`         CHAR(64) NULL COMMENT '签署前 PDF 的 SHA-256',
  `document_frozen_at`    DATETIME NULL,
  `content_snapshot`      JSON NULL COMMENT '冻结的验收内容快照，不含身份证/人脸',
  `content_snapshot_hash` CHAR(64) NULL,
  `signed_document_key`   VARCHAR(512) NULL COMMENT '服务商回传的已签 PDF',
  `signed_document_hash`  CHAR(64) NULL,
  `evidence_key`          VARCHAR(512) NULL COMMENT '证据报告，私有存储',
  `certificate_serial`    VARCHAR(128) NULL,
  `certificate_issuer`    VARCHAR(255) NULL,
  `certificate_not_after` DATETIME NULL,
  `signed_at`             DATETIME NULL COMMENT '服务商可信时间',
  `verify_status`         ENUM('pending','valid','invalid') NOT NULL DEFAULT 'pending',
  `verified_at`           DATETIME NULL,
  `verify_result`         JSON NULL COMMENT '脱敏验签结果；不存身份证/人脸',
  `provider_status`       VARCHAR(64) NULL,
  `sign_mode`             VARCHAR(16) NULL COMMENT 'webview / miniprogram / mock',
  `sign_url`              VARCHAR(2048) NULL,
  `sign_app_id`           VARCHAR(64) NULL,
  `sign_path`             VARCHAR(512) NULL,
  `attempt_no`            INT UNSIGNED NOT NULL DEFAULT 1,
  `last_synced_at`        DATETIME NULL,
  `last_event_at`         DATETIME NULL,
  `error_code`            VARCHAR(64) NULL,
  `error_message`         VARCHAR(500) NULL,
  `expires_at`            DATETIME NULL,
  `created_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- 同一验收单最多一条进行中/归档中任务；生成列 + 唯一索引兜底
  `active_key`            BIGINT UNSIGNED GENERATED ALWAYS AS (
                            IF(`status` IN ('creating','pending','archiving'), `acceptance_id`, NULL)
                          ) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_esign_idempotency` (`idempotency_key`),
  UNIQUE KEY `uk_esign_provider_task` (`provider`, `provider_task_id`),
  UNIQUE KEY `uk_esign_active` (`active_key`),
  KEY `idx_esign_acceptance` (`acceptance_id`, `id`),
  KEY `idx_esign_status` (`status`, `expires_at`),
  KEY `idx_esign_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='可靠电子签名任务';


-- ── esign_identity：用户与服务商实名主体绑定 ──
-- 微信账号不等于业主本人；完成签署前必须确认实名 passed 且 subject 匹配。
CREATE TABLE `esign_identity` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`             BIGINT UNSIGNED NOT NULL,
  `provider`            VARCHAR(32) NOT NULL,
  `provider_subject_id` VARCHAR(128) NULL COMMENT '服务商个人主体 id；不存身份证号',
  `realname_status`     ENUM('pending','passed','failed') NOT NULL DEFAULT 'pending',
  `realname_method`     ENUM('face','idcard','phone','bankcard','other') NULL,
  `realname_ref`        VARCHAR(128) NULL COMMENT '核身流水号',
  `name_masked`         VARCHAR(64) NULL,
  `verified_at`         DATETIME NULL,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_esign_identity_user` (`user_id`, `provider`),
  UNIQUE KEY `uk_esign_identity_subject` (`provider`, `provider_subject_id`),
  KEY `idx_esign_identity_realname` (`provider`, `realname_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户与电子签服务商实名主体绑定';


-- ── esign_event：回调收件箱（幂等/审计） ──
CREATE TABLE `esign_event` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider`              VARCHAR(32) NOT NULL,
  `event_id`              VARCHAR(128) NOT NULL,
  `task_id`               BIGINT UNSIGNED NULL,
  `provider_task_id`      VARCHAR(128) NULL,
  `provider_business_id`  VARCHAR(64) NULL,
  `event_type`            VARCHAR(64) NULL,
  `event_time`            DATETIME NULL,
  `payload`               JSON NULL COMMENT '脱敏后的回调摘要，不存身份证/人脸',
  `status`                ENUM('received','processed','ignored','failed') NOT NULL DEFAULT 'received',
  `attempts`              INT UNSIGNED NOT NULL DEFAULT 0,
  `next_retry_at`         DATETIME NULL,
  `error_message`         VARCHAR(500) NULL,
  `received_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at`          DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_esign_event` (`provider`, `event_id`),
  KEY `idx_esign_event_task` (`task_id`),
  KEY `idx_esign_event_retry` (`status`, `next_retry_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='电子签回调事件';


ALTER TABLE `acceptance_flow`
  ADD COLUMN `esign_task_id` BIGINT UNSIGNED NULL AFTER `images`,
  ADD KEY `idx_af_esign` (`esign_task_id`);
