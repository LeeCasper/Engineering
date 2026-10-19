-- =====================================================================
-- 012 管理员消息
--
-- ── 为什么必须另起一张表，而不是复用 notification ──
-- `notification.user_id` 指向 **C 端 `user` 表**，而后台管理员在 `admin_user` 表 ——
-- 两者是不同的主体集合，共享一张表意味着 `user_id` 会指向两种互不相干的实体。
--
-- 这个缺口在 M7 与 M8 都被明确标记过：
--   AC-P23「工长连续未汇报 → 向**管理员**与业主各推送一次」——当时只发了业主，
--          因为把 `project.created_by`（admin_user.id）塞进 `user_id`
--          会给一个毫不相干的 C 端用户发消息，是**数据串号**而非功能缺失；
--   AC-AD61「大数据量时改为异步生成并通知下载」——导出是后台发起的，
--          完成通知自然要发给管理员。
--
-- ── 与 notification 的关系 ──
-- 两张表结构几乎一致，但**刻意不合并**：它们的接收人主体不同、
-- 已读逻辑各自的端各管各的（C 端 tab 红点 vs 后台消息铃铛），
-- 未来还可能分化（后台消息会加「处理状态」「指派给谁」而 C 端不会）。
-- 强行合并成一张多态表，之后每次改一处都要考虑另一处的兼容。
-- =====================================================================

CREATE TABLE `admin_notification` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_user_id` BIGINT UNSIGNED NOT NULL COMMENT '接收人，指向 admin_user',
  `type`          ENUM('project','account','export','system') NOT NULL
                  COMMENT '消息分类。注意与 notification.type 是**两套枚举**，不可混用',
  `title`         VARCHAR(100)    NOT NULL,
  `content`       VARCHAR(500)    NULL,
  `ref_type`      VARCHAR(32)     NULL COMMENT '关联对象类型，如 export_task、project',
  `ref_id`        BIGINT UNSIGNED NULL,
  `is_read`       TINYINT(1)      NOT NULL DEFAULT 0,
  `read_at`       DATETIME        NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- 消息列表与未读角标共用这个索引
  KEY `idx_admin_notif_user_read` (`admin_user_id`, `is_read`, `created_at`),
  KEY `idx_admin_notif_ref` (`ref_type`, `ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员消息';


-- ---------------------------------------------------------------------
-- export_task：异步导出任务（AC-AD61）
--
-- AC-AD61 要求「大数据量时改为异步生成并通知下载」。异步意味着
-- 「发起」与「完成」之间存在一个中间状态，必须持久化：
--   - 生成中的任务要让发起人能看到进度（否则页面刷新后任务就消失了）；
--   - 生成失败要能重试，且失败原因要可见；
--   - 生成好的文件要能被**同一个管理员之外的人**取用吗？不能 ——
--     导出的是项目列表，含合同金额，按 §5.1 的数据权限必须只给发起人。
--
-- 因此 `created_by` 是必填的，下载时校验「是不是发起人」。
-- ---------------------------------------------------------------------
CREATE TABLE `export_task` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_by`   BIGINT UNSIGNED NOT NULL COMMENT '发起人（admin_user）。下载时校验只能是本人',
  `status`       ENUM('pending','running','success','failed') NOT NULL DEFAULT 'pending',
  `filters`      JSON            NULL COMMENT '发起时的筛选条件快照，用于失败重试与「导出的是什么」的追溯',
  `row_count`    INT UNSIGNED    NULL COMMENT '成功时的数据行数',
  `file_url`     VARCHAR(512)    NULL,
  `error`        VARCHAR(500)    NULL COMMENT '失败原因，供发起人判断要不要调整筛选条件',
  `started_at`   DATETIME        NULL,
  `finished_at`  DATETIME        NULL,
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`   DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_export_task_owner` (`created_by`, `created_at`),
  KEY `idx_export_task_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='异步导出任务';
