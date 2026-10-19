# 工程宝 · 关键约束（认证、会话与邀请）

> 本文件是 [CLAUDE.md](../../CLAUDE.md)「关键约束」的完整说明。
> 编号保持不变；源码注释中的「CLAUDE.md 第 N 条」仍以该编号为准。

---

<a id="c11"></a>

### 11. 提醒去重靠唯一索引，不靠「先查再插」

`reminder_log` 对 `(type, ref_type, ref_id, target_user_id)` 建唯一索引
（AC-P23 / AC-A22 的「同一提醒只发一次」）。

发送前**先插入**，插入成功才发；撞唯一键说明已发过。
用「先查询再插入」在定时任务多实例部署下会双发，唯一索引不会。

---

<a id="c12"></a>

### 12. 登录校验的**顺序**本身就是安全设计

`adminAuth.service.js` 必须先验密码、再判断锁定与禁用状态。调换过来（先判断状态）
会让攻击者不输密码就能通过响应差异枚举出哪些用户名存在 —— 那正是 AC-AD01 要防的。

同理，账号不存在时也要对着 `DUMMY_HASH` 跑一次 `bcrypt.compare`。
否则「账号存在」的响应比「不存在」慢 60ms，时间差同样能枚举账号。

这两条看着像过度设计，但改动时非常容易被「优化」掉（比如把状态判断提前以省一次哈希）。
`tests/integration/adminAuth.test.js` 的 `AC-AD01` 一节锁着它们。

---

<a id="c13"></a>

### 13. B 端会话键必须**存在**才放行，不能「不存在就当首次请求」

`session.service.js` 管理 B-1.7 的空闲超时。曾经写过一版是「键不存在就创建并放行」，
看似能容忍缓存重启，实际后果是**登出永远失效**：登出删掉键之后，
下一次请求会因为「不存在」而被放行并重新建键。

因此登录时建键、每次请求刷新 TTL、登出删键，缺失一律 401。
键里带 token 的 `iat` 而不是只用 adminId —— 否则登出一个标签页会把另一个也踢掉。

---

<a id="c14"></a>

### 14. 验证码在开发环境回显答案

`captcha.service.js` 在 `config.isDev`（即 `NODE_ENV=development`）时多返回一个
`debugAnswer` 字段，否则用 curl 手工调登录接口永远拿不到正确的验证码。
测试环境不需要它（测试与服务器同进程，直接读缓存）。

生产环境拿不到这个字段，但 `NODE_ENV` 配错就危险了 ——
因此 `server.js` 启动时会打一条醒目告警。

---

<a id="c15"></a>

### 15. 邀请是按手机号发起的，因此存在「占位账号」与合并

§5.2 的邀请流程是「后台录入手机号 → 生成 pending 成员」，而 `project_member.user_id`
非空 —— 被邀请的那个人**当时可能还没有账号**。所以 M4 建档邀请时（以及测试里）
必须按手机号先建一个**占位用户**：`phone` 有值、`openid` 为 NULL。

等这个人真的用微信登录，静默登录按 openid 匹配不到任何账号，会新建一个只有
openid、没有手机号的空账号。此时他去绑定手机号，就会撞上那个占位账号。
`user.model.js` 的 `bindPhone` 负责把这个空壳账号合并进占位账号。

三个必须记住的点：

1. **合并的三步顺序不能换**。openid 有唯一索引，先给占位账号写 openid 会撞键
   （表现为一个莫名其妙的 409）。必须先 `SET openid = NULL` 腾空当前账号，再写入，最后作废。
2. **合并后必须换发新 token**（`miniAuth.service.bindPhone` 返回 `token`）。
   旧 token 的 `sub` 指向已被作废的空壳账号，下一次请求就 401 ——
   用户刚绑完手机号就被踢下线。
3. **当前账号已挂数据时拒绝合并**，宁可报错交人工。静默搬运数据出错了无法追溯。

另外，**「拒绝邀请」没有独立的 status 值**。§6.1 把 `project_member.status`
定为 `pending/active/removed` 三个值，为拒绝新增枚举要一次迁移，而这三个值够用了：

| 含义 | status | confirmed_at |
| --- | --- | --- |
| 拒绝（从未确认就退出） | `removed` | NULL |
| 解除（曾是成员后被移除） | `removed` | 有值 |

管理后台据此区分，不必加字段。不要「顺手」把拒绝改成删除行 ——
管理员需要看到「这个人拒绝了」，否则列表里凭空少一条会被误判成邀请没发出去。

---

<a id="c16"></a>

### 16. WX_MOCK 是危险开关，用启动自检兜住

`WX_MOCK=true` 时跳过 code2session，由 code 派生 openid —— 谁都能伪造任意身份登录。
本机开发没有 AppID 时必须用它，但生产绝不能开。

因此 `wx.service.assertSafeConfig()` 在 `server.js` 启动时做硬校验：
`NODE_ENV=production` 且 `WX_MOCK=true` 直接**拒绝启动**。
把危险配置变成「起不来」，比写在文档里靠人记得可靠。

---

<a id="c17"></a>

### 17. 系统配置有 60 秒进程内缓存

`sysConfig.service.js` 对 §5.5 的配置项做 60 秒进程内缓存（配置读得极频繁、改得极少）。

改了 `sys_config` 想让新值立刻被读到，必须调 `sysConfigService.invalidate()` ——
管理后台的配置更新接口也要这么做。集成测试里改配置后同样需要它，
否则会读到上一次缓存的空值。

---

<a id="c18"></a>

### 18. 数据权限的两道防呆，别拆掉

`dataScope.service.js` + `projectAccess.service.js` 是后台项目权限的**唯一**来源。

1. **`projectModel` 的后台查询方法强制要求 `scope` 参数**，缺失时 `dataScope.assertValid`
   直接抛错。把过滤做成「记得就加」的约定，迟早有人忘；做成「不加就报错」，忘了立刻发现。
2. **`projectAccess.load(operator, projectId, { requireWritable })`** 是所有项目相关
   服务的统一入口（project / projectMember / paymentNode 三处共用）。
   新增服务方法时必须用它，不要自己写 `findByIdScoped` —— 后者会把无权项目变成 404。

`findByIdUnscoped` **仅供 C 端与 `projectAccess` 内部使用**，命名刻意做得显眼。
C 端的可见性由 `project_member` 决定，不适用后台 scope 规则。

---

<a id="c19"></a>

### 19. 404 与 403：两端刻意相反

| 端 | 无权访问时 | 依据 |
| --- | --- | --- |
| B 端 | **403**「无权访问该项目」 | AC-AD52 明确要求 |
| C 端 | **404**，且提示与「项目不存在」完全相同 | AC-P26 要求不泄露项目是否存在 |

这不是不一致，是两批用户的差异：B 端面对内部管理员，能区分「不存在」和「没权限」
才能排查问题；C 端面对外部用户，403 等于告诉对方「这个 id 确实有个项目」。

---

<a id="c20"></a>

### 20. `money.validate` 不能用来校验坐标

金额限制「最多两位小数」，而坐标是 `DECIMAL(10,7)`。用它校验 `121.4737010` 会同时犯两个错：
拒绝合法输入，以及把精度截断成 `121.47`（约 1 公里误差）。

坐标有专门的校验（`adminProject.controller.js` 的 `coordinateField`），
返回**字符串**而不是 Number —— 只有字符串能原样保住 7 位小数。
