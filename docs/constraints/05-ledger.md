# 工程宝 · 关键约束（账务、报告与运行环境）

> 本文件是 [CLAUDE.md](../../CLAUDE.md)「关键约束」的完整说明。
> 编号保持不变；源码注释中的「CLAUDE.md 第 N 条」仍以该编号为准。

---

<a id="c41"></a>

### 41. 存储层的扩展名白名单只约束**用户上传**

`storage.save` 的白名单是给用户上传用的（防止传可执行文件）；
验收报告 PDF 是服务端自己渲染出来的归档物，走 `saveGenerated`。

把两者合成一个入口，就得加一个 `trusted` 之类的开关 —— 而那种开关迟早会被
滥用来「让它先跑通」，结果是 pdf 也被放进了可上传类型。

---

<a id="c42"></a>

### 42. 验收单的「不存在」与「无权访问」必须是同一句提示

`loadForAction` 里两者都返回 `验收单不存在`。
若「不是本项目成员」返回「项目不存在」而「单子不存在」返回「验收单不存在」，
两者一比就能探出某个 id 是否真实存在 —— 这类提示差异会把
AC-A25 / AC-P26 的「不泄露」变成空话。

---

<a id="c43"></a>

### 43. pdfkit 加载 `.ttc` 要的是 **postscript 名**，不是字体族名

```js
// ❌ 报 "Not a supported font format or standard PDF font."
doc.registerFont('cn', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC')
// ✅
doc.registerFont('cn', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'NotoSansCJKsc-Regular')
```

那个报错**完全没提**「你该传 postscript 名」，很容易被误判成字体文件损坏。
查集合内可用名称：

```bash
node -e "console.log(require('fontkit').openSync('<ttc路径>').fonts.map(f=>f.postscriptName))"
```

配置在 `config.acceptancePdf.fontPath` / `fontName`。
与水印一样，字体缺失时**直接失败**，不产出中文变成方块的报告。

改完建议实际渲染一份 PDF 看一眼（`pdftoppm -png` 后用 Read 打开）——
断言只能证明「文件有内容」，证明不了「中文可读」。

---

<a id="c44"></a>

### 44. 门锁密码：本项目的最高敏感级数据（M12，§4.8）

**它是物理安全凭证，不是业务数据。** 前面所有模块存的最敏感的东西是合同金额和手机号；
门锁密码泄露意味着有人能进业主家。因此它的处理规则与其余模块**不同**：

| 要求 | 说明 |
| --- | --- |
| **可逆加密** | AES-256-GCM，密文格式 `v1.<iv>.<authTag>.<ciphertext>`。**不能用 bcrypt** —— 单向的，工长取不出明文 |
| **密钥分离** | 密钥来自环境变量 `DOOR_CODE_KEY`，不进数据库、不进仓库、不进日志。密钥丢失 = 所有密码不可恢复 |
| **日志脱敏** | 必须把 `code` / `doorCode` / `codeCipher` 加进 `utils/logger.js` 的 `SENSITIVE_KEYS`。现有名单只认 `password` / `pwd`，**这些字段名不会被拦住** |
| **不缓存** | 含密码的响应带 `Cache-Control: no-store` |
| **读取留痕** | 每次读取写 `operation_log`。展示明文 ≠ 不记录谁读过 |
| **三重失效** | 项目归档 / 成员被移除 / 业主手动失效。前两者必须在**既有流程里顺带处理**，不新增校验入口 —— 漏一条就留下「前工长仍能开门」的长期风险 |
| **管理员无权查看** | 与后台的「按项目隔离」模型无关。管理员能看到合同金额已经够了，没有理由知道业主家门密码 |

**能力边界必须向业主明示**：系统无法阻止拿到密码的人开门，也无法感知有人开门；
「失效」只作用于系统内的可见性，不改变实体锁上的密码。
**这不是安防方案，是装修期间的便利工具。** 已确认采用「直接展示明文」，
代价是工长/监理手机被翻看或截图即泄露，且只能追溯到「谁读过」，无法证明「谁泄露的」。

**落地时的三条补充（M12）：**

1. **密钥缺失时生产环境拒绝启动**（`doorCode.assertKeyConfigured`），
   非生产环境用派生密钥兜底并打警告。与 WX_MOCK 同一个判断：
   缺密钥时若静默降级，部署的人不会发现，直到有人发现所有门锁密码
   都用一个公开在源码里的密钥加密。
2. **`assertKeyConfigured` 是接收参数的纯函数**（`{isProd, key}`）——
   `config` 是深冻结的，测试改不动它，而「生产把密钥配错」恰恰最需要被测住。
   与 `password.checkBcryptRounds(rounds)` 同一模式（第 46 条）。
3. **解密失败不能让整个列表 500**：单条坏数据标记为 `available: false`、
   记 error 级日志，其余照常返回。抛错会让「一条坏数据」的代价变成
   「所有人都看不了任何密码」；返回空串则更糟 —— 工长会站在门口反复试一个空密码。

---

<a id="c45"></a>

### 45. 测试夹具用 DELETE 而不是 TRUNCATE

