# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 工程宝 · 开发约束

> 本文件记录**架构约定**与**踩过的坑**。改动代码前请先读「关键约束」一节 ——
> 那里的每一条都是实际踩出来的，不是理论建议。
>
> **阅读建议**：先看「架构要点」→ 第 1~9 条（数据库/测试基础）→ 第 71~90 条（多租户、后台与小程序管理员）。
> 约束编号是历史追加顺序且被源码注释引用，**不要重排或复用编号**。
> 90 条约束的完整说明已按主题拆到 [`docs/constraints/`](docs/constraints/)，
> 本文件只保留编号索引，按编号仍可直接检索。

## 项目定位

室内装修协同系统。以项目为中心，把「进度汇报 → 多级验收 → 阶段结算 → 推进门禁」串成闭环。
需求见 `需求文档.md`（**一切实现的最终依据**）。

> **产品方向（v1.7 确认）**：聚焦**室内装修（家装）**。
> 工装特有的能力（消防验收、多标段分包、总包/分包多层级）**不做** ——
> 遇到「这个功能工装会需要吗」时，默认答案是「不做」。

- **C 端**：微信小程序（uni-app），工长 / 监理 / 业主；另有租户 `owner` / `admin` 的移动管理端
- **B 端**：Web 管理后台（Vue3 + Element Plus，基于 Soybean Admin），平台运营 / 租户管理员 / 项目管理员

| 端 | 目录 | 技术栈 | 语言 |
| --- | --- | --- | --- |
| 后端 | `server/` | Express + MySQL 8 + Redis | CommonJS JavaScript |
| 管理后台 | `admin/` | Soybean Admin Element Plus + Vue3 + Vite + Element Plus + UnoCSS | TypeScript |
| 小程序 | `miniapp/` | uni-app + Vue3 + Vite | JavaScript |

三端共用同一套 API；后台接口统一挂在 `/api/v1/admin/*`，C 端在 `/api/v1/*`。
后端与小程序刻意使用 JavaScript；后台沿用 Soybean 模板的 TypeScript，不要为了「统一」把它改回 JS。

## 文档地图

| 文件 | 内容 |
| --- | --- |
| `需求文档.md` | 产品需求（v2.8），**一切实现的最终依据** |
| `CLAUDE.md` | 本文件：架构约定、常用命令、90 条约束编号索引 |
| `docs/constraints/` | 90 条约束的完整说明，按主题拆分；编号与源码注释一一对应 |
| `README.md` | 环境准备、数据库初始化、快速开始、交付进度 |
| `admin/README.md` | 双登录入口、角色菜单、已实现页面与验证方式 |
| `miniapp/README.md` | Stitch 设计稿来源、页面行为、原生 tabBar、资源生成 |
| `DESIGN.md` | Stitch 导出的设计令牌（品牌色 `#165DFF` 等），仅作设计参考 |

## 当前进度

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M1 | 基建：配置、DB、缓存、响应/错误、迁移、单测与集成测试骨架 | ✅ 已完成 |
| M2 | B 端认证与账号管理（AC-AD01~08、10、47~51） | ✅ 已完成 |
| M3 | C 端微信登录与我的项目（C-1.1~1.5、AC-AD18/19、AC-U02） | ✅ 已完成 |
| M4 | 项目、成员、付款节点、数据权限、主工长（AC-AD11~27、52~59、60~61、68~71） | ✅ 已完成 |
| M5 | 阶段模板管理（AC-AD28~35、62~64） | ✅ 已完成 |
| M6 | 阶段工序树、完成度算法与变更留痕（AC-P02~04、14~19、AC-AD16/23、AC-S09 汇报侧） | ✅ 已完成 |
| M7 | 进度汇报、服务端水印、评论、未汇报提醒（AC-P05~13、20~26） | ✅ 已完成 |
| M8 | 验收状态机、电子签名、报告 PDF、付款节点联动（AC-A01~A26） | ✅ 已完成 |
| M9 | 记账、付款节点流转、对账锁定、红冲、结算单 PDF（AC-L01~L31） | ✅ 已完成 |
| M10 | C 端消息中心、后台操作日志、系统配置（AC-U06~10、AC-AD09、AC-AD65~67） | ✅ 已完成 |
| M11 | 个人中心（AC-U01~05、AC-U11~U20、内容页、意见反馈） | ✅ 已完成 |
| M12 | **门锁密码管理**（§4.8 / AC-K01~K16） | ✅ 已完成 —— 全项目敏感级别最高的模块 |
| M13 | **SaaS 多租户改造**（平台 → 租户 → 项目三层隔离） | ✅ 已完成（P0~P6；P2 的权限矩阵在 P1/P3/P4 中一并落地） |
| V1.2-A | **考察计划与路线规划**（§4.6 / C-6.3~C-6.12） | ✅ 已完成：多选项目、起点、推荐顺序、手动重排、逐段导航、保存复用、坐标变更失效、地图降级；现场签到仍属后续 |
| V2.9 | **平台运营数据看板 + 租户地区字段**（§5.7.6 / AC-T23~T25） | ✅ 已完成：中国地图省级着色、省 → 市行政区划下钻、未分配地区统计、地区租户列表；开通/调整租户录入省 + 市 |
| — | 租户侧项目数据看板（AC-AD36~43） | 明确不在本轮（V1.2 的项目/工长/财务统计，与平台运营看板是两套口径） |
| — | 管理后台页面（`admin/`） | ✅ 基座 / 平台与租户双登录 / 项目 / 平台租户 / **平台数据看板** / 平台基础配置 / 基础内容页 / 平台日志中心 / 阶段模板 / 账号 / 配置 / 操作与登录日志 / 内容页 / 反馈 / 排障授权 / 平台只读排障 / 我的导出 |
| — | C 端小程序（`miniapp/`） | 🚧 已开始：首页（我的项目）、项目详情页、工程动态页、记账页、验收页、验收详情页、登录页、角色说明页、我的页 1:1 还原；我的项目 / 项目详情 / 工程动态 / 记账总览、流水与对账 / 消息中心 / 订阅状态 / 意见反馈 / 注销账号 / 租户管理员移动管理端 / **考察计划与路线规划** / **门锁密码（业主管理、工长监理查看）** / 搜索筛选 / 邀请确认 / 无项目引导 / 跨项目验收收件箱 / 业主签名已接通 |

**后端 M1~M13、V1.2-A 路线规划与 V2.9 平台运营看板已完成**：151 条路由、40 张业务表、
893 条自动化测试（38 个测试文件）、123~124 项端到端冒烟断言
（平台账号首登改密那条只在首次运行时出现）。

管理后台页面已交付；剩余的是 C 端小程序的进度汇报提交页。

