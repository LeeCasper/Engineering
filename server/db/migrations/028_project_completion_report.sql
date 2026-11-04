-- =====================================================================
-- 028 项目竣工总报告
--
-- 项目完工后，把各阶段验收、参建成员、付款节点与账务汇总生成一份 PDF，
-- 作为项目级归档材料。与验收报告一样，它是**归档产物**，不参与状态判定：
-- 生成失败只标记 failed，不影响项目已完工/已归档的事实，也允许重新生成。
--
-- 一个项目只保留当前一份总报告，因此 project_id 直接做主键；
-- 重新生成时覆盖同一行，不保留历史版本（历史版本的验收报告各自独立归档）。
--
-- file_url / file_key 同时保存：file_url 是 storage.urlFor 生成的绝对地址，
-- file_key 是存储层 key，换对象存储时两者仍然对应。
-- =====================================================================

CREATE TABLE `project_completion_report` (
  `project_id`       BIGINT UNSIGNED NOT NULL,
  `status`           ENUM('pending','success','failed') NOT NULL DEFAULT 'pending'
                     COMMENT '生成中 / 已生成 / 生成失败；失败可重试',
  `file_url`         VARCHAR(512) NULL COMMENT 'PDF 绝对地址',
  `file_key`         VARCHAR(512) NULL COMMENT '存储层 key，换对象存储时仍可用',
  `sha256`           CHAR(64)     NULL COMMENT 'PDF 内容哈希，归档校验用',
  `error`            VARCHAR(500) NULL COMMENT '失败原因，供重试入口展示',
  `generated_by`     BIGINT UNSIGNED NULL COMMENT '触发人 id；含义由 generated_by_type 决定',
  `generated_by_type` ENUM('user','admin') NULL COMMENT 'C 端用户或后台管理员，两套 id 空间不能混用',
  `generated_at`     DATETIME     NULL COMMENT '成功生成时间',
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`),
  KEY `idx_pcr_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目竣工总报告归档';
