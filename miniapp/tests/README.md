# 小程序自动化测试

目录分两层：

```text
tests/e2e/   H5 端 Playwright 回归（可在 Linux CI 直接跑）
tests/mp/    微信开发者工具 / 真机自动化（miniprogram-automator）
```

两者共用 `src/pages/**` 的页面代码与 `/api/v1` 接口。H5 覆盖业务界面回归，
`tests/mp` 覆盖微信运行时、分包、原生能力等 H5 不具备的部分。

## 1. H5 端 E2E

### 前置

- Node.js >= 20
- 本机安装 Chrome（或设置 `CHROME_PATH`）
- 后端 `.env` 指向**开发库**，`WX_MOCK` 可用
- 首次运行前建好数据库并执行过 `npm run seed`

### 运行

```bash
cd miniapp
npm install            # 安装 playwright-core
npm run test:e2e:h5
```

执行器会自动：

- 检查后端 `http://127.0.0.1:3000/api/v1/health`，未启动则用
  `NODE_ENV=development WX_MOCK=true node src/server.js` 拉起；
- 检查 H5 `http://localhost:5173`，未启动则拉起 `npm run dev:h5`；
- 用 Node 内置测试运行器跑 `tests/e2e/*.test.js`；
- 结束后关闭本次拉起的服务。

安全限制：`E2E_BASE_URL` 只允许本机地址；确认要打远程环境时必须显式设置：

```bash
E2E_ALLOW_REMOTE=1 E2E_BASE_URL=https://... npm run test:e2e:h5
```

### 已覆盖

- 开屏动画结束后进入登录页；
- 管理员登录入口只存在于登录页；
- 微信登录按钮独立 loading；
- 登录后进入项目页，C 端不出现管理入口；
- 管理员一键登录、进入管理端「我的」、退出管理端过场。

深度业务用例（项目、汇报、验收、记账）建议按同样的 `page.locator(...)`
方式补充。选择器优先使用页面已有的稳定 class，例如 `.login-card`、
`.wechat-btn`、`.logout-btn`、`.exit-overlay`。

## 2. 微信端 E2E

### 前置

```bash
cd miniapp
npm install --save-dev miniprogram-automator
npm run dev:mp-weixin
```

微信开发者工具需要：

1. 打开 `dist/dev/mp-weixin`；
2. 设置 → 安全设置 → 开启「服务端口」；
3. 后端以 `NODE_ENV=development WX_MOCK=true` 运行。

### 运行

**Linux / 已手动开启自动化端口（推荐）**

先找到 IDE 的 HTTP 端口（本机是一个 `.cli` 文件，内容就是端口号）：

```bash
cat ~/.config/wechat-devtools/*/Default/.cli
```

然后用 CLI 对 dev 包开启自动化：

```bash
wechat-devtools-cli --electron --port=<IDE_HTTP_PORT> \
  auto --project="$PWD/dist/dev/mp-weixin" \
  --auto-port=9420 --trust-project
```

再连接自动化端口执行测试：

```bash
MP_AUTOMATION_WS=ws://127.0.0.1:9420 npm run test:e2e:mp
```

**Mac / Windows**

```bash
WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" \
MP_PROJECT_PATH="$PWD/dist/dev/mp-weixin" \
npm run test:e2e:mp
```

Windows 或自定义安装路径时，把 `WECHAT_DEVTOOLS_CLI` 换成对应的 `cli.bat` / `cli` 路径。

连接模式（`MP_AUTOMATION_WS`）只断开自动化连接，不会关闭你正在使用的开发者工具项目；
launch 模式才会在测试结束后关闭项目。

用例开始时会执行 `wx.clearStorageSync()`，保证每次都从登录页开始，不依赖上一次的登录态。

### 已覆盖

- 启动开屏；
- 登录页管理员入口存在；
- 点击微信登录出现独立 spinner；
- 登录后进入项目页；
- C 端项目页不出现管理入口。

### 继续扩展

`miniprogram-automator` 的常用 API：

```js
const page = await miniProgram.reLaunch('/pages/projects/index')
const button = await page.$('.wechat-btn')
await button.tap()
const current = await miniProgram.currentPage()
```

原生能力（定位、相机、手机号授权）无法在自动化中完全模拟，仍需保留真机手工回归。
需要正式 CI 上传时，再引入 `miniprogram-ci`，用私钥生成预览/上传版本；
它不负责 UI 点击，UI 自动化仍用 automator。

## 3. 与后端测试的分工

- `server/`：`npm run test:all` + `npm run smoke` 覆盖接口、权限、多租户、账务、验收、结算；
- `miniapp/tests/e2e`：覆盖页面路由、登录态、动画与关键交互；
- `miniapp/tests/mp`：覆盖真实微信运行时与分包加载。

三层都通过后，才建议上传体验版做真机回归。