本轮实际已覆盖原 V1.1 的多级验收、对账结算、阶段门禁与 PDF（M8 / M9 已落地）；
V1.2 的**路线规划已交付**；平台运营看板（租户地区维度，V2.9）已交付，
租户侧的项目/工长/财务看板（AC-AD36~43）与现场签到仍不在本轮。

## 常用命令

```bash
# 首次安装
cd server && npm install
cd ../admin && pnpm install
cd ../miniapp && npm install

# 后端（server/）
npm run dev                 # 开发模式（nodemon 热重载）
npm start                   # 生产启动
npm run migrate             # 执行未应用的迁移
npm run migrate:test        # 在测试库上执行迁移（NODE_ENV=test）
npm run migrate -- --status # 只看迁移状态，不改库
npm run migrate -- --fresh  # 删库重建（非生产环境可用）
npm run seed                # 灌种子数据（幂等，可重复执行）
npm test                    # 单元测试（纯逻辑，不碰数据库）
npm run test:watch          # 单元测试 watch 模式
npm run test:integration    # 集成测试（打真实 MySQL，必须串行）
npm run test:all            # 全部测试（串行）
npm run smoke               # 端到端冒烟，需要先启动 development 模式的后端

# 单个测试
npx vitest run tests/unit/password.test.js
npx vitest run tests/integration/adminAuth.test.js --no-file-parallelism
npx vitest run tests/integration/adminAuth.test.js --no-file-parallelism -t "AC-AD01"

# 管理后台（admin/，端口 9527）
pnpm dev                    # Vite 开发，/proxy-default -> 127.0.0.1:3000/api/v1
pnpm build                  # 生产构建（产物 dist/）
pnpm typecheck              # vue-tsc 类型检查
pnpm lint                   # ESLint（脚本带 --fix，会改文件）
pnpm preview                # 预览 dist/
pnpm geo:generate           # 重新生成全国/省级地图与地区树（需联网）

# 小程序（miniapp/）
npm run dev:h5              # 浏览器预览（需后端 WX_MOCK=true，固定 dev code 登录）
npm run dev:mp-weixin       # 用微信开发者工具导入 dist/dev/mp-weixin
npm run build:mp-weixin
npm run build:h5
node scripts/gen-assets.js  # 从 design-refs/ 重新生成 PNG 静态资源

# 服务探针
curl http://127.0.0.1:3000/health        # 存活探针
curl http://127.0.0.1:3000/api/v1/health # 就绪探针（真连 MySQL + 缓存）
```

首次启动前先按 `README.md` 建好 `renovation_dev` / `renovation_test`（`utf8mb4`），
并在 `server/.env` 配好数据库、JWT、`SIGNED_URL_SECRET`、`DOOR_CODE_KEY`；
H5 预览与冒烟测试需要 `WX_MOCK=true`（集成测试会自行强制该值）。

本地联调按「后端 → 管理后台 → 小程序」顺序启动；后端的就绪探针通过后再开前端，
否则后台登录会拿到 502 / 连接拒绝。

## 端口与开发账号

| 项 | 值 |
| --- | --- |
| 后端 API | `http://127.0.0.1:3000/api/v1` |
| 管理后台 | `http://127.0.0.1:9527` |
| 平台运营入口 | `/login`，`platform / Platform123456` |
| 租户管理员入口 | `/t/default/login`，`admin / Admin123456`（租户 #1，`code=default`） |
| MySQL | `127.0.0.1:3306`，开发库 `renovation_dev`，测试库 `renovation_test` |
| Redis | `127.0.0.1:6379`；`CACHE_DRIVER=memory` 可绕过多实例限制 |

种子账号首次登录强制改密；本机密码改过之后 `npm run seed` 不会覆盖，需要按
`admin/README.md` 里的重置命令处理。冒烟脚本要求后端 `NODE_ENV=development`
（验证码接口要返回 `debugAnswer`），并会从租户入口登录。

**验证组合**：后端 `npm run test:all` + `npm run smoke`；后台 `pnpm typecheck && pnpm build`
（没有前端自动化测试，交互用 Playwright 手工验证）；小程序至少跑
`npm run build:h5 && npm run build:mp-weixin`，交互用 `dev:h5` 跑通。
只改小程序样式时也不能只看构建成功 —— 用 H5 / 微信开发者工具实际看一眼主色、
tabBar 选中态和底部安全区。

## 架构要点

### 目录边界

```
server/
├── config/index.js          环境变量的**唯一**读取入口
├── db/migrations/*.sql      数据库结构的**唯一权威**
├── scripts/                 migrate / seed / smoke
├── src/
│   ├── app.js               构造 express app（不监听端口）
│   ├── server.js            监听端口 + 优雅退出
│   ├── routes/              路由挂载
│   ├── controllers/         入参校验 + 调 service + 组装响应
│   ├── services/            业务逻辑（可被单测直接调用）
│   ├── models/              数据访问层，每张表一个模块，手写 SQL
│   ├── middlewares/         鉴权 / 权限 / 数据权限 / 门禁 / 日志 / 限流 / 错误
│   ├── cache/               缓存抽象层（redis / memory 可切）
│   ├── db/pool.js           连接池 + 事务
│   └── utils/               金额、完成度、时间、分页、响应、日志
└── tests/
    ├── unit/                纯逻辑，可并行
    └── integration/         打真实 MySQL，必须串行
```

`app.js` 与 `server.js` 分离是刻意的：集成测试直接 `require('src/app')` 用 supertest 打它，
不起真实端口 —— 没有端口冲突、没有启动竞态、测试结束不残留进程。

### 小程序（`miniapp/`）

uni-app + Vue 3 + Vite。页面与后端分离，通过 `src/config.js` 的 `API_BASE` 连接。

- **设计来源**：Stitch 项目 `7202629267044826058` 的登录页与角色说明页；
  原始 HTML / 截图在 `miniapp/design-refs/`，只作对照，不参与构建。
- **品牌与配色**：小程序可见品牌按品牌方 logo 统一为「柏总管」，
  完整 logo 来源是 `miniapp/design-refs/brand-logo.png`（橙底白字），
  由 `scripts/gen-assets.js` 生成 `src/static/images/logo.png`。
  主色 `#EB5C20`、按压色 `#C44710`、浅底 `#FDEBE4`、页面底色 `#FAF7F4`；
  橙色 hero 上用 `home-logo.png` 的反色小标记，浅底页面才用完整 wordmark。
  绿色 / 红色 / 琥珀色仍是业务语义色，不要把成功、危险、警告也刷成品牌橙。
