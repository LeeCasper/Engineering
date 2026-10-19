# 工程宝 · 微信小程序（uni-app + Vue 3）

C 端小程序。当前完成 **登录页** 与 **角色选择页** 的 1:1 还原，并接通已有的
微信登录、手机号绑定、我的项目、项目邀请确认接口；项目详情（进度 / 验收 / 记账）
是下一批页面。

## 设计来源

Stitch 项目 `7202629267044826058`：

| 页面 | Screen ID | 说明 |
| --- | --- | --- |
| 工程宝登录界面 - 1:1还原版 | `0962713247df4b88a9ac92719e58a3da` | `pages/login/index` |
| 工程宝角色选择界面 - 1:1还原版 | `cc017677044b41e8a7e83639286df310` | `pages/role/index` |

原始 HTML 与截图保留在 `design-refs/`，仅作对照，不参与构建。
设计令牌来自仓库根目录的 `DESIGN.md`（Stitch 导出的同一份）。

## 运行

### 方式一：HBuilderX

1. 用 HBuilderX 打开 `miniapp/` 目录；
2. 运行 → 运行到小程序模拟器 → 微信开发者工具；
3. 微信开发者工具需要在「详情 → 本地设置」勾选
   **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**。

### 方式二：CLI

```bash
cd miniapp
npm install
npm run dev:mp-weixin   # 产物在 dist/dev/mp-weixin，用微信开发者工具导入
npm run dev:h5          # H5 预览（登录会走 mock code）
```

## 后端地址

`src/config.js` 默认 `http://127.0.0.1:3000/api/v1`。真机调试请改成局域网 IP，
或用环境变量：

```bash
VITE_API_BASE=http://192.168.1.20:3000/api/v1 npm run dev:mp-weixin
```

生产环境必须是已在小程序后台配置的 HTTPS 域名。

## 登录流程

后端 C 端身份是**微信 openid**，没有短信验证码登录接口。因此：

- 登录页的「登录 / 微信登录」按钮：`uni.login` → `POST /auth/login`；
- 手机号输入框：开发环境（后端 `WX_MOCK=true`）会顺带调
  `POST /auth/bind-phone` 绑定手机号，方便被邀请人直接看到 pending 邀请；
- 「获取验证码」如实提示「短信登录暂未开通」—— 不做一个永远收不到验证码的假倒计时；
- 真实环境应使用微信 `getPhoneNumber` 授权（需要真实 AppID），后续在「我的」里补绑定入口。

H5 预览使用固定开发 code `gongchengbao-h5-dev`，后端 mock 会派生出稳定 openid，
反复刷新仍是同一个账号。

## 角色选择页的语义

**这个页面选择的是「默认视角」，不是权限声明。** 工程宝的身份由
`project_member` 按项目判定：同一个人可以在 A 项目当工长、在 B 项目当业主。
选择结果只存在本地（`gc_preferred_role`），用于后续页面的排序与文案；
真正的可见性、可写性全部由后端决定。

## 与设计稿的两处刻意差异

1. **不绘制假的 iOS 状态栏与微信胶囊。** 设计稿里的「9:41 / 信号 / 电池」
   和右上角胶囊是手机壳示意；真机上系统状态栏与微信原生胶囊已经存在。
   页面用 `padding-top: var(--status-bar-height)` 对齐安全区，导航行右侧
   预留了胶囊宽度。
2. **SVG 一律栅格化为 PNG。** 微信小程序各端对 SVG 的支持不一致，
   背景插画、天际线、图标由 `scripts/gen-assets.js` 用 sharp 生成 3x PNG。
   角色卡实景图保留原始 JPG（每张 50–80KB），左侧羽化用页面上的白色渐变
   覆盖层实现 —— 带 alpha 的大 PNG 每张近 2MB，会直接把主包顶过微信 2MB 限制。

## 资源生成

设计稿里的内联 SVG 与实景图通过脚本转成小程序静态资源：

```bash
node scripts/gen-assets.js
```

脚本复用 `../server/node_modules/sharp`，不需要额外安装依赖。

## 目录

```
src/
├── api/           请求封装与接口（auth / project）
├── config.js      API 地址、角色清单、状态文案
├── pages/
│   ├── login/     登录页（1:1）
│   ├── role/      角色选择页（1:1）
│   ├── projects/  我的项目 + 待确认邀请（功能桥接页）
│   └── legal/     用户协议 / 隐私政策
├── static/images/ 由设计稿生成的 PNG
├── store/         登录态与本地偏好
├── App.vue
├── pages.json
└── manifest.json
```

## 下一步

- 项目详情：进度时间轴、汇报提交、验收、记账；
- 消息中心与订阅授权；
- 真实微信 `getPhoneNumber` 绑定；
- 订阅消息模板 ID 配置后的推送联调。
