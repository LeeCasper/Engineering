-- =====================================================================
-- 038 手写签名改私有存储
--
-- 签名图片包含业主 / 工长 / 监理的姓名笔迹，是验收与结算纠纷时的关键证据。
-- 旧实现写到 UPLOAD_DIR 由 express.static 公开服务，链接一旦泄露即永久可下载。
--
-- 新数据：signature_key 指向私有存储，signature_url 置 NULL；
-- 历史数据：signature_url 保留公开地址，signature_key 为 NULL，
--          阅读侧按「有 key 读私有，无 key 读旧 URL」兼容。
-- =====================================================================

ALTER TABLE `acceptance_flow`
  ADD COLUMN `signature_key` VARCHAR(512) NULL
    COMMENT '手写签名图片的私有存储 key；历史记录为 NULL'
    AFTER `signature_url`;

ALTER TABLE `acceptance`
  ADD COLUMN `signature_key` VARCHAR(512) NULL
    COMMENT '业主签名的私有存储 key（兼容字段）；历史记录为 NULL'
    AFTER `signature_url`;
