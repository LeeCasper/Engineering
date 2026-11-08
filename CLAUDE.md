# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 工程宝 · 开发约束

> 本文件记录**架构约定**与**踩过的坑**。改动代码前请先读「关键约束」一节 ——
> 那里的每一条都是实际踩出来的，不是理论建议。
>
> **阅读建议**：先看「架构要点」→ 第 1~9 条（数据库/测试基础）→ 第 71~94 条（多租户、后台、小程序管理员、现场签到、主业主、可靠电子签名与实名认证）。
> 约束编号是历史追加顺序且被源码注释引用，**不要重排或复用编号**。
> 94 条约束的完整说明已按主题拆到 [`docs/constraints/`](docs/constraints/)，
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
| `需求文档.md` | 产品需求（v2.14），**一切实现的最终依据** |
| `CLAUDE.md` | 本文件：架构约定、常用命令、94 条约束编号索引 |
| `docs/constraints/` | 94 条约束的完整说明，按主题拆分；编号与源码注释一一对应 |
| `docs/esign-legal.md` | 可靠电子签服务商资质与法律效力核验清单（仅在启用可靠电子签时适用） |
| `server/.env.example` | 环境变量模板；新增配置必须同步这里与 `server/config/index.js` |
| `README.md` | 环境准备、数据库初始化、快速开始、交付进度 |
| `admin/README.md` | 双登录入口、角色菜单、已实现页面与验证方式 |
| `miniapp/README.md` | Stitch 设计稿来源、页面行为、原生 tabBar、资源生成 |
| `miniapp/tests/README.md` | H5 / 微信端 E2E 的运行方式与 Linux 开发者工具自动化配置 |
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
| V1.2-A | **考察计划与路线规划**（§4.6 / C-6.3~C-6.12） | ✅ 已完成：多选项目、起点、推荐顺序、手动重排、逐段导航、保存复用、坐标变更失效、地图降级 |
| V1.2-B | **现场签到留痕**（§4.6 / C-6.13~C-6.20 / AC-N17~N28） | ✅ 已完成：工长 / 监理定位签到、1–3 张照片、服务端水印、偏差阈值与异常说明、管理员提醒、当日去重、项目详情考察时间轴、考察计划「已考察」回填 |
| V2.9 | **平台运营数据看板 + 租户地区字段**（§5.7.6 / AC-T23~T25） | ✅ 已完成：中国地图省级着色、省 → 市行政区划下钻、未分配地区统计、地区租户列表；开通/调整租户录入省 + 市 |
| V2.10 | **平台小程序品牌**（§5.7.6 / B-7.12 / AC-T26） | ✅ 已完成：平台设置小程序名称与 Logo、Logo 上传、公开 `GET /branding`；小程序登录页 / 首页 / 角色页 / 管理端登录页读取 |
| V2.12 | **主业主与临时业主**（§2.2 / §5.2 / AC-AD72~74） | ✅ 已完成：`project_member.owner_type`（迁移 025）、主业主唯一索引与存量回填；验收签名、付款确认、对账确认/异议仅主业主；临时业主可查看与门锁密码管理；主业主注销时自动提升临时业主 |
| V2.13 | **可靠电子签名（验收单，可选能力）**（§4.3 / AC-A16 / AC-A27~A33） | ✅ 代码与 mock 测试已完成；**当前产品默认关闭，验收走手写签名（仅项目内部确认，不具备法律效力）**。需要法律效力时配置服务商并设置 `ESIGN_ENABLED=true`：`esign_task`/`esign_identity`/`esign_event`（迁移 026）、回调收件箱、验签/哈希比对、实名主体绑定、私有存储；开启后生产禁止 mock、禁止手写兜底 |
| V2.14 | **项目竣工总报告** | ✅ 项目状态为「已完工 / 已归档」后按需生成：汇总项目概况、参建成员、阶段验收、验收记录、付款节点与账务；PDF 归档（迁移 028 `project_completion_report`），签名 URL 下载；业主 / 工长可看，监理不可见 |
| V2.15 | **阶段结算与推进门禁补全**（§4.7 / C-7.5~C-7.9 / AC-S02~AC-S08） | ✅ 验收通过自动生成阶段结算草稿；主工长提交、主业主确认或逐条提异议；确认时在同一事务内把当前阶段置 `settled`、下一阶段置 `active`；阶段结算单 PDF 与周期对账单分开渲染 |
| V2.16 | **实名认证** | ✅ 新增 `GET /auth/real-name` 与 `POST /auth/real-name/verify`；姓名 + 身份证号校验，证件号**不落库**，只存脱敏号与核验结果（迁移 033 `identity_verification`）；被邀请（pending / active）但未认证时确认邀请返回 409；认证姓名不可再通过资料接口修改；后台成员列表显示「已实名」。核验通道可配：`local` 本地证件校验（basic 等级）或 `aliyun` 阿里云实人认证 `Id2MetaVerify`（provider 等级，按次计费） |
| — | 租户侧项目数据看板（AC-AD36~43） | 明确不在本轮（V1.2 的项目/工长/财务统计，与平台运营看板是两套口径） |
| — | 管理后台页面（`admin/`） | ✅ 基座 / 平台与租户双登录 / 项目 / 平台租户 / **平台数据看板** / 平台基础配置 / 基础内容页 / 平台日志中心 / 阶段模板 / 账号 / 配置 / 操作与登录日志 / 内容页 / 反馈 / 排障授权 / 平台只读排障 / 我的导出 |
| — | C 端小程序（`miniapp/`） | ✅ 主要页面已交付（持续 UI 调整）：首页（我的项目）、项目详情页、工程动态页、记账页、验收页、验收详情页、登录页、角色说明页、我的页 1:1 还原；我的项目 / 项目详情 / 工程动态 / 记账总览、流水与对账 / 消息中心 / 订阅状态 / 意见反馈 / 注销账号 / 租户管理员移动管理端 / **考察计划与路线规划** / **现场签到与考察记录时间轴** / **进度汇报提交** / **门锁密码（业主管理、工长监理查看）** / 搜索筛选 / 邀请确认 / 无项目引导 / 跨项目验收收件箱 / **项目验收报告库** / 业主签名 / **项目竣工总报告** / 移动管理端（工作台、项目、项目详情、跨项目成员目录、阶段模板、我的管理设置）已接通 |

