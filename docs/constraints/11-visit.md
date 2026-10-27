# 现场签到（91）

对应需求：§4.6 / C-6.13 ~ C-6.20 / AC-N17 ~ N28。

---

<a id="c91"></a>

## 91. 签到照片先暂存、提交时水印；记录只追加、当日唯一、阈值快照

现场签到看起来只是「传几张照片」，但它同时踩中了本项目四条已有的硬约束：

1. **微信一次只能传一个文件**（见 `report_media_staging` 的说明）。
   签到要求 1–3 张照片，不能依赖一次 multipart 带齐。
2. **水印必须在服务端生成**（第 33 条），不能信任客户端处理过的图片。
3. **签到记录只追加**（第 10 条），任何角色都不能改 / 删。
4. **偏差阈值要能改，但历史判定不能回溯**（AC-N21）。
   这和系统配置「只对新数据生效」是同一个口径。

### 照片：暂存只存原图，提交时才生成水印

`uni.uploadFile` 一次只能带一个文件，因此：

- `POST /projects/:id/visits/media` 接收单张图片，落盘原图，写
  `visit_media_staging`（绑定 project_id + user_id），返回 `mediaId`；
- `POST /projects/:id/visits` 在事务里消费 `mediaIds`，写 `visit_record` 与
  `visit_media`。

**暂存阶段不加水印。** 水印内容是「时间 + 签到位置文字 + 项目地址 + 签到坐标」，
而签到坐标是提交时才最终确定的。暂存时加水印会出现「水印上的坐标」与「记录里的坐标」
不是同一组的问题 —— 纠纷时这比没有水印更糟。

签到位置文字由服务端用坐标逆地理编码得到（高德优先、腾讯兜底）；未配置地图 Key
或逆编码失败时，水印写「签到位置：实时地址未解析」并保留坐标，**不要编造地址**。
前端在提交前会强制重新定位一次，定位失败不允许提交。

提交时由服务端 `storage.read(原图)` → `watermark.apply(...)` →
`storage.save(带水印图)`；`visit_media.url` 存原图、`watermark_url` 存带水印图。
前端展示优先用 `watermarkUrl`。

生成水印在事务**外**完成（sharp 处理 1–3 张图可能几百毫秒，不应长时间持锁）；
进入事务后再 `FOR UPDATE` 重新校验暂存行，防止并发消费或清理任务认领。
事务失败时删除本次生成的水印文件；暂存原图保持 `staged`，用户可以重试。
未提交的暂存行由 `visitMediaCleanup` 在 24 小时后先认领为 `expired` 再删文件。

### 当日唯一：用生成列 + 唯一索引，不在应用层算「今天」

`visit_record.checkin_date` 是 `DATE(checkin_at)` 生成列，
`uk_visit_daily (project_id, user_id, checkin_date)` 保证同一项目同一人当日只有一条。

日期必须由数据库算：应用进程时区与 MySQL 会话时区不一致时，跨零点会算错一天
（AC-N25）。service 里的预检用 `datetime.formatDate()` 取上海时区日期，
并发下仍由唯一键兜底；捕获 `ER_DUP_ENTRY` 且命中 `uk_visit_daily` 时翻译成
409「今日已签到」。

### 只追加：model 不导出 update / delete

`visitRecord.model.js` 只导出 SELECT / INSERT。路由层也没有
PUT / PATCH / DELETE。`visit_record.deleted_at` 虽然存在，但业务层不使用它。

AC-N26 与 C-6.20「如需更正须新增一条」存在冲突：当日唯一键不允许同一天新增第二条。
当前交付选择 AC-N25；更正只能在次日新增，或后续引入独立的更正记录模型。

### 阈值快照

`visit_record.threshold_m` 必须随记录保存，不能只存 `is_abnormal`。
后台改租户阈值后，新签到按新阈值判定，历史记录仍保留当时的阈值与判定结果。
当前只实现租户级阈值（`sign_in_distance_threshold`）；B-5.1 的「按项目覆盖」
尚未实现，不要误以为配置页能按项目单独调。

### 异常签到：允许提交，但必须说明并通知

- `distance_m > threshold_m` 才是异常（等于阈值算正常）。
- 异常但没填 `abnormal_reason` → 400，返回里带 `distance` / `threshold`，
  前端据此展开说明输入框。
- 提交成功后向租户 owner + 项目创建者发 `admin_notification`
  （`type='project'`，`ref_type='visit'`）。通知在事务提交后发送，
  失败只记日志 —— 通知失败不能让已经发生的签到回滚。
- 签到是弱证明：定位可以伪造。真正的凭证是服务端水印照片，不要把距离校验
  当成安防能力。

### 考察计划联动

从考察计划进入时带 `routePlanId` + `seqInPlan`，两者必须成对。
服务端校验方案属于当前用户、站点属于当前项目，提交成功后回填
`route_plan_point.visited_at`（只填第一次，重复签到不覆盖）。
没有这两个参数的项目详情签到不回填路线点。
