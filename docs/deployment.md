# CI / CD

本文件描述持续集成与持续部署的实际链路。生产服务器的路径、端口、备份与证书
细节仍以服务器上的 `/srv/renovation/DEPLOY-NOTES.md` 为准。

## 持续集成（GitHub Actions）

工作流：`.github/workflows/ci.yml`。触发条件：push 到 `main`、任意 PR、手动触发。

| Job | 内容 |
| --- | --- |
| `server` | 起 MySQL 8 服务，安装中文字体，跑单元测试 + 集成测试（集成测试会重建测试库） |
| `admin` | `pnpm typecheck` + `pnpm build` |
| `miniapp` | `npm run build:mp-weixin`（带生产 API 基址） |

CI 不需要任何仓库 Secret：数据库与密钥都用 CI 专用假值。同一分支连续 push 时，
旧运行会被 `concurrency` 取消，避免多个集成测试同时 DROP 同一个测试库。

小程序产物不随 CD 发布：构建成功只代表能打包，正式发布仍需在本机用微信
开发者工具上传并提交审核。

### 测试报告与群通知

- server job 用 Allure reporter 产出 `server/allure-results`，生成 HTML 后作为
  `allure-report` artifact 上传；**测试失败时也会上传**，方便直接看失败用例。
- `pages` job 把报告推到 `gh-pages` 分支。首次使用需要在 GitHub →
  Settings → Pages 选择「Deploy from a branch → gh-pages / root」，之后地址是
  `https://leecasper.github.io/Engineering/`。私有仓库的 Pages 需要套餐支持，
  不可用时 `pages` job 会失败但已标 `continue-on-error`，不影响 CI 结论。
- `notify` job 通过企业微信群机器人推送结果与报告链接，需要仓库 Secret
  `WECOM_WEBHOOK`（在群机器人设置里复制完整 webhook 地址）。没配置时自动跳过。
- `allure-vitest` 必须固定在 **3.0.0**：更新的版本只实现了 vitest 3 的 reporter
  API，在当前的 vitest 2.1.9 上不报错但也不产出结果。

### 几个不能随手改的事

- **admin 的 pnpm 必须是 12**：`pnpm-workspace.yaml` 里的 `allowBuilds` /
  `shamefullyHoist` 只有 pnpm 10 以上才识别。pnpm 9 能装上 workspace 包，但根
  `node_modules` 不做提升，`axios` / `@unocss/core` 这些直接 import 全部解析失败。
- **CI 的时区必须是 Asia/Shanghai**：业务约定所有时间是上海墙上时间。
  job 设 `TZ`，并把 MySQL 全局 `time_zone` 设为 `+08:00`（官方镜像默认 UTC）。
  否则锁定时间、提醒窗口、导出任务清理都会偏 8 小时。
- **`migrate.js --fresh` 会自己建库**：它先建立不带 database 的连接再 DROP/CREATE，
  因此 CI 不需要额外创建 `renovation_test`；也不要改回「先连库再删库」，
  库不存在时连接会直接失败。
- **`admin/build/` 与 `admin/.env` 必须入库**：前者是 Vite 插件源码，后者是公开的
  构建变量。`.gitignore` 只忽略仓库根目录的 `/build/` 和 `server/.env` 等真实密钥。

## 持续部署（服务器拉取式）

服务器上的 `renovation-deploy.timer` 每 5 分钟执行一次
`/usr/local/bin/renovation-deploy.sh`：

1. `git fetch origin main`（含 tags），HEAD 没变就退出（幂等，可随时手动重跑）
1.5 **CI 闸门**：只有带 `ci-green/<完整 sha>` 标签的提交才继续。这个标签由 CI 的
    `mark-green` job 在三个 job 全绿后自动打上；标签还没出现说明 CI 仍在跑或失败，
    **保留线上旧版本**，等下一轮 timer 再看
2. `git reset --hard origin/main`（`.env` 与 uploads 不被跟踪，不受影响）
3. 仅当 `server/package*.json` 变化时执行 `npm ci --omit=dev`
4. 执行 `npm run migrate`（迁移本身幂等）
5. 仅当 `admin/` 变化或 `dist` 缺失时安装依赖并构建管理后台
6. 仅当 `server/` 变化时重启 `renovation-api`，并轮询 `/health` 确认恢复

任一步失败都会在重启之前退出，线上继续跑旧进程。部署日志：
`/var/log/renovation/deploy.log`。

### 为什么不是 GitHub Actions 推送部署

服务器本来就有仓库的只读访问权限，拉取式部署不需要把 SSH 私钥放进 GitHub
Secrets，也不需要维护额外的部署账号。代价是部署延迟最多一个 timer 周期，
对当前项目可以接受。

如果以后需要「合并即部署」的实时性，再改成 GitHub Actions + 部署密钥即可，
脚本本身可以复用。

### 闸门与紧急绕过

- `mark-green` job 需要 `GITHUB_TOKEN` 有写权限：GitHub → Settings → Actions →
  General → Workflow permissions 选「Read and write permissions」。权限不足时
  这个 job 会红，表现为「CI 绿了但线上不更新」。
- 紧急情况（例如 CI 环境故障但必须发布）可以手工打标签绕过闸门：

  ```bash
  git tag ci-green/$(git rev-parse HEAD) HEAD
  git push origin ci-green/$(git rev-parse HEAD)
  ```

  打完标签后，下一轮 timer 会自动部署。**这只应在确认代码可上线时使用。**

### 安装 / 重装

```bash
# 在本机（仓库根目录）
scp deploy/renovation-deploy.sh root@bzg.yanxinn.com:/usr/local/bin/renovation-deploy.sh
ssh root@bzg.yanxinn.com 'chmod 755 /usr/local/bin/renovation-deploy.sh'
scp deploy/renovation-deploy.service deploy/renovation-deploy.timer \
  root@bzg.yanxinn.com:/etc/systemd/system/
ssh root@bzg.yanxinn.com 'systemctl daemon-reload && systemctl enable --now renovation-deploy.timer'

# 手动触发一次
ssh root@bzg.yanxinn.com 'systemctl start renovation-deploy.service'
tail -f /var/log/renovation/deploy.log
```

### 回滚

CD 不做自动回滚。出问题时把 main 指回上一个提交（`git revert` 后 push），
timer 会在一个周期内自动部署回去；急用时直接 SSH 到服务器
`git reset --hard <旧提交>` 后手动执行脚本。
