# 鉴权中间件（95）

对应源码：`server/src/middlewares/miniAuth.js`、`server/src/middlewares/adminAuth.js`、
`server/src/routes/index.js`、`server/src/middlewares/rateLimit.js`。
回归用例：`server/tests/unit/routeAuthOnce.test.js`。

---

<a id="c95"></a>

## 95. 鉴权中间件必须幂等：一个请求只鉴权一次、只扣一个限流额度

### 现象

限流从「读写合计 60 次/分钟」改成「读 180 / 写 60」之后，测试同学实测仍然会被误伤：

| 请求 | 标称额度消耗 | 实测消耗 |
| --- | --- | --- |
| 进一次项目详情（聚合前 9 个接口） | 9 | **24** |
| `GET /projects/:id/visits`（现场考察记录） | 1 | **7** |
| `GET /projects/:id/ledger/summary`、`/payment-nodes` | 1 | **4** |
| `POST` 保存一笔记账 | 1 | **4** |

用户实际可用量只剩标称的 1/3~1/4，「列表 ↔ 详情 ↔ 记账来回四五趟」照样会 429，
需求要消灭的问题根本没解决。

### 根因

`routes/index.js` 把 7 条子路由串在同一个挂载点上：

```js
router.use(
  '/projects',
  require('./mini/project.routes'),
  reportRoutes.projectRouter,
  acceptanceRoutes.projectRouter,
  require('./mini/ledger.routes'),
  reconciliationRoutes.projectRouter,
  doorCodeRoutes.projectRouter,
  visitRoutes.projectRouter
)
```

每条子路由自己 `use(requireMini)`。Express 的 `router.use(mw)` 没有路径匹配，
**子路由就算没有匹配到任何路由，它的 `use` 中间件照样会执行**。于是
`GET /projects/1/visits` 会依次穿过 7 条 `requireMini`：

- 回库查 7 次用户、验 7 次 token；
- `userRateLimit` 扣 7 个读额度；
- 因为 `/projects` 后面还有 6 条子路由，`/projects/1/ledger/summary` 扣 4 个、
  `/acceptances` 扣 3 个 —— **扣多少取决于这条路由排在链上的第几位**。

这个数字看起来很随机，正是「阈值写对了、但用户还是被限流」的典型表现。

### 做法

`requireMini` / `requireAdmin` 在入口处直接短路：

```js
async function requireMini(req, res, next) {
  if (req.auth && req.auth.type === 'mini') return next()
  ...
}
```

鉴权结果与限流额度都是**请求级**的，第二次进来既不重查库、也不再计数。
注意不能「跳过查库但仍调一次限流器」—— 那样计数问题还在。

后台的 `requireAdmin` 目前各子路由挂在不同前缀（`/admin/projects`、`/admin/members`…），
一次请求只会命中一条，暂时没暴露；但同一个挂载点的写法随时可能出现，所以一并加了同样的短路。
它省下的不只是一次查询，还有 `sessions.touch()` 与会话状态校验。

### 为什么不在路由层拆开（另一种改法）

把 `requireMini` 统一提到 `router.use('/projects', requireMini, ...)` 也能修，但要同时改
7 个路由文件，还必须确保每条子路由在别处单独挂载时仍带鉴权（`visitRouter`、`reportRouter`
都是这样复用的）。漏一个就是未授权访问，风险比中间件短路大得多。
**中间件幂等是防御性的：以后无论怎么重组挂载链都不会再重复计数。**

### 顺带修掉的两处

1. **`Retry-After` 改成窗口剩余秒数**。原来取限流键的 TTL（固定 61 秒），
   窗口末尾撞限流的用户会看到「请 61 秒后再试」，而实际一两秒后就能用。
   现在按 `WINDOW_SECONDS - (now % WINDOW_SECONDS)` 计算，客户端退避不会等过头。
2. **账目页后台刷新失败不再替换整页**。原来任何非 404 错误都写 `loadError`，
   于是一次「保存成功 → 后台刷新撞限流」就把已加载的账目整页换成
   「项目账目不可用」。现在与项目详情页同一口径：已有数据时只弹 toast，
   首屏失败才进错误态，并且 429 的标题是「请求太频繁」而不是「账目不可用」。

### 回归怎么验

- `npx vitest run tests/unit/routeAuthOnce.test.js`：跑真实路由树，断言
  `/projects/:id/visits`（链上第 7 条）、`/ledger/overview`（第 4 条）、
  `/acceptances`（第 3 条）、`/reports`（第 2 条）、`/notifications`（独立挂载）
  每个请求都只扣 1 个额度、只回库 1 次。**去掉短路后这条用例会失败**，
  所以它锁的是行为，不是实现。
- 手工：同一账号连刷项目详情 20 次，`X-RateLimit-Remaining` 每次只减 1。
- 新增挂在同一个挂载点下的子路由时，**不要**在路由层另外补限流中间件。

