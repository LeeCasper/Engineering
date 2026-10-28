-- ── 项目封面 / 缩略图 ──
--
-- 后台与小程序项目卡片用同一张图。存的是 storage.urlFor 生成的**绝对地址**，
-- 与汇报照片、签到照片一致；上传走 /admin/projects/cover，Key 不下发前端。
--
-- 允许为 NULL：没有封面的项目回落到各端内置的占位图，不阻断建档。
ALTER TABLE `project`
  ADD COLUMN `cover_url` VARCHAR(512) NULL COMMENT '项目封面 / 缩略图绝对地址' AFTER `remark`;
