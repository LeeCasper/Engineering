-- =====================================================================
-- 037 意见反馈图片暂存
--
-- 与 017 / 024 解决同一个问题：微信小程序的 uni.uploadFile 一次只能带一个
-- 文件，而 AC-U18 要求一条反馈可以带最多 3 张图。前端先把图片逐张传到本表，
-- 提交反馈（POST /feedback）时再在同一个事务里消费 mediaIds。
--
-- ── 为什么不能直接信任前端传回的 URL ──
-- URL 是客户端可控输入。暂存行绑定 user_id，提交时逐条校验归属与状态；
-- 只有本人、且仍是 staged 的行才能被消费。
--
-- ── 与汇报 / 签到暂存的差异 ──
-- 反馈图片**不打水印**（见 feedback.service 的说明）：用户是来报问题的，
-- 水印会压住截图里要说明的内容。因此这里只存原图地址，没有 watermark 列。
--
-- ── 清理 ──
-- 未提交的 staged 行由 feedbackMediaCleanup 在 24h 后认领为 expired 并删文件，
-- 必须先认领再删文件（与 017 / 024 相同）。
-- =====================================================================


CREATE TABLE `feedback_media_staging` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL COMMENT '上传人；只能被本人消费',
  `ext`         VARCHAR(8)      NOT NULL COMMENT '文件扩展名',
  `url`         VARCHAR(512)    NOT NULL COMMENT '图片地址；提交时写入 feedback.images',
  `size_bytes`  INT UNSIGNED    NULL,
  `status`      ENUM('staged','used','expired') NOT NULL DEFAULT 'staged'
                COMMENT 'used=已被某条反馈消费；expired=清理任务已认领，等待删文件',
  `feedback_id` BIGINT UNSIGNED NULL COMMENT '消费它的 feedback.id',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME NULL,
  PRIMARY KEY (`id`),
  -- 统计 / 消费校验：某个人还有多少张未提交的图片
  KEY `idx_feedback_staging_user` (`user_id`, `status`, `deleted_at`),
  -- 定时清理：按创建时间扫描长期未提交的暂存行
  KEY `idx_feedback_staging_cleanup` (`status`, `created_at`, `deleted_at`),
  KEY `idx_feedback_staging_feedback` (`feedback_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='意见反馈图片暂存';
