# 工程宝 · 关键约束（数据库、迁移与测试基础）

> 本文件是 [CLAUDE.md](../../CLAUDE.md)「关键约束」的完整说明。
> 编号保持不变；源码注释中的「CLAUDE.md 第 N 条」仍以该编号为准。

---

<a id="c1"></a>

### 1. 数据库连接的两个选项组合，不能随手改

`src/db/pool.js` 里这三个选项是配合使用的，任何一个改动都会静默出错账或诡异 bug：

| 选项 | 值 | 为什么 |
| --- | --- | --- |
| `decimalNumbers` | `false` | DECIMAL 恒以**字符串**返回。设 `true` 会让金额变成 IEEE754 浮点，AC-L11 的「无浮点运算」当场失效，且失效方式是偶尔差一分，极难复现 |
| `dateStrings` | `true` | DATETIME 以字符串返回。关掉会套用 Node 进程时区，表现为「本机测试对、服务器差 8 小时」 |
| `bigNumberStrings` | `false` | BIGINT 在安全整数范围内给 Number，超出才给字符串。**设 `true` 会把所有自增主键与 COUNT 变成字符串**，全项目 `if (a.id === b.id)` 集体失效 |

金额运算一律走 `src/utils/money.js`（内部 decimal.js）。
业务代码里不允许出现 `parseFloat(amount)` / `Number(amount)` / `+amount`。

---

<a id="c2"></a>

### 2. MySQL 的唯一索引不约束 NULL

需求文档 §6.2 有两处写法直接照抄会**得到没有约束的索引**：

- `sys_config` 对 `(config_key, scope, project_id)` 建唯一索引，`scope='global'` 时 `project_id` 为 NULL
  → 多个 NULL 互不相同，全局配置能被插入两条。
- `ledger` 对 `payment_node_id` 建**条件唯一索引**（仅 `type='income'`），MySQL 8 **没有** partial index。

**统一解法：生成列 + 唯一索引** —— 把不满足条件的行折叠成 `NULL`，唯一索引自然不约束它们。

```sql
-- 005_ledger.sql
`payment_node_uniq` BIGINT UNSIGNED GENERATED ALWAYS AS (
  IF(`type` = 'income' AND `deleted_at` IS NULL, `payment_node_id`, NULL)
) STORED,
UNIQUE KEY `uk_ledger_payment_node_income` (`payment_node_uniq`)
```

必须 `STORED` —— `VIRTUAL` 生成列不能建唯一索引。
`STORED` 生成列会在 `deleted_at` 变化时重算，因此软删除一条已对账收入后，
该付款节点可重新登记 —— 这正是期望行为。

---

<a id="c3"></a>

### 3. MySQL 的 DDL `COMMENT` 不接受相邻字符串字面量拼接

```sql
-- ❌ 报 ERROR 1064
COMMENT '上半句。'
        '下半句'
-- ✅
COMMENT '上半句下半句'
```

`SELECT 'a' 'b'` 在 MySQL 里能拼接成 `'ab'`，但 DDL 的 `COMMENT` 子句解析器不接受。
多行注释内容请写成注释块放在列定义上方，或压成一行。

---

<a id="c4"></a>

### 4. `dayjs.tz` 的三参重载，第三个参数是 locale 不是时区

```js
// ❌ 静默解析错误，差 8 小时
dayjs.tz(text, 'YYYY-MM-DD HH:mm:ss', 'Asia/Shanghai')
// ✅ 无时区信息 → 按上海墙上时间理解
dayjs.tz(text, 'Asia/Shanghai')
// ✅ 带 Z / +08:00 → 先作绝对时刻解析，再换算
dayjs(text).tz('Asia/Shanghai')
```

`src/utils/datetime.js` 的 `parse()` 用正则区分这两种输入。
所有时间处理一律走该模块，时区钉死 `Asia/Shanghai`（§6.2）。

---

<a id="c5"></a>

### 5. 迁移文件一旦执行过就不能改

`scripts/migrate.js` 会校验已执行迁移的 sha256。改了已执行的 `.sql` 会**报错退出**，
因为服务器上不会重跑，最终导致本地与线上结构静默不一致。

要改结构 → **新增一个迁移文件**。
本地写坏了想重来 → `npm run migrate -- --fresh`（会删库重建，非生产环境可用）。

DDL 在 MySQL 中隐式提交、无法回滚，因此每个迁移文件里的语句是逐条执行的，
报错能定位到具体哪一条。

---

<a id="c6"></a>

### 6. 集成测试会 DROP DATABASE

`NODE_ENV=test` 下连的是 `renovation_test`（见 `config/index.js`），
集成测试的 `beforeAll` 会 `migrate --fresh`。

两条硬性要求：
- 集成测试**必须** `--no-file-parallelism`。并行跑多个文件会同时 DROP 同一个库。
- `vitest.config.mjs` 里的 `env: { NODE_ENV: 'test' }` 不能删 —— 它必须在
  `config/index.js` 被 require 之前生效，否则测试会清空**开发库**。

`tests/integration/foundation.test.js` 里有一条断言专门盯着这件事。

---

<a id="c7"></a>

### 7. 测试文件用 CommonJS + 全局注入，不要 `require('vitest')`

本项目源码是 CommonJS，`vitest` 包本身是 ESM-only，
`require('vitest')` 会直接报错。因此 `vitest.config.mjs` 开了 `globals: true`，
测试文件里直接使用 `describe` / `it` / `expect`，不要写 import/require。

---

<a id="c8"></a>

### 8. 四个必须收敛到中间件的校验

需求文档 §6.2 点名这些地方「漏掉一处就是漏洞 / 失效」，因此**不允许各接口自行判断**：

| 校验 | 后果 | 落点 |
| --- | --- | --- |
| 数据权限（AC-AD52） | 越权看到他人项目 | 「按项目隔离」的统一过滤 |
| 阶段门禁（C-7.3、AC-S09） | 门禁失效 | `project_stage.gate_status` 单一事实来源 + 行锁 |
| 归档只读（AC-AD25） | 已归档项目被改写 | 服务层统一拦截 |
| 项目角色（AC-P25 等） | 业主/监理能提交工长数据 | 按 `project_member.role` 判定，`pending` 不计入 |

---

<a id="c9"></a>

### 9. 进度与门禁是两个字段，各有各的事实来源

`project_stage` 同时有 `status` 与 `gate_status`，**不是冗余**：

- `gate_status`（locked/active/pending_acceptance/accepted/disputed/settled）是**单一事实来源**，
  决定能否汇报、能否发起验收；
- `status`（not_started/in_progress/completed/accepted）是**展示状态**，由 progress 与验收结论**派生**，
  没有手工设置入口。

不合并是因为 §4.7.1 里 `accepted` 与 `pending_acceptance` 在展示层都要呈现为「已验收」，
合并后前端只能反推，反推逻辑散落到各页面更易出错。

---

<a id="c10"></a>

### 10. 只追加表：数据库层管不了，靠仓储层约束

`acceptance_flow`（验收流转记录）与 `visit_record`（签到记录）要求
「任何角色含管理员都不得 UPDATE / DELETE」（AC-A14 / AC-A26 / AC-N26）。
MySQL 没有表级只读约束，因此：

**对应的 model 模块不导出 update / delete 方法。** 绕过它的写法应在 code review 中被拦下。
