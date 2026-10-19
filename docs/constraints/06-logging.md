# 工程宝 · 关键约束（对账、日志、通知与审计基础）

> 本文件是 [CLAUDE.md](../../CLAUDE.md)「关键约束」的完整说明。
> 编号保持不变；源码注释中的「CLAUDE.md 第 N 条」仍以该编号为准。

---

<a id="c51"></a>

### 51. 对账确认：状态流转与流水锁定必须在同一事务

AC-L20 要求确认后该周期流水全部 `locked = 1`。这两件事必须原子完成 ——
分开提交会出现「单据已确认但流水没锁」的中间态，而**那正是「确认完还能改」的扯皮来源**。

另外 `locked` 必须是**服务端**的硬拦截：`ledgerModel` 的写方法刻意叫
`updateUnlocked` / `softDeleteUnlocked`，让绕过的人至少得先看见这个名字。
只在前端藏按钮不算数。

---

<a id="c52"></a>

### 52. `operation_log` 由 service 显式调用，不挂自动中间件

AC-AD09 与 AC-L28 都要求记录**变更前后值**。自动中间件只能拿到 HTTP 层的
请求体与响应体，它既不知道这条流水改之前是什么样子，也分不清改成功与改失败；
硬要拿到 before 就得在中间件里再查一次库，等于把业务逻辑复制一份。

因此 `operationLog.record()` 由业务代码在事务内显式调用 ——
它就在改动发生的那一处，before/after 都是现成的。
审计日志写失败**不阻断业务**（记 error 级日志），但调用方传 `tx` 时会跟着业务事务一起提交。

---

<a id="c53"></a>

### 53. 「不存在支付渠道调用」做成了可执行的断言

AC-L17 要求「抓包及服务端日志中不存在任何第三方支付渠道的请求」。
抓包需要在真实环境做，但更根本的保证是**代码里根本没有这类调用**。

`tests/integration/ledger.test.js` 里有一条断言扫描 `src/` 全部源文件，
匹配 `wxpay|alipay|prepay_id|mch_id|商户号` 等关键词，命中即失败。
这比人工抓包更可靠，也不会随时间失效。

---

<a id="c54"></a>

### 54. 管理员消息与 C 端消息是**两套主体**，不共用一张表

| 表 | 接收人 | 指向 |
| --- | --- | --- |
| `notification` | C 端用户（工长/监理/业主） | `user` |
| `admin_notification` | 后台管理员 | `admin_user` |

把 `project.created_by`（admin_user.id）塞进 `notification.user_id`，
会给一个**毫不相干的 C 端用户**发消息 —— 这是数据串号，不是「少发一条」。

两表的 `type` 也是**两套枚举**：
`notification.type` = `acceptance/progress/payment/comment/system`；
`admin_notification.type` = `project/account/export/system`。
与 CLAUDE.md 第 31 条（`reminder_log.type` vs `notification.type`）同源，
**MySQL 对 ENUM 越界值只做静默截断**。

AC-P23「向管理员与业主各推送一次」因此要发两次、走两条通道，
`staleReportReminder` 里就是这么做的。

---

<a id="c55"></a>

### 55. 少 SELECT 一列 —— 第三次了

`staleReportReminder` 的项目查询漏了 `created_by`，于是
`notifyProjectAdmin` 里的 `if (!project.created_by) return` 直接短路，
**管理员那条提醒静默不发**，日志里一片干净。

前两次分别是：
- `progressReport` 的 JOIN 条件列（导致 SQL 报错，还好发现得早）
- `acceptanceTimeout` 的 `resubmit_count`（去重键变成 `NaN`，第 39 条）

**共同特征**：都不报错，只是安静地少做一件事。因此凡是「靠某列的值做判断或拼键」
的地方，写完要回头确认那一列真的在 SELECT 列表里。
`grep` 一下变量名与 SELECT 列表对一遍，比调试半小时划算。

---

<a id="c56"></a>

### 56. supertest 对二进制响应的处理是**有损**的

`res.body` 对不认识的 Content-Type（xlsx、PDF）是空对象，
数据落在 `res.text` 里 —— 而 `res.text` **已按 UTF-8 解码过**，
字节 >127 的部分已经损坏，`Buffer.from(res.text, 'binary')` 救不回来。

因此 `tests/integration/helpers/request.js` 提供 `request.binary(method, url, { token })`：
自定义 parser，自己收集数据流拼 Buffer。

验收报告 PDF 与结算单 PDF 的测试都用它。**不要图省事用 `res.body`** ——
它对 PDF 会返回 `{}`，断言会以「文件头不对」的形式失败，而真实原因是根本没拿到字节。

---

<a id="c57"></a>

### 57. 服务端生成物的扩展名白名单要单独维护

`storage.saveGenerated` 的 `GENERATED_EXTENSIONS` 与 `save` 的 `ALLOWED_EXTENSIONS`
是两份**不同的**清单。加导出功能时漏了 `xlsx`，表现是导出接口 500
（`不支持的文件类型：xlsx`），而错误信息看起来像「用户传了不支持的文件」。

两者混用会出两个方向的问题：
- 把 xlsx 加进 `ALLOWED_EXTENSIONS` → 顺带允许**用户上传**表格文件；
- 忘了加进 `GENERATED_EXTENSIONS` → 服务端自己生成的文件存不进去。

---

<a id="c58"></a>

### 58. 响应体不回显用户可控输入

404 提示不回显请求路径，错误消息不回显用户输入。
路径是用户可控的，原样放进响应体，一旦某个前端用 `innerHTML` 渲染就是反射型 XSS。
排查错拼用服务端访问日志里的 `path`。

---

<a id="c59"></a>

### 59. 「红点数字」与「列表内容」必须同源

消息中心的未读红点（AC-U07）与消息列表（AC-U06）如果各写一套过滤条件，
就会出现**「红点显示 3 条，点进去一条都没有」**——用户会认为消息丢了，
而这个差异只在特定筛选组合下出现，最难复现。

因此 `notification.model.js` 的 `buildFilter()` 是唯一的口径来源，列表与计数共用它。

配套的一条约定：**列表接口返回的 `unread` 恒为全局未读数，与筛选条件无关**。
看起来有点反直觉（按 `type=comment` 筛完还返回 5 条未读），但红点回答的是
「我有多少条没看」，不是「我正看的这一类有多少条没看」。若返回筛选口径的未读数，
用户切一次分类红点就从 5 变 1，像是消息被吞了。分类角标另有 `unreadSummary().byType`。

---

<a id="c60"></a>

### 60. 审计动作「定义了」不等于「会被写」

`operationLog.ACTIONS` 里曾有 33 个动作，**只有 12 个真的被调用**：项目建档/编辑/
状态流转、成员邀请/移除/改指、模板增删改复制、账号增删改、系统配置全都在常量表里躺着。
日志界面照常能用、列表里也有一堆记录，**只有追责时才会发现那次改动没留痕** ——
而「日志里没有」与「这件事没发生过」在审计时是同一个结论。

补上之后加了 `tests/unit/operationLogActions.test.js`：扫描 `src/` 全部源码，
逐个核对每个动作名至少被引用一次，新增常量忘了接线立刻变红。
例外清单（`NOT_YET_WIRED`）目前只有 M12 的门锁密码，**加例外必须写明理由**，
否则它会变成「忘了接线就加进来」的垃圾桶，而那正是它要防的事。