`fixtures.resetBusinessTables` 清表用的是 `DELETE FROM`，**不是 TRUNCATE**。

TRUNCATE 在 InnoDB 上会删掉并重建表空间，实测每张表 90–134ms，31 张表合计约 **2.8 秒** ——
而它在每个用例的 beforeEach 里都要跑一次。换成 DELETE 后同样 31 张表只要 **4ms**。

这一处改动把整套测试从**超过 600 秒**压到 **33 秒**（配合下面第 46 条）。
如果将来有人觉得「TRUNCATE 更快」而改回去，先看这条。

代价是 **AUTO_INCREMENT 不重置**。这是可接受的，而且是好事：
测试本来就不该依赖「新建的项目一定 id=1」——那种依赖在用例顺序变化时会莫名其妙地失败。
原先只有 `adminTemplate.test.js` 有一处这样的假设，已改为使用接口返回的 id。

---

<a id="c46"></a>

### 46. bcrypt cost 在测试环境降到 4，生产有硬守卫

cost=10 时单次哈希/校验约 45ms，而集成测试里有上千次登录（每个用例都要建管理员再登录），
仅这一项就吃掉二十多秒。测试环境配成 4（约 8ms），整套再省 21 秒。

**cost 只影响计算量，不影响哈希串格式与比对结果**，因此降下来不削弱对密码逻辑的覆盖。
代价是测试不再覆盖生产实际的计算耗时 —— 但那本来就该在压测里对真实配置做。

生产环境由 `password.checkBcryptRounds()` 守住下限：cost < 10 **直接拒绝启动**。
这条守卫做成了接收参数的纯函数（不是为了好看，是因为 `config` 深冻结、测试改不了它，
而「生产把 cost 调低」恰恰最需要被测住）。`tests/unit/password.test.js` 锁着它。

---

<a id="c47"></a>

### 47. 拼 SQL 时 JOIN 必须写在 WHERE 之前 —— 这个坑踩过两次了

```js
// ❌ 语法错误：FROM ... WHERE ... LEFT JOIN ...
const clause = `FROM ledger l WHERE ${where.join(' AND ')}`
db.query(`SELECT ... ${clause} LEFT JOIN project_stage s ON ...`)

// ✅ 拆成两段维护
const fromClause = `FROM ledger l LEFT JOIN project_stage s ON ...`
const whereClause = `WHERE ${where.join(' AND ')}`
db.query(`SELECT ... ${fromClause} ${whereClause} ORDER BY ...`)
```

第一次在 `progressReport.model`，第二次在 `ledger.model`。两次的表现都是 500 +
`ER_PARSE_ERROR`，而报错里给出的「错误位置」指向 JOIN 那一行，很容易被误读成
JOIN 本身写错了。

**根本原因**：把「FROM + 条件」揉成一个变量之后，后续再想加 JOIN 就只能接在它后面。
**避免方式**：只要一个查询可能带 JOIN，就把 `fromClause` / `whereClause` 分开命名。

---

<a id="c48"></a>

### 48. 红冲：金额同号，靠 `is_reversal` 在汇总时取负

红冲记录（AC-L23）的金额与原记录**同号正数**，不是负数 —— 金额列是 `DECIMAL(12,2)`
且业务上不允许负数（AC-L03）。冲销语义由 `is_reversal` 表达：

```sql
COALESCE(SUM(CASE WHEN is_reversal = 1 THEN -amount ELSE amount END), 0)
```

**每一个汇总查询都必须带这个 CASE**（`sumByType` / `sumByExpenseByCategory` /
`sumByExpenseByMonth` / `sumByProjectGrouped`）。漏掉任何一个，那个口径下
被冲掉的金额仍然算数 —— 而账面上凭空多出钱，比少算更难被发现。

---

<a id="c49"></a>

### 49. 服务层预检的条件必须与数据库索引**完全一致**

`ledger` 的条件唯一索引（迁移 011）是
`type='income' AND deleted_at IS NULL AND reversed_by_id IS NULL`。

`ledgerModel.findIncomeByPaymentNode` 是它的服务层预检，**必须带同样的三个条件**。
曾经漏掉 `reversed_by_id IS NULL`，结果是：红冲之后数据库允许重新登记，
但服务层预检把它拦下 —— 用户看到「该节点已登记过付款」，而系统里那条明明已经冲掉了。

**索引与预检是同一个约束的两处表达，改动任何一处都要同步另一处。**

---

<a id="c50"></a>

### 50. 红冲会释放付款节点的收入位（迁移 011）

原始的条件唯一索引是 `IF(type='income' AND deleted_at IS NULL, payment_node_id, NULL)`。
红冲时原记录**保留**（账目只增不减），于是它继续占着唯一位 ——
**红冲之后再也无法为这个节点登记正确的金额**。

这是个真实的死角：业主转错钱、工长记错金额，按流程红冲完之后发现「这节点永远登记不了了」。

迁移 011 把已冲销的行也排除出约束，语义变成「一个付款节点只能有一条**有效**收入流水」。

配套：收入被红冲后，付款节点状态退回 `unlocked`（那笔款实际上没收到）。
不退的话节点会一直显示「已付款」而账上是 0，两者对不上。