**后端 M1~M13、V1.2-A 路线规划、V1.2-B 现场签到、V2.9 看板、V2.10 小程序品牌、V2.12 主业主、V2.13 可靠电子签名（可选，默认关闭）、V2.14 项目竣工总报告与 V2.16 实名认证已完成**：
182 条路由、46 张业务表、1081 条自动化测试（53 个测试文件）、128~129 项端到端冒烟断言
（平台账号首登改密那条只在首次运行时出现）。

管理后台页面已交付；C 端小程序的进度汇报提交页也已接通，本轮 C 端页面清单完成。

本轮实际已覆盖原 V1.1 的多级验收、对账结算、阶段门禁与 PDF（M8 / M9 已落地）；
V1.2 的**路线规划与现场签到已交付**；平台运营看板（租户地区维度，V2.9）已交付，
租户侧的项目/工长/财务看板（AC-AD36~43）与后台考察统计（B-4.6）仍不在本轮。

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
npm run migrate:test        # 测试库迁移；脚本用 cross-env，但它不在依赖里
NODE_ENV=test node scripts/migrate.js   # 上面报 cross-env: not found 时用这条
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
npm run dev:mp-weixin       # 用微信开发者工具导入 dist/dev/mp-weixin；新增页面/路由后必须重启 watcher
npm run build:mp-weixin     # 默认接口回落到 127.0.0.1:3000，仅本地调试用
npm run build:h5
npm run test:e2e:h5         # H5 E2E（自动拉起 dev 后端 + H5，Playwright 驱动）
npm run test:e2e:mp         # 微信端 E2E（需安装 miniprogram-automator 并开启开发者工具服务端口）
# 生产包必须显式指定 HTTPS API，否则真机会报 url not in domain list
VITE_API_BASE=https://bzg.yanxinn.com/api/v1 npm run build:mp-weixin
node scripts/gen-assets.js  # 从 design-refs/ 重新生成 PNG 静态资源

# 服务探针
curl http://127.0.0.1:3000/health        # 存活探针
curl http://127.0.0.1:3000/api/v1/health # 就绪探针（真连 MySQL + 缓存）
```

运行环境：Node.js ≥ 20（本机 22.x）；管理后台额外要求 Node ≥ 20.19 与 pnpm ≥ 8.7。
小程序 E2E 需要本机 Chrome；微信端 E2E 还需要微信开发者工具开启服务端口。

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
（没有前端自动化测试，交互用 Playwright 手工验证）；小程序跑
`npm run test:e2e:h5` + `npm run build:h5 && npm run build:mp-weixin`，
需要真机 / 微信运行时再用 `npm run test:e2e:mp`。只改小程序样式时也不能只看构建成功 ——
用 H5 / 微信开发者工具实际看一眼主色、tabBar 选中态和底部安全区。

## 生产部署（当前环境）

> 以下是**本机现在这台生产服务器**的实际情况，不是通用部署模板。
> 服务器上的完整路径、端口、备份与更新命令见 `/srv/renovation/DEPLOY-NOTES.md`。

- 线上入口：`https://bzg.yanxinn.com`。管理后台静态文件由 Nginx 直接服务，
  `/api/v1` 与 `/uploads` 反代到后端；MySQL、Redis 不对公网开放。
- 后端用 **systemd**，不是 PM2：`renovation-api.service` 监听 `127.0.0.1:3100`。
  `systemctl status/restart renovation-api`、`journalctl -u renovation-api`。
- MySQL 8 与 Redis 是独立 Docker 容器：`renovation-mysql`（127.0.0.1:3307）、
  `renovation-redis`（127.0.0.1:6380），刻意避开宿主机已有的 3306/6379。
- 这台机器的 Nginx 是**宝塔的** `/www/server/nginx`，站点配置必须放
  `/www/server/panel/vhost/nginx/*.conf`；放 `/etc/nginx` 不会生效。
  重载命令是 `/www/server/nginx/sbin/nginx -s reload`。
- 证书由 certbot 的 webroot 方式签发，续期后自动 reload 宝塔 Nginx。
  站点配置：`/www/server/panel/vhost/nginx/bzg.yanxinn.com.conf`。
- 发布流程：后端 `rsync` 代码 → `npm ci --omit=dev` → `npm run migrate` →
  `systemctl restart renovation-api`；前端在本机构建后只同步 `admin/dist`。
- **小程序不在服务器上托管**：生产包是 `miniapp/dist/build/mp-weixin`，需要在本机
  微信开发者工具「上传」后到公众平台提交发布；不要把它 rsync 到服务器。
- 生产变量只存在服务器 `/srv/renovation/app/server/.env`（600，`renovation` 用户）；
  `DOOR_CODE_KEY` 必须另外离线保存。服务器上还有宝塔、Java 服务与 `ab-prod` Docker 栈，
  **不要为了本项目重启或修改无关服务**。

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

### 按任务定位

| 要做的事 | 先看哪里 |
| --- | --- |
| 新增 / 修改接口 | `src/routes` → `controllers` → `services` → `models`；先对照 `需求文档.md`、相关 constraint |
| 权限 / 租户隔离 | `services/dataScope.service.js`、`projectAccess.service.js`、`middlewares/adminAuth.js` / `miniAuth.js` |
| 验收 / 电子签 / PDF | `services/acceptance*.service.js`、`esign.service.js`；C 端 `pages/acceptance/detail.vue` |
| 记账 / 付款 / 对账 | `services/ledger.service.js`、`paymentNode.service.js`、`reconciliation.service.js` |
| Web 管理后台 | `admin/src/views/**` + `admin/src/router/routes/index.ts`；`router/elegant/` 与 `typings/elegant-router.d.ts` 是生成文件 |
| 小程序页面 | `miniapp/src/pages/**` + `pages.json`；图标 / 插画改 `scripts/gen-assets.js`，不要手改生成 PNG |
| 数据库结构 | `server/db/migrations/*.sql` 是唯一权威；已执行的迁移不改，新增迁移文件 |

### 小程序（`miniapp/`）

uni-app + Vue 3 + Vite。页面与后端分离，通过 `src/config.js` 的 `API_BASE` 连接。

- **设计来源**：Stitch 项目 `7202629267044826058` 的登录页与角色说明页；
  原始 HTML / 截图在 `miniapp/design-refs/`，只作对照，不参与构建。