- **「我的」按当前项目 + 账号固定角色渲染**：资料卡用 `GET /auth/profile?projectId`
  的角色（`accountRole` 是账号级固定角色）；有当前项目时，业主显示 `contacts`、
  工长显示单项目 `my-stats`；**没有当前项目时工长显示 `GET /projects/my-stats`
  的全部项目汇总**，业主 / 监理没有项目级卡片。「我的」的项目切换条**第一项固定为
  「全部项目」**，默认就是该状态；选择具体项目后写入 `gc_current_project`，
  统计切到单项目。项目列表点击项目、或记账页下拉切换也会更新同一上下文，
  其他 tab 在 `onShow` 重新加载。选择「全部项目」会清除上下文并回到汇总。
  消息红点挂在「我的」tab（index 3），口径是全局未读数，不随消息分类变化。
  意见反馈当前只提交文字，图片需要先补多文件暂存，不能假上传。
- **登录**：C 端身份是微信 `openid`，没有短信验证码接口。登录页的「登录 / 微信登录」
  都走 `uni.login → POST /auth/login`；手机号输入框在开发环境（`WX_MOCK=true`）
  顺带绑定手机号。**不要给短信登录做假倒计时** —— 后端没有这个能力。
- **内容页按当前项目租户读取**：`pages/legal/index` 请求 `/contents/:key` 时带上
  `getCurrentProject().tenantId`，后端按「租户已发布 → 平台已发布 → 404」回退；
  没有项目上下文（登录前）则读平台基础版本。不要只读平台版本，否则租户的
  协议补充条款永远不会生效。
- **角色是账号级固定的（v2.5）**：`user.role` 在管理员按手机号首次邀请时确定，
  工长在所有项目里都是工长、监理在所有项目里都是监理，不能跨项目改成别的角色；
  业主可以参与多个项目。`project_member.role` 仍用于项目内权限，但必须与
  `user.role` 一致。角色选择页已改为说明页，不再写入本地「默认视角」。
- **登录落点由 `/projects` 决定**：有待确认邀请先去邀请列表，否则直接进项目列表。
  没有项目时也不该先问「请选择您的身份」—— 用户此时还没有任何项目身份。
- **项目上下文是独立状态**：进入项目时把 `{id, tenantId, name, role}` 存入
  `gc_current_project`（`store/projectContext.js`）。项目列表每次刷新都会校验，
  成员被移除 / 项目归档 / 租户停用后立即清空；项目内页面没有上下文一律回项目列表，
  **不要默认取第一个项目** —— 一个人可能同时属于多个租户的多个项目。
- **没有项目时不进入项目页**：不渲染进度 / 验收 / 记账等空壳页面，而是显示引导，
  提示用户先绑定手机号。邀请按手机号匹配，**未绑定手机号的用户看不到邀请**；
  空态必须提供绑定入口（微信端用 `getPhoneNumber`，H5 开发环境用输入框）。
- **首页卡片的数据来源**：`GET /projects` 的项目项现在额外带 `ownerName`、
  `foremanName` 与 `stages`。业主/主工长由服务层批量查询并脱敏（昵称优先，
  否则脱敏手机号，最后「待分配」），**不要在前端逐个查项目成员**；阶段胶囊取
  「当前阶段起连续 3 个」，全部结清时取最后 3 个。
- **首页的搜索与筛选是前端的**：列表一次性拉全量（C 端不分页），按名称/地址/业主、
  状态、我的角色、租户在本地过滤。后端的项目状态只有 `pending/building/finished/archived`，
  设计稿里的「已暂停」在本系统没有对应值，第三个 tab 显示为「已归档」。
- **项目详情与阶段树的字段来源**：`GET /projects/:id` 返回 `ownerName`、`foremanName`、
  `memberCount`、`hasSupervisor`、`isPrimaryForeman`、`currentStageId/Name/GateStatus/Progress`；
  `GET /projects/:id/stages` 返回 `gateStrength` 与每个阶段的 `canReport`、`lockedReason`。
  前端直接读这些字段，**不要自己按 `gateStatus` 猜门禁** —— 严格 / 标准 / 宽松三档的差异只在后端。
- **项目详情页是业主视角、按角色降级**：`pages/project/index` 按 Stitch
  `ee8b98dadd7e4c41a9d4485ae5d92922`「阳光花园项目进度总览」1:1 还原
  （项目概览 / 待我处理 / 阶段进度 / 工程动态 / 账目概览 / 联系与导航）。
  待我处理由验收单与付款节点共同组成；业主可查看联系方式、确认付款；监理看不到项目账目；
  照片只取真实汇报的 `media`，没有数据时显示空态，**不要拿设计稿里的示例照片冒充现场**。
  `GET /projects/:id/reports` 额外返回 `fromProgress` 与 `author.role/roleLabel`，
  供「80% → 100%」与「李师傅 · 工长」展示；画进度变化不要在前端自己猜上一值。
- **门锁密码入口在项目详情，密码只在独立页读取**：`pages/project/door-code` 进入时
  才调用 `GET /projects/:id/door-codes`；后端每读一条密码就写 `door_code.read` 审计，
  因此**不要在项目详情页预拉密码**，也不要把明文写入 storage / 日志。业主可新增、
  修改、失效与查看访问记录；工长 / 监理只读明文；项目归档后整条链路返回 403，
  非项目成员返回 404。失效弹窗必须说明「只改变系统内可见性，不改变实体锁」。
- **考察计划走服务端路线规划**：入口在「我的」的考察计划横幅与项目详情「更多」；
  `pages/route-plan/{index,plan,detail}` 支持多选工地、当前位置 / 地图选点、推荐顺序、
  手动上下调整、逐段导航、**一键导航**与保存复用。一键导航会重新调用
  `/route-plans/preview`（`optimize:true`）按最近路线排序，然后直接打开第一站；
  微信一次只能导航一个目的地，返回小程序后由 `onShow` 询问是否继续下一站。
  路线由后端 `/route-plans/preview` 计算，
  **小程序端不持有任何地图 Key**；未配置 `AMAP_KEY`、高德超时或配额耗尽时，
  后端返回 `degraded: true` 与列表顺序，页面必须显示「简化模式」，不能编造里程。
  保存的计划在项目坐标变更后由后端返回 `stale: true` 并隐藏旧折线，页面提示重新规划。
  排序算法是最近邻 + 2-opt（`server/src/utils/routeOptimizer.js`），只用于建议顺序；
  用户调整顺序后请求必须带 `optimize:false`，服务端不再重排。
