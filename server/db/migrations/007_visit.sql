-- =====================================================================
-- 007 考察域：路线方案、途经点、现场签到、签到照片
--
-- 对应需求文档 §6.1 的 route_plan / route_plan_point / visit_record /
-- visit_media，机制说明见 §4.6。
--
-- 这一域在 V1.2 才交付（§10 迭代规划），但表结构一次建全 ——
-- 后续迭代只加列不改表，比在已有数据上做结构变更安全得多。
-- =====================================================================


-- route_plan：考察计划（保存下来的多项目路线方案）
--
-- plan_hash = 「起点坐标 + 途经点项目 ID 有序集合 + 各项目坐标版本」的哈希
-- （§6.2）。它同时服务两件事：
--   AC-N14  5 分钟内的相同请求命中缓存，不重复消耗地图配额；
--   AC-N10  项目经纬度变更后，引用该项目的已存路线能判定为「需重新规划」。
-- 用一个字段支撑两件事，是因为两者的判定条件本质相同，都是「这组输入变了吗」。
CREATE TABLE `route_plan` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_id`       BIGINT UNSIGNED NOT NULL COMMENT '创建者（工长/监理）。路线方案是个人资产，不跨用户共享',
  `name`           VARCHAR(50)     NOT NULL COMMENT '方案名，如「周二上午 · 三个工地」',
  `origin_type`    ENUM('current','custom') NOT NULL DEFAULT 'current'
                   COMMENT 'current=以当前位置为起点；custom=手动指定起点（如公司）（C-6.4）',
  `origin_lat`     DECIMAL(10,7)   NULL,
  `origin_lng`     DECIMAL(10,7)   NULL,
  `origin_name`    VARCHAR(100)    NULL COMMENT '起点名称，如「公司」「家」',
  `point_count`    INT UNSIGNED    NOT NULL DEFAULT 0,
  `total_distance` DECIMAL(10,2)   NULL COMMENT '总里程（米）',
  `total_duration` INT UNSIGNED    NULL COMMENT '预计总耗时（秒）',
  `plan_hash`      CHAR(64)        NOT NULL COMMENT 'sha256，用于结果缓存与失效判定',
  `stale_at`       DATETIME        NULL COMMENT '被标记为「需重新规划」的时间（AC-N10）',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rp_owner` (`owner_id`, `deleted_at`),
  KEY `idx_rp_hash` (`plan_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='考察计划';


-- route_plan_point：考察计划途经点
--
-- 同时快照了每个点的经纬度与分段里程耗时：
--   快照坐标 —— 项目坐标后续变更时，能对比出「这份方案是按旧坐标算的」（AC-N10）；
--   分段数据 —— 路线页要逐段展示里程与耗时（C-6.6），
--               重算一次要再调地图接口，属于纯浪费配额。
CREATE TABLE `route_plan_point` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `route_plan_id` BIGINT UNSIGNED NOT NULL,
  `seq`          INT UNSIGNED    NOT NULL COMMENT '访问顺序，可被用户手动调整（C-6.7）',
  `project_id`   BIGINT UNSIGNED NOT NULL,
  `latitude`     DECIMAL(10,7)   NOT NULL COMMENT '规划时的项目坐标快照（GCJ-02）',
  `longitude`    DECIMAL(10,7)   NOT NULL,
  `leg_distance` DECIMAL(10,2)   NULL COMMENT '从上一站到本站的里程（米），首站为 NULL',
  `leg_duration` INT UNSIGNED    NULL COMMENT '从上一站到本站的耗时（秒），首站为 NULL',
  `visited_at`   DATETIME        NULL
                 COMMENT '签到成功时回填，用于路线页展示「已考察」进度（如 2/5，AC-N23）',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`   DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rpp_plan_seq` (`route_plan_id`, `seq`),
  KEY `idx_rpp_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='考察计划途经点';


-- visit_record：现场签到记录
--
-- ── 只追加表 ──
-- AC-N26：签到记录对任何角色（含管理员）只读，无编辑与删除入口，
-- 接口层同样拒绝。与 acceptance_flow 同理，由仓储层不导出 update/delete 强制。
--
-- ── 关于 threshold_m 必须随记录快照保存 ──
-- AC-N21 要求「修改阈值后新签到按新阈值判定，**历史记录的判定结果与当时阈值
-- 不被回溯改写**」。只存 is_abnormal 是不够的 —— 那样只能看到结论，
-- 看不到「当时按什么标准判的」，纠纷时无法解释。因此快照阈值本身。
--
-- ── 能力边界（§4.6.2）──
-- 定位可被模拟工具伪造，这是已知且难以根除的问题。本表是**弱证明**，不是安全边界：
-- 价值在于留下时间、地点、照片的关联记录以提高造假成本，
-- 而非杜绝造假。真正的证据是服务端叠加水印的照片。
CREATE TABLE `visit_record` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`      BIGINT UNSIGNED NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL COMMENT '签到人（工长/监理）。AC-N27：业主与管理员调用返回 403',
  `route_plan_id`   BIGINT UNSIGNED NULL COMMENT '从考察计划发起的签到才有值（AC-N23）',
  `seq_in_plan`     INT UNSIGNED    NULL COMMENT '该点在方案中的序号，用于回填 route_plan_point.visited_at',
  `checkin_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `checkin_lat`     DECIMAL(10,7)   NOT NULL COMMENT '签到坐标（GCJ-02）',
  `checkin_lng`     DECIMAL(10,7)   NOT NULL,
  `distance_m`      DECIMAL(10,2)   NOT NULL COMMENT '与项目坐标的偏差距离（米）（AC-N17）',
  `threshold_m`     DECIMAL(10,2)   NOT NULL COMMENT '判定时生效的阈值快照（AC-N21）',
  `is_abnormal`     TINYINT(1)      NOT NULL DEFAULT 0,
  `abnormal_reason` VARCHAR(500)    NULL COMMENT '异常签到须填说明方可提交（AC-N19）。超阈值不阻断提交',
  `remark`          VARCHAR(1000)   NULL COMMENT '考察备注：施工质量、发现问题、待办事项（C-6.16）',
  -- 生成列 + 唯一索引实现「同一项目同一工长当日仅一次」（AC-N25）。
  -- 用生成列而不是在应用层算日期，是为了让约束在数据库层成立 ——
  -- 应用层算日期时用的是应用进程时区，与 MySQL 会话时区不一致就会算错一天。
  `checkin_date`    DATE GENERATED ALWAYS AS (DATE(`checkin_at`)) STORED
                    COMMENT '仅用于当日去重唯一索引（AC-N25）',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_visit_daily` (`project_id`, `user_id`, `checkin_date`),
  KEY `idx_visit_project_time` (`project_id`, `checkin_at`),
  KEY `idx_visit_user_time` (`user_id`, `checkin_at`),
  -- 后台考察统计：按时间区间统计签到数、异常数（B-4.6）
  KEY `idx_visit_abnormal` (`is_abnormal`, `checkin_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='现场签到记录（只追加）';


-- visit_media：签到现场照片
--
-- AC-N18：照片由**服务端**叠加水印，内容含拍摄时间、项目地址、签到坐标；
-- 绕过小程序直接上传原图，返回的图片仍带水印。
-- 水印组件与进度汇报共用，内容字段参数化（§4.6.2）。
--
-- AC-N22：未上传任何现场照片时无法提交签到 —— 因此这是本域唯一
-- 「写操作必产生至少一行」的表，服务层须校验 1–3 张（C-6.14）。
CREATE TABLE `visit_media` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `visit_id`      BIGINT UNSIGNED NOT NULL,
  `type`          ENUM('image') NOT NULL DEFAULT 'image' COMMENT '签到只接受照片，不接受视频',
  `url`           VARCHAR(512)    NOT NULL,
  `watermark_url` VARCHAR(512)    NULL,
  `width`         INT UNSIGNED    NULL,
  `height`        INT UNSIGNED    NULL,
  `size_bytes`    INT UNSIGNED    NULL,
  `sort_order`    INT UNSIGNED    NOT NULL DEFAULT 0,
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_vm_visit` (`visit_id`, `sort_order`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='签到现场照片';