- **品牌与配色**：小程序可见品牌按品牌方 logo 统一为「柏总管」，
  完整 logo 来源是 `miniapp/design-refs/brand-logo.png`（橙底白字），
  由 `scripts/gen-assets.js` 生成 `src/static/images/logo.png`。
  主色 `#EB5C20`、按压色 `#C44710`、浅底 `#FDEBE4`、页面底色 `#FAF7F4`。
  **所有小程序内品牌 Logo 都读 `store/branding.js` 的 `branding.logoUrl`**
  （平台设置里上传的 Logo），未配置时统一退回 `logo.png`；首页橙色 hero 也用
  同一个 Logo，不再使用 `home-logo.png` 的反色小标记。
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
  「常用功能」按账号角色区分：**业主只保留「消息 / 验收报告」**（验收报告进入
  `pages/acceptance/reports` 的项目报告库，不是验收 tab 的跨项目收件箱；没有当前项目时
  先弹出项目选择，选定后再进入）；
  工长 / 监理保留「消息 / 我的项目 / 验收」，工长另有「记账」。
- **头像与昵称由用户自己维护**：「我的」资料面板用微信 `button open-type="chooseAvatar"`
  与 `input type="nickname"` 支持一键使用微信头像 / 昵称，也可以手动输入。
  `chooseAvatar` 返回的是**临时文件**，保存时先 `POST /auth/avatar`（multipart 字段
  `avatar`，仅图片、≤5MB）转存为绝对 URL，再 `PUT /auth/profile` 保存昵称。
  不要直接把临时路径写进 `user.avatar`，下次进入小程序就失效了。
  上传新头像会删除本系统上一张旧头像；注销账号时头像文件一并删除。
  `PUT /auth/profile` 的昵称不允许空串（会回落到「微信用户」，看起来像保存失败）。
  后台成员列表（网页项目详情「成员」tab、小程序管理端成员页）返回并展示
  `avatar` + `nickname`，昵称为空时回落脱敏手机号 / 首字母。
  **真实姓名存 `user.real_name`（迁移 032），认证状态存 `real_name_status`（迁移 033）**：
  所有“人”的展示名统一按 `real_name → nickname → 脱敏手机号 → 角色占位` 取，
  项目列表 / 项目详情 / 联系人 / 成员目录 / 验收流转都走这个优先级。
  不要用真实姓名覆盖 `nickname` —— 微信昵称仍要能在资料面板里单独编辑。
  **被邀请之后必须完成实名认证**：用户存在 pending/active 成员关系但
  `real_name_status != 'verified'` 时，`GET /auth/profile` 返回
  `requiresRealNameAuth: true`（旧字段 `requiresRealName` 保留为同义），
  小程序在「我的 → 资料」里给出「去认证」入口；确认邀请接口返回 409
  （`detail.requiresRealNameAuth`），只填姓名未认证同样会被拦下。
  认证走 `POST /auth/real-name/verify`（姓名 + 身份证号 + 显式 consent）；
  **证件号不落库**，库里只有 `id_card_mask`（前 6 后 4）与
  `identity_verification` 审计流水，完整证件号不得进入日志、错误响应或 storage。
  核验通道由 `REAL_NAME_PROVIDER` 决定：
  - `local`：本地证件校验（校验位 / 出生日期 / 省级行政区），接口返回
    `verificationLevel: 'basic'`，**不得宣传成公安库或第三方核验**；
  - `aliyun`：阿里云实人认证 `Id2MetaVerify`（姓名 + 身份证号二要素），
    返回 `verificationLevel: 'provider'`。AccessKey 只放服务端
    `ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET`，启动自检会在
    provider=aliyun 但缺密钥时直接拒绝启动；网络/鉴权/欠费错误一律转 503，
    不能当成「身份不通过」。
  新增 provider 必须实现同样的 `verify()` 契约；未实现的 provider 返回 503，
  不能静默降级成本地校验。小程序授权文案要根据状态接口的 `provider` 字段说明
  证件信息是否会传输给服务商。
  认证后的姓名不可通过 `PUT /auth/profile` 修改（验收 / 结算单据的署名依据）。
  还没被邀请的账号仍可留空、不强制认证。
- **登录**：C 端身份是微信 `openid`，没有短信验证码接口。登录页的「登录 / 微信登录」
  都走 `uni.login → POST /auth/login`；手机号输入框在开发环境（`WX_MOCK=true`）
  顺带绑定手机号。**不要给短信登录做假倒计时** —— 后端没有这个能力。
  **dev 构建固定登录 code**：`WX_MOCK=true` 时后端按 code 派生 openid，而微信开发者
  工具每次编译的 code 都不同 —— 清缓存 / 重新编译会变成新账号，再绑手机号就会报
  「该手机号已被其他账号绑定」。因此 H5 用 `DEV_WX_CODE`、dev 构建的微信端用
  `DEV_MP_WX_CODE`（`import.meta.env.DEV` 分支）；正式构建仍走 `uni.login`。
  不要为了「更像真机」把 dev 分支去掉。
- **开发调试入口只在 dev 存在**：管理端登录页的「一键登录管理端」用
  `<!-- dev-only:start/end -->` 与 `/* dev-only:start/end */` 包住模板 / 脚本 / 样式，
  `vite.config.js` 的 `stripDevOnly` 在 **mode=production** 时整段删除。
  不要用 `apply:'build'` 判断 —— `dev:mp-weixin` 内部也是 `vite build`；
  也不要只靠 `import.meta.env.DEV + v-if` —— 账号常量会被摇掉，但按钮文案仍会留在
  H5 render 与 WXML 里，正式包里还能被检索到。新增 dev-only 代码时沿用这套标记。
  **被正式构建保留的公共函数不能引用 dev-only 声明**：登录过场 `playEnterTransition`
  在正式包里仍要复位 `devLogging`，而声明原本被标记删掉了，正式包跑起来就是
  `ReferenceError: devLogging is not defined`。需要跨边界的变量把声明放在标记外，
  账号常量 / 按钮 / 函数仍留在标记内。
- **内容页按当前项目租户读取**：`pages/legal/index` 请求 `/contents/:key` 时带上
  `getCurrentProject().tenantId`，后端按「租户已发布 → 平台已发布 → 404」回退；
  没有项目上下文（登录前）则读平台基础版本。不要只读平台版本，否则租户的
  协议补充条款永远不会生效。
