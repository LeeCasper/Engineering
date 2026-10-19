# 工程宝

装修工程协同系统。以项目为中心，把「进度汇报 → 多级验收 → 阶段结算 → 推进门禁」串成闭环。

- **C 端**：微信小程序（uni-app）—— 工长 / 监理 / 业主
- **B 端**：Web 管理后台（Vue3 + Element Plus，基于 Soybean Admin）—— 平台运营 / 租户管理员 / 项目管理员

需求见 [`需求文档.md`](./需求文档.md)（v2.4）。开发约定与踩坑记录见 [`CLAUDE.md`](./CLAUDE.md)。

## 核心机制

系统的差异化在于最后一步 —— 它不只记录工程，还**约束工程的推进节奏**：

```
建档 → 汇报进度 → 阶段完工 → 发起验收 → 监理审核 → 业主确认 + 电子签名
                                                    ↓
                                    解锁本阶段付款节点 → 工长线下收款 → 登记收入
                                                    ↓
                                          系统生成阶段结算单 → 业主对账
                                                    ↓
                                    无异议 → 本阶段「已结清」→ 解锁下一阶段
```

阶段未结清则下一阶段锁定：**发起验收一律阻断**，进度汇报是否阻断取决于门禁强度
（默认「标准」= 放行汇报、阻断验收，理由见需求文档 §4.7.3）。

> 记账模块**不含任何支付功能**，款项一律走线下转账。系统只做三件事：记账、付款节点提醒、双方对账确认。

## 目录结构

```
Renovation/
├── 需求文档.md          产品需求（v2.4，含 SaaS 多租户与双登录入口）
├── CLAUDE.md            开发约束与踩坑记录
├── docs/                关键约束（按主题拆分）
├── server/              后端服务（Express + JavaScript + MySQL 8 + Redis）
├── admin/               Web 管理后台（Vue3 + Element Plus）
└── miniapp/             微信小程序（uni-app）
```

## 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20 | 开发用 22.23 |
| MySQL | 8.0 | 需要 `utf8mb4` 与生成列支持（8.0.13+） |
| Redis | 7+ | 缓存、验证码、限流；可 `CACHE_DRIVER=memory` 绕过 |

## 快速开始

### 1. 准备数据库

```sql
CREATE DATABASE renovation_dev  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE renovation_test DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'renovation'@'localhost' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON renovation_dev.*  TO 'renovation'@'localhost';
GRANT ALL PRIVILEGES ON renovation_test.* TO 'renovation'@'localhost';
FLUSH PRIVILEGES;
```

### 2. 配置后端

```bash
cd server
npm install
cp .env.example .env
# 编辑 .env：
#   DB_PASSWORD      —— 数据库密码
#   JWT_*_SECRET     —— openssl rand -hex 32
#   DOOR_CODE_KEY    —— node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#                       **必填**：门锁密码用 AES-256-GCM 可逆加密，生产环境缺它则拒绝启动。
#                       密钥丢失 = 所有已存密码永久不可恢复，因此要与数据库备份分开保管
```

### 3. 建表与灌种子数据

```bash
npm run migrate   # 执行全部迁移（38 张业务表）
npm run seed      # 默认租户 + 租户管理员 + 平台运营账号 + 内置模板 + 系统配置 + 内容页骨架
```

> 种子里的「用户协议 / 隐私政策」是**未发布的骨架**，需在后台填写正式文本后再发布。
> 直接发布占位内容比不发布更危险 —— 它会让「我们已经有隐私政策了」变成一句看起来成立的话。

### 4. 启动

```bash
npm run dev
curl http://127.0.0.1:3000/api/v1/health
# {"code":0,"message":"success","data":{"checks":{"database":true,"cache":true}}}
```

## 测试

```bash
cd server
npm test                 # 单元测试（纯逻辑，不碰数据库）
npm run test:integration # 集成测试（打真实 MySQL，串行执行）
npm run test:all         # 全部
npm run smoke            # 端到端冒烟：建档 → 汇报 → 验收 → 记账 → 消息 → 个人中心 → 注销 → 门锁密码 → SaaS 多租户
```

> 集成测试在 `NODE_ENV=test` 下连 `renovation_test`，并在开始前**删库重建**。
> 两个库名不要配成同一个。
>
> 冒烟脚本一次运行发一百多个请求，会撞上 §8.2 的限流（后台账号 60 次/分钟）。
> 脚本内已对 429 自动退避重试，因此连跑两次时第二次会明显变慢 —— 那是正常的。

当前规模：**797 条自动化测试**（单测 + 集成）+ **123~124 项端到端冒烟断言**，125 条路由，38 张业务表。

## 小程序（`miniapp/`）

uni-app + Vue 3。已完成 **登录页** 与 **角色选择页** 的 1:1 还原，并接通
微信登录、手机号绑定、我的项目与邀请确认。

```bash
cd miniapp
npm install
npm run dev:mp-weixin   # 用微信开发者工具导入 dist/dev/mp-weixin
npm run dev:h5          # 浏览器预览（固定 dev code，走后端 mock 登录）
```

