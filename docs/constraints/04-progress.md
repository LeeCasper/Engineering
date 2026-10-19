# 工程宝 · 关键约束（进度、验收与存储）

> 本文件是 [CLAUDE.md](../../CLAUDE.md)「关键约束」的完整说明。
> 编号保持不变；源码注释中的「CLAUDE.md 第 N 条」仍以该编号为准。

---

<a id="c31"></a>

### 31. `notification.type` 与 `reminder_log.type` 是两个不同的枚举

| 表 | 字段 | 取值 |
| --- | --- | --- |
| `notification` | `type` | `acceptance` / `progress` / `payment` / `comment` / `system` |
| `reminder_log` | `type` | `stale_report` / `acceptance_timeout` / `big_expense` / `abnormal_checkin` |

把前者的值写进后者（或反之）时，**MySQL 不报错，只把 ENUM 静默截断成空串**
（仅 `WARN_DATA_TRUNCATED`）。表现是消息看起来写进去了、按分类却永远查不到。

`notification.service.js` 的 `REMINDER_TO_NOTIFICATION_TYPE` 是唯一的映射处。
发带去重的提醒时，`notifyOnce` 要**同时**给 `reminderType`（去重键）与 `type`（消息分类）。

---

<a id="c32"></a>

### 32. 「先抢占后发送」失败时必须释放去重键

`notifyOnce` 先往 `reminder_log` 插入抢占，再写 `notification`。
**写通知失败时必须把抢占记录删掉**，否则这条提醒永久丢失 ——
下次运行会因「已发过」跳过，而用户一条都没收到。

这个 bug 真实发生过一次（因为上面那个枚举串号导致写入失败），
表现是定时任务日志里报错、但 `reminded` 计数为 0，很容易被当成「没有需要提醒的项目」。
释放的窗口期内可能多发一条通知，比永久漏发轻得多。

---

<a id="c33"></a>

### 33. 服务端水印的三条硬约束

1. **字体缺失必须抛错**（`watermark.checkFontAvailable`）。
   sharp 在字体缺失时**不会报错**，会渲染出空白或方块 ——
   照片被静默地以「没有水印」的状态存下来，而 AC-P12 的全部意义就是
   「服务端水印绕不过去」。容器镜像里常常没有中文字体，这是会真实发生的场景。
2. **SVG 图层只画文字块，不铺满整图**。若图层与图片等大，
   `composite` 的 `gravity` 就失去意义（整图放哪都是整图），
   位置只能硬编码在坐标里，AC-P13 的配置项形同虚设。
3. **基线相对底板顶部算，不是相对 SVG 顶部**。
   写错会让最后一行的基线落到下沿之外 —— 看起来就是「第三行压出了底板」。
   `tests/integration/report.test.js` 断言了右下角有水印、左上角干净。

改水印后建议实际生成一张图看一眼（`sharp(out).toFile(...)` 后用 Read 打开），
断言只能证明「有像素变化」，证明不了「中文没变成方块」。

---

<a id="c34"></a>

### 34. 视频时长是客户端上报的，不是安全边界

服务端没有 ffprobe，无法自行测量视频时长。AC-P07 的「≤ 60 秒」因此是一道
**UX 约束**：它拦住正常用户的误操作，拦不住刻意绕过。

真正的服务端限制是「最多 1 个视频」与 multer 的文件大小上限，那两个是自己算的。
要把它变成真正的边界，需要引入 ffprobe 并接受这个二进制依赖。

---

<a id="c35"></a>

### 35. 汇报提交与完成度变更必须在同一事务

`progress.service.applyItemProgress` 接受可选的 `externalTx`。
提交汇报时把事务传进去，让「写汇报记录 + 写附件 + 变更完成度 + 重算阶段」原子化。

另开事务会取到**另一条连接**：行锁失效，还可能自己把自己锁死。
分开提交则会产生「有汇报但进度没变」的中间态 ——
而这两张表恰恰是争议时互相对照的证据。

文件落盘在事务**外**（文件系统不参与事务），失败时由 `cleanupFiles` 补偿删除。
不清理的话，每次失败的提交都会在磁盘上留下孤儿文件。

---

<a id="c36"></a>

### 36. 测试夹具表清单改为枚举，别再手写

`fixtures.truncateBusinessTables` 现在从 `information_schema` 枚举全部表。
原来是手写数组，结果是每加一张新表就可能漏掉，而后果很隐蔽：
数据在用例间累积，「查询返回几条」的断言读到残留，
报出「期望 1 条实际 13 条」这种看起来像业务算错了的错误。

这件事在本项目里发生过两次（`progress_log`、`progress_report`），所以改成了枚举。

---

<a id="c37"></a>

### 37. 验收状态机必须用**精确的迁移表**，不能用有序数组比索引

`acceptance.service.js` 的 `TRANSITIONS` 逐条列出「什么状态允许什么动作」。

不要图省事把五个状态排成一个数组、用下标比较来判断「是否正向流转」：
验收状态机**不是线性的**（驳回回到 `pending_rectify`，重新提交又回到首环节），
用序数比较会放行一批实际非法的跃迁，例如 `pending_rectify → passed`。
AC-A04 明确要求非法跃迁返回 409。

---

<a id="c38"></a>

### 38. 轮次（round）的两个陷阱

验收流转记录按轮分组展示，`round` 的算法踩过两次：

1. **不能用 `MAX(round) + 1`**。同一轮里插入第二条记录时，`MAX(round)` 已经等于
   当前轮次，于是第二条起每条都被算成新的一轮 —— 一次「提交 + 驳回」被拆成两轮。
   正确算法是 `acceptance.resubmit_count + 1`，它在一轮内恒定。
2. **重新提交时要 +1**。`currentRound(acceptance)` 读的是**递增前**的
   `resubmit_count`，给出的是「刚结束的那一轮」；重新提交开启的是下一轮，
   因此要 `currentRound(acceptance) + 1`。少这个 +1，新一轮的记录会被归到上一轮。

---

<a id="c39"></a>

### 39. 少 SELECT 一列不会报错，只会让去重键变成 `NaN`

`acceptanceTimeout` 的查询漏选了 `resubmit_count`，于是
`undefined + 1 = NaN`，去重键变成 `acceptance_rNaN`。

**危险的不是 NaN，而是它看起来像个正常键**：字符串拼接不会报错，
且所有轮次共用同一个键，第二轮的提醒被判为「已发过」而静默消失 ——
日志里一片安静，只有用户发现「没收到提醒」。

因此 job 里加了一道 `Number.isFinite` 检查：算不出轮次就记 error 并跳过该单。
宁可漏发一轮并留下日志，也不要出现「键存在但含义已经错了」的静默状态。

同类问题也适用于 `progress.service` 与 `report.service`：**凡是靠列值拼键的地方，
都要确认那一列真的在 SELECT 列表里**。

---

<a id="c40"></a>

### 40. 不要在模块内引用 `module.exports` 上的函数

曾经写成：

```js
// ❌ 模块内部引用不到，抛 ReferenceError
module.exports = { generateReportPdf: (...args) => require('./x').generate(...args) }
async function finalize() { await generateReportPdf(id) }  // ReferenceError
```

`generateReportPdf` 只是 `module.exports` 的一个属性，**不是模块作用域的绑定**。
抛出的 ReferenceError 被外层的 `.catch` 吞掉并记了一条日志，
表现是「PDF 状态永远停在 pending」，而日志看起来像生成失败。

需要跨模块调用就在顶部 `require` 成模块级常量。
