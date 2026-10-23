# 小程序管理员（90）

## c90. 小程序管理员是独立后台身份，不是项目角色

小程序里的「管理员」对应后台 `admin_user` 的 `owner` / `admin` 账号，**不是**
`project_member.role` 的第四种取值。把管理员塞进项目角色会同时破坏项目数据权限、
验收签字与记账口径，因此这条边界不能模糊。

### 两套 token，绝不混用

- C 端：`gc_token`，JWT audience `mini`，只访问 `/api/v1/*`。
- 管理端：`gc_admin_token`，JWT audience `admin`，只访问 `/api/v1/admin/*`。
- 管理员 token 必须由现有的 `jwt.signAdmin` 签发，并执行 `sessions.start`；
  **不能**让 mini token 直接通过 `requireAdmin`，也不能在 mini 路由里复用管理员 token。
- 管理员 JWT 额外带 `amr`（`password` / `wechat`），只用于判断「当前会话是否允许
  创建新的微信绑定」，不参与授权。
- C 端 401 只清 `gc_token` 等 C 存储；管理端 401 只清 `gc_admin_*`。两个方向都不能
  互清，否则管理会话过期会把业主/工长的登录态一起踢掉。

### 微信免密绑定

表 `admin_wechat_binding`（迁移 018）以 **openid 为权威键**，不是 `user_id`：

- 手机号绑定会合并 C 端占位账号并改变 `user.id`，但 openid 不变；
- `user_id` 只作审计与注销辅助，合并后由 `userModel.bindPhone` 修正；
- 一个管理员最多一条 active 绑定；同一个微信可以绑定多个管理员账号，进入时选择身份；
- `admin_token_version` 是改密/禁用后的兜底：即使撤销写入漏了，版本失配也会让绑定失效；
- 重新绑定另一个微信时，旧绑定在同一事务内 revoke；生成列 + 唯一索引实现
  「失效后可重新绑定」（CLAUDE.md 第 2 条）。

绑定必须在以下事件撤销：

| 事件 | reason |
| --- | --- |
| 本人改密 | `password_changed` |
| 管理员重置密码 | `password_reset` |
| 启用/禁用账号 | `admin_active` / `admin_disabled` |
| C 端账号注销 | `user_deactivated`（必须在匿名化、清空 openid 之前） |
| 重新绑定 | `rebind` |
| 主动解绑 | `manual` |

### 免密登录必须重新校验，不能只看绑定表

每次 `POST /auth/admin/wechat-login` 都要重新确认：

1. 绑定 active，且 `binding.openid === 当前 C 用户 openid`；
2. 管理员账号 active、未锁定、`must_change_password=0`；
3. 角色是 `owner` / `admin`，平台账号拒绝；
4. `binding.admin_token_version === admin_user.token_version`；
5. 绑定租户与管理员租户一致，租户 active 且未到期；
6. 通过后签发新的管理员 JWT + `sessions.start`，并写 `admin_login_log`
   （`auth_method='wechat'`）与 `operation_log`。

绑定创建还要求：本次管理员会话必须来自密码登录（`amr='password'`），且在 30 分钟内；
`X-Mini-Token` 只用于证明 openid，不进入任何日志。

### 入口与页面边界

- 保留项目 / 验收 / 记账 / 我的四个原生 tab，**不新增第五个 tab**，不做自定义 tabBar。
- 管理页面全部是 `pages/admin/**` 下的非 tab 页，使用 `navigationStyle: custom`。
- 项目列表顶部「管理」只对有管理员 token 或有效绑定的用户显示；首次登录从「筛选」
  面板底部的「管理员登录」进入，登录并绑定后顶部入口出现。普通用户看不到顶部入口。
- 管理端直接复用 `/api/v1/admin/*`：项目、成员、付款节点、阶段工序的权限、审计与
  数据与网页后台完全一致，不存在需要同步的第二套数据。
- 首期不在小程序做的：账号管理、模板编辑器、系统配置、内容页、反馈、操作/登录日志、
  导出、平台租户管理、门锁密码。它们仍在网页后台。
- 项目阶段/工序完成度在管理端只读；写入口仍然只有 C 端进度汇报（CLAUDE.md 第 28 条）。
- 项目删除仅 owner；小程序首期不提供软删除恢复入口，删除前必须明确告知。

### 常见错误

- 把 `gc_admin_token` 和 `gc_token` 存成同一个键，或让 `clearSession()` 清管理员 token。
- 用 mini token 作为 `Authorization` 调 `/admin/*`；`requireAdmin` 会 401，这是正确行为。
- 绑定只在创建时校验，免密登录时不再回库；账号被禁用/改密后仍能进入。
- 改密只自增 `token_version` 而不撤销绑定，导致管理入口继续显示。
- C 端注销时先 `anonymize` 再撤销绑定；openid 已被清空，绑定永远删不到。
- 在日志里记录 openid、mini token、admin token 或验证码答案。
- 给普通用户显示「管理」入口，或把管理员写进 `project_member`。
