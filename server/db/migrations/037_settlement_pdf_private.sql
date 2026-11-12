-- =====================================================================
-- 037 结算单 PDF 改私有存储
--
-- 结算单含金额明细，属于只应通过「带时效签名 URL」分发的归档物。
-- 旧实现写到 UPLOAD_DIR 并由 express.static 公开服务，链接一旦转发即
-- 永久免登录可下载，AC-L24 的临时链接约束形同虚设。
--
-- 新数据：settlement_pdf_key 指向私有存储，settlement_pdf_private = 1，
--        settlement_pdf_url 保持 NULL；
-- 历史数据：settlement_pdf_private = 0，仍按 settlement_pdf_url 读取。
-- =====================================================================

ALTER TABLE `reconciliation`
  ADD COLUMN `settlement_pdf_key` VARCHAR(512) NULL
    COMMENT '私有存储 key；与 settlement_pdf_private 一起使用'
    AFTER `settlement_pdf_url`,
  ADD COLUMN `settlement_pdf_private` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1=私有存储，只能经签名 URL 下载；0=历史公开文件'
    AFTER `settlement_pdf_key`;