- **工程动态页是汇报列表，不是单条汇报详情**：`pages/project/feed` 按 Stitch
  `368a845eb6254a3ab51b77d43b5cc42c` 1:1 还原；数据来自
  `GET /projects/:id/reports`，阶段筛选只展示「当前阶段 + 下一阶段」，图片/视频/评论
  都走真实接口。监理巡检卡片只在 `author.role === 'supervisor'` 时渲染；后端没有
  巡检/签到记录接口时不要凭空造一张「已完成巡检」的卡片。
- **记账页是业主视角的账本总览**：`pages/ledger/index` 按 Stitch
  `d73a858ad38148a1a3493175a74ef98b`「工程宝阳光花园项目记账页面」1:1 还原。
  顶部项目名可切换项目（只列业主 / 工长项目），「我是业主」是**只读角色标识**，
  不能点击切角色；汇总卡按角色换文案（业主「已支付 / 待支付」，工长「已收款 / 待收」）。
  概览的数据分别来自 `GET /projects/:id/ledger/summary`、`payment-nodes`、
  `stages/ledger` 与 `ledger/expense-breakdown`；三个分段页签对应总览、流水与对账。
  「待我处理」由「业主待确认的付款节点 + 待确认对账单」组成，工长看到有异议的
  对账单；业主可确认付款、确认对账、逐条提异议。工长的写入口在「流水」与「对账」
  页签：登记收入/支出、发起周期对账；登记收入会把关联付款节点推进到「待业主确认」。
  微信 `uni.uploadFile` 一次只能带一个文件，当前 UI 只支持 1 张票据（后端允许 3 张，
  后续要做多图需先增加暂存接口）。监理整个记账页显示「监理不参与记账」，
  不请求账目接口。
  「查看合同」打开的是合同**信息**面板（金额、工期、地址），系统没有合同附件接口，
  **不要做一个打不开的合同预览**。支出构成按后端真实的 material / labor / transport /
  other 分类计算，没有数据时显示空态，**不要把设计稿的 45% / 35% / 20% 写死**。
  当前阶段账目取 `stages/ledger` 中 `currentStageId` 对应行，结余口径为「已收 − 已支出」。
- **小程序管理端是独立的租户后台身份，不是第四种项目角色**：租户 `owner` /
  项目管理员 `admin` 用后台账号密码 + 图形验证码登录，拿到的是 audience=admin 的
  普通管理员 JWT；C 端微信 token 只用于证明 openid，绝不直接访问 `/admin/*`。
  管理端页面在 `pages/admin/**`，全部是非 tab 页；保留 4 个原生 tab。项目列表顶部
  「管理」入口只对有管理员 token 或有效微信绑定的用户显示；首次登录在小程序登录页
  的「管理员登录」进入。管理员 token 存在 `gc_admin_*`，与 C 端 `gc_token` 分离：
  任一端 401 都不能清另一端。微信免密绑定表是 `admin_wechat_binding`（迁移 018），
  以 openid 为权威键，`admin_token_version` 失配即失效；改密、重置、禁用、C 端注销
  必须撤销绑定。平台账号不能登录小程序管理端，也不能绑定。管理员复用后台
  `/admin/*` 接口与数据权限，网页与小程序天然同步；首期只做项目/成员/付款节点/
  阶段工序，账号、模板、配置、内容、反馈、日志、导出仍在网页后台。
- **进度汇报的多附件走暂存接口**：微信端 `uni.uploadFile` 一次只能带一个文件，而
  `POST /projects/:id/reports` 要求一次原子提交。先逐文件调
  `POST /projects/:id/reports/media`（服务端打水印）拿到 `mediaId`，再用 `mediaIds`
  提交；两种附件方式互斥。暂存行 24 小时未提交由 `reportMediaCleanup` 清理，
  清理任务必须**先认领 `status='expired'` 再删文件**，否则会把用户刚提交的图片删掉。
  不要在前端手工拼 multipart，也不要恢复「一次 multipart 带齐」的假设。
- **C 端没有建档权限**：项目新建只对租户管理员开放，入口在
  `pages/admin/projects/index` 的管理端 FAB。C 端项目列表**不展示**「新建项目」按钮，
  也不要把用户引导到一个不存在的 C 端建档接口。
- **底部导航用原生 tabBar**：`pages.json` 配置项目 / 验收 / 记账 / 我的四项，**不要**每个 tab 页自己画一个底部栏，也不要用 `reLaunch` 切 tab —— 那会重建页面并白屏。四项现在都是真实页面；「我的」是个人工作台（资料、多项目时的切换入口、业主联系人 / 工长统计、消息、订阅、反馈、注销），消息未读数用 `uni.setTabBarBadge({ index: 3 })` 挂在「我的」tab 上。
- **H5 下的 tabBar 在页面内**：底部浮层（筛选、阶段、签名等）的 z-index 必须高于 H5 的 `uni-tabbar`（当前用 1000）；小程序原生 tabBar 在 webview 外，不受影响。
- **不要画假的 iOS 状态栏与微信胶囊**：设计稿里的「9:41 / 电池」和右上角胶囊
  是手机壳示意；真机已有系统状态栏与原生胶囊。页面用
  `padding-top: var(--status-bar-height)`（H5 回退 12px）对齐。
- **SVG 一律栅格化**：微信各端对 `<image>` 的 SVG 支持不一致，
  `scripts/gen-assets.js` 用 sharp 把背景、天际线、图标转成 3x PNG。
  角色卡实景图保留原 JPG，左侧羽化用白色渐变覆盖层实现 ——
  带 alpha 的大 PNG 会把主包顶过微信 2MB 限制（这是实际的踩坑点）。
- **构建**：`npm run build:mp-weixin` → `dist/build/mp-weixin`；
  `npm run dev:h5` 可在浏览器里走通登录（固定 dev code，后端 mock 派生稳定账号）。
  微信开发者工具需勾选「不校验合法域名」才能访问 `127.0.0.1`。

### 管理后台（`admin/`）

Vue 3 + Vite + TypeScript + Element Plus + UnoCSS，基座是 **Soybean Admin Element Plus 版**
（`soybeanjs/soybean-admin-element-plus` v1.4，MIT）。只保留布局、主题、路由与请求基础设施，
模板自带的 demo 页面已删除。

- **后端地址**：开发用 `.env.test` 的 `VITE_SERVICE_BASE_URL` + Vite 代理
  （`/proxy-default` → `http://127.0.0.1:3000/api/v1`）；生产用 `.env.prod` 的 `/api/v1`，
  由 Nginx 同源反代。不要把后端地址写进源码。
- **响应约定**：`{ code, message, data }`，成功码 `0`。Soybean 默认是 `0000 + msg`，
  已在 `.env` 的 `VITE_SERVICE_SUCCESS_CODE=0` 与 `src/service/request/index.ts` 中改掉。
