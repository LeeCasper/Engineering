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

## 持续部署（服务器拉取式）

服务器上的 `renovation-deploy.timer` 每 5 分钟执行一次
`/usr/local/bin/renovation-deploy.sh`：

1. `git fetch origin main`，HEAD 没变就退出（幂等，可随时手动重跑）
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
