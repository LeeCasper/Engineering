-- =====================================================================
-- 005 记账域：付款节点、流水、对账单 / 阶段结算单、对账明细
--
-- 对应需求文档 §6.1 的 payment_node / ledger / reconciliation /
-- reconciliation_detail。
--
-- 重要前提：**本域不含任何支付功能**（§4.4.3）。所有款项走线下转账，
-- 系统只做三件事：记账、付款节点提醒、双方对账确认。
-- 「已付款」仅代表账目登记状态，不代表系统内发生过任何资金划转（AC-L17）。
-- =====================================================================


-- ── payment_node：付款节点 ──
CREATE TABLE `payment_node` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`        BIGINT UNSIGNED NOT NULL,
  `seq`               INT UNSIGNED    NOT NULL COMMENT '展示顺序，如 定金 → 开工款 → 水电验收款 → 竣工尾款',
  `name`              VARCHAR(50)     NOT NULL,
  `amount`            DECIMAL(12,2)   NOT NULL COMMENT '节点金额。各节点之和与合同额不一致时后台告警但允许保存（AC-L18）',
  `trigger_type`      ENUM('manual','stage_acceptance') NOT NULL DEFAULT 'manual'
                      COMMENT 'manual=管理员手工解锁（AC-L15）；stage_acceptance=关联阶段验收通过后自动解锁（AC-L14）',
  `trigger_stage_id`  BIGINT UNSIGNED NULL COMMENT 'trigger_type=stage_acceptance 时必填；只能选本项目已有阶段（AC-AD22）',
  `status`            ENUM('not_started','unlocked','paid','confirmed') NOT NULL DEFAULT 'not_started'
                      COMMENT '单向流转，跳级返回 409（AC-L13）',
  `unlocked_at`       DATETIME        NULL,
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pn_project_seq` (`project_id`, `seq`),
  KEY `idx_pn_project` (`project_id`, `deleted_at`),
  KEY `idx_pn_trigger_stage` (`trigger_stage_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='付款节点';


-- ledger：账目流水
--
-- ── 关于「条件唯一索引」──
-- 需求文档 §6.2 要求：对 payment_node_id 建条件唯一索引
-- （仅 type='income' AND deleted_at IS NULL），从数据库层保证
-- 「一个付款节点只有一条收入流水」（AC-L05）。
--
-- MySQL 8 **没有** partial index（PostgreSQL 的 WHERE 子句式索引）。
-- 标准替代方案是「生成列 + 唯一索引」：把不满足条件的行折叠成 NULL，
-- 而唯一索引不约束 NULL，于是这些行自然不参与约束。
-- 语义与条件唯一索引等价。
--
-- 注意生成列必须为 STORED：VIRTUAL 生成列不能建唯一索引。
-- 且 STORED 生成列在 deleted_at 变化时会重算 ——
-- 软删除一条已对账的收入后，该付款节点即可重新登记，这正是期望行为。
CREATE TABLE `ledger` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`      BIGINT UNSIGNED NOT NULL,
  -- G-22：阶段归属**必填**。历史数据若无法归属，挂到系统保留的「未归类」阶段，
  -- 避免 NULL 导致按阶段汇总漏算（AC-S03）。
  `project_stage_id` BIGINT UNSIGNED NOT NULL COMMENT '必填（C-4.11）',
  `type`            ENUM('income','expense') NOT NULL COMMENT '收入=业主付款；支出=工长支出',
  `category`        ENUM('material','labor','transport','other') NULL
                    COMMENT '支出分类，仅这四种预设枚举（AC-L06）。收入为 NULL',
  `amount`          DECIMAL(12,2)   NOT NULL COMMENT '必须 > 0，两位小数（AC-L03）',
  `occurred_at`     DATE            NOT NULL COMMENT '发生日期，对账周期按它划分',
  `remark`          VARCHAR(500)    NULL,
  `payment_node_id` BIGINT UNSIGNED NULL COMMENT '收入关联的付款节点（AC-L05）。支出为 NULL',
  `receipt_images`  JSON            NULL COMMENT '票据照片，最多 3 张（AC-L02）：[{"url":"..."}]',
  `created_by`      BIGINT UNSIGNED NOT NULL,
  `locked`          TINYINT(1)      NOT NULL DEFAULT 0
                    COMMENT '对账确认后置 1，禁止 UPDATE（AC-L20）。更正只能新增红冲记录',
  `is_reversal`     TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '本行是否为红冲记录（G-02）',
  `reversal_of_id`  BIGINT UNSIGNED NULL COMMENT '本行红冲的是哪条原记录（AC-L23 双向追溯）',
  `reversed_by_id`  BIGINT UNSIGNED NULL COMMENT '本行被哪条红冲记录冲销',
  `payment_node_uniq` BIGINT UNSIGNED GENERATED ALWAYS AS (
      IF(`type` = 'income' AND `deleted_at` IS NULL, `payment_node_id`, NULL)
    ) STORED COMMENT '仅用于唯一索引，实现条件唯一：非收入行与已删除行折叠为 NULL 不参与约束',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ledger_payment_node_income` (`payment_node_uniq`),
  -- 流水列表：按项目 + 时间倒序 + 类型/分类筛选（C-4.2），强制分页（AC-L29）
  KEY `idx_ledger_project_time` (`project_id`, `occurred_at`, `deleted_at`),
  KEY `idx_ledger_project_type` (`project_id`, `type`, `occurred_at`),
  KEY `idx_ledger_stage` (`project_stage_id`, `deleted_at`),
  KEY `idx_ledger_reversal_of` (`reversal_of_id`),
  KEY `idx_ledger_reversed_by` (`reversed_by_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='账目流水';


-- reconciliation：对账单 / 阶段结算单
--
-- 一张表承载两种单据，由 scope_type 区分（G-23）：
--   scope_type='stage'   阶段结算单：project_stage_id 必填，period_* 为空
--   scope_type='period'  周期对账单：period_* 必填，project_stage_id 为空
--
-- 合并的理由：两者的字段、状态流转、确认动作完全一致，仅「统计范围」的定义不同。
-- 拆两张表意味着确认逻辑、红冲逻辑、PDF 生成逻辑全都要写两遍。
-- AC-S15 要求两者并存时金额口径一致、同一笔流水不被重复统计 ——
-- 同表存储让这个校验可以一次 SQL 完成，拆表则要跨表 JOIN。
CREATE TABLE `reconciliation` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`         BIGINT UNSIGNED NOT NULL,
  `scope_type`         ENUM('stage','period') NOT NULL DEFAULT 'period',
  `project_stage_id`   BIGINT UNSIGNED NULL COMMENT 'scope_type=stage 时必填',
  `period_start`       DATE            NULL COMMENT 'scope_type=period 时必填',
  `period_end`         DATE            NULL,
  `status`             ENUM('draft','pending','confirmed','disputed') NOT NULL DEFAULT 'draft'
                       COMMENT '有异议时置 disputed，退回工长处理（C-7.8 / AC-L21）',
  `total_amount`       DECIMAL(12,2)   NOT NULL DEFAULT 0.00 COMMENT '提交时的金额快照，避免明细变动后金额口径漂移',
  `income_amount`      DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  `expense_amount`     DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  `submitted_by`       BIGINT UNSIGNED NULL,
  `submitted_at`       DATETIME        NULL,
  `confirmed_by`       BIGINT UNSIGNED NULL,
  `confirmed_at`       DATETIME        NULL,
  `remark`             VARCHAR(500)    NULL,
  `settlement_pdf_url` VARCHAR(512)    NULL COMMENT 'G-03：结算单 PDF（AC-L24 / AC-S14）',
  `settlement_generated_at` DATETIME   NULL,
  `created_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`         DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rec_project_status` (`project_id`, `status`, `deleted_at`),
  -- 「一个阶段在任一时刻只能有一张未终结的结算单」（§6.2）。
  -- 同样因为 MySQL 唯一索引不约束 NULL，这里不建唯一索引，
  -- 该约束由服务层在事务内加锁后校验（并发下唯一索引也无法表达「状态非 confirmed」这个条件）。
  KEY `idx_rec_stage` (`project_stage_id`, `status`),
  KEY `idx_rec_period` (`project_id`, `period_start`, `period_end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对账单 / 阶段结算单';


-- reconciliation_detail：对账明细
--
-- 一行业务含义是「某张单据包含某条流水，以及业主对该条是否有异议」。
-- 按 ledger_id 关联而非拷贝金额：金额以 ledger 为准，
-- 避免明细快照与流水本身不一致（AC-S15 的金额口径一致要求）。
CREATE TABLE `reconciliation_detail` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reconciliation_id` BIGINT UNSIGNED NOT NULL,
  `ledger_id`         BIGINT UNSIGNED NOT NULL,
  `dispute`           TINYINT(1)      NOT NULL DEFAULT 0,
  `dispute_remark`    VARCHAR(500)    NULL COMMENT '异议说明，dispute=1 时必填（AC-L21 / C-7.7）',
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- 同一张单据里同一条流水只能出现一次，否则合计会重复计算
  UNIQUE KEY `uk_rd_rec_ledger` (`reconciliation_id`, `ledger_id`),
  KEY `idx_rd_ledger` (`ledger_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对账明细';
