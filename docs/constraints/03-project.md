# 工程宝 · 关键约束（项目、成员与模板）

> 本文件是 [CLAUDE.md](../../CLAUDE.md)「关键约束」的完整说明。
> 编号保持不变；源码注释中的「CLAUDE.md 第 N 条」仍以该编号为准。

---

<a id="c21"></a>

### 21. `archived_at` 必须双向维护

`projectModel.updateStatus` 进归档时置 `NOW()`，**离开归档时清空**。
只写不清的话，把项目从已归档改回已完工之后 `archived_at` 还留着旧值，
任何按它统计「已归档项目」的报表都会算错。

---

<a id="c22"></a>

### 22. 两个「恢复」是不同的东西

| 接口 | 含义 | 前置条件 |
| --- | --- | --- |
| `POST /admin/projects/:id/restore` | 恢复**软删除**（AC-AD27） | 项目被软删除了 |
| `PUT /admin/projects/:id/status` 改回 `finished` | 解除**归档**（§5.2） | 项目状态是 archived，且操作者是超管 |

别把它们合并成一个接口：一个动的是 `deleted_at`，一个动的是 `status`，
混在一起之后「恢复」的含义就没人说得清了。

另外，**归档有两个入口**（`POST /archive` 与 `PUT /status`），两边的二次确认门槛必须一致 ——
否则绕过确认只需要换个接口。`changeStatus` 里对 `targetStatus === 'archived'` 单独判了 confirm。

---

<a id="c23"></a>

### 23. 「工长必须 1 人、业主至少 1 人」（AC-AD58）的校验时机

文档说「不满足时拒绝保存」，但没说清「保存」是哪一步：§5.2 的新建项目表单里
**没有**人员字段，人员分配（B-2.6）是独立的一步，且邀请后成员是 pending、
要等对方在小程序确认（AC-AD18）。若在建档时就要求 1 名工长，建档根本无法完成。

因此校验放在**流转到「施工中」**这一步：那是「人员配齐、可以开工」的自然语义位置，
也是唯一能保证后续汇报与验收有明确操作人的时机。只统计 `active` 成员。

v2.12 起还要有 1 名已确认的**主业主**（见第 92 条）：有业主但没有主业主时同样拒绝流转，
提示「尚未指定主业主」或「主业主尚未确认邀请」。

---

<a id="c24"></a>

### 24. 多名工长与主工长（Q11，v1.3）

**一个项目可以有多个工长，其中恰有 1 名主工长。** 所有工长能汇报进度、登记支出
（各自留痕）；**仅主工长能发起验收、提交阶段结算单**。

| 要点 | 说明 |
| --- | --- |
| 表结构 | `project_member.is_primary` + 生成列 `primary_foreman_key` + 唯一索引（迁移 008）。又是一个「MySQL 没有 partial index → 用生成列折叠成 NULL」的用法 |
| 自动指定 | 首个工长被邀请时自动成为主工长，避免「有工长但没人能发起验收」的死角 |
| 改指顺序 | `projectMemberModel.setPrimary` 必须**先清零再置位**。先置位会撞唯一索引（同 bindPhone 的合并陷阱） |
| 不能移除主工长 | 返回 409。自动提升下一位会**静默**改变「谁能发起验收」 |
| 邀请时的自查 | 判断「是否已有主工长」要 `AND user_id <> 本人`，否则重新邀请现主工长时他会把自己挤掉 |
| 权限判定 | `projectMemberModel.findActiveRole()` 现在返回 `is_primary`。**M8 实现发起验收时必须检查它**，不能只看 `role === 'foreman'` |

需求文档已同步（v1.3）：§2.1、§2.2 权限矩阵、§5.2、C-3.2、C-3.13、C-7.6、
AC-A24、AC-AD58、AC-AD68~71、G-24。**Q11 已关闭**，不再是待确认事项。

