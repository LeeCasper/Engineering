-- =====================================================================
-- 035 管理员消息去重
--
-- AC-P23 要求「工长连续多日未汇报」对管理员只提醒一次（每个静默周期）。
-- 旧实现只对 C 端 notification 用 reminder_log 去重，管理员这一路是裸
-- INSERT；定时任务每小时跑一次，就会每小时重复插入。
--
-- 这里按 (接收人, 类型, 关联对象类型, 关联对象 id) 建唯一键，让「同一件事
-- 对同一个管理员」只有一行。ref_id 为 NULL 的消息不受约束（MySQL 唯一键
-- 不约束 NULL），与现有语义一致。
-- =====================================================================

-- 先清掉历史重复行（保留最早一条），否则唯一键加不上
DELETE n1
  FROM `admin_notification` n1
  JOIN `admin_notification` n2
    ON n1.`admin_user_id` = n2.`admin_user_id`
   AND n1.`type` = n2.`type`
   AND n1.`ref_type` <=> n2.`ref_type`
   AND n1.`ref_id` <=> n2.`ref_id`
   AND n1.`id` > n2.`id`;

ALTER TABLE `admin_notification`
  ADD UNIQUE KEY `uk_admin_notif_dedupe`
    (`admin_user_id`, `type`, `ref_type`, `ref_id`);
