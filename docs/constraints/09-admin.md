# 工程宝 · 关键约束（管理后台）

> 本文件是 [CLAUDE.md](../../CLAUDE.md)「关键约束」的完整说明。
> 编号保持不变；源码注释中的「CLAUDE.md 第 N 条」仍以该编号为准。

---

<a id="c84"></a>

### 84. Vue 模板表达式里不能写 `import.meta`

```vue
<!-- ❌ 编译报 import.meta may appear only with 'sourceType: "module"' -->
<div v-if="import.meta.env.DEV">
```

模板表达式由 Vue 编译器单独解析，不走模块上下文。在 `<script setup>` 里先取出来：

```ts
const isDev = import.meta.env.DEV;
```

模板只引用变量。登录页的开发环境提示就是踩过这一条。

---

<a id="c85"></a>

### 85. 登录后立刻 push 命名路由会报 `No match`

路由表分两批注册：常量路由（403/404/500/login）在应用启动时就绪；
业务路由要等**第一次导航**时由 `routeStore.initAuthRoute()` 加进 router。
登录接口返回后如果直接 `routerPushByKey('change-password')`，业务路由还没注册 ——
控制台报 `No match for {"name":"change-password"}`，页面停在登录页。

首登强制改密的路径最容易踩到。正确做法是先 `await routeStore.initAuthRoute()` 再跳：
没注册路由的命名跳转不会「稍后生效」，它会直接失败。

---

<a id="c86"></a>

### 86. `@sa/axios` 的 `BACKEND_ERROR_CODE` 只覆盖「2xx + 业务码失败」

后端统一响应是 `{ code, message, data }` 且 HTTP 状态码与 code 同值（§7.2）。
HTTP 4xx 会被 axios 当作传输层错误（`ERR_BAD_REQUEST` / `ERR_BAD_RESPONSE`），
`error.code` **不等于** `BACKEND_ERROR_CODE`。

若只在 `error.code === BACKEND_ERROR_CODE` 分支里取 `response.data.message`，
用户看到的永远是 `Request failed with status code 409`，而不是后端那句
「无法进入施工中：尚未指定工长；尚未指定业主」—— 这类提示看起来像前端崩了，
真实原因却被吞掉。直接读 `error.response.data.message`，不要按 `error.code` 分流。

---

<a id="c87"></a>

### 87. 登录门户必须由**地址**决定，不能做成登录页上的一个下拉框

平台运营与租户管理员是两个入口：

| 入口 | 地址 | 后端参数 | 接受谁 |
| --- | --- | --- | --- |
| 平台 | `/login` | `portal=platform` | `tenant_id IS NULL` 的平台账号 |
| 租户 | `/t/<tenantCode>/login` | `portal=tenant` + `tenantCode` | 仅该租户账号 |

把 `tenantCode` 做成登录页的可选输入框，等于把「我在哪家公司」交给用户猜 ——
输错就登进别家，或者永远登不进去。租户标识必须来自地址，由平台开通租户时生成。

两处提示的口径不同，**不能统一**：

- 平台入口遇到租户账号：密码已经正确，返回 403 并明确提示使用专属地址，
  **不累加 `failed_count`**（误用旧书签不该锁号），但写登录日志；
- 租户入口遇到其他租户账号：与账号不存在一致，返回「账号或密码错误」。
  提示「你不属于这个租户」会泄露账号归属，等于给枚举开了个口子。

---

<a id="c88"></a>

### 88. 改密 / 登出 / 会话失效的跳转不能写死 `/login`

租户管理员的账号在平台入口会被拒。以下三处都必须回到**本次使用的门户**：

1. `resetStore()`（登出、401）——读 `localStg.get('loginTenantCode')`，有值则
   跳 `/t/<code>/login`，没有才跳平台 `/login`；
2. 路由守卫的「未登录」分支——同上，否则 token 被手动清掉后会被送回平台入口；
3. 改密成功页——`resetStore()` 之后再 `replace` 到对应登录页，并且**不要带
   `redirect=/change-password`**：密码刚改完又被送回改密页，用户会以为没生效。

`loginTenantCode` 在登录时写入（平台登录则清除），登出后保留 —— 它决定下一次
会话失效时回哪个入口。

---

<a id="c89"></a>

### 89. elegant-router 生成的路径必须与显式路由一致

`src/views/platform/tenant/index.vue` 会被插件生成成 `/platform/tenant`，
而显式路由里如果写成 `/platform/tenants`，菜单和跳转都能用，但**页签会坏**：
页签按 path 调 `getRouteName(path)` 反查路由名，生成表里没有这个 path，
拿到的就是 `null`，页签无法恢复/关闭。

新增页面时，先看 `src/router/elegant/transform.ts` 里插件生成的路径，
显式路由用同一个 path。目录名决定路径，不要靠手写去「纠正」它。
