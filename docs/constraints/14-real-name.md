# 实名认证（第 94 条）

> 对应源码：`server/src/utils/idCard.js`、`server/src/services/identity.service.js`、
> `server/src/services/realName/aliyun.provider.js`、`server/src/controllers/miniRealName.controller.js`、
> `server/db/migrations/033_real_name_verification.sql`、`miniapp/src/pages/mine/real-name.vue`。

## 背景

迁移 032 只增加了 `user.real_name` 文本字段，用户可以随手填一个网名；被邀请进入项目后，
这个姓名会出现在验收记录、联系人与结算单据上，没有可信度。

V2.16 把「填写姓名」升级为「姓名 + 身份证号二要素校验」：

- `GET /auth/real-name` 读取认证状态；
- `POST /auth/real-name/verify` 提交 `realName` + `idCardNo` + `consent: true`；
- 用户存在 pending / active 成员关系但未认证时，确认邀请返回 409；
- 认证后的姓名不可再通过 `PUT /auth/profile` 修改。

## 第 94 条：证件号不落库；核验等级必须如实标注

### 1. 证件号明文不落库

`id_card_mask` 只保留前 6 位与后 4 位（例如 `310101********1234`）。
`identity_verification` 审计表同样只存 `id_card_mask` 与 `name_masked`（例如 `张*`）。

完整证件号的生命周期只到 `identity.service.verify()` 的入参。以下位置**不得**出现完整证件号：

- 数据库任何列；
- `operation_log` / 访问日志 / 错误日志；
- 接口响应（包括 400 的 `detail`）；
- 小程序 storage 或分享内容。

前端在提交成功后立即清空页面里的 `idCardNo`。若将来需要保留证件号（例如对接第三方后
需要重试），必须先设计加密与密钥分离方案，不能直接加一个 `id_card_no` 列。

### 2. 两种核验通道

本地格式校验（18 位、校验位、出生日期、行政区划）**永远先执行**，避免把明显
错误的输入发给付费服务商。之后按 `REAL_NAME_PROVIDER` 分流：

| provider | 行为 | 返回等级 |
| --- | --- | --- |
| `local` | 只做本地证件格式校验，不判断姓名与证件号是否同一人 | `basic` / 证件信息校验 |
| `aliyun` | 调用阿里云实人认证 `Id2MetaVerify`（姓名 + 身份证号二要素） | `provider` / 服务商二要素核验 |

`local` 模式下前端**不得**写「公安库核验通过」或「已通过第三方实名认证」；
`aliyun` 模式可以写「阿里云实人认证核验」，但仍应说明本系统只保存脱敏结果。

阿里云返回 `Code=200` 只代表调用成功，业务结果看 `ResultObject.BizCode`：

- `1` 一致 → 认证通过；
- `2` 不一致 → 400，`code=MISMATCH`；
- `3` 查无记录 → 400，`code=NOT_FOUND`。

网络超时、鉴权失败、欠费、限流等**不能当成身份不通过**：统一写一条失败审计后
返回 503，让用户可以稍后重试，也避免把服务故障归因到用户身份上。

配置项：

```dotenv
REAL_NAME_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_REAL_NAME_ENDPOINT=cloudauth.aliyuncs.com
ALIYUN_REAL_NAME_TIMEOUT_MS=8000
```

AccessKey 只从服务端配置读取，不使用前端传入的凭据。建议使用 RAM 子账号，
只授予 CloudAuth 的最小权限；`server.js` 启动自检会在 provider=aliyun 但缺
AccessKey 时直接拒绝启动。

阿里云按调用次数计费（后付费或流量包，查无记录通常不计费），因此只在
`POST /auth/real-name/verify` 成功通过本地格式校验后才发起调用；同一用户
认证成功后再次提交直接返回当前状态，不会重复计费。
`ALIYUN_REAL_NAME_MAX_ATTEMPTS_PER_HOUR`（默认 10）是单用户每小时调用上限，
用来挡住用随机证件号刷付费接口的行为，不能把它当成身份校验逻辑。

由于证件号不落库，当前也**不做「一证一号」查重**。若后续需要查重，
应新增带独立密钥的 HMAC 列（不能存明文，也不能用可逆加密后再直接比较），
并同时处理注销释放与并发唯一索引。

### 3. 第三方 provider 不能静默降级

`REAL_NAME_PROVIDER` 只接受 `local` / `aliyun`；其它值会让认证接口返回 503，
而不是悄悄按本地校验放行 —— 否则用户会误以为自己经过了服务商核验。
新增 provider 时必须实现同样的 `verify()` 契约，并通过 `verificationLevel`
如实反映核验等级。

### 4. 门禁只加在「被邀请」之后

未被邀请的账号没有协作身份，提前索要身份证号属于超范围收集。
`requiresRealNameAuth` 的计算条件是：

```sql
project_member.status IN ('pending', 'active') AND user.real_name_status <> 'verified'
```

只填了 `real_name`、没有认证的旧数据同样会被拦下；这是升级项，不是回归。
认证通过后，`PUT /auth/profile` 只能改昵称 / 头像，姓名变化返回 409。

### 5. 审计与注销

每次提交（成功或失败）都写一行 `identity_verification`，包括失败码与请求 id。
该表只追加，不更新、不删除（第 10 条）。

注销账号时 `userModel.anonymize()` 会把 `real_name_status` 置回 `none` 并清空
`id_card_mask` / 认证时间 / 认证方式；历史 `identity_verification` 行保留，
但其中只有脱敏值。
