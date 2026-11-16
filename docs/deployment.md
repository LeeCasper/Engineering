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
- **国内网络优先用生产域名下的报告**：部署脚本会把 `gh-pages` 同步到
  `/srv/renovation/reports/latest`，nginx 暴露为 `https://bzg.yanxinn.com/reports/`。
  企业微信通知里的链接用的是这个地址；`github.io` 在不少网络下打不开。
- `notify` job 通过企业微信群机器人推送结果与报告链接，需要仓库 Secret
  `WECOM_WEBHOOK`（在群机器人设置里复制完整 webhook 地址）。没配置时自动跳过。
- `allure-vitest` 必须固定在 **3.0.0**：更新的版本只实现了 vitest 3 的 reporter
  API，在当前的 vitest 2.1.9 上不报错但也不产出结果。
- 企业微信消息包含：状态（✅/❌）、提交标题、三个 job 各自的结果、通过 / 失败 /
  跳过数、Allure 报告链接、运行日志链接。webhook 返回错误码时只记日志，
  不会把 CI 判成失败。

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
1.6 **隔离闸门**：这个提交上次部署失败并回滚过就跳过，不再重试（见下文「失败与回滚」）
2. `git reset --hard origin/main`（`.env` 与 uploads 不被跟踪，不受影响）
3. 仅当 `server/package*.json` 变化时执行 `npm ci --omit=dev`
4. 执行 `npm run migrate`（迁移本身幂等）
5. 仅当 `admin/` 变化或 `dist` 缺失时安装依赖并构建管理后台
6. 仅当 `server/` 变化时重启 `renovation-api`，并轮询**就绪探针**
   `/api/v1/health` 确认恢复

任一步失败都会在重启之前退出，线上继续跑旧进程。部署日志：
`/var/log/renovation/deploy.log`。

### 失败与回滚

探针用的是 `/api/v1/health`（会真的 ping MySQL，DB 不可用返回 503），不是只证明
进程活着的 `/health`。**不要换回 `/health`**，否则「进程起来了但连不上库」会被判为
部署成功。

新版本探活连续失败（默认 20 次 × 2 秒）时，脚本会：

1. 把失败提交写进 `/srv/renovation/.failed-commit`；
2. `git reset --hard` 到「上一次成功部署的提交」（没有标记时退回部署前的工作区）；
3. 若回滚跨越了 `server/package*.json` 或 `admin/` 变化，重装依赖 / 重建管理后台；
4. 重启并再次探活；
5. 无论回滚成功与否都以非零退出 —— systemd 把这次部署标成 failed，日志里能查到。

日志结尾一定会写出**结论行**，不要只靠数「就绪探针失败」出现几次来推断：

| 结局 | 日志结论行 |
| --- | --- |
| 回滚成功、服务恢复 | `已回滚到 <sha> 并探活通过，服务恢复；失败提交 <sha> 已隔离` |
| 回滚后仍不健康 | `回滚后仍不健康：服务不可用，等待人工介入（回滚目标 …，失败提交 …）` |
| 没有可回滚的提交 | `无法回滚：没有可用的历史提交，提交 <sha> 已隔离，服务不可用，等待人工介入` |

企微告警的正文直接链到 `deploy.log`，所以结论必须落在日志里 —— 只写在告警里的话，
点进日志的人看不到脚本最后停在哪。

回滚成功后脚本会把 `.deployed-commit` 写成回滚目标。**隔离标记保留**，`origin/main`
没变时 timer 不会再装一遍同一份坏代码（否则每 5 分钟重启一次，服务持续不可用）。
出现新的 main 提交，或人工清空 `rm /srv/renovation/.failed-commit`（也可
`DEPLOY_FORCE=1` 临时绕过）后恢复自动部署。

**迁移不回滚**：迁移是前向的，代码回滚后新库结构仍然保留。因此回滚只恢复代码、
依赖与后台产物；如果某次迁移本身不可逆，回滚后需要人工评估数据库状态。

### 部署告警

失败路径（包括脚本中途被 `set -e` 打断）会推企业微信群机器人，复用 CI 的
`WECOM_WEBHOOK`。在服务器上建一个 600 权限的环境文件：

```bash
sudo install -d -m 755 /etc/renovation
sudo sh -c 'umask 077; echo "WECOM_WEBHOOK=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." \
  > /etc/renovation/deploy.env'
sudo chmod 600 /etc/renovation/deploy.env
```

`renovation-deploy.service` 通过 `EnvironmentFile=-/etc/renovation/deploy.env` 注入；
文件不存在或没配 webhook 时脚本只记日志，不影响部署结论。手动执行脚本时也会读取
同一个文件。

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

# 告警文件（含密钥，600；没有它部署仍能跑，只是不告警）
sudo install -d -m 755 /etc/renovation
sudo sh -c 'umask 077; echo "WECOM_WEBHOOK=<企业微信群机器人地址>" > /etc/renovation/deploy.env'
sudo chmod 600 /etc/renovation/deploy.env

# 手动触发一次
ssh root@bzg.yanxinn.com 'systemctl start renovation-deploy.service'
tail -f /var/log/renovation/deploy.log
```

> 脚本改动**只有重新 scp 才会生效**：CD 只对 `APP_DIR` 做 `git reset`，
> 不会把 `deploy/` 下的文件复制到 `/usr/local/bin` 或 `/etc/systemd/system`。

### 改部署脚本后怎么验

```bash
bash -n deploy/renovation-deploy.sh
bash deploy/test-deploy-lib.sh        # 纯决策逻辑（该不该部署 / 隔离 / 回滚目标 / 告警转义）
bash deploy/test-deploy-rollback.sh   # 沙箱模拟：探活失败 → 回滚 → 隔离 → 新提交恢复；回滚目标也不健康时写结论
```

两个测试都不需要 root、不碰真实服务和数据库：`test-deploy-rollback.sh` 用 stub 替换
`systemctl` / `npm` / `pnpm` / `curl`，在临时 git 仓库里跑完整链路。

### 回滚

**新版本探活失败会自动回滚**（见「失败与回滚」）。需要人工回滚时有两种方式：

- 常规：`git revert` 出问题的提交后 push，CI 绿了 timer 会在一个周期内部署回去；
- 紧急：SSH 到服务器 `git reset --hard <旧提交>` 后手动执行
  `/usr/local/bin/renovation-deploy.sh`，并确认 `.deployed-commit` 与工作区一致。

如果线上是「代码没变但库结构被迁移改坏」这类不可逆问题，自动回滚帮不上忙，
需要按备份恢复数据库 —— 迁移不回滚是刻意选择。