> 主工长的 `is_primary` 只对 `role=foreman` 有意义；业主的主业主 / 临时业主用独立的
> `owner_type` 表达，见 [第 92 条](./12-primary-owner.md#c92)。两者不要混用。

---

<a id="c25"></a>

### 25. zod 的报错默认是英文，且会直接被用户看到

`utils/validate.js` 会把**单条**校验错误作为面向用户的 `message` 返回。
而 zod 默认抛的是 `Array must contain at least 1 element`、`Required`、`Invalid input` ——
不处理就会原样出现在前端提示里。

因此 `utils/zodLocale.js` 注册了全局中文错误映射，由 `validate.js` 以副作用方式 require。
**新增 schema 时不要删掉那行 require**；需要更精确的措辞时，在具体字段上写 `message`
（会覆盖全局映射），例如 `z.array(itemSchema).min(1, '每个阶段至少需要包含 1 个工序')` ——
通用兜底的「不能为空」说不清是哪个数组空了。

`tests/unit/validate.test.js` 锁着这些文案与「单条错误提到 message、多条用通用文案」的取舍。

---

<a id="c26"></a>

### 26. 模板保存是「整体替换」，且旧行是物理删除

§5.3 明确「所有排序在保存时整体提交，服务端按最终顺序重写 `seq`」，
因此 `PUT /admin/stage-templates/:id` 收到的是完整的阶段工序数组，
`seq` 由数组下标决定 —— **前端不传 `seq`**，两份顺序并存迟早不一致。

`replaceStructure` 用 `DELETE` 而非软删：模板的阶段/工序**没有任何东西引用**
（项目里的 `project_stage` / `project_item` 是建档时拷贝的副本，见 §6.2 / AC-AD17），
物理删除不会有悬空引用，也避免改十次模板攒十份软删数据。
顺序必须**先删后插** —— `uk_sts_template_seq` 对 `(template_id, seq)` 唯一。

---

<a id="c27"></a>

### 27. 默认模板的唯一性靠生成列，`clearDefault` 必须先调

`stage_template.is_default` 上有一个生成列 `default_key` + 唯一索引（迁移 009），
保证全系统至多一个默认模板。设默认时必须**先 `clearDefault` 再 `setDefault`** ——
直接置位会撞唯一索引（又是那一类顺序陷阱）。

「**至少**一个默认模板」数据库表达不了，由「默认模板不可删除」这条服务层规则保证。
迁移 009 加这个约束不是洁癖：两个默认模板会让 `findDefault()` 按 `id ASC` 静默挑一个，
而删除保护还会误判。

---

<a id="c28"></a>

### 28. 工序完成度只有一个写入口

`progress.service.applyItemProgress()` 是**唯一**能改工序完成度的地方。
它在同一个事务里做五件事：校验操作者是该项目的已确认工长、校验门禁、
`SELECT ... FOR UPDATE` 锁行、改进度并写 `progress_log`、重算所属阶段完成度。

不要新增第二个写入口（例如一个「直接调整完成度」的后台接口）。
C-2.4 规定完成度是**随进度汇报提交**的，而留痕正是这个产品在质量争议时的价值 ——
多一个入口就多一条不写留痕改数据的路径。

补一句：`project_item.progress` 与 `project_stage.progress` 的**一致性**完全依赖
「改动即重算」。因此所有会改变「该阶段下工序集合或其权重」的操作
（改进度、增工序、删工序、改工序权重）都必须在同一事务里调
`recomputeStageProgress`。漏一处，阶段完成度就永久脱节，而门禁与看板都信它。

---

<a id="c29"></a>

### 29. 阶段状态是派生的，判定顺序不能换

`deriveStageStatus` 的顺序：**已验收优先** → 完成度满 100 → 有进度 → 未开始。

已验收放最前是因为 AC-P18 允许下调完成度：一个已经验收通过的阶段，
即便之后有人把某个工序完成度改小，也不该显示回「进行中」。
`ACCEPTED_GATES` 同时包含 `accepted`、`disputed`、`settled` ——
`disputed` 表示结算单有异议，但**验收**这一步已经过了。

---

<a id="c30"></a>

### 30. 阶段与工序的删除保护

- **不能删掉某阶段的最后一个工序**：零个工序会让阶段完成度恒为 0.00，
  这个阶段永远推进不到 100% 去触发验收，而界面上看不出任何异常。
- **不能删掉项目的最后一个阶段**：同理，时间轴会是一片空白。

两条都返回 409 并说明原因，而不是放行后留下一个说不清状态的项目。

---

## 补充：项目地图定位（实现说明，不占用约束编号）

新建 / 编辑项目时，网页后台与小程序管理端共用 `/admin/maps/geocode`、
`/admin/maps/reverse-geocode`、`/admin/maps/static`。静态地图由服务端调用高德
Web 服务，以 base64 data URL 返回；**AMap Key 只留在服务端**，前端不加载地图 JS SDK。

- 创建 / 编辑接口接受可选 `longitude` / `latitude`，两者必须同时出现；
  同时存在时直接使用，不再按地址地理编码。
- 只改坐标（不传 address）是合法更新；`projectModel.update` 的坐标写入与
  `address` 已解耦。
- 前端按 `coordinateSource` 判断：地址改动后，`geocode` / `hydrate` 来源的旧坐标
  不再提交，交给后端重新解析；`manual` / `choose` 是管理员明确选择的位置，继续提交。
- 静态图拖拽使用 CSS 像素 + Web Mercator。**高德静态图的 zoom 比标准 Web Mercator
  大 1**（实测 zoom=16 的覆盖范围等同 `256 * 2^17` 世界像素）；服务端与两端前端
  必须使用同一偏移，否则拖动距离会偏一倍。
- 地图服务不可用时返回 `found:false` / `available:false`，表单仍可保存并手工填写坐标
  （AC-AD54）；不要把第三方地图错误打成 500。
