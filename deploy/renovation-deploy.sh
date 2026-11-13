#!/usr/bin/env bash
#
# 服务器端拉取式部署（CD）。
#
# 由 renovation-deploy.timer 每 5 分钟调用一次，也可以手动执行。
# 判定标准只有一个：origin/main 的 HEAD 变了就部署，没变就立即退出。
# 连续执行是安全的 —— flock 保证同一时间只有一个部署在跑。
#
# 为什么是「服务器拉取」而不是「GitHub Actions 推送」：
# 这台服务器已经有仓库的只读访问权限，不需要把部署私钥再放进 GitHub Secrets；
# 代价是部署延迟最多一个 timer 周期，对当前项目可以接受。
#
# 部署顺序刻意做成「先代码、再依赖、再迁移、最后重启」：
# 任何一步失败都会在重启之前退出，线上继续跑旧进程，不会出现
# 「代码已是新的、依赖还是旧的」这种半截状态。

set -euo pipefail

APP_DIR=${APP_DIR:-/srv/renovation/app}
BRANCH=${BRANCH:-main}
OWNER=${OWNER:-renovation}
LOCK_FILE=${LOCK_FILE:-/var/lock/renovation-deploy.lock}
# 记录「上一次成功部署到的提交」。它不是 git 跟踪的文件，避免 reset 时被清掉。
# 上一轮如果在 reset 之后、重启之前失败，工作区已经是新代码、进程却还是旧的；
# 只比较 OLD..NEW 会漏掉这段差异，导致后端一直不重启。用它作为 diff 的起点。
MARKER_FILE=${MARKER_FILE:-/srv/renovation/.deployed-commit}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3100/health}
NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=2048}

log() { echo "[deploy $(date '+%F %T')] $*"; }

# 同一时间只允许一个部署。抢不到锁说明上一轮还在跑，本轮直接退出
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "已有部署在运行，本轮退出"
  exit 0
fi

cd "$APP_DIR"

# 仓库与依赖都属于 renovation。以 root 执行 git/npm 会把源码改成 root 属主，
# 之后 renovation 再跑 npm 就会 permission denied
run_as_owner() { sudo -u "$OWNER" -- "$@"; }

OLD=$(run_as_owner git -C "$APP_DIR" rev-parse HEAD)
run_as_owner git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
NEW=$(run_as_owner git -C "$APP_DIR" rev-parse "origin/$BRANCH")
DEPLOYED=$(cat "$MARKER_FILE" 2>/dev/null || true)

# 「已是新代码」不等于「已经部署完成」：上一轮可能在 reset 之后、重启之前失败。
# 只有工作区（OLD）与成功标记（DEPLOYED）都等于 NEW，才算真的没事可做
if [ "$OLD" = "$NEW" ] && [ "$DEPLOYED" = "$NEW" ]; then
  log "已是最新（${NEW:0:7}），无需部署"
  exit 0
fi

log "发现新提交 ${OLD:0:7} -> ${NEW:0:7}"

# diff 的起点用「上次成功部署的提交」；没有标记（首次部署）时退回 OLD
BASE=$OLD
if [ -n "$DEPLOYED" ] && run_as_owner git -C "$APP_DIR" cat-file -e "${DEPLOYED}^{commit}" 2>/dev/null; then
  BASE=$DEPLOYED
fi
CHANGED=$(run_as_owner git -C "$APP_DIR" diff --name-only "$BASE" "$NEW")
# 工作区已经是 NEW 时 reset 是空操作，但 diff 仍要按 BASE 计算
if [ "$BASE" != "$OLD" ]; then
  log "上次成功部署停在 ${BASE:0:7}，本轮按 ${BASE:0:7}..${NEW:0:7} 计算变更"
fi

# .env 在 .gitignore 里，reset 不会动它；uploads / private-esign 也不跟踪
run_as_owner git -C "$APP_DIR" reset --hard --quiet "$NEW"

server_changed=0
echo "$CHANGED" | grep -q '^server/' && server_changed=1 || true

if echo "$CHANGED" | grep -qE '^server/package(-lock)?\.json$'; then
  log "后端依赖有变化，执行 npm ci"
  run_as_owner npm --prefix "$APP_DIR/server" ci --omit=dev --no-audit --no-fund
  server_changed=1
fi

# 迁移是幂等的，每次都跑；它不改变 server_changed ——
# 只改管理后台的提交不应该顺带重启后端
log "执行数据库迁移"
run_as_owner npm --prefix "$APP_DIR/server" run migrate

# 管理后台：只在 admin/ 有改动或 dist 缺失时构建，避免每次部署都花几分钟
if echo "$CHANGED" | grep -q '^admin/' || [ ! -f "$APP_DIR/admin/dist/index.html" ]; then
  log "构建管理后台"
  if [ ! -d "$APP_DIR/admin/node_modules" ] || echo "$CHANGED" | grep -q '^admin/pnpm-lock\.yaml$'; then
    NODE_OPTIONS="$NODE_OPTIONS" pnpm --dir "$APP_DIR/admin" install --frozen-lockfile
  fi
  NODE_OPTIONS="$NODE_OPTIONS" pnpm --dir "$APP_DIR/admin" build
  # nginx 以 www 运行，只需读权限；不要 chown 成 root 之外的用户，
  # 否则下次以 root 构建时又会改回来，来回折腾
  chmod -R a+rX "$APP_DIR/admin/dist"
fi

if [ "$server_changed" -eq 1 ]; then
  log "重启 renovation-api"
  systemctl restart renovation-api

  # 重启后确认进程真的能对外服务；失败时保留日志并以非零退出，
  # systemd 会把这次部署标为 failed
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
      log "健康检查通过"
      echo "$NEW" > "$MARKER_FILE"
      log "部署完成：${NEW:0:7}"
      exit 0
    fi
    sleep 2
  done

  log "健康检查失败：$HEALTH_URL 连续 40 秒不可用"
  journalctl -u renovation-api -n 50 --no-pager || true
  exit 1
fi

echo "$NEW" > "$MARKER_FILE"
log "仅前端有变化，不重启后端。部署完成：${NEW:0:7}"