- **角色是账号级固定的（v2.5）**：`user.role` 在管理员按手机号首次邀请时确定，
  工长在所有项目里都是工长、监理在所有项目里都是监理，不能跨项目改成别的角色；
  业主可以参与多个项目。`project_member.role` 仍用于项目内权限，但必须与
  `user.role` 一致。角色选择页已改为说明页，不再写入本地「默认视角」。
  **业主在项目内再分主业主 / 临时业主**（`project_member.owner_type`）：
  验收签名、付款确认、对账确认/异议只认主业主；临时业主保留查看项目/账目/联系人
  与门锁密码管理等普通能力。首个业主自动主业主，active 主业主不可移除，
  详见第 92 条。前端不要用 `user.role` 猜主业主，必须读项目详情 / 成员接口的
  `isPrimaryOwner` / `ownerType`。
- **登录落点由 `/projects` 决定**：有待确认邀请先去邀请列表，否则直接进项目列表。
  没有项目时也不该先问「请选择您的身份」—— 用户此时还没有任何项目身份。
- **项目上下文是独立状态**：进入项目时把 `{id, tenantId, name, role, ownerType, isPrimaryOwner}`
  存入 `gc_current_project`（`store/projectContext.js`）。项目列表每次刷新都会校验，
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
- **新建 / 编辑项目支持地图定位**：网页后台与小程序管理端的项目表单都调用
  `/admin/maps/{geocode,reverse-geocode,static}`。静态地图由服务端请求高德 Web 服务、
  以 base64 data URL 返回，**AMap Key 不下发前端，也不要接 AMap JS SDK**。
  创建 / 编辑接口接受可选 `longitude/latitude`（必须成对），手动坐标优先于地址地理编码；
  地址改动后若坐标来源是地理编码 / 回填，前端不提交旧坐标，交给后端重新解析。
  静态图拖拽使用 CSS 像素 + Web Mercator，**高德静态图 zoom 比标准 Mercator 大 1**，
  服务端与两端前端必须使用同一偏移，否则拖动会偏一倍。
- **项目封面（缩略图）**：`project.cover_url`（迁移 027）存绝对 URL；上传走
  `POST /admin/projects/cover`（multipart 字段 `cover`，仅 PNG / JPG / WebP、≤5MB），
  拿到 `url` 后再随创建 / 编辑提交 `coverUrl`。网页与小程序管理端共用这套接口；
  没有封面时各端回落内置占位图（C 端按 id 稳定映射 4 张实景图）。
  所有展示位（C 端首页 / 项目详情、管理端项目卡片、网页列表）都是 **1:1 正方形**，
  用 `aspectFill` 居中裁切，上传提示也按 1:1 写 —— 不要再提示 3:2 之类的横图比例。
  **不要下发 storage key，也不要把封面塞进建档 JSON 之外的第二种提交方式。**
- **项目状态与阶段进度是两套字段**：顶部「待开工 / 施工中」读 `project.status`，
  不是阶段完成度。按 §5.2，**首次提交进度汇报时自动进入「施工中」**
  （`report.service` 调用 `projectService.autoStartProjectIfPending`），
  自动流转同样要过 AC-AD58 的人员配置校验；人员没配齐时整笔汇报回滚。
  不要因为某个阶段 100% 就只改阶段字段或只改 `project.status` 的展示文案。
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
- **现场签到是独立链路，不混进工程动态**：入口在项目详情的「签到」pill / 更多菜单，
  签到页 `pages/visit/checkin`、考察记录页 `pages/visit/timeline`。
  只有工长 / 监理能签到；业主可看时间轴但不能签到。定位失败时**不允许提交**，
  必须给出去设置的引导（AC-N28）。
  照片先逐张 `POST /projects/:id/visits/media` 暂存，提交时用 `mediaIds` 一次性消费；
  水印在**提交时**用最终坐标生成（时间 + 签到位置文字 + 项目地址 + 坐标）；
  位置文字由服务端逆地理编码（高德优先、腾讯兜底；只配 `TENCENT_MAP_KEY`
  也可以生成文字地址），未配置地图 Key 时写「实时地址未解析」并保留坐标，
  不编造地址。前端提交前会强制重新定位一次，定位失败不允许提交；
  不要复用页面打开时的旧坐标。
  同项目同人当日只有一条记录（`uk_visit_daily`）；异常签到允许提交但必须填说明，
  并给管理员发站内消息。签到记录只追加，model 不导出 update / delete。
  从考察计划进入时带 `routePlanId` + `seqInPlan`，提交后回填 `route_plan_point.visited_at`，
  路线详情要靠 `visit:created` 事件或 `onShow` 刷新「已考察」进度。
- **进度汇报提交页**：入口在项目详情「工程动态」卡片右侧的「汇报进度」，
  以及工程动态页右下角的悬浮按钮；只有**工长**且至少有一个 `stage.canReport`
  的阶段时显示。页面 `pages/report/submit` 的阶段列表直接读
  `GET /projects/:id/stages` 的 `canReport` / `lockedReason`，
  **不要自己按 gateStatus 猜门禁**（严格档 / 标准 / 宽松的差异在后端）。
  完成度是 0–100、步进 5；附件先逐张 / 逐个调到
  `POST /projects/:id/reports/media`（带 `itemId`，图片在这一步就由服务端打水印），
  提交时用 `mediaIds` 一次性消费，并带 `clientRequestId` 幂等键
  （断网重试必须复用）。换了阶段 / 工序要清空本地 mediaId 重新上传 ——
  暂存行在服务端绑定了工序。工程动态页和项目详情在 `onShow` 会重新拉取，
  提交成功后直接返回即可看到首行新汇报。
- **工程动态页是汇报列表，不是单条汇报详情**：`pages/project/feed` 按 Stitch
  `368a845eb6254a3ab51b77d43b5cc42c` 1:1 还原；数据来自
  `GET /projects/:id/reports`，阶段筛选只展示「当前阶段 + 下一阶段」，图片/视频/评论
  都走真实接口。监理巡检卡片只在 `author.role === 'supervisor'` 时渲染；
  签到记录在项目详情的「考察记录」卡片与时间轴页，**不要混进工程动态**。
