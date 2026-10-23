-- =====================================================================
-- 017 进度汇报附件暂存
--
-- 解决的不是「存哪里」，而是「怎么把多文件交给一个原子提交」。
--
-- 微信小程序的 wx.uploadFile / uni.uploadFile 一次只能带一个文件，
-- 而 §7.3 的 POST /projects/:id/reports 是 multipart 一次带齐全部附件。
-- 前端无法在一次请求里同时提交 9 张照片 + 1 个视频。
--
-- 因此拆成两步：
--   1. POST /projects/:id/reports/media  单文件上传，服务端水印后写入本表；
--   2. POST /projects/:id/reports        提交汇报时带 mediaIds，把暂存行
--      在同一个事务里复制进 progress_media 并标记 used。
--
-- 为什么需要这张表，而不是让前端把 URL 传回来：
--   - URL 是客户端可控输入，直接信任等于允许把任意图片挂到汇报上；
--   - 暂存行带 project/user/item 归属，提交时逐条校验，跨项目/跨用户不可用；
--   - 未提交的文件需要可清理的元数据，否则只能在磁盘上盲扫孤儿文件。
-- =====================================================================


CREATE TABLE `report_media_staging` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`      BIGINT UNSIGNED NOT NULL,
  `project_item_id` BIGINT UNSIGNED NOT NULL COMMENT '暂存时就绑定工序，提交时不允许换工序',
  `user_id`         BIGINT UNSIGNED NOT NULL COMMENT '上传人；只能被本人提交',
  `type`            ENUM('image','video') NOT NULL DEFAULT 'image',
  `url`             VARCHAR(512)    NOT NULL COMMENT '原图/原视频地址',
  `watermark_url`   VARCHAR(512)    NULL COMMENT '服务端水印后的地址；视频为 NULL',
  `duration`        INT UNSIGNED    NULL COMMENT '视频时长（秒），客户端上报',
  `size_bytes`      INT UNSIGNED    NULL,
  `width`           INT UNSIGNED    NULL,
  `height`          INT UNSIGNED    NULL,
  `status`          ENUM('staged','used','expired') NOT NULL DEFAULT 'staged'
                    COMMENT 'used 表示已被某条汇报消费；expired 表示清理任务已认领，等待删文件',
  `report_id`       BIGINT UNSIGNED NULL COMMENT '消费它的 progress_report.id',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- 统计某个用户在某工序下已暂存多少附件，用于上传前的上限提示
  KEY `idx_staging_user_item` (`user_id`, `project_id`, `project_item_id`, `status`, `deleted_at`),
  -- 定时清理：按创建时间扫描长期未提交的暂存行
  KEY `idx_staging_cleanup` (`status`, `created_at`, `deleted_at`),
  KEY `idx_staging_report` (`report_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='进度汇报附件暂存';