- **两个登录入口**：平台运营固定 `/login`（`portal=platform`）；租户管理员使用
  `/t/<tenantCode>/login`（`portal=tenant`，租户标识由地址带入，**不让用户手工输入**）。
  平台入口拒绝租户账号，租户入口只接受该租户账号；`portal` 缺省时保留旧行为，
  供尚未改造的调用方使用。真实前端两处都必须显式传 `portal`。
- **验证码**：`GET /admin/auth/captcha` → `POST /admin/auth/login`。
  验证码**一次性有效**，登录失败后必须重新获取，不能复用一个 captchaId。
- **会话失效回哪个登录页**：由本地 `loginTenantCode` 决定。租户会话失效 / 登出必须回
  `/t/<code>/login`；把人甩到 `/login` 会被后端正确拒绝，等于二次伤害。
  路由守卫与改密成功后的跳转都要读它（见第 87、88 条）。
- **首登强制改密**：后端在 `mcp=1` 时只放行改密 / 资料 / 登出三个接口。
  前端登录后要先把业务路由注册进 router（见第 85 条）再跳 `/change-password`。
  改密必须验证**原密码**（初始密码），完成后 token 立即失效，必须重新登录。
- **平台租户管理**：`/platform/tenant`。开通租户后展示 `/t/<code>/login` 并支持复制；
  列表/详情也提供同一地址。地址由租户标识确定性生成，不在数据库里另存 URL。
  **地区字段只提交行政区划代码**（`provinceCode` / `cityCode`），名称由后端按
  `server/src/data/regions.json` 派生后入库 —— 前端提交代码与名称两份数据迟早会对不上。
  开通租户时省、市必填；调整租户可补录或显式清空。老租户可以为 NULL，
  看板必须把它们归入「未分配地区」，不能静默丢出统计。
- **平台数据看板**：`/platform/dashboard`。全国按省着色 → 点击省份加载
  `public/geo/provinces/{adcode}.json` 切换成城市边界 → 点击城市看该城市租户。
  直辖市 / 港澳台「省即城市」，点击后不再下钻。地图数据由
  `pnpm geo:generate`（`scripts/gen-geo-assets.mjs`）从阿里云 DataV GeoAtlas 生成，
  全国图约 580KB 静态内置、省级按需 fetch 并缓存；**不要改成运行时直连地图服务**，
  也不要手改生成文件。租户数、项目数、账号数用相互独立的查询再在 service 合并，
  不要三个一对多 JOIN 一起 `COUNT`（行乘积会把数字放大）。聚合口径排除已软删的
  租户 / 项目 / 账号；「本月新增」按 Asia/Shanghai 的月初区间计算，不用 `DATE_FORMAT`。
  看板只展示租户运营信息（状态、套餐、用量、开通时间），不展示合同金额等业务数据。
  **中国地图的 bounding box 是个坑**：海南省的 GeoJSON 把三沙岛礁（最南到北纬 3.8°）
  放在同一个 MultiPolygon 里，直接注册 `china` 会把整体拉高，大陆被压到顶部并贴边，
  看起来像被裁切。注册前必须裁掉海南岛以南的多边形；ECharts 对名为 `china` 的地图
  会自动补一个右下角「南海诸岛」插图区域，不需要自己另做小图。
  北京 / 天津 / 上海 / 香港 / 澳门在国家尺度下放不下文字，标签会压到邻省；
  这五个地区不显示地图标签，从右侧排行或 tooltip 进入。
- **平台只读排障**：租户 owner 在 `/grant` 授予窗口后，平台从租户列表
  「更多 → 只读进入（排障）」进入。路由过滤只在 `localStg.tenantContext` 存在时
  把租户业务路由挂进菜单（`filterAuthRoutesByRoles`），进入/退出都**整页重载** ——
  菜单是启动时构建的，不重载会出现「路由变了菜单没变」。
  窗口内 UI 隐藏所有写操作，后端 `requireTenant` 也会拒绝写；每次请求写目标租户日志。
  C 端用户只能在「项目详情 → 成员」里看到（手机号脱敏），没有租户级用户列表，
  平台也不能借此重置任何租户账号密码。
- **角色菜单**：静态路由在 `src/router/routes/index.ts` 显式声明，由 `meta.roles` 过滤。
  `platform` 看不到任何租户业务路由；`owner` / `admin` 看不到平台路由。
  **前端隐藏入口不算校验** —— 最终依据仍是后端的 `requireTenant` / `requireTenantOwner`。
- **完成度在后台是只读的**：阶段/工序完成度只能由 C 端进度汇报写入（第 28 条）。
  后台的阶段工序页只允许改名称、权重、计划日期与增删，**不提供直接调完成度的入口**。
- **金额展示不走浮点**：接口返回 DECIMAL 字符串，前端只做千分位格式化；
  页面上的合计仅用于展示时按整数分累加，真正的金额运算全部在后端 `money.js`。
- **页面目录 / 生成文件**：`src/views/**` 会被 elegant-router 插件扫描，自动生成
  `src/router/elegant/imports.ts`、`src/router/elegant/transform.ts` 与
  `src/typings/elegant-router.d.ts`。**不要手改这三处生成文件**；显式路由
  `src/router/routes/index.ts` 的 `path` 必须与生成路径一致（第 89 条）。
  新增页面除了建 `.vue`，还要在 `routes/index.ts` 里声明路由与角色；
  删除页面后让插件重新生成，不要留下指向已删文件的 import。
- **验证**：`pnpm typecheck && pnpm build`。项目没有前端自动化测试，交互用
  Playwright 连真实后端验证；构建成功不等于页面正确，涉及权限的改动要实际走一遍。
- **平台基础层与租户策略层必须分开**（v2.6）：
  `sys_config` 与 `content_page` 的 `tenant_id` 允许为 NULL，表示**平台基础版本**。
  读取优先级统一为「租户覆盖 → 平台基础 → 代码默认值」；租户后台只写自己的覆盖值，
  平台后台 `/platform/{config,content}` 只写基线。平台改动会让继承它的租户缓存失效。
  内容页在登录前没有租户上下文，只能读平台版本；租户未发布时也继承平台版本，
  不能出现「共享小程序打不开隐私政策」。
  **微信订阅消息模板 ID 是平台专属项**（`platformOnly`）：模板来自小程序主体，
  租户申请不到，租户后台只读、写接口 403；读取固定走平台配置，历史租户覆盖值被忽略。
- **日志要分两套**：平台日志中心 `/platform/log` 只看 `tenant_id IS NULL` 的
  平台级事件（租户开通/停用、平台配置与内容页修改等）；租户的业务操作与登录日志
  留在租户后台 `/log/*`。平台默认不能横向浏览租户业务日志，只能在排障授权窗口内只读。