设计稿来自 Stitch 项目 `7202629267044826058`，原始 HTML 与截图保留在
`miniapp/design-refs/`。微信开发者工具需勾选「不校验合法域名」才能访问
`http://127.0.0.1:3000`。详见 `miniapp/README.md`。

## 管理后台（`admin/`）

基于 [Soybean Admin Element Plus 版](https://github.com/soybeanjs/soybean-admin-element-plus)
（Vue 3 + Vite + TypeScript + Element Plus + UnoCSS，MIT）。已交付基座、登录与项目模块：

- **平台运营与租户管理员使用两个登录地址**：`/login` 与 `/t/<tenantCode>/login`；
- 账号密码登录（图形验证码）、首登强制改密；
- 角色菜单：平台运营 / 租户管理员 / 项目管理员；
- 工作台、项目列表（筛选 / 分页 / 新建 / 编辑 / 状态流转 / 归档 / 软删除 / 批量操作 / 导出）；
- 项目详情：概览、阶段与工序、成员与邀请、付款节点；
- 平台租户管理：开通租户并生成专属管理地址、配额与到期、停用 / 恢复 / 退租；
- 阶段模板、账号管理、系统配置、操作/登录日志、内容页、意见反馈、排障授权；
- 我的导出：大数据量自动转后台生成，完成后下载；
- 平台只读排障：租户授予窗口后，平台可从租户列表「只读进入」查看项目与成员。

```bash
cd admin
pnpm install
pnpm dev     # http://127.0.0.1:9527，开发时代理 /proxy-default -> 127.0.0.1:3000
pnpm build   # 产物在 dist/，生产环境需把 /api/v1 反向代理到后端
```

开发环境验证码会由后端回显答案（`NODE_ENV=development`），登录页直接显示；
生产环境不会返回该字段。设计令牌沿用 `DESIGN.md` 的品牌蓝 `#165DFF`。
阶段性验收截图保存在 `admin/screenshots/`。详见 `admin/README.md`。

## 交付进度

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M1 ~ M12 | 基建、双端认证、项目与成员、阶段模板、进度、验收、记账、消息中心、操作日志、系统配置、个人中心、门锁密码 | ✅ |
| M13 | **SaaS 多租户**：平台 → 租户 → 项目三层隔离、租户生命周期、排障授权、C 端跨租户 | ✅ |
| — | Web 管理后台页面（`admin/`） | ✅ 基座 / 双登录入口 / 项目 / 平台租户 / 阶段模板 / 账号 / 配置 / 日志 / 内容页 / 反馈 / 排障授权；数据看板按约定属 V1.2 |
| — | 微信小程序（`miniapp/`） | 🚧 登录 / 角色选择 1:1 还原，我的项目 / 邀请确认已接通 |

**后端 M1~M13 与 Web 管理后台页面已全部完成。** 剩余的是 C 端小程序的其余页面（项目详情、进度、验收、记账、消息）。
数据看板（AC-AD36~43）、路线规划与现场签到（§4.6）明确属于 V1.2，不在本轮。

> 种子会创建两个后台账号：平台运营 `platform / Platform123456`（从 `/login` 登录）
> 与租户 #1 的 owner `admin / Admin123456`（从 `/t/default/login` 登录）。
> 两者**首次登录都强制改密**；生产环境请通过
> `SEED_ADMIN_PASSWORD` / `SEED_PLATFORM_PASSWORD` 覆盖初始密码。

详见 `CLAUDE.md` 的「当前进度」表与「关键约束」（踩坑清单）。

### 已确认的能力边界

拿到真实凭据前**无法完成**的部分，不做假的实现：

| 项 | 缺什么 | 现状 |
| --- | --- | --- |
| 微信订阅消息推送 | AppID / Secret 与已审核的模板 ID | 站内消息完整可用；推送留有一个明确的空位（`notification.service.js`），后台已可配置模板 ID |
| 微信真机登录 | 同上 | `WX_MOCK=true` 用 code 派生稳定 openid，仅限开发环境（生产环境启动即拒绝） |
| 地址地理编码 | 腾讯地图 Key | 自动降级为后台在地图上手工拾取坐标（AC-AD54） |
| 视频时长校验 | 服务端无 ffprobe | 时长由客户端上报，属 UX 约束而非安全边界 |

### 安全须知（部署前必读）

| 项 | 说明 |
| --- | --- |
| **`DOOR_CODE_KEY`** | 门锁密码的加密密钥。生产环境未配置则**拒绝启动**。与数据库备份**分开保管** —— 同库备份等于没做密钥分离 |
| **门锁密码的能力边界** | 系统无法阻止拿到密码的人开门，也无法感知有人开门；「失效」只作用于系统内的可见性，不改变实体锁上的密码。**这不是安防方案**，是装修期间的便利工具。该说明随接口一起下发给前端，必须展示给业主 |
| **`WX_MOCK`** | 生产环境开启即拒绝启动（谁都能伪造 openid 登录成他人） |
| **管理员看不到门锁密码** | 刻意的：后台管理员没有任何业务理由需要知道业主家门锁密码，给他开这个口子等于把平台内部人员也纳入泄露面 |

## 许可

私有项目。
