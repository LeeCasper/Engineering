-- =====================================================================
-- 013 个人中心域：content_page / feedback
--
-- 这两张表是 M11 补出来的，原始文档 §6.1 没有它们 —— 但 AC-U17 要求
-- 「关于我们、用户协议、隐私政策页面内容由后台可维护」、AC-U18 要求
-- 「意见反馈支持文字 + 图片提交」，两者都需要存储，属于 §6.3 的漏项。
-- =====================================================================


-- ── content_page：静态内容页（AC-U17 / C-5.8） ──
--
-- 为什么不复用 sys_config：
--   1. `config_value` 是 VARCHAR(500)，而用户协议这类文本动辄数千字，
--      塞进去要么被静默截断、要么得先改列类型；
--   2. 两者的变更语义不同 —— 配置项改完要立刻影响业务判定，
--      内容页改完要能**先存草稿再发布**，因此这里带 `published_at`，
--      而 sys_config 没有「未发布」这个状态。
-- 把它们合成一张表，就得在 `sys_config` 上长出一堆只对内容页有意义的字段。
CREATE TABLE `content_page` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- 页面标识：about / agreement / privacy。用 VARCHAR 而不是 ENUM，
  -- 白名单由服务层的注册表维护 —— 新增一个「帮助中心」不该要一次迁移
  `page_key`     VARCHAR(64)     NOT NULL COMMENT '页面标识，如 about / agreement / privacy',
  `title`        VARCHAR(100)    NOT NULL COMMENT '页面标题，前端导航栏直接用',
  `content`      MEDIUMTEXT      NULL COMMENT '正文（富文本或 Markdown，由前端约定渲染方式）',
  -- 版本号由后台填写（如 2026-10-01），用于回答「用户当时同意的是哪一版」
  `version`      VARCHAR(32)     NULL,
  `published_at` DATETIME        NULL COMMENT 'NULL 表示尚未发布，C 端不返回',
  `updated_by`   BIGINT UNSIGNED NULL COMMENT '最后修改的后台账号',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`   DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_content_page_key` (`page_key`),
  KEY `idx_content_page_published` (`published_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='静态内容页（关于我们/用户协议/隐私政策）';


-- ── feedback：意见反馈（C-5.7 / AC-U18） ──
--
-- `images` 用 JSON 而不是独立子表，与 `acceptance.photos`、`ledger.receipt_images`
-- 一致：这些图片只按「属于哪条反馈」被读取，没有任何查询会单独按图片检索。
--
-- `user_id` 不设外键、也不做级联删除：AC-U19 明确「历史记录保留」——
-- 用户注销后反馈仍在（且已匿名化），运维要能看到「有人提过这个问题」。
CREATE TABLE `feedback` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED NULL COMMENT '提交人。注销后置 NULL，反馈本体保留',
  `project_id` BIGINT UNSIGNED NULL COMMENT '可选：在哪一个项目下遇到的问题',
  `content`    VARCHAR(1000)   NOT NULL COMMENT '反馈正文',
  `images`     JSON            NULL COMMENT '截图，[{"url":"..."}]，最多由配置项控制',
  -- 联系方式留空则不回访。不默认带入手机号：反馈是主动提交的信息，
  -- 默认填入手机号等于把一个「可选」变成了「默认同意被联系」
  `contact`    VARCHAR(100)    NULL COMMENT '回访联系方式，用户自愿填写',
  `status`     ENUM('new','processing','resolved') NOT NULL DEFAULT 'new',
  `reply`      TEXT            NULL COMMENT '处理结果回执，便于事后回答「当时怎么处理的」',
  `handled_by` BIGINT UNSIGNED NULL,
  `handled_at` DATETIME        NULL,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `idx_feedback_user` (`user_id`, `created_at`),
  -- 后台的默认视图是「待处理的反馈」，按状态 + 时间排
  KEY `idx_feedback_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='意见反馈';
