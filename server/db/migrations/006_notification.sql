-- =====================================================================
-- 006 消息域：notification / reminder_log / user_subscription（§6.1）
--
-- 三张表分工容易混淆：
--   notification      给用户看的**内容**，有已读状态，驱动 tab 红点
--   reminder_log      系统「发过没发过」的**事实记录**，与用户是否看到无关
--   user_subscription 用户对每个微信消息模板的**授权状态**
--
-- reminder_log 不能靠反查 notification 去重（G-06）：用户未授权订阅消息时，
-- 微信推送发不出去但站内消息仍要生成，两者不是一一对应，用 notification 去重
-- 会把「微信没发」误判成「已提醒过」。
-- =====================================================================


-- notification：站内消息
--
-- 需求文档 §4.5.1 AC-U06：消息中心覆盖验收通知、进度提醒、付款提醒、
-- 评论回复四类；AC-U08 要求点击后跳转到对应业务详情页 ——
-- 跳转由 ref_type + ref_id 支撑，前端据此路由。
CREATE TABLE `notification` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED NOT NULL COMMENT '接收人',
  `project_id` BIGINT UNSIGNED NULL COMMENT '关联项目，切换项目时用于过滤',
  `type`       ENUM('acceptance','progress','payment','comment','system') NOT NULL
               COMMENT 'acceptance/progress/payment/comment 四类（AC-U06）+ system 兜底',
  `title`      VARCHAR(100)    NOT NULL,
  `content`    VARCHAR(500)    NULL,
  `ref_type`   VARCHAR(32)     NULL COMMENT '如 acceptance、report、payment_node',
  `ref_id`     BIGINT UNSIGNED NULL,
  `is_read`    TINYINT(1)      NOT NULL DEFAULT 0,
  `read_at`    DATETIME        NULL COMMENT 'AC-U09 单条已读 / 全部已读',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- 消息列表 + 未读红点计数（AC-U07）共用这个索引
  KEY `idx_notif_user_read` (`user_id`, `is_read`, `created_at`),
  KEY `idx_notif_user_type` (`user_id`, `type`, `created_at`),
  KEY `idx_notif_ref` (`ref_type`, `ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内消息';


-- reminder_log：提醒发送记录
--
-- 唯一索引 (type, ref_type, ref_id, target_user_id) 是 AC-P23 / AC-A22
-- 「同一提醒只发一次、第 4 天不重复推送」的**实现方式本身**：
-- 发送前先插入，插入成功才发，撞唯一键就说明已经发过。
-- 用「插入-捕获重复键」而不是「先查询再插入」，是因为后者在并发下
-- （定时任务多实例部署）会双发，而唯一索引不会。
CREATE TABLE `reminder_log` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`     BIGINT UNSIGNED NULL,
  -- stale_report=连续未汇报（AC-P23）；acceptance_timeout=验收超时（AC-A22）；
  -- big_expense=大额支出（AC-L30）；abnormal_checkin=异常签到（AC-N20）
  -- （COMMENT 必须为单个字符串字面量，MySQL 的 DDL 解析器不支持 'a' 'b' 拼接）
  `type`           ENUM('stale_report','acceptance_timeout','big_expense','abnormal_checkin') NOT NULL
                   COMMENT '提醒类型：未汇报/验收超时/大额支出/异常签到',
  `ref_type`       VARCHAR(32)     NOT NULL COMMENT '业务对象类型，如 project、acceptance、ledger',
  `ref_id`         BIGINT UNSIGNED NOT NULL,
  `target_user_id` BIGINT UNSIGNED NOT NULL,
  `channel`        ENUM('subscribe','inapp') NOT NULL DEFAULT 'inapp'
                   COMMENT 'subscribe=微信订阅消息；inapp=仅站内（用户未授权时的兜底，AC-L31）',
  `sent_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_reminder_once` (`type`, `ref_type`, `ref_id`, `target_user_id`),
  KEY `idx_reminder_project` (`project_id`, `type`, `sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='提醒发送记录';


-- user_subscription：订阅消息授权状态
--
-- AC-U11 要求「按业务流程在恰当时机引导授权，不在启动时一次性索要全部权限」；
-- AC-U12 要求「用户拒绝后不再重复弹窗骚扰」。要满足后者，
-- 就必须记住「这个用户对这个模板已经拒绝过」—— 这正是本表的作用。
--
-- status='ban' 是微信侧的长期拒绝状态（用户在设置里勾选了「不再询问」），
-- 与一次性拒绝区分开：前者不该再引导，后者可以换个时机再问。
CREATE TABLE `user_subscription` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `template_id` VARCHAR(64)     NOT NULL COMMENT '微信订阅消息模板 ID（B-5.7 各业务消息分别配置）',
  `template_key` VARCHAR(64)    NULL COMMENT '业务语义键，如 progress_comment、acceptance_todo，避免代码里硬编码模板 ID',
  `status`      ENUM('accepted','rejected','ban') NOT NULL,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_us_user_template` (`user_id`, `template_id`),
  KEY `idx_us_template_key` (`template_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订阅消息授权';
