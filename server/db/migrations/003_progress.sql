-- =====================================================================
-- 003 进度域：汇报、附件、评论、完成度变更日志
--
-- 对应需求文档 §6.1 的 progress_report / progress_media /
-- progress_comment / progress_log。
-- =====================================================================


-- ── progress_report：进度汇报 ──
CREATE TABLE `progress_report` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`        BIGINT UNSIGNED NOT NULL COMMENT '冗余项目归属，汇报记录流按项目查且强制分页',
  `project_item_id`   BIGINT UNSIGNED NOT NULL COMMENT '汇报必须归属到具体工序（C-2.4）',
  `user_id`           BIGINT UNSIGNED NOT NULL COMMENT '提交人，应为该项目的工长（AC-P25）',
  `progress`          DECIMAL(5,2)    NOT NULL COMMENT '提交时的完成度，0–100 步进 5',
  `content`           TEXT            NULL COMMENT '文字说明。正文为空且无附件时不允许提交（AC-P08）',
  -- 幂等键（G-08）：断网重试不产生重复记录（AC-P10）。
  -- 由小程序端为每次「提交动作」生成一个 UUID，重试时复用同一个值。
  `client_request_id` VARCHAR(64)     NOT NULL,
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- 数据库层兜底幂等：应用层先查后插在并发下会穿透，唯一索引不会
  UNIQUE KEY `uk_report_idempotent` (`user_id`, `client_request_id`),
  KEY `idx_report_project_time` (`project_id`, `created_at`),
  KEY `idx_report_item` (`project_item_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='进度汇报';


-- progress_media：汇报附件
--
-- url 与 watermark_url 分开存的意义：原图保留（纠纷时可能要看原始信息），
-- 展示与对外分发用带水印版本（AC-P11/AC-P12）。
-- 需求文档只列了两个字段，这里补充了宽高、大小与校验和 ——
-- 前端瀑布流布局需要宽高来占位，否则图片加载时会跳动；
-- 校验和用于识别重复上传。
CREATE TABLE `progress_media` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_id`     BIGINT UNSIGNED NOT NULL,
  `type`          ENUM('image','video') NOT NULL DEFAULT 'image',
  `url`           VARCHAR(512)    NOT NULL COMMENT '原图/原视频地址',
  `watermark_url` VARCHAR(512)    NULL COMMENT '服务端叠加水印后的地址（AC-P12）。视频不做水印，为 NULL',
  `duration`      INT UNSIGNED    NULL COMMENT '视频时长（秒），用于校验 ≤ 60s（AC-P07）',
  `width`         INT UNSIGNED    NULL,
  `height`        INT UNSIGNED    NULL,
  `size_bytes`    INT UNSIGNED    NULL,
  `sort_order`    INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '展示顺序，保持用户上传时的次序',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_media_report` (`report_id`, `sort_order`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='汇报附件';


-- ── progress_comment：汇报评论 ──
CREATE TABLE `progress_comment` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_id`  BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT '冗余，便于按项目做数据权限校验时不回表',
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `content`    VARCHAR(500)    NOT NULL,
  `reply_to`   BIGINT UNSIGNED NULL COMMENT '回复的评论 ID，用于楼中楼',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_comment_report` (`report_id`, `created_at`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='汇报评论';


-- progress_log：完成度变更日志
--
-- AC-P18 要求「完成度允许下调；每次变更均写入 progress_log，
-- 记录操作人、时间与变更前后值」；AC-P19 的前端「进度变更历史」直接读本表。
CREATE TABLE `progress_log` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`       BIGINT UNSIGNED NOT NULL COMMENT '冗余，便于按项目维度查询与校验',
  `project_item_id`  BIGINT UNSIGNED NOT NULL,
  `user_id`          BIGINT UNSIGNED NOT NULL COMMENT '操作人',
  `from_progress`    DECIMAL(5,2)    NOT NULL,
  `to_progress`      DECIMAL(5,2)    NOT NULL,
  `report_id`        BIGINT UNSIGNED NULL COMMENT '由哪条汇报触发，手工调整时为 NULL',
  `remark`           VARCHAR(200)    NULL COMMENT '变更原因，下调时建议填写',
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_plog_item_time` (`project_item_id`, `created_at`),
  KEY `idx_plog_project_time` (`project_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='完成度变更日志';
