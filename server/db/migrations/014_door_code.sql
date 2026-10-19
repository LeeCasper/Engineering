-- =====================================================================
-- 014 门锁密码（§4.8 / AC-K01 ~ AC-K16）
--
-- 本项目**敏感级别最高**的一张表：它存的是能打开业主家门的凭证。
-- 泄露的后果与「合同金额被人看到」不是一个量级，因此它的处理规则
-- 与其余模块刻意不同（可逆加密、读取留痕、管理员无权查看）。
-- 详见 CLAUDE.md 第 44 条。
-- =====================================================================


-- ── project_door_code：门锁密码条目 ──
--
-- ── 为什么用可逆加密而不是 bcrypt ──
-- bcrypt 是单向的：存进去就取不出明文。而 C-8.5 明确要求密码在工长与
-- 监理端**直接展示明文** —— 单向哈希在这一步就走不通。
-- （「直接展示明文」这个产品决策本身见 §4.8.3，那是已确认的取舍。）
--
-- ── 密文格式 v1.<iv>.<authTag>.<ciphertext>（全部 base64url）──
-- 版本前缀不是为了好看：将来换算法（如改密钥长度、改 GCM 为 ChaCha20）
-- 时，老数据仍能按 v1 解开，不需要一次性停机迁移所有密文。
-- 没有这个前缀，「换个算法」就等于「所有现存密码全部作废」。
CREATE TABLE `project_door_code` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`  BIGINT UNSIGNED NOT NULL,
  `name`        VARCHAR(50)     NOT NULL COMMENT '条目名称，如「入户门」「单元门」',
  -- 密文比明文长：AES-GCM 的 12 字节 IV + 16 字节认证标签都要一并落库
  `code_cipher` VARCHAR(512)    NOT NULL COMMENT 'AES-256-GCM 密文，格式 v1.<iv>.<authTag>.<ciphertext>',
  `remark`      VARCHAR(200)    NULL COMMENT '备注，如「锁上有个红点要按住」',
  `status`      ENUM('active','revoked') NOT NULL DEFAULT 'active',
  `created_by`  BIGINT UNSIGNED NOT NULL COMMENT '创建人（必为业主）',
  `revoked_at`  DATETIME        NULL,
  `revoked_by`  BIGINT UNSIGNED NULL,
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- 列表查询固定是「某项目的、未失效的条目」（AC-K16 多条各自独立失效）
  KEY `idx_door_code_project` (`project_id`, `status`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='门锁密码条目';


-- ── reminder_log.type 增加一个取值：door_code_risk ──
--
-- AC-K15 要求「项目归档或成员被移除时，业主收到『建议更换门锁密码』提醒，
-- **同一事件不重复推送**」。去重靠的正是 reminder_log 上的
-- 唯一索引 (type, ref_type, ref_id, target_user_id)，
-- 因此这个提醒必须有自己的 type —— 借用 `abnormal_checkin` 之类会让
-- 「本月发了多少条异常签到提醒」这类统计把门锁提醒也算进去。
--
-- ENUM 扩展必须 MODIFY 成完整的新列表（MySQL 没有「向 ENUM 追加值」的语法）。
-- 值顺序保持原有顺序不变，只在末尾追加：既有的行不会因为重排而错位。
ALTER TABLE `reminder_log`
  MODIFY COLUMN `type` ENUM('stale_report','acceptance_timeout','big_expense','abnormal_checkin','door_code_risk')
  NOT NULL COMMENT '提醒类型：未汇报/验收超时/大额支出/异常签到/门锁密码风险';
