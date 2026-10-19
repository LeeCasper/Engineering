# 工程宝 · Web 管理后台

B 端后台。基座是 [Soybean Admin Element Plus 版](https://github.com/soybeanjs/soybean-admin-element-plus)
v1.4（MIT）：Vue 3 + Vite + TypeScript + Element Plus + UnoCSS。
只保留布局、主题、路由与请求基础设施，模板自带的 demo 页面已删除。

当前已交付：**平台 / 租户双登录入口、首登强制改密、工作台、项目管理、平台租户管理、
阶段模板、账号管理、系统配置、操作/登录日志、内容页、意见反馈、排障授权**。
数据看板按约定属于 V1.2，不在本轮。

## 运行

```bash
cd admin
pnpm install
pnpm dev      # http://127.0.0.1:9527
pnpm build    # 产物在 dist/
```

后端需要先启动（`cd ../server && npm run dev`）。开发环境的 Vite 代理把
`/proxy-default/**` 转发到 `http://127.0.0.1:3000/api/v1/**`。

### 环境变量

| 文件 | 用途 |
| --- | --- |
| `.env` | 品牌名、成功码、登出码、主题前缀等公共配置 |
| `.env.test` | `vite --mode test`（`pnpm dev`）使用，指向本机后端 |
| `.env.prod` | `vite build --mode prod` 使用，`/api/v1` 同源 |

生产部署需要把 `/api/v1` 反向代理到后端；前端静态文件本身不需要 Node 进程：

```nginx
location / { try_files $uri $uri/ /index.html; }
location /api/v1/ { proxy_pass http://127.0.0.1:3000/api/v1/; }
```

## 登录（两个入口）

| 入口 | 地址 | 适用账号 |
| --- | --- | --- |
| 平台运营 | `/login` | `tenant_id IS NULL` 的平台账号 |
| 租户管理员 | `/t/<tenantCode>/login` | 该租户内的 owner / 项目管理员 |

- 平台开通租户后，后台展示并支持复制 `http://<host>/t/<tenantCode>/login`。
  **租户标识由地址自动带入**，不再让用户手工输入。
- 平台入口遇到租户账号：403「该账号属于租户，请使用所属公司的租户专属管理地址登录」，
  **不计入登录失败次数**（密码是对的，误用旧书签不该锁号），但写登录日志。
- 租户入口遇到其他租户的账号：与账号不存在一致，返回「账号或密码错误」，
  不能提示「你不属于这个租户」，否则可以拿它枚举账号归属。
- 会话失效 / 登出后，前端根据本地 `loginTenantCode` 回到对应入口；
  租户管理员不会被甩到平台入口（那里会拒绝 ta）。
- 验证码**一次性有效**，登录失败后页面自动换一张。
- 首次登录（`mustChangePassword=true`）被强制送到 `/change-password`：
  后端此时只放行改密 / 资料 / 登出三个接口；改密必须输入**原密码**，
  成功后 token 立即失效并重新登录。

开发环境（后端 `NODE_ENV=development`）验证码接口会回显 `debugAnswer`，
登录页直接显示，方便联调。生产环境不会返回该字段。

### 本机种子账号

```text
平台运营：  /login              platform / Platform123456
租户管理员：/t/default/login    admin    / Admin123456   （租户 #1，code=default）
```

两者首次登录都会强制改密。若本机数据库里的密码已被改过，可以重置
（**仅限开发库**）：

```bash
cd ../server
node -e "const b=require('bcryptjs'),d=require('./src/db/pool');(async()=>{await d.query(\"UPDATE admin_user SET password_hash=?,must_change_password=1,token_version=token_version+1 WHERE username='admin' AND tenant_id=1\",[await b.hash('Admin123456',10)]);process.exit(0)})()"
```

## 角色与菜单

| 角色 | 可见范围 | 菜单 |
| --- | --- | --- |
| `platform` 平台运营 | 默认 0 个租户业务数据；只有租户授予窗口后可只读进入 | 工作台、平台运营 / 租户管理；窗口内额外出现项目、模板、账号、配置、日志、内容页、反馈、我的导出 |
| `owner` 租户管理员 | 本租户全部项目 + 本租户账号/模板/配置 | 工作台、项目管理、阶段模板、账号管理、系统配置、日志中心、内容页、意见反馈、排障授权 |
| `admin` 项目管理员 | 本租户内自己创建或被授权的项目 | 工作台、项目管理、阶段模板、账号管理（仅自己创建的下属）、系统配置（只读）、日志中心、内容页、意见反馈；**无排障授权** |

路由在 `src/router/routes/index.ts` 显式声明，`meta.roles` 决定可见性。
**前端隐藏入口不是权限校验**：所有接口仍由后端的
`requireAdmin` / `requireTenant` / `requireTenantOwner` 判定。

## 已实现页面

| 页面 | 路径 | 接口 |
| --- | --- | --- |
| 登录 | `/login` | `GET /admin/auth/captcha`、`POST /admin/auth/login` |
| 强制 / 主动改密 | `/change-password` | `POST /admin/auth/change-password` |
| 工作台 | `/home` | 租户账号：项目计数与最近项目；平台账号：租户计数与运营入口 |
| 平台 · 租户管理 | `/platform/tenant` | 租户列表 / 详情、开通（生成专属地址）、调整配额与到期、停用 / 恢复 / 退租；租户授予窗口后可从「更多 → 只读进入（排障）」进入该租户 |
| 项目列表 | `/project/list` | 列表、筛选、分页、新建、编辑、状态流转、归档、解除归档、软删除、批量归档 / 分配工长、导出 Excel |
| 项目详情 · 概览 | `/project/detail/:id` | 项目详情、阶段概况、付款节点概况、坐标手工拾取（AC-AD54） |
| 项目详情 · 阶段工序 | 同上 | 阶段 / 工序增删改（**不提供改完成度的入口**） |
| 项目详情 · 成员 | 同上 | 成员列表、手机号邀请、主工长改指、解除成员 |
| 项目详情 · 付款节点 | 同上 | 整体替换、手工解锁、合同额与节点合计差异提示 |
| 阶段模板 | `/template` | 模板列表 / 新建 / 编辑（阶段、工序、默认验收项、排序）/ 复制 / 设默认 / 删除 / 预览 |
| 账号管理 | `/account` | 账号列表、新建、启用 / 禁用、重置密码、授予项目数据权限 |
| 系统配置 | `/config` | 配置清单与修改；非 owner 只读；如实标注「暂未生效」 |
| 操作日志 | `/log/operation` | 按模块 / 动作 / 操作人类型 / 日期筛选；展开查看变更前后值 |
| 登录日志 | `/log/login` | 按用户名 / 结果筛选；项目管理员只看自己的记录 |
| 内容页 | `/content` | 关于我们 / 用户协议 / 隐私政策；编辑、保存草稿、发布 |
| 意见反馈 | `/feedback` | 列表、查看图片、置处理中 / 已处理、写回执 |
| 我的导出 | `/export-task` | 异步导出任务列表、状态与失败原因、下载（仅发起人） |
| 排障授权 | `/grant` | 授予平台账号限时只读窗口、查看历史、立即撤销 |
| 个人中心 | `/user-center` | `GET /admin/auth/profile`；租户管理员可复制自己的管理地址 |

### 平台只读排障

平台运营**不是**租户的超级管理员。它默认看不到任何租户数据，也不能修改租户账号密码；
唯一入口是租户管理员在「排障授权」里给某个平台账号开一个时间窗（最长 7 天）：

1. 租户 owner 打开 `/grant` → 授予访问窗口 → 填平台账号用户名与截止时间；
2. 平台在 `/platform/tenant` 找到该租户 → 更多 → **只读进入（排障）**；
3. 进入后页面右下角常驻「只读排障模式」提示，租户业务菜单才会出现；
4. 窗口内所有写操作按钮被隐藏，后端 `requireTenant` 同时拒绝任何写请求；
5. 每一次请求都写入**目标租户**的操作日志，租户 owner 能看到平台来过；
6. 点「退出排障」清掉上下文并回到平台首页。

C 端用户（工长 / 监理 / 业主）是**项目成员**，不是租户账号：在排障窗口内打开
项目详情 → 成员 tab 可以看到成员、角色、状态与脱敏手机号；后台没有「租户级用户列表」，
平台也不能通过这个窗口重置任何人的密码。

已确认的产品策略（PRD v2.4 / AC-T21、AC-T22）：

- 平台**永久不能**重置租户账号密码，包括租户 owner；窗口内也只读。
  租户 owner 忘密由运维人工处理，不提供平台侧自助找回。
- 小程序用户信息**只在项目成员里**出现；不新增租户级用户列表，也不给平台默认可见入口。

### 刻意不做的两件事

- **不在后台直接调整阶段 / 工序完成度。** 完成度只能由 C 端进度汇报写入并留痕
  （CLAUDE.md 第 28 条）。多一个写入口就多一条不写留痕改数据的路径。
- **不为平台账号提供「直接看租户项目」的入口。** 平台默认 `1 = 0`；
  排障必须由租户管理员授予时间窗，且窗口内只读、每次访问留痕。

## 目录

```
src/
├── router/routes/index.ts   路由与角色声明（显式维护）
├── service/
│   ├── api/                 auth / project / template / account / config /
│   │                        log / content / feedback / grant / platform 接口
│   └── request/             统一请求层（success code 0、401 登出、X-Tenant-Id）
├── store/modules/auth/      登录态、强制改密、角色
├── views/
│   ├── _builtin/login/      登录页（平台 / 租户共用，靠路由参数区分入口）
│   ├── change-password/     改密页
│   ├── home/                工作台
│   ├── project/             项目列表与详情（含 tabs 组件）
│   ├── template/            阶段模板列表与编辑器
│   ├── account/             账号管理
│   ├── config/              系统配置
│   ├── log/                 操作日志 / 登录日志
│   ├── content/             内容页
│   ├── feedback/            意见反馈
│   ├── export-task/         我的导出（异步导出任务）
│   ├── grant/               排障授权
│   ├── platform/tenant/     平台租户管理
│   └── user-center/         个人中心
└── utils/
    ├── format.ts            金额 / 日期 / 状态文案
    └── tenant.ts            租户专属登录地址与复制
```

## 与模板的差异

- 成功码从 `0000` 改为 `0`，错误字段从 `msg` 改为 `message`；
- 去掉 refresh-token 流程：本项目没有 refresh token，改密/禁用会让 token 立即失效；
- 401 统一清会话回登录页，不弹「登录已失效」的重复提示；
- 品牌色 `#165DFF`、品牌 Logo、页脚与标题改为工程宝；
- 删除 demo 页面；`package.json` 里仍有模板自带的图表 / 甘特等依赖，
  未被打包，后续可安全裁剪。

## 验证

本目录的 `screenshots/` 保存了用 Playwright（Chromium 1440×1000）跑通的截图：

- 登录页与验证码；
- 强制改密；
- 工作台（租户管理员 / 平台运营两种视角）；
- 项目列表、新建项目、批量归档（逐条结果）、导出 Excel（同步下载）、我的导出；
- 项目详情四个 tab；
- 付款节点配置与保存；
- 成员邀请（pending）；
- 人员未配齐时状态流转被拒（后端 409 中文提示）；
- 平台入口拒绝租户账号（403 中文提示）；
- 平台开通租户 → 生成专属管理地址 → 租户管理员从该地址登录 → 首登改密 → 进入租户后台；
- 模板新建（含默认验收项）与删除、配置修改、内容页编辑、排障授权创建与撤销；
- 项目管理员视角：菜单无排障授权、系统配置只读、账号列表只剩自己创建的下属、
  直接访问 `/grant` 被拦到 403。
