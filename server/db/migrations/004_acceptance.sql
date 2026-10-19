-- =====================================================================
-- 004 验收域：验收单、验收项、验收流转记录
--
-- 对应需求文档 §6.1 的 acceptance / acceptance_item / acceptance_flow，
-- 状态机见 §4.3.1：
--
--   草稿 → 待监理审核 → 待业主确认 → 已通过（终态）
--            ↓ 驳回        ↓ 驳回
--         待整改 ←──────────┘
--            ↓ 工长整改完成并重新提交
--         待监理审核（重新进入流程）
--
--   项目未配置监理时跳过「待监理审核」，提交后直接进入「待业主确认」（AC-A05）。
-- =====================================================================


-- ── acceptance：验收单 ──
CREATE TABLE `acceptance` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`       BIGINT UNSIGNED NOT NULL,
  `project_stage_id` BIGINT UNSIGNED NULL COMMENT '阶段级验收时必填',
  `project_item_id`  BIGINT UNSIGNED NULL COMMENT '工序级验收时必填',
  `type`             ENUM('stage','item') NOT NULL DEFAULT 'stage',
  `status`           ENUM('draft','pending_supervisor','pending_owner','pending_rectify','passed')
                     NOT NULL DEFAULT 'draft',
  `submitter_id`     BIGINT UNSIGNED NOT NULL COMMENT '发起人（工长）。AC-A24：仅工长可发起与重新提交',
  -- G-01：submitted_at 记录**首次提交**时刻且永不变更。
  -- 驳回后重新提交只递增 resubmit_count 并刷新 step_entered_at。
  -- 这是 AC-A22（48 小时超时）与 AC-AD39（平均验收周期）成立的前提 ——
  -- 若重新提交会覆盖 submitted_at，「平均验收周期」会被最后一次重提的时间反复重置。
  `submitted_at`     DATETIME        NULL COMMENT '首次提交时刻，永不更新',
  `current_step`     ENUM('self_check','supervisor','owner') NULL
                     COMMENT '当前所处环节，用于判定「该谁处理」与超时提醒（AC-A22）',
  `step_entered_at`  DATETIME        NULL
                     COMMENT '进入当前环节的时刻，超时提醒以此为起点；重新提交时刷新',
  `resubmit_count`   INT UNSIGNED    NOT NULL DEFAULT 0,
  `finished_at`      DATETIME        NULL COMMENT '通过时间，用于统计平均验收周期',
  `signature_url`    VARCHAR(512)    NULL COMMENT '业主手写电子签名图片（C-3.7、AC-A16）',
  `report_pdf_url`   VARCHAR(512)    NULL,
  `report_pdf_status` ENUM('pending','success','failed') NOT NULL DEFAULT 'pending'
                     COMMENT 'G-04：区分「未生成/生成中/失败」，否则 url 为空时无法判断（AC-A19）',
  `report_pdf_error` VARCHAR(500)    NULL COMMENT '生成失败原因，供重试入口展示',
  `description`      VARCHAR(1000)   NULL COMMENT '验收说明（C-3.2）',
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- AC-A03：同一阶段存在未终结验收单（草稿/待监理审核/待业主确认/待整改）时，
  -- 重复发起返回 409。该校验须在事务内加锁执行，索引是加锁的基础 ——
  -- 没有它，SELECT ... FOR UPDATE 会退化成锁全表。
  KEY `idx_acc_stage_status` (`project_stage_id`, `status`, `deleted_at`),
  KEY `idx_acc_project_status` (`project_id`, `status`, `deleted_at`),
  -- AC-A22 的 48 小时超时扫描：按「当前环节 + 进入时刻」找超时单
  KEY `idx_acc_step_entered` (`current_step`, `step_entered_at`, `status`),
  KEY `idx_acc_submitter` (`submitter_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='验收单';


-- ── acceptance_item：验收项 ──
CREATE TABLE `acceptance_item` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `acceptance_id` BIGINT UNSIGNED NOT NULL,
  `seq`           INT UNSIGNED    NOT NULL,
  `name`          VARCHAR(200)    NOT NULL COMMENT '如「强弱电分管分槽，间距 ≥ 30cm」',
  `result`        ENUM('pass','fail') NULL COMMENT '未勾选时为 NULL',
  `remark`        VARCHAR(500)    NULL,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_acceptance_seq` (`acceptance_id`, `seq`),
  KEY `idx_ai_acceptance` (`acceptance_id`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='验收项';


-- acceptance_flow：验收流转记录
--
-- ── 只追加表 ──
-- 需求文档 §6.2 明确：任何角色（含管理员）不得 UPDATE 或 DELETE，
-- 对应 AC-A14（重新提交时此前流转记录不被覆盖）与 AC-A26（流转记录只读）。
-- 数据库层无法直接禁止 UPDATE（MySQL 没有表级只读约束），
-- 因此这条约束由**仓储层强制**：src/models/acceptanceFlow.model.js 不导出
-- update / delete 方法。任何绕过它的写法都应在 code review 中被拦下。
--
-- images 与 reason 均可能为空，但驳回时 reason 必填由服务层校验（AC-A11）。
CREATE TABLE `acceptance_flow` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `acceptance_id` BIGINT UNSIGNED NOT NULL,
  `round`         INT UNSIGNED    NOT NULL DEFAULT 1
                  COMMENT '第几轮。驳回后重新提交递增，用于把多轮记录分组展示',
  `step`          ENUM('self_check','supervisor','owner') NOT NULL,
  `operator_id`   BIGINT UNSIGNED NOT NULL,
  `action`        ENUM('submit','approve','reject') NOT NULL,
  `reason`        VARCHAR(500)    NULL COMMENT '驳回原因，驳回时必填（AC-A11）',
  `images`        JSON            NULL COMMENT '驳回时附带的照片，结构：[{"url":"...","watermarkUrl":"..."}]（AC-A12）',
  `operated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_af_acceptance` (`acceptance_id`, `round`, `operated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='验收流转记录（只追加）';