- **工长「确认收款」是一键记账，不是只改状态**：付款节点解锁后，工长可点
  「确认收款」，服务端会把节点金额自动写成一条收入流水（归属节点关联阶段；
  手工节点归到当前阶段），节点随之进入「已付款」。**不要恢复成只改
  `payment_node.status` 而不写 ledger 的旧行为**——阶段结算的「已收」来自流水，
  只改节点会得到「节点已付款、账面已收为 0」的矛盾数据。
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
  管理端页面在 `pages/admin/**`，全部是非 tab 页；C 端保留 4 个原生 tab。管理端顶层
  页（工作台 / 项目 / 成员 / 我的）合并进 `pages/admin/home/index` 壳页，用内页
  `AdminTabBar` 切换视图，不注册进原生 tabBar，详情/表单页不显示底部导航。
  C 端项目列表**不显示**
  管理入口；管理员统一从小程序登录页的「管理员登录」进入工作台，避免把后台身份
  暴露在普通业主 / 工长 / 监理的主界面。管理员 token 存在 `gc_admin_*`，与 C 端 `gc_token` 分离：
  任一端 401 都不能清另一端。微信免密绑定表是 `admin_wechat_binding`（迁移 018），
  以 openid 为权威键，`admin_token_version` 失配即失效；改密、重置、禁用、C 端注销
  必须撤销绑定。平台账号不能登录小程序管理端，也不能绑定。管理员复用后台
  `/admin/*` 接口与数据权限，网页与小程序天然同步；小程序管理端覆盖项目/成员/
  付款节点/阶段工序/**验收报告（只读）**，以及阶段模板的概览、切换、新建与基础编辑
  （阶段名、工期、工序名、未被引用时删除）。验收报告页是
  `pages/admin/project/reports`，复用 `GET /admin/projects/:id/acceptances`
  （`{ items, summary }`，无分页，草稿也会出现），只有已通过且报告生成成功才带
  `reportPdf.signedPath`；下载走 2 小时签名 URL（无需 Authorization），微信端
  `uni.downloadFile` 后 `uni.openDocument`，**必须检查 `downloadFile` 的
  `statusCode`**（4xx 也会走 success），过期时提示下拉刷新而不是白屏。
  **报告编号以 `acceptance.report_no` 为准**（迁移 034）：生成 PDF 时写入，
  新报告是 `AC-{通过日期}-{项目 id}-{验收单 id}`（如 AC-20261105-8092-000040），
  旧报告回填成 `AC-{验收单 id}`，与其已归档 PDF 保持一致。
  列表接口返回 `reportNo`，前端直接展示并参与搜索，**不要在前端重新拼接**；
  未通过的单子没有报告编号，显示「待生成」。
  账号管理、权重/验收项清单等高级模板编辑、配置、内容、反馈、日志、
  导出仍在网页后台。模板编辑只改模板本身，**不会回写已创建项目的阶段树**。
- **进度汇报的多附件走暂存接口**：微信端 `uni.uploadFile` 一次只能带一个文件，而
  `POST /projects/:id/reports` 要求一次原子提交。先逐文件调
  `POST /projects/:id/reports/media`（服务端打水印）拿到 `mediaId`，再用 `mediaIds`
  提交；两种附件方式互斥。暂存行 24 小时未提交由 `reportMediaCleanup` 清理，
  清理任务必须**先认领 `status='expired'` 再删文件**，否则会把用户刚提交的图片删掉。
  不要在前端手工拼 multipart，也不要恢复「一次 multipart 带齐」的假设。
- **C 端没有建档权限**：项目新建只对租户管理员开放，入口在管理端工作台的
  「新建项目」快捷入口和项目管理列表头部的「+ 新建项目」。C 端项目列表**不展示**
  「新建项目」按钮，也不要把用户引导到一个不存在的 C 端建档接口。
- **C 端底部导航用原生 tabBar**：`pages.json` 配置项目 / 验收 / 记账 / 我的四项，**不要**每个 tab 页自己画一个底部栏，也不要用 `reLaunch` 切 tab —— 那会重建页面并白屏。四项现在都是真实页面；「我的」是个人工作台（资料、多项目时的切换入口、业主联系人 / 工长统计、消息、订阅、反馈、注销），消息未读数用 `uni.setTabBarBadge({ index: 3 })` 挂在「我的」tab 上。
  自绘底栏、`tabBar.custom`、按平台隐藏原生栏都试过：真机切换 tab 时底栏会重绘闪烁，
  因此**保持原生**。不要为了玻璃效果再改回自绘 / custom tabBar。
- **管理端顶层页是壳页内的视图，不是四个页面**：`pages/admin/home/index` 里
  渲染工作台 / 项目 / 成员 / 我的四个视图（`components/admin/views/*View.vue`），
  用 `v-show` 保活、首次访问才挂载；`AdminTabBar` 只渲染一次，只发 `change` 事件。
  **不要改回四个独立页面 + `redirectTo`**：真机会重建 webview，底部菜单栏会闪
  （开发者工具渲染快，看不出来）。C 端用原生 tabBar + `switchTab` 达到同样效果；
  微信只允许一套 tabBar（最多 5 个）且 tabBar 页必须在主包，管理端页面在分包里，
  所以只能用壳页模拟，不要尝试注册第二套原生 tab。
  `pages/admin/{workbench,projects,members,profile}/index.vue` 只是兼容旧深链的
  转跳壳，内部入口一律走 `store/adminTabs.js` 的 `requestAdminTab`。
  视图里不能写页面生命周期（`onLoad` / `onShow` 在组件里不生效）：初始加载放
  `onMounted`，激活用 `watch(() => props.active)`；下拉刷新 / 触底加载由壳页
  `onPullDownRefresh` / `onReachBottom` 转发到当前视图的 `refresh` / `loadMore`
  （`defineExpose`）。跨组件传递回调必须用事件（`@back`），**不要用函数 prop**，
  小程序自定义组件之间无法序列化函数。
  嵌套页（详情 / 表单 / 成员 / 付款节点 / 阶段工序）仍用 `navigateTo`、不显示底栏；
  从嵌套页返回时由壳页 `onShow` 刷新当前视图。
  四个视图统一用 `store/adminCache.js` 的内存快照做首次挂载的秒开：setup 时先用
  快照渲染，再静默刷新；只有首次进入（没有快照）才显示加载态。
  管理员登录 / 登出 / 401 会清空快照（`setAdminSession` / `clearAdminSession`），
  不要把快照写进 storage，也不要在快照里放另一个账号的数据。
  成员 tab 是 `pages/admin/members/index.vue` 转跳到壳页的成员视图，内容为跨项目
  成员目录，读 `GET /admin/members`（复用 `dataScope`，手机号脱敏）；邀请 / 改指 /
  移除仍走具体项目的 `/admin/projects/:id/members`，不要为写操作另开跨项目接口。
  项目详情 `pages/admin/project/detail` 按 Stitch `64c024eb…` 还原，单项目成员页
  `pages/admin/project/members` 复用成员卡片与筛选样式；两页都不显示底部导航。
  **管理端顶部导航统一用 `AdminNav` / `AdminRootHeader`**，右侧安全区由
  `composables/useCapsuleInsets.js` 读取微信胶囊 `getMenuButtonBoundingClientRect()`
  动态计算（`rightInset = 屏幕宽 − 胶囊 left + 间隙`），**不要写死 `dp(92)`**：
  92dp 在 375px 屏只有约 88px，胶囊连同右边距接近 95px，右侧按钮会被压到胶囊下面。
  H5 / App 没有胶囊时 `rightInset` 为 0，回落到组件自己的 CSS 内边距；
  MP 测量失败时按屏幕宽度约 28% 保守预留。新增管理端页面必须复用这两个组件，
  不要另画一条顶部栏。顶部右侧动作统一用 `AdminHeaderAction`
  （浅橙玻璃胶囊 `variant="pill"` / 圆形图标 `variant="icon"`），
  不要在页面里再写 `edit-pill`、`new-pill`、`admin-nav-action` 这类私有样式。
  **页面 json 的 `backgroundColor` 必须与页面画布一致**：它是原生窗口底色，
  页面切换、webview 初始化那几帧会露出来。工作台 / 我的曾经为了下拉回弹把
  背景设成品牌橙（`#EB5C20` / `#F85A2A`），结果在管理端切页时底部会闪一块橙色；
  现在统一用画布灰 `#F6F7F9` + `backgroundTextStyle: dark`。
  橙色只留在页面自己的头部渐变里，不要再写进 `backgroundColor`。
- **H5 下的 tabBar 在页面内**：底部浮层（筛选、阶段、签名等）的 z-index 必须高于 H5 的 `uni-tabbar`（当前用 1000）；小程序原生 tabBar 在 webview 外，不受影响。
- **H5 的 `uni.showModal` 要盖住管理端面板**：它默认 `z-index: 999`，而管理端底部面板是 1300，
  从成员操作 / 模板编辑面板里弹出的确认框会被盖住、按钮点不到。`App.vue` 已在 H5 下把
  `.uni-mask` / `uni-modal` 统一抬到 2000/2001，不要在单个页面里再调低模态层。
- **不要画假的 iOS 状态栏与微信胶囊**：设计稿里的「9:41 / 电池」和右上角胶囊
  是手机壳示意；真机已有系统状态栏与原生胶囊。页面用
  `padding-top: var(--status-bar-height)`（H5 回退 12px）对齐。
- **SVG 一律栅格化**：微信各端对 `<image>` 的 SVG 支持不一致，
  `scripts/gen-assets.js` 用 sharp 把背景、天际线、图标转成 3x PNG。
  角色卡实景图保留原 JPG，左侧羽化用白色渐变覆盖层实现 ——
  带 alpha 的大 PNG 会把主包顶过微信 2MB 限制（这是实际的踩坑点）。
  **唯一例外**是登录页「微信登录 / 管理员登录」两个按设计提供的 SVG 图标：
  以 base64 data URI 放进 `<image>`，并绑定 `@error` 回退到 PNG；不要把这种写法
  扩大到其他图标，也不要把大尺寸 SVG 塞进主包。
  在 `dev:mp-weixin` 运行时执行 `gen-assets.js`，watcher 可能把正在写入的 PNG
  复制成 0 字节，表现为原生 tabBar 图标全部破图；生成后要重启 watcher
  （或删掉 `dist/dev/mp-weixin` 下的 0 字节文件）再编译。
- **底部弹窗统一下滑关闭**：`src/composables/useSwipeClose.js` 负责把手 /
  标题区的下拉手势，阈值约 90px（向下速度 > 0.6px/ms 也算），不足阈值用
  `cubic-bezier(.22,1,.36,1)` 平滑回弹；入场有全局 `sheet-rise` 动画，
  关闭用加速曲线淡出。
  只把 touch 绑定在 `.sheet-handle` / `.sheet-head` / `.sheet-header` 上，
  **不要绑整个 `.sheet`** —— 面板里有输入框和可滚动列表，整面板手势会抢滚动。
  每个页面的遮罩必须带 `@touchmove.stop.prevent="sheetSwipe.onMaskTouchMove"`，
  否则拖动时背景页面会跟着滚；把手实际触摸区域由 `App.vue` 的全局
  `.sheet-handle` 样式撑到整条顶部，**不要改回 4px 高的胶囊**。
  composable 必须把 `onTouchStart / onTouchMove / onTouchEnd` 直接返回给模板，
  只放在 `handlers` 对象里会导致模板绑定到 `undefined`，表现为完全拖不动。
  **长表单不能只靠 `.sheet` 的 `overflow-y`**：微信里会被蒙层的
  `catchtouchmove` 拦住，内容被底部按钮盖住且滑不动。应使用固定标题 + 底部按钮 +
  中间 `scroll-view`，并给面板明确高度（例如 `height: 86vh` + flex）；只给
  `max-height` 时 `flex:1` 的滚动区会塌成几十像素。
- **tab 页 `onShow` 静默刷新不能先清空旧数据**：切回「我的」与「验收」时，
  页面会重新拉取数据；旧实现先把 `stats.value = null` / 展示「加载中…」，
  于是每次切 tab 都闪一下。现在「我的」用 `statsScopeKey` 区分同范围刷新与切换项目，
  同范围保留旧值直到新值返回；「验收」用 `loaded` 标记，只有首次进入才显示首屏加载态。
  新增 tab 页的 `onShow` 刷新时沿用这个原则：**保留旧内容 + 后台更新，
  只有切换项目 / 范围变化才清空**。
- **页面模块依次入场**：给内容容器加 `.gc-stagger`，直接子级会按
  `:nth-child` 以 20~340ms 的延迟依次淡入上浮（`gc-reveal-up`）。
  只加在纯内容容器（`.content`、`.card-list`、`.project-list`）上，
  **不要加到包含固定弹窗 / 遮罩的容器**，否则面板会被重复动画。
- **液态玻璃材质**：`src/uni.scss` 的 `glass-surface` / `glass-sheet`
  （暖白半透明底 + 径向柔光 + `backdrop-filter` + 内侧高光）用于 C 端与管理端的卡片、
  吸顶导航、搜索 / 筛选胶囊与底部面板。**底部导航保持原样**：C 端是微信原生 tabBar，
  管理端 `AdminTabBar` 仍是白底通栏，不要给它加模糊或改成浮动坞。
  表单、长文本、地图与签名画布保持不透明底，避免滚动时影响阅读。
  **不要用多段白色线性渐变做玻璃**：0.92 → 0.5 → 0.72 这种中间凹下去的写法
  在小卡片上会出现明暗色带；橙底上再叠 `border-top: 0.96` 会形成一条白边。
  玻璃表面统一用暖白（`255,251,247`）+ 单一颜色的细边框 + 柔和顶光。
  **「我的」橙色 hero 的高度按设计稿恢复为 `safeTop + 175`**：资料卡可以跨过
  橙白收口线，不要为了把卡片完全包进橙色而把 hero 拉高（橙色会显得过重）。
  hero 图片底部的深色描边就是那条「阴影」，已从 `scripts/gen-assets.js` 的
  `MINE_HERO_BG` 中移除，**不要再加回来**；只保留白色收口线。
  资料卡跨过收口线时也**不要加外投影**（`box-shadow` 的外阴影会在橙白两侧形成阴影带），
  只保留内侧高光。
  纯灰/近白画布上玻璃几乎不可见，需要在页面底色里埋极淡的暖色径向光晕，
  玻璃才有折射可读。
  不支持 `backdrop-filter` 的内核会退化为暖白半透明底，不能把关键文字放在
  仅靠模糊才能区分的背景上。改动 `uni.scss` 后必须重启 `npm run dev:mp-weixin`，
  增量编译不会重新注入全局 mixin，会报 `Undefined mixin`。
- **加载态统一用 `gc-loading` / `gc-skeleton`**（easycom，目录
  `src/components/gc-loading/gc-loading.vue`、`gc-skeleton/gc-skeleton.vue`）：
  列表首屏用骨架屏（`gc-skeleton`，带 shimmer），详情页 / 面板内 / 加载更多用
  品牌色跳动圆点（`gc-loading`，`inline` 为横排）。不要在各页面重新写
  「加载中…」纯文本；小程序管理端的 `AdminPageState` 已内置 `gc-loading`。
- **小程序名称与 Logo 由平台后台配置**：`miniapp_name` / `miniapp_logo` 是
  `platformOnly` 配置，租户只读；Logo 通过 `POST /admin/platform/branding/logo`
  上传，配置值存绝对 URL。小程序登录前读 `GET /branding`（`auth:false`），
  登录页 / 首页 / 角色页 / 管理端登录页用 `store/branding.js` 的 `branding.name`
  与 `branding.logoUrl`，未配置时回落到各自的内置 Logo。不要把品牌名再写死。
- **生产小程序包必须显式传 API 基址**：构建命令是
  `VITE_API_BASE=https://<域名>/api/v1 npm run build:mp-weixin`，默认值会回落到 `127.0.0.1:3000`。真机预览/发布前，
  微信公众平台的 request / uploadFile / downloadFile 合法域名都要加入该 HTTPS 域名，
  否则会报 `request:fail url not in domain list`（请求根本到不了后端）。
  构建产物是 `dist/build/mp-weixin`；不要拿 `dist/dev/mp-weixin` 去真机预览。
- **构建**：`npm run build:mp-weixin` → `dist/build/mp-weixin`；
  `npm run dev:h5` 可在浏览器里走通登录（固定 dev code，后端 mock 派生稳定账号）。
  微信开发者工具需勾选「不校验合法域名」才能访问 `127.0.0.1`（仅本地）。
- **主包必须保持在 2MB 以内**：微信上传报 `80051 source size ... exceed max limit 2MB`
  时，不要删减功能或压糊图片，先看是否把非 tab 页放进了主包。
  当前 `pages/admin/**` 与 `pages/settlement/**` 走 `subPackages`，tab 页
  （`pages/projects` / `pages/acceptance` / `pages/ledger` / `pages/mine`）与
  登录、项目详情等首屏链路留在主包。新增非 tab 页面优先放进分包；
  分包被打包后路径不变（仍是 `/pages/admin/...`、`/pages/settlement/...`）。
  `dist/dev/mp-weixin` 比正式包大，**上传发布必须用 `dist/build/mp-weixin`**。
- **`mp-weixin.lazyCodeLoading` 保持 `requiredComponents`**：微信开发者工具在
  每次编译后的冷启动里，第一次路由进入**任何**分包（`pages/admin`、`pages/settlement`
  都复现）都会抛 `SystemError: routeDone with a webviewId ... is not found`。
  已验证与 `wx.preloadSubpackage` 无关；开启按需注入后连续冷启动不再出现。
  这是运行时路由问题，不是可选的性能项，不要删掉。

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
  `src/router/elegant/{imports,routes,transform}.ts` 与
  `src/typings/elegant-router.d.ts`。**不要手改这些生成文件**；显式路由
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
  **模板关键词映射也是平台专属配置**（`subscribe_template_<type>_fields`）：
  微信要求 `data` 的键与所选模板**完全一致**（`thing1` / `time2` …），公共模板库的关键词
  布局又因模板而异，因此不能写死在代码里；默认给一套常见布局，运营按模板详情改成
  JSON（值可用 `projectName / title / content / typeLabel / time / date / refId`）。
  推送走 `stable_token`（`force_refresh=false` 时多实例拿到同一 token，避免互相顶掉），
  token 落 Redis；发送失败只记日志，站内消息不受影响，且**推送不阻塞业务请求**。
- **日志要分两套**：平台日志中心 `/platform/log` 只看 `tenant_id IS NULL` 的
  平台级事件（租户开通/停用、平台配置与内容页修改等）；租户的业务操作与登录日志
  留在租户后台 `/log/*`。平台默认不能横向浏览租户业务日志，只能在排障授权窗口内只读。
- **当前已交付**：平台 / 租户双登录入口、强制改密、工作台、
  项目列表 / 新建 / 编辑 / 状态流转 / 归档 / 软删除 / 批量归档 / 批量分配工长 / 导出、
  项目详情（概览 / 阶段工序 / **验收报告** / 成员 / 付款节点）、
  平台租户管理（开通 / 配额 / 停用 / 退租 / 专属地址 / 地区）、
  平台数据看板（中国地图 / 省市级下钻 / 未分配地区 / 地区租户列表）、
  平台小程序品牌（名称 / Logo 上传与预览）、
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
> 新增条目一律追加到末尾。多租户、后台、小程序管理员、现场签到、主业主、可靠电子签名与实名认证相关的条目集中在第 71~94 条。
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
- **付款节点整体替换必须用「条件唯一」**：`payment_node` 的历史行是软删除，
  而 `(project_id, seq)` 如果直接建唯一键，会连软删行一起约束 —— 第二次保存时
  先软删旧节点、再按 seq 1..N 插入，就会撞唯一键并返回 409「数据已存在」。
  迁移 031 改为生成列 `active_project_id = IF(deleted_at IS NULL, project_id, NULL)`
  + 唯一键 `(active_project_id, seq)`；新增类似「软删后重建」的表时沿用这个模式。
- **验收通过 ≠ 解锁下一阶段**：验收通过只解锁本阶段付款节点；下一阶段要等阶段结算
  无异议（`settled`）。详情页的五步流程和提示必须把「验收通过」与「阶段结算」分开，
  否则用户签完字会以为已经能进下一阶段。
  **阶段结算已经落地**（迁移 030）：验收通过后 `acceptancePass.finalizeAfterPass`
  自动生成 `reconciliation(scope_type='stage')` 草稿；C 端
  `GET /projects/:id/stages/:sid/settlement` 也会在不存在时补生成。
  主工长用 `POST /projects/:id/stages/:sid/settlement/submit` 提交，
  确认仍复用 `POST /reconciliations/:id/confirm` —— 在该事务里同时完成
  「当前阶段 `settled` + 下一阶段 `active`」（AC-S08），不能分成两次提交。
  确认前会复核流水与付款节点快照，提交后金额或明细变了就返回 409 要求重新提交。
  阶段异议会把 `project_stage.gate_status` 置为 `disputed`，下一阶段继续锁定；
  重新提交时旧异议标记为已处理但保留说明（AC-S07）。
  不要为了「让下一阶段赶紧解锁」在验收通过时直接写 `settled`，也不要让周期对账
  `scope_type='period'` 的确认顺手推进阶段门禁 —— 两种单据的范围不同（AC-S15）。
- **项目竣工总报告是项目级归档，不是验收报告的替代品**：只在项目状态为
  `finished` / `archived` 后生成；汇总阶段验收、验收记录、付款节点与账务。
  C 端仅业主 / 工长可看（报告含账务，监理不可见），后台按 dataScope 访问；
  平台只读排障窗口可下载但不能生成。生成失败只标记 `failed` 并允许重试，
  不影响项目状态。报告存 `project_completion_report`（迁移 028，一个项目一份），
  下载与验收报告一样使用 2 小时 HMAC 签名 URL，不挂登录态。
- **后台验收报告查询是只读的**：网页项目详情「验收报告」tab 通过
  `GET /admin/projects/:id/acceptances` 列出该项目全部验收单（含草稿 / 流转中），
  走 `projectAccess` 的数据权限；已通过且 PDF 生成成功的单子返回 2 小时签名链接，
  「下载报告」直接打开。报告生成失败时后台不提供重试入口，重试仍在 C 端验收详情。
- **验收签名默认是手写签名，不是可靠电子签**：`ESIGN_ENABLED=false`（默认）时
  走 canvas 手写签名，只作为项目内部验收确认记录，**不具备法律效力**；生产环境
  同样允许，但必须保持 `ESIGN_LEGACY_SIGNING=true`。设置 `ESIGN_ENABLED=true`
  并配置服务商后才改用可靠电子签，此时不再接受手写兜底。不要恢复
  「生产必须启用电子签、否则拒绝启动」的旧门禁。
- **验收详情依赖的扩展字段**：`getDetail` 额外返回 `projectAddress`、`hasSupervisor`、
  `round`、`stageProgress`、`stageGateStatus`、`waitingHours`。无监理项目把「监理审核」
  显示为「已跳过」，不要画成一个真实环节。
- **业主签名是一次性 multipart 提交**：字段名固定 `signature`；签名与「通过」必须
  在同一个请求里完成，不能拆成「先签名、再确认」两步。驳回原因必填，照片字段走
  `photos`，服务端按字段名区分。

### 小程序管理员（90）

完整说明：[docs/constraints/10-mini-admin.md](docs/constraints/10-mini-admin.md)

- [90. 小程序管理员是独立后台身份，不是项目角色](docs/constraints/10-mini-admin.md#c90)

### 现场签到（91）

完整说明：[docs/constraints/11-visit.md](docs/constraints/11-visit.md)

- [91. 签到照片先暂存、提交时水印；记录只追加、当日唯一、阈值快照](docs/constraints/11-visit.md#c91)

### 主业主与临时业主（92）

完整说明：[docs/constraints/12-primary-owner.md](docs/constraints/12-primary-owner.md)

- [92. 主业主与临时业主：同一个 role，项目内 owner_type 区分；重要决策仅主业主](docs/constraints/12-primary-owner.md#c92)

### 可靠电子签名（93）

完整说明：[docs/constraints/13-esign.md](docs/constraints/13-esign.md)

- [93. 可靠电子签名（可选）：回调不是事实、验签+哈希+实名+行锁缺一不可；关闭时走手写签名](docs/constraints/13-esign.md#c93)

### 实名认证（94）

完整说明：[docs/constraints/14-real-name.md](docs/constraints/14-real-name.md)

- [94. 实名认证：证件号不落库；本地校验 ≠ 公安库核验，等级必须如实标注](docs/constraints/14-real-name.md#c94)

## 尚未确定 / 需注意

- **微信凭据与 `WX_MOCK`**：本机 `.env` 已配置真实 AppID / Secret（AppID 同时写进
  `miniapp/src/manifest.json`）。**Secret 只存在于 gitignored 的 `.env`，不要提交、
  不要回显**；生产环境必须换成该部署自己的凭据。
  两种模式按调试目标切换，改完 `.env` 必须重启后端：
  - `WX_MOCK=true`：H5 预览、微信开发者工具 mock 登录、`npm run smoke` 都依赖它
    （客户端用 `DEV_WX_CODE` / `DEV_MP_WX_CODE` 派生稳定账号）；
  - `WX_MOCK=false`：真机 / 真实微信账号联调，`uni.login` 的 code 才会被微信校验。
  生产环境 `WX_MOCK=true` 会被启动自检直接拒绝。
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
