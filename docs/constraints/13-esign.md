# 工程宝 · 关键约束（可靠电子签名）

> 本文件是 [CLAUDE.md](../../CLAUDE.md)「关键约束」的完整说明。
> 编号保持不变；源码注释中的「CLAUDE.md 第 N 条」仍以该编号为准。

---

<a id="c93"></a>

### 93. 可靠电子签名：回调不是事实、验签+哈希+实名+行锁缺一不可

现有验收单的 `signature_url` 是主业主在 canvas 上手写的图片。它能证明“某个已登录账号点过确认”，
但不满足《电子签名法》第 13 条的可靠电子签名条件，不能主张与手写签名/盖章同等效力。
V2.13 起，新验收单走第三方电子签服务商；存量已通过的单子标记为 `legacy`，不追溯重签。

#### 状态与表

- `acceptance.signature_mode`：`legacy` / `provider`。
- `acceptance.esign_status`：`none → creating → pending → archiving → signed`；
  `creating/pending → failed/expired/cancelled`；`archiving` 只进 `signed`，归档失败保持
  `archiving` 并告警，不允许重新签；`signed` 终态。
- `esign_task`：一次签署任务一行；`active_key` 生成列 + `uk_esign_active` 保证同一验收单最多
  一个 `creating/pending/archiving` 任务。
- `esign_identity`：微信用户与服务商实名主体的绑定；完成验收前必须 `realname_status='passed'`。
- `esign_event`：回调收件箱，`(provider, event_id)` 唯一；未知任务的事件保留，不能丢。
- `acceptance_flow.esign_task_id`：把“通过”流转记录与签署任务连起来。

#### 完成条件（缺一不可）

1. 服务商回调验签通过（原始 body，不是 JSON 重新序列化后的对象）；
2. 下载已签 PDF，调用服务商验签 API 通过；
3. 服务商证据/验签结果中的原始文档哈希与本地冻结的 `document_hash` 一致；
4. 服务商返回的实名主体与 `esign_identity` 匹配且 `passed`；
5. 事务内先锁 `acceptance`、再锁 `esign_task`；
6. `markPassed` 用 `WHERE status='pending_owner'` 条件更新并检查 `affectedRows`；
7. 签署人仍然是该项目 active 主业主，否则任务置 `superseded`，验收不通过。

**不要把回调本身当签署事实。** 回调只说明服务商发来一个事件；没有验签/哈希/实名/行锁，
晚到的回调可以把已驳回的单子改成 passed，或者把一个伪造事件变成“已签”。

#### 回调必须快

回调请求只做：验签 → 落 `esign_event` → 快状态更新（`archiving`/terminal）→ 立即 200。
下载 PDF、验签、归档、付款解锁/通知全部交给 `processTask` / `esignSync`。
在回调里做多 MB 下载会超过服务商 5 秒超时，触发重试风暴和重复处理。

#### 创建任务的幂等

- 本地 `esign_task.idempotency_key` 与 `uk_esign_active` 防重复；
- 调服务商创建前用 `externalId`/`ClientToken` 作为幂等标识；
- 超时/网络未知**不要直接判失败**，保留 `creating`，由 `esignSync` 按 externalId 对账；
- 只有服务商明确返回 4xx/业务失败才置 `failed`。

#### 私有存储

已签 PDF、证据报告、签署前 PDF 必须走 `ESIGN_PRIVATE_DIR`，**不能**落在 `UPLOAD_DIR` 下。
启动自检会拒绝私有目录位于上传目录内部的配置。下载走短时签名 URL，响应 `Cache-Control: no-store`，
每次下载写操作日志。

#### 生产门禁

- 生产 `ESIGN_LEGACY_SIGNING` 强制 false；`ESIGN_ENABLED=false`、provider=mock、缺凭据、
  回调 URL 非 HTTPS、私有目录在上传目录内 → **拒绝启动**。
- `ESIGN_SIGNING_PAUSED=true` 只停新建任务；回调/查单/归档继续，绝不回退手写签名。
- 生产禁止 `mock` provider；开发/测试默认关闭，继续走 legacy 以保证既有测试可跑。

#### 私有数据

不存身份证号、身份证照片、人脸图或生物特征模板。`esign_identity` 只存服务商 subject id、
核身流水号、脱敏姓名；`esign_event.payload` 只存脱敏摘要；日志不得出现 secret/证件号/人脸。

#### 测试

`tests/integration/esign.test.js` 用 mock provider 覆盖：创建、权限、合法/非法回调、
重复回调、原始哈希不匹配、私有存储、旧签名接口拒绝。真实服务商适配器必须在沙箱用真实
身份证 + 人脸走通后才能上线；mock 通过不等于生产可用。
