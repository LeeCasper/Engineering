-- =====================================================================
-- 034 验收报告编号
--
-- 旧编号只是 `AC-{验收单 id}`（例如 AC-000004），看不出日期与项目，
-- 打印归档后很难定位「这是哪个项目、哪天的报告」。
--
-- 新编号：AC-{YYYYMMDD}-{项目 id}-{验收单 id 6 位}
--   例：AC-20261105-8092-000040
-- 日期取验收通过日（finished_at），同一份验收单重试生成时编号不变。
--
-- 编号在生成 PDF 时写入 `acceptance.report_no`，列表接口原样返回，
-- 保证 App / 网页看到的编号与 PDF 上印的一致。
--
-- 已生成的旧报告**回填旧编号**（AC-{id}）：PDF 已经归档，改编号会让
-- 归档文件与系统对不上；旧报告继续显示它 PDF 上的编号。
-- =====================================================================

ALTER TABLE `acceptance`
  ADD COLUMN `report_no` VARCHAR(40) NULL
    COMMENT '验收报告编号；旧报告回填 AC-{id}，新报告为 AC-{日期}-{项目}-{id}'
    AFTER `report_pdf_error`,
  ADD UNIQUE KEY `uk_acceptance_report_no` (`report_no`);

UPDATE `acceptance`
   SET `report_no` = CONCAT('AC-', LPAD(`id`, 6, '0'))
 WHERE `report_pdf_status` = 'success'
   AND `report_no` IS NULL;
