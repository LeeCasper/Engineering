-- =====================================================================
-- 024 现场签到照片暂存
--
-- 与 017 的 report_media_staging 解决同一个问题：
-- 微信小程序的 uni.uploadFile 一次只能带一个文件，而一次签到要求 1–3 张照片。
-- 前端先把照片逐张传到本表，提交签到（POST /projects/:id/visits）时
-- 再在同一个事务里消费 mediaIds。
--
-- ── 为什么不能直接信任前端传回的 URL ──
-- URL 是客户端可控输入，直接落库等于允许把任意图片挂到自己的签到记录上。
-- 暂存行绑定 project_id + user_id，提交时逐条校验归属与状态。
--
-- ── 水印为什么不在暂存时生成 ──
-- 水印内容包含「签到坐标」，坐标是提交时才最终确定的；暂存阶段只有原图。
-- 提交时服务端读取原图、叠加水印、另存一份带水印版本，
-- 原图与水印图的地址分别写入 visit_media.url / watermark_url。
--
-- ── 清理 ──
-- 未提交的 staged 行由 visitMediaCleanup 在 24h 后认领为 expired 并删除文件。
-- 必须先认领再删文件，顺序与 017 相同。
-- =====================================================================


CREATE TABLE `visit_media_staging` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL COMMENT '上传人；只能被本人消费',
  `ext`        VARCHAR(8)      NOT NULL COMMENT '原图扩展名，提交时生成水印图仍用它',
  `url`        VARCHAR(512)    NOT NULL COMMENT '原图地址；提交时据此读取并生成水印图',
  `size_bytes` INT UNSIGNED    NULL,
  `status`     ENUM('staged','used','expired') NOT NULL DEFAULT 'staged'
               COMMENT 'used=已被某条签到消费；expired=清理任务已认领，等待删文件',
  `visit_id`   BIGINT UNSIGNED NULL COMMENT '消费它的 visit_record.id',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  -- 统计 / 消费校验：某人在某项目下还有多少张未提交的照片
  KEY `idx_visit_staging_user` (`user_id`, `project_id`, `status`, `deleted_at`),
  -- 定时清理：按创建时间扫描长期未提交的暂存行
  KEY `idx_visit_staging_cleanup` (`status`, `created_at`, `deleted_at`),
  KEY `idx_visit_staging_visit` (`visit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='现场签到照片暂存';