- **当前已交付**：平台 / 租户双登录入口、强制改密、工作台、
  项目列表 / 新建 / 编辑 / 状态流转 / 归档 / 软删除 / 批量归档 / 批量分配工长 / 导出、
  项目详情（概览 / 阶段工序 / 成员 / 付款节点）、
  平台租户管理（开通 / 配额 / 停用 / 退租 / 专属地址 / 地区）、
  平台数据看板（中国地图 / 省市级下钻 / 未分配地区 / 地区租户列表）、
  平台基础配置 / 基础内容页 / 平台日志中心、
  阶段模板编辑器、账号管理、系统配置、操作日志 / 登录日志、
  内容页、意见反馈、排障授权、我的导出、个人中心。
  租户侧的项目数据看板（AC-AD36~43）按约定属于 V1.2。

### 请求管线

```
requestId → 访问日志 → 限流(IP) → 路由 → 鉴权 → 限流(用户) → 权限 → 数据权限 → 门禁 → 控制器
                                                                                    ↓
                                                                              统一错误处理
```

### 响应约定（§7.2）

```json
{ "code": 0, "message": "success", "data": {} }
```

`code` 取 **HTTP 语义值**（400 / 401 / 403 / 404 / 409 / 429 / 500），且 HTTP 状态码与 code 同步。
`429` 是文档表格之外、为 §8.2 限流而加的一项。

controller / service 里**不允许**出现 `res.status(4xx).json(...)` —— 一律 `throw AppError.xxx()`，
由 `middlewares/errorHandler.js` 统一成形。这是 AC-AD46「不向前端暴露 SQL、堆栈」的唯一出口。

### 接口路径约定

- C 端**逐字照搬** §7.3：`/api/v1/auth/*`、`/api/v1/projects/*`
- B 端统一挂 `/api/v1/admin/`：`/api/v1/admin/auth/login`、`/api/v1/admin/projects`

加 `/admin` 前缀是文档没写但必须有的：§7.1 要求两端 token 互不通用（AC-AD10），
鉴权中间件要按前缀分流。若两端接口平铺在同一命名空间（如 §7.3 的 `/admin-users` 与 `/projects`），
就只能逐个接口手工指定鉴权方式 —— 漏一个就是越权。

### 技术栈上的三处刻意偏离

1. **后端用 JavaScript，不用 TypeScript** —— 需求文档 §3.2 明确排除（"JavaScript，不使用 TypeScript"）。
2. **不用 ORM，手写 SQL** —— §6.2 要求 `SELECT ... FOR UPDATE` 行锁、条件唯一索引、生成列，
   ORM 表达不了或表达失真。
3. **金额用 `DECIMAL(12,2)`，不用整数分** —— §6.2 / AC-L11 明确要求。

## 关键约束（踩过的坑）

> 编号是**历史追加顺序**，不是阅读顺序；源码注释与文档会引用具体编号
> （例如「CLAUDE.md 第 28 条」）。**不要重排、不要复用已删除的编号**，
> 新增条目一律追加到末尾。多租户、后台与小程序管理员相关的条目集中在第 71~90 条。
>
> 完整说明已按主题拆到 [`docs/constraints/`](docs/constraints/)；本文件保留
> 编号索引，源码注释里的「CLAUDE.md 第 N 条」仍然可以按编号查到。

### 数据库、迁移与测试基础（1–10）

完整说明：[docs/constraints/01-foundation.md](docs/constraints/01-foundation.md)

