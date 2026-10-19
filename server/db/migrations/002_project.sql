-- =====================================================================
-- 002 项目域：项目、成员、阶段模板、项目阶段与工序实例
--
-- 对应需求文档 §6.1 的 project / project_member / stage_template /
-- stage_template_stage / stage_template_item / project_stage / project_item。
--
-- 两张「模板」与「实例」的关系是本域的核心：
--   模板（stage_template*）是施工流程的定义，可复用、可编辑；
--   实例（project_stage / project_item）是建档时按模板**拷贝**出来的副本。
-- 因此编辑模板不影响已生成的项目（AC-AD17），这是天然隔离而非额外逻辑。
-- =====================================================================


-- ── project：项目表 ──
CREATE TABLE `project` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`            VARCHAR(50)     NOT NULL COMMENT '项目名称，≤50 字',
  `address`         VARCHAR(200)    NOT NULL COMMENT '详细地址，≤200 字',
  -- 全系统坐标统一 GCJ-02（§6.2）。任何来源的 WGS-84 / BD-09 必须在写入前转换，
  -- 混存会导致导航落点偏移数百米（AC-N03）。
  `longitude`       DECIMAL(10,7)   NULL COMMENT 'GCJ-02 经度，约 1cm 精度',
  `latitude`        DECIMAL(10,7)   NULL COMMENT 'GCJ-02 纬度',
  `geocoded_at`     DATETIME        NULL COMMENT '地理编码时间。地址变更时置 NULL 并触发重新解析',
  `area`            DECIMAL(10,2)   NULL COMMENT '户型面积（㎡）',
  `contract_amount` DECIMAL(12,2)   NOT NULL COMMENT '合同金额，必须 > 0',
  `start_date`      DATE            NOT NULL COMMENT '开工日期',
  `plan_end_date`   DATE            NOT NULL COMMENT '计划竣工日期，不得早于开工日期（AC-AD14）',
  `actual_end_date` DATE            NULL COMMENT '实际竣工日期（G-09），用于 AC-P24 的延期判定',
  `status`          ENUM('pending','building','finished','archived') NOT NULL DEFAULT 'pending'
                    COMMENT '待开工/施工中/已完工/已归档，单向流转（B-2.10）',
  `template_id`     BIGINT UNSIGNED NULL COMMENT '建档时使用的阶段模板，仅供追溯，不影响已生成的实例',
  `remark`          VARCHAR(500)    NULL COMMENT '备注，≤500 字（新建项目表单字段）',
  `created_by`      BIGINT UNSIGNED NOT NULL COMMENT '创建者。项目管理员的数据权限以它为准（§5.1）',
  `archived_at`     DATETIME        NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_project_status` (`status`, `deleted_at`),
  KEY `idx_project_created_by` (`created_by`, `deleted_at`),
  KEY `idx_project_name` (`name`),
  KEY `idx_project_template` (`template_id`),
  -- 看板按「按期 / 延期」筛选要拿 plan_end_date 与当前日期比较（§5.4 统计口径）
  KEY `idx_project_plan_end` (`plan_end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目';


-- project_member：项目成员关系
--
-- 一个用户可在不同项目中担任不同角色（§2.2 说明），因此角色挂在**关系**上，
-- 而不是挂在 user 表上。权限一律按 (project_id, user_id) 判定。
CREATE TABLE `project_member` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`   BIGINT UNSIGNED NOT NULL,
  `user_id`      BIGINT UNSIGNED NOT NULL,
  `role`         ENUM('foreman','supervisor','owner') NOT NULL
                 COMMENT '工长/监理/业主。人数约束：工长必须且仅 1 人、业主至少 1 人（AC-AD58）',
  `status`       ENUM('pending','active','removed') NOT NULL DEFAULT 'pending'
                 COMMENT 'pending 表示已邀请未确认，**不计入任何权限判定**（AC-AD18）',
  `invited_by`   BIGINT UNSIGNED NULL COMMENT '邀请人（后台管理员）',
  `joined_at`    DATETIME        NULL,
  `confirmed_at` DATETIME        NULL COMMENT '被邀请人在小程序确认的时间',
  `left_at`      DATETIME        NULL COMMENT '解除关系时间（AC-AD21，历史记录保留）',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`   DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- 同一用户在同一项目内只能有一个角色（AC-AD20：重复分配应提示替换而非新增）
  UNIQUE KEY `uk_pm_project_user` (`project_id`, `user_id`),
  KEY `idx_pm_user` (`user_id`, `status`),
  KEY `idx_pm_project_role` (`project_id`, `role`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目成员关系';


-- ── stage_template：阶段模板 ──
CREATE TABLE `stage_template` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(50)     NOT NULL,
  `is_default` TINYINT(1)      NOT NULL DEFAULT 0
               COMMENT '默认模板。系统始终保留至少一个，且不可删除（AC-AD33）',
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_template_default` (`is_default`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='阶段模板';


-- ── stage_template_stage：模板下的阶段 ──
CREATE TABLE `stage_template_stage` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `template_id` BIGINT UNSIGNED NOT NULL,
  `name`        VARCHAR(50)     NOT NULL,
  `seq`         INT UNSIGNED    NOT NULL COMMENT '展示顺序，模板编辑器拖拽后整体重写（AC-AD29）',
  `plan_days`   INT UNSIGNED    NOT NULL COMMENT '计划工期天数，仅接受正整数（AC-AD30）',
  `weight`      DECIMAL(5,2)    NULL COMMENT '阶段权重，未配置时按等权平均（G-15、AC-P16）',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME        NULL,
  PRIMARY KEY (`id`),
  -- 保证排序稳定：同一模板内序号不可重复，否则拖拽保存后顺序不确定
  UNIQUE KEY `uk_sts_template_seq` (`template_id`, `seq`),
  KEY `idx_sts_template` (`template_id`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模板阶段';


-- ── stage_template_item：模板下的工序 ──
CREATE TABLE `stage_template_item` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `template_stage_id` BIGINT UNSIGNED NOT NULL,
  `name`              VARCHAR(50)     NOT NULL,
  `seq`               INT UNSIGNED    NOT NULL,
  `weight`            DECIMAL(5,2)    NULL COMMENT '工序权重，仅接受正数（AC-AD23）',
  -- 结构示例：[{"name":"强弱电分管分槽，间距 ≥ 30cm"}]
  -- 注意：COMMENT 必须写成**单个**字符串字面量。MySQL 在 SELECT 里支持
  -- 'a' 'b' 这样的相邻字面量拼接，但 DDL 的 COMMENT 子句解析器不接受，会报 1064。
  `default_checklist` JSON            NULL
                      COMMENT '默认验收项清单（B-3.5/AC-AD32），生成项目验收单时带入',
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sti_stage_seq` (`template_stage_id`, `seq`),
  KEY `idx_sti_stage` (`template_stage_id`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模板工序';


-- project_stage：项目阶段实例
--
-- ── 关于这里同时存在 status 与 gate_status ──
-- 两者不是冗余，职责不同，但**必须明确各自的事实来源**，否则会出现
-- 「时间轴显示进行中、门禁却认为已结清」这类自相矛盾：
--
--   gate_status  门禁状态，**单一事实来源**（§6.2）。锁定/解锁、能否发起验收
--                以它为准。进度的写入门禁、验收的发起校验都读它。
--   status       展示状态（AC-P02 的 未开始/进行中/已完成/已验收）。
--                它是由 progress 与验收结论**派生**的，没有手工设置入口，
--                由服务层在进度更新与验收通过时同步写入。
--
-- 之所以不合并成一个字段：§4.7.1 的状态机里 `accepted`（验收通过待结算）
-- 与 `pending_acceptance`（进度满待验收）在展示层都要呈现为「已验收」，
-- 合并后前端就得反推，反推逻辑分散到各页面更易出错。
CREATE TABLE `project_stage` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`  BIGINT UNSIGNED NOT NULL,
  `name`        VARCHAR(50)     NOT NULL,
  `seq`         INT UNSIGNED    NOT NULL,
  `weight`      DECIMAL(5,2)    NULL COMMENT '阶段权重，未配置时按等权平均（G-15）',
  `status`      ENUM('not_started','in_progress','completed','accepted') NOT NULL DEFAULT 'not_started'
                COMMENT '展示状态，由 progress 与验收结论派生，无手工设置入口（AC-P02）',
  `gate_status` ENUM('locked','active','pending_acceptance','accepted','disputed','settled')
                NOT NULL DEFAULT 'locked'
                COMMENT '门禁状态，单一事实来源。首个阶段建档时置 active（C-7.4）',
  `plan_start`  DATE            NULL,
  `plan_end`    DATE            NULL,
  `actual_start` DATE           NULL COMMENT 'G-09',
  `actual_end`  DATE            NULL,
  `progress`    DECIMAL(5,2)    NOT NULL DEFAULT 0.00
                COMMENT '阶段完成度 = 各工序按权重加权平均（§4.2.1），由服务层汇总写入',
  `unlocked_at` DATETIME        NULL,
  `settled_at`  DATETIME        NULL,
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ps_project_seq` (`project_id`, `seq`),
  KEY `idx_ps_project` (`project_id`, `deleted_at`),
  KEY `idx_ps_gate` (`project_id`, `gate_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目阶段实例';


-- ── project_item：项目工序实例 ──
CREATE TABLE `project_item` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_stage_id` BIGINT UNSIGNED NOT NULL,
  `name`             VARCHAR(50)     NOT NULL,
  `seq`              INT UNSIGNED    NOT NULL,
  `weight`           DECIMAL(5,2)    NULL COMMENT '工序权重，仅接受正数（AC-AD23）',
  `progress`         DECIMAL(5,2)    NOT NULL DEFAULT 0.00
                     COMMENT '完成度 0–100，步进 5%（AC-P06）',
  `status`           ENUM('not_started','in_progress','completed') NOT NULL DEFAULT 'not_started'
                     COMMENT '完成度为 0 时显示「未开始」（AC-P04）',
  `plan_start`       DATE            NULL COMMENT 'G-12，用于工序级延期判断（AC-P24）',
  `plan_end`         DATE            NULL,
  `checklist`        JSON            NULL COMMENT '自检清单，由模板的 default_checklist 带入',
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pi_stage_seq` (`project_stage_id`, `seq`),
  KEY `idx_pi_stage` (`project_stage_id`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目工序实例';