- [1. 数据库连接的两个选项组合，不能随手改](docs/constraints/01-foundation.md#c1)
- [2. MySQL 的唯一索引不约束 NULL](docs/constraints/01-foundation.md#c2)
- [3. MySQL 的 DDL `COMMENT` 不接受相邻字符串字面量拼接](docs/constraints/01-foundation.md#c3)
- [4. `dayjs.tz` 的三参重载，第三个参数是 locale 不是时区](docs/constraints/01-foundation.md#c4)
- [5. 迁移文件一旦执行过就不能改](docs/constraints/01-foundation.md#c5)
- [6. 集成测试会 DROP DATABASE](docs/constraints/01-foundation.md#c6)
- [7. 测试文件用 CommonJS + 全局注入，不要 `require('vitest')`](docs/constraints/01-foundation.md#c7)
- [8. 四个必须收敛到中间件的校验](docs/constraints/01-foundation.md#c8)
- [9. 进度与门禁是两个字段，各有各的事实来源](docs/constraints/01-foundation.md#c9)
- [10. 只追加表：数据库层管不了，靠仓储层约束](docs/constraints/01-foundation.md#c10)

### 认证、会话与邀请（11–20）

完整说明：[docs/constraints/02-auth.md](docs/constraints/02-auth.md)

- [11. 提醒去重靠唯一索引，不靠「先查再插」](docs/constraints/02-auth.md#c11)
- [12. 登录校验的**顺序**本身就是安全设计](docs/constraints/02-auth.md#c12)
- [13. B 端会话键必须**存在**才放行，不能「不存在就当首次请求」](docs/constraints/02-auth.md#c13)
- [14. 验证码在开发环境回显答案](docs/constraints/02-auth.md#c14)
- [15. 邀请是按手机号发起的，因此存在「占位账号」与合并](docs/constraints/02-auth.md#c15)
- [16. WX_MOCK 是危险开关，用启动自检兜住](docs/constraints/02-auth.md#c16)
- [17. 系统配置有 60 秒进程内缓存](docs/constraints/02-auth.md#c17)
- [18. 数据权限的两道防呆，别拆掉](docs/constraints/02-auth.md#c18)
- [19. 404 与 403：两端刻意相反](docs/constraints/02-auth.md#c19)
- [20. `money.validate` 不能用来校验坐标](docs/constraints/02-auth.md#c20)

### 项目、成员与模板（21–30）

完整说明：[docs/constraints/03-project.md](docs/constraints/03-project.md)

- [21. `archived_at` 必须双向维护](docs/constraints/03-project.md#c21)
- [22. 两个「恢复」是不同的东西](docs/constraints/03-project.md#c22)
- [23. 「工长必须 1 人、业主至少 1 人」（AC-AD58）的校验时机](docs/constraints/03-project.md#c23)
- [24. 多名工长与主工长（Q11，v1.3）](docs/constraints/03-project.md#c24)
- [25. zod 的报错默认是英文，且会直接被用户看到](docs/constraints/03-project.md#c25)
- [26. 模板保存是「整体替换」，且旧行是物理删除](docs/constraints/03-project.md#c26)
- [27. 默认模板的唯一性靠生成列，`clearDefault` 必须先调](docs/constraints/03-project.md#c27)
- [28. 工序完成度只有一个写入口](docs/constraints/03-project.md#c28)
- [29. 阶段状态是派生的，判定顺序不能换](docs/constraints/03-project.md#c29)
- [30. 阶段与工序的删除保护](docs/constraints/03-project.md#c30)

### 进度、验收与存储（31–40）

完整说明：[docs/constraints/04-progress.md](docs/constraints/04-progress.md)

- [31. `notification.type` 与 `reminder_log.type` 是两个不同的枚举](docs/constraints/04-progress.md#c31)
- [32. 「先抢占后发送」失败时必须释放去重键](docs/constraints/04-progress.md#c32)
- [33. 服务端水印的三条硬约束](docs/constraints/04-progress.md#c33)
- [34. 视频时长是客户端上报的，不是安全边界](docs/constraints/04-progress.md#c34)
- [35. 汇报提交与完成度变更必须在同一事务](docs/constraints/04-progress.md#c35)
- [36. 测试夹具表清单改为枚举，别再手写](docs/constraints/04-progress.md#c36)
- [37. 验收状态机必须用**精确的迁移表**，不能用有序数组比索引](docs/constraints/04-progress.md#c37)
- [38. 轮次（round）的两个陷阱](docs/constraints/04-progress.md#c38)
- [39. 少 SELECT 一列不会报错，只会让去重键变成 `NaN`](docs/constraints/04-progress.md#c39)
- [40. 不要在模块内引用 `module.exports` 上的函数](docs/constraints/04-progress.md#c40)

### 账务、报告与运行环境（41–50）

完整说明：[docs/constraints/05-ledger.md](docs/constraints/05-ledger.md)

- [41. 存储层的扩展名白名单只约束**用户上传**](docs/constraints/05-ledger.md#c41)
- [42. 验收单的「不存在」与「无权访问」必须是同一句提示](docs/constraints/05-ledger.md#c42)
- [43. pdfkit 加载 `.ttc` 要的是 **postscript 名**，不是字体族名](docs/constraints/05-ledger.md#c43)
- [44. 门锁密码：本项目的最高敏感级数据（M12，§4.8）](docs/constraints/05-ledger.md#c44)
- [45. 测试夹具用 DELETE 而不是 TRUNCATE](docs/constraints/05-ledger.md#c45)
- [46. bcrypt cost 在测试环境降到 4，生产有硬守卫](docs/constraints/05-ledger.md#c46)
- [47. 拼 SQL 时 JOIN 必须写在 WHERE 之前 —— 这个坑踩过两次了](docs/constraints/05-ledger.md#c47)
- [48. 红冲：金额同号，靠 `is_reversal` 在汇总时取负](docs/constraints/05-ledger.md#c48)
- [49. 服务层预检的条件必须与数据库索引**完全一致**](docs/constraints/05-ledger.md#c49)
- [50. 红冲会释放付款节点的收入位（迁移 011）](docs/constraints/05-ledger.md#c50)

### 对账、日志、通知与审计基础（51–60）

完整说明：[docs/constraints/06-logging.md](docs/constraints/06-logging.md)

- [51. 对账确认：状态流转与流水锁定必须在同一事务](docs/constraints/06-logging.md#c51)
- [52. `operation_log` 由 service 显式调用，不挂自动中间件](docs/constraints/06-logging.md#c52)
- [53. 「不存在支付渠道调用」做成了可执行的断言](docs/constraints/06-logging.md#c53)
- [54. 管理员消息与 C 端消息是**两套主体**，不共用一张表](docs/constraints/06-logging.md#c54)
- [55. 少 SELECT 一列 —— 第三次了](docs/constraints/06-logging.md#c55)
- [56. supertest 对二进制响应的处理是**有损**的](docs/constraints/06-logging.md#c56)
- [57. 服务端生成物的扩展名白名单要单独维护](docs/constraints/06-logging.md#c57)
- [58. 响应体不回显用户可控输入](docs/constraints/06-logging.md#c58)
- [59. 「红点数字」与「列表内容」必须同源](docs/constraints/06-logging.md#c59)
- [60. 审计动作「定义了」不等于「会被写」](docs/constraints/06-logging.md#c60)

### 审计、配置与跨模块一致性（61–70）

完整说明：[docs/constraints/07-audit.md](docs/constraints/07-audit.md)

- [61. 两套自增 id 撞号是常态，不是巧合](docs/constraints/07-audit.md#c61)
- [62. 配置项「改完不生效」必须如实标注](docs/constraints/07-audit.md#c62)
- [63. 循环 require 会让方法在运行时变成 undefined](docs/constraints/07-audit.md#c63)
- [64. 注销账号**不能**用 `deleted_at`](docs/constraints/07-audit.md#c64)
- [65. AC-U15 的完整手机号不违反 AC-U02 的脱敏](docs/constraints/07-audit.md#c65)
- [66. 「我的统计」里混了「我的」与「项目的」，这是刻意的](docs/constraints/07-audit.md#c66)
- [67. 「谁是这个项目的管理员」只在一处实现](docs/constraints/07-audit.md#c67)
- [68. SQL 注释写在模板字符串里时，不能出现反引号](docs/constraints/07-audit.md#c68)
- [69. 「带去重的批量通知」和「普通的批量通知」是两条通道](docs/constraints/07-audit.md#c69)
- [70. `code` 进日志脱敏名单的副作用：错误日志的 HTTP 状态码被抹掉](docs/constraints/07-audit.md#c70)

### SaaS 多租户（71–83）

完整说明：[docs/constraints/08-tenancy.md](docs/constraints/08-tenancy.md)

- [71. 多租户：三层隔离与「没有任何角色是不受限的」](docs/constraints/08-tenancy.md#c71)
- [72. 多租户下三种「全局唯一」必须改成「租户内唯一」](docs/constraints/08-tenancy.md#c72)
- [73. 两处「跨项目串号」，与租户无关但必须一起修](docs/constraints/08-tenancy.md#c73)
- [74. C 端可跨租户，因此「租户」必须由调用方显式给出](docs/constraints/08-tenancy.md#c74)
- [75. 哪些表带 `tenant_id`，哪些靠 project 派生](docs/constraints/08-tenancy.md#c75)
- [76. 可空 `tenant_id` 表达「不属于任何单一租户的事件」](docs/constraints/08-tenancy.md#c76)
- [77. 平台账号在**路由层**被拒绝，不是「查出一片空」](docs/constraints/08-tenancy.md#c77)
- [78. 跨租户不可见的验证方式：每个入口单独断，不能只测列表](docs/constraints/08-tenancy.md#c78)
- [79. 开通租户必须一次成型；配额检查必须锁租户行](docs/constraints/08-tenancy.md#c79)
- [80. C 端「租户停用/到期只读」挂在路由层，不要下沉到 service](docs/constraints/08-tenancy.md#c80)
- [81. 平台级事件写 `tenant_id = NULL`，且「已退租」是终态](docs/constraints/08-tenancy.md#c81)
- [82. 平台访问租户数据：显式上下文头 + 统一只读 + 逐次留痕](docs/constraints/08-tenancy.md#c82)
- [83. C 端跨租户：订阅、推送与定时任务的三个具体落点](docs/constraints/08-tenancy.md#c83)

### 管理后台（84–89）

完整说明：[docs/constraints/09-admin.md](docs/constraints/09-admin.md)

- [84. Vue 模板表达式里不能写 `import.meta`](docs/constraints/09-admin.md#c84)
- [85. 登录后立刻 push 命名路由会报 `No match`](docs/constraints/09-admin.md#c85)
- [86. `@sa/axios` 的 `BACKEND_ERROR_CODE` 只覆盖「2xx + 业务码失败」](docs/constraints/09-admin.md#c86)
- [87. 登录门户必须由**地址**决定，不能做成登录页上的一个下拉框](docs/constraints/09-admin.md#c87)
- [88. 改密 / 登出 / 会话失效的跳转不能写死 `/login`](docs/constraints/09-admin.md#c88)
- [89. elegant-router 生成的路径必须与显式路由一致](docs/constraints/09-admin.md#c89)

- **验收 tab 是跨项目收件箱**：`GET /acceptances` 按当前用户所有 active 项目聚合，
  `GET /projects/:id/acceptances` 只用于单项目；不要让用户先选项目再看待办。
  分类固定为「全部项目 / 待我处理 / 进行中 / 已完成」，项目名只作为卡片归属信息，
  项目筛选放在单独的筛选面板里。
- **“待我处理”仍要按项目成员关系判定**：虽然角色是账号级固定的，但主工长是
  项目级属性，且成员关系可能被移除。收件箱查询带出 `pm.role / pm.is_primary`，
  每条单子分别判断；不能只按用户账号角色一刀切。
  主工长的「可发起验收」阶段也计入「待我处理」，由后端 `listInitiablesForUser`
  按「进度 100% + 门禁 pending_acceptance + 无未终结验收单」计算。
- **验收通过 ≠ 解锁下一阶段**：验收通过只解锁本阶段付款节点；下一阶段要等阶段结算
  无异议（`settled`）。详情页的五步流程和提示必须把「验收通过」与「阶段结算」分开，
  否则用户签完字会以为已经能进下一阶段。
- **验收详情依赖的扩展字段**：`getDetail` 额外返回 `projectAddress`、`hasSupervisor`、
  `round`、`stageProgress`、`stageGateStatus`、`waitingHours`。无监理项目把「监理审核」
  显示为「已跳过」，不要画成一个真实环节。
- **业主签名是一次性 multipart 提交**：字段名固定 `signature`；签名与「通过」必须
  在同一个请求里完成，不能拆成「先签名、再确认」两步。驳回原因必填，照片字段走
  `photos`，服务端按字段名区分。

### 小程序管理员（90）

完整说明：[docs/constraints/10-mini-admin.md](docs/constraints/10-mini-admin.md)

- [90. 小程序管理员是独立后台身份，不是项目角色](docs/constraints/10-mini-admin.md#c90)

## 尚未确定 / 需注意

- **微信凭据与 `WX_MOCK`**：本机 `.env` 已配置真实 AppID / Secret（AppID 同时写进
  `miniapp/src/manifest.json`），当前 `WX_MOCK=false`。**Secret 只存在于 gitignored 的
  `.env`，不要提交、不要回显**；生产环境必须换成该部署自己的凭据。
  `WX_MOCK=true` 时用 code 派生稳定 openid，仅限开发环境（生产环境启动即拒绝）。
  真实模式下，依赖固定 dev code 的能力都不可用：H5 预览要临时切回 `WX_MOCK=true`，
  冒烟脚本同理；小程序真机登录走微信开发者工具与真实账号。
- **`DOOR_CODE_KEY` 必须单独保管**：`.env` 里已为本机生成了一份，生产环境需另配。
  **它与数据库备份必须分开存** —— 同库备份等于没做密钥分离。
  丢失 = 所有已存的门锁密码永久不可恢复；泄露 = 拿到库即可解出所有密码。
  生产环境未配置时**服务拒绝启动**。
- **地图 Key 的职责已拆开**：`AMAP_KEY` 用于驾车路线规划（必需，且需要「Web 服务」类型
  Key）；`TENCENT_MAP_KEY` 仅作地理编码兜底。两者都为空时，单点导航仍可用，
  路线规划降级为「按选择顺序 + 单点导航」（AC-N12）。`MAP_PROVIDER=auto|amap|tencent`
  显式选择服务商；无论选哪个，Key 都只留在服务端（AC-N13）。
- **Redis**：本机已装（8.0.2）。`CACHE_DRIVER=memory` 可完全绕过它，但多实例部署下必须用 redis。
- **冒烟脚本会撞限流**：一次运行发一百多个请求，而后台账号限流 60 次/分钟。
  脚本内已对 429 自动退避重试（因此连跑两次时第二次会明显变慢），
  这是刻意的 —— 「可重复执行」是硬要求，慢几秒好过看一片随机失败。
- **冒烟脚本依赖 `WX_MOCK=true`**：它用固定的 mock code 派生 openid。
  本地 `.env` 为正真实微信联调设成 `WX_MOCK=false` 时，`npm run smoke` 会失败；
  跑冒烟前临时切回 `WX_MOCK=true` 并重启后端。集成测试不受影响 ——
  `vitest.config.mjs` 会强制 `WX_MOCK=true`，绝不会打真实微信接口。
- **《需求文档》中两处未定义、由实现补齐的语义**（改行为前先看这里）：
  1. §4.2.1「未配置权重时等权」未说明**部分**配置权重怎么办。
     实现选择：**只有全部条目都配了正权重才走加权，否则整个集合退化为等权**，
     理由是混合加权会算出一个无法解释的数字。
  2. §7.3 未区分 C / B 端路径前缀，实现加了 `/admin` 前缀（见上文「接口路径约定」）。
- **AC-K02 的字面要求（管理员查看门锁密码返回 403）实际表现为 401**：
  后台 token 的 audience 与 C 端不同，在 `requireMini` 就被拒，请求根本没走到业务代码。
  这比 403 更强（连「有没有这个资源」都不知道），因此不改。见 G-38。
